import type { FastifyBaseLogger } from 'fastify';
import pg from 'pg';
import type { WebSocket } from 'ws';
import type { Config } from '../../core/config.js';
import { DURATIONS } from '../../constants/runtime/durations.js';
import { UploadRepository, type UploadSnapshotRow } from '../uploads/index.js';
import { toDrizzle } from '../../data/drizzle.js';
import { connectionOptions } from '../../data/pool.js';
import type { UploadEvent } from './events.js';
import {
  SOCKET_EVENT,
  UPLOAD_EVENTS_LISTEN,
  WS_MESSAGE,
  JOB_FAILURE,
} from '../../constants/domain/realtime.js';
import { LOG } from '../../constants/messages/log.js';
import { UPLOAD_STATE, VERIFY_STATE } from '../../constants/data/enums.js';

export interface ClientSocket {
  socket: WebSocket;
  uid: string;
  sessions: Set<string>;
}

// Keeps the open sockets of this process and forwards upload events to them.
// Events reach every process through one LISTEN connection, so it works with 1 or 10 servers.
// Delivery is best effort: on reconnect the app gets a full snapshot.
export class RealtimeHub {
  private readonly config: Config;
  private readonly pool: pg.Pool;
  private readonly sockets = new Map<string, Set<ClientSocket>>();
  private listener: pg.Client | undefined;
  private log: FastifyBaseLogger | undefined;
  private stopped = false;

  constructor(config: Config, pool: pg.Pool) {
    this.config = config;
    this.pool = pool;
  }

  // false when the user already has the maximum number of sockets open.
  add(client: ClientSocket): boolean {
    let set = this.sockets.get(client.uid);
    if (set === undefined) {
      set = new Set();
      this.sockets.set(client.uid, set);
    }
    if (set.size >= this.config.maxSocketsPerUser) {
      return false;
    }
    set.add(client);
    return true;
  }

  remove(client: ClientSocket): void {
    const set = this.sockets.get(client.uid);
    if (set === undefined) {
      return;
    }
    set.delete(client);
    if (set.size === 0) {
      this.sockets.delete(client.uid);
    }
  }

  async start(log: FastifyBaseLogger): Promise<void> {
    this.log = log;
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.listener !== undefined) {
      await this.listener.end();
      this.listener = undefined;
    }
  }

  private async connect(): Promise<void> {
    // A dedicated connection outside the pool: LISTEN must stay on one connection.
    const listener = new pg.Client(connectionOptions(this.config));
    listener.on(SOCKET_EVENT.notification, (message) => {
      void this.onNotification(message.payload);
    });
    listener.on(SOCKET_EVENT.error, (error) => {
      this.log?.error({ err: error }, LOG.realtime.listenerLost);
      this.listener = undefined;
      void listener.end().catch(() => undefined);
      this.scheduleReconnect();
    });
    await listener.connect();
    await listener.query(UPLOAD_EVENTS_LISTEN);
    this.listener = listener;
    this.log?.info(LOG.realtime.listening);
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }
    setTimeout(() => {
      this.connect().catch((error) => {
        this.log?.error({ err: error }, LOG.realtime.reconnectFailed);
        this.scheduleReconnect();
      });
    }, DURATIONS.listenerReconnectMs);
  }

  private async onNotification(payload: string | undefined): Promise<void> {
    if (payload === undefined) {
      return;
    }
    try {
      const event = JSON.parse(payload) as UploadEvent;
      if (event.sessionId === null) {
        return;
      }
      // F19: every member watching the session gets it, not only the uploader.
      // The payload holds ids only: read the current state of the row.
      const row = await new UploadRepository(toDrizzle(this.pool)).snapshot(event.uploadId);
      if (row === undefined) {
        return;
      }
      const message = uploadMessage(row);
      if (message === undefined) {
        return;
      }
      for (const set of this.sockets.values()) {
        for (const client of set) {
          if (client.sessions.has(event.sessionId)) {
            send(client.socket, message);
          }
        }
      }
    } catch (error) {
      this.log?.error({ err: error }, LOG.realtime.forwardFailed);
    }
  }
}

export function send(socket: WebSocket, message: object): void {
  // 1 = OPEN
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}

// The message the app gets for one upload row, or undefined while it is still uploading.
export function uploadMessage(row: UploadSnapshotRow): object | undefined {
  if (row.state === UPLOAD_STATE.aborted) {
    return { type: WS_MESSAGE.jobFailed, jobID: row.id, reason: JOB_FAILURE.aborted };
  }
  if (row.state !== UPLOAD_STATE.completed) {
    return undefined;
  }
  if (row.verifyState === VERIFY_STATE.mismatch) {
    return { type: WS_MESSAGE.jobFailed, jobID: row.id, reason: JOB_FAILURE.integrity };
  }
  return {
    type: WS_MESSAGE.jobCompleted,
    jobID: row.id,
    remoteKey: row.objectKey,
    sha256: row.sha256,
    verified: row.verifyState === VERIFY_STATE.verified,
  };
}
