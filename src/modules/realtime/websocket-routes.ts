import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from 'ws';
import { TokenRejectedError } from '../../core/auth.js';
import { ApiRoutes } from '../../constants/http/api-routes.js';
import { DURATIONS } from '../../constants/runtime/durations.js';
import { WS_CLOSE } from '../../constants/runtime/websocket.js';
import { reaches, type Member } from '../team/members/member.js';
import { type ClientSocket, send, uploadMessage } from './hub.js';
import { WS_CLOSE_REASON, WS_MESSAGE, SOCKET_EVENT } from '../../constants/domain/realtime.js';
import { MEMBER_LOOKUP } from '../../constants/domain/team.js';
import { LOG } from '../../constants/messages/log.js';
import { UUID_SHAPE } from '../../constants/domain/object-keys.js';

interface IncomingMessage {
  type?: unknown;
  token?: unknown;
  sessionID?: unknown;
  at?: unknown;
}

// /ws: an observation channel. The token comes in the first message, never in the URL.
export const websocketRoutes: FastifyPluginAsync = async (app) => {
  const { deps } = app;
  app.get(ApiRoutes.WEBSOCKET, { websocket: true }, (socket: WebSocket, request) => {
    let client: ClientSocket | undefined = undefined;
    let member: Member | undefined = undefined;
    let expiryTimer: NodeJS.Timeout | undefined = undefined;
    const authTimer = setTimeout(
      () => socket.close(WS_CLOSE.authTimeout, WS_CLOSE_REASON.authTimeout),
      DURATIONS.websocketAuthTimeoutMs,
    );

    async function authenticate(token: unknown): Promise<void> {
      if (typeof token !== 'string') {
        socket.close(WS_CLOSE.token, WS_CLOSE_REASON.missingToken);
        return;
      }
      try {
        const verified = await deps.tokens.verify(token);
        const lookup = await deps.services.access.lookup(verified.uid);
        if (lookup.status !== MEMBER_LOOKUP.member) {
          clearTimeout(authTimer);
          socket.close(WS_CLOSE.forbidden, WS_CLOSE_REASON.notMember);
          return;
        }
        member = lookup.member;
        clearTimeout(authTimer);
        const candidate: ClientSocket = { socket, uid: verified.uid, sessions: new Set() };
        if (!deps.hub.add(candidate)) {
          socket.close(WS_CLOSE.tooManySockets, WS_CLOSE_REASON.tooManySockets);
          return;
        }
        client = candidate;
        // Close when the token expires; the app refreshes it and reconnects.
        const msLeft = verified.expiresAt.getTime() - Date.now();
        expiryTimer = setTimeout(
          () => socket.close(WS_CLOSE.token, WS_CLOSE_REASON.tokenExpired),
          Math.max(msLeft, 0),
        );
        request.log.info({ uid: verified.uid }, LOG.ws.authenticated);
      } catch (error) {
        if (!(error instanceof TokenRejectedError)) {
          request.log.error({ err: error }, LOG.ws.tokenCheckFailed);
        }
        socket.close(WS_CLOSE.token, WS_CLOSE_REASON.invalidToken);
      }
    }

    async function subscribe(current: ClientSocket, sessionID: unknown): Promise<void> {
      if (typeof sessionID !== 'string' || !UUID_SHAPE.test(sessionID)) {
        return;
      }
      const sessionId = sessionID.toLowerCase();
      // F19: the session's project must be reachable, else the socket closes.
      const projects = await deps.db.repos.uploads.projectsOfSession(sessionId);
      const reach = await deps.services.access.reach(member!);
      for (const projectId of projects) {
        if (!reaches(reach, projectId)) {
          request.log.warn({ uid: current.uid }, LOG.ws.unreachableSession);
          socket.close(WS_CLOSE.forbidden, WS_CLOSE_REASON.forbidden);
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
        if (type === WS_MESSAGE.jobCompleted) {
          completed.push(item);
        } else {
          failed.push(item);
        }
      }
      send(socket, { type: WS_MESSAGE.snapshot, sessionID: sessionId, completed, failed });
    }

    async function handle(raw: string): Promise<void> {
      let message: IncomingMessage;
      try {
        message = JSON.parse(raw) as IncomingMessage;
      } catch {
        request.log.warn(LOG.ws.notJson);
        return;
      }
      if (client === undefined) {
        if (message.type === WS_MESSAGE.auth) {
          await authenticate(message.token);
        } else {
          socket.close(WS_CLOSE.token, WS_CLOSE_REASON.authFirst);
        }
        return;
      }
      if (message.type === WS_MESSAGE.subscribe) {
        await subscribe(client, message.sessionID);
      } else if (message.type === WS_MESSAGE.ping) {
        send(socket, { type: WS_MESSAGE.pong, at: message.at });
      }
    }

    // Messages are handled one at a time, in order: a subscribe never overtakes its auth.
    let queue: Promise<void> = Promise.resolve();
    socket.on(SOCKET_EVENT.message, (data) => {
      queue = queue
        .then(() => handle(data.toString()))
        .catch((error) => request.log.error({ err: error }, LOG.ws.messageFailed));
    });

    socket.on(SOCKET_EVENT.close, () => {
      clearTimeout(authTimer);
      clearTimeout(expiryTimer);
      if (client !== undefined) {
        deps.hub.remove(client);
      }
    });
  });
};
