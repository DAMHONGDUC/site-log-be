import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { AppDeps } from '../../app.js';
import { TokenRejectedError } from '../../core/auth.js';
import { ApiRoutes } from '../../constants/http/api-routes.js';
import { DURATIONS } from '../../constants/runtime/durations.js';
import { WS_CLOSE } from '../../constants/runtime/websocket.js';
import { reaches, type Member } from '../team/member.js';
import { type ClientSocket, send, uploadMessage } from './hub.js';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface IncomingMessage {
  type?: unknown;
  token?: unknown;
  sessionID?: unknown;
  at?: unknown;
}

// /ws: an observation channel. The token comes in the first message, never in the URL.
export function websocketRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get(ApiRoutes.WEBSOCKET, { websocket: true }, (socket: WebSocket, request) => {
    let client: ClientSocket | undefined = undefined;
    let member: Member | undefined = undefined;
    let expiryTimer: NodeJS.Timeout | undefined = undefined;
    const authTimer = setTimeout(
      () => socket.close(WS_CLOSE.authTimeout, 'auth timeout'),
      DURATIONS.websocketAuthTimeoutMs,
    );

    async function authenticate(token: unknown): Promise<void> {
      if (typeof token !== 'string') {
        socket.close(WS_CLOSE.token, 'missing token');
        return;
      }
      try {
        const verified = await deps.tokens.verify(token);
        const lookup = await deps.services.access.lookup(verified.uid);
        if (lookup.status !== 'member') {
          clearTimeout(authTimer);
          socket.close(WS_CLOSE.forbidden, 'not a member');
          return;
        }
        member = lookup.member;
        clearTimeout(authTimer);
        const candidate: ClientSocket = { socket, uid: verified.uid, sessions: new Set() };
        if (!deps.hub.add(candidate)) {
          socket.close(WS_CLOSE.tooManySockets, 'too many sockets');
          return;
        }
        client = candidate;
        // Close when the token expires; the app refreshes it and reconnects.
        const msLeft = verified.expiresAt.getTime() - Date.now();
        expiryTimer = setTimeout(
          () => socket.close(WS_CLOSE.token, 'token expired'),
          Math.max(msLeft, 0),
        );
        request.log.info({ uid: verified.uid }, 'ws: authenticated');
      } catch (error) {
        if (!(error instanceof TokenRejectedError)) {
          request.log.error({ err: error }, 'ws: token check failed');
        }
        socket.close(WS_CLOSE.token, 'invalid token');
      }
    }

    async function subscribe(current: ClientSocket, sessionID: unknown): Promise<void> {
      if (typeof sessionID !== 'string' || !UUID.test(sessionID)) {
        return;
      }
      const sessionId = sessionID.toLowerCase();
      // F19: the session's project must be reachable, else the socket closes.
      const projects = await deps.db.repos.uploads.projectsOfSession(sessionId);
      const reach = await deps.services.access.reach(member!);
      for (const projectId of projects) {
        if (!reaches(reach, projectId)) {
          request.log.warn({ uid: current.uid }, 'ws: subscribe to an unreachable session');
          socket.close(WS_CLOSE.forbidden, 'forbidden');
          return;
        }
      }
      current.sessions.add(sessionId);

      // The snapshot is always the first answer: it is how the app recovers anything it missed.
      const rows = await deps.db.repos.uploads.finishedInSession(sessionId);
      const completed: object[] = [];
      const failed: object[] = [];
      for (const row of rows) {
        const message = uploadMessage(row) as { type: string; [key: string]: unknown } | undefined;
        if (message === undefined) {
          continue;
        }
        const { type, ...item } = message;
        if (type === 'jobCompleted') {
          completed.push(item);
        } else {
          failed.push(item);
        }
      }
      send(socket, { type: 'snapshot', sessionID: sessionId, completed, failed });
    }

    async function handle(raw: string): Promise<void> {
      let message: IncomingMessage;
      try {
        message = JSON.parse(raw) as IncomingMessage;
      } catch {
        request.log.warn('ws: message is not JSON');
        return;
      }
      if (client === undefined) {
        if (message.type === 'auth') {
          await authenticate(message.token);
        } else {
          socket.close(WS_CLOSE.token, 'auth first');
        }
        return;
      }
      if (message.type === 'subscribe') {
        await subscribe(client, message.sessionID);
      } else if (message.type === 'ping') {
        send(socket, { type: 'pong', at: message.at });
      }
    }

    // Messages are handled one at a time, in order: a subscribe never overtakes its auth.
    let queue: Promise<void> = Promise.resolve();
    socket.on('message', (data) => {
      queue = queue
        .then(() => handle(data.toString()))
        .catch((error) => request.log.error({ err: error }, 'ws: message failed'));
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      clearTimeout(expiryTimer);
      if (client !== undefined) {
        deps.hub.remove(client);
      }
    });
  });
}
