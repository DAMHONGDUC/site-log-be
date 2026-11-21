import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Action } from '../../constants/domain/roles.js';
import { can } from '../../modules/team/permissions.js';
import { forbidden } from '../errors.js';

// preHandlers every route picks from.
export interface Guards {
  // A member (valid token + member record).
  requireUser: preHandlerAsyncHookHandler;
  // Any Firebase user (accepting an invitation, leaving the company).
  requireSignedIn: preHandlerAsyncHookHandler;
}

// A member whose role may do `action` (runs after requireUser).
export function requireAction(action: Action): preHandlerAsyncHookHandler {
  return async function allowed(request: FastifyRequest): Promise<void> {
    if (!can(request.member.role, action)) {
      throw forbidden();
    }
  };
}

// requireUser, then the role check.
export function memberMay(guards: Guards, action: Action): preHandlerAsyncHookHandler[] {
  return [guards.requireUser, requireAction(action)];
}
