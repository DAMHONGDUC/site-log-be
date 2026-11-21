import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { FastifyRequest } from 'fastify';
import { ErrorCode } from '../constants/http/error-codes.js';
import { MS_PER_SECOND } from '../constants/runtime/units.js';
import type { Member } from '../modules/team/member.js';
import { forbidden, serviceUnavailable, unauthorized } from './errors.js';
import type { AccessService } from '../modules/team/access-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    // Set by requireUser on every authenticated route.
    uid: string;
    // Set by requireUser: the caller's member record (F19).
    member: Member;
    // The email in the ID token (used to accept an invitation).
    email: string | undefined;
  }
}

export interface VerifiedToken {
  uid: string;
  expiresAt: Date;
  email?: string | undefined;
}

// Checks a Firebase ID token. Tests pass a fake; production uses Firebase.
export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
  deleteUser(uid: string): Promise<void>;
  // Signs the user out everywhere (F19: a removed member).
  revoke(uid: string): Promise<void>;
}

// The token itself is bad (expired, revoked, malformed): the app should refresh and retry.
export class TokenRejectedError extends Error {}

function isTokenProblem(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = String(error.code);
  return code.startsWith('auth/') && code !== 'auth/internal-error';
}

export function createFirebaseVerifier(serviceAccountBase64: string): TokenVerifier {
  const json = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');
  const serviceAccount = JSON.parse(json);
  const firebaseApp = initializeApp({ credential: cert(serviceAccount) });
  const auth = getAuth(firebaseApp);

  return {
    async verify(token: string): Promise<VerifiedToken> {
      try {
        // true = also check that the token was not revoked (sign out everywhere, deleted user)
        const decoded = await auth.verifyIdToken(token, true);
        return {
          uid: decoded.uid,
          expiresAt: new Date(decoded.exp * MS_PER_SECOND),
          email: decoded.email,
        };
      } catch (error) {
        if (isTokenProblem(error)) {
          throw new TokenRejectedError(String((error as { code: string }).code));
        }
        throw error;
      }
    },

    async revoke(uid: string): Promise<void> {
      try {
        await auth.revokeRefreshTokens(uid);
      } catch (error) {
        if ((error as { code?: string }).code === 'auth/user-not-found') {
          return;
        }
        throw error;
      }
    },

    async deleteUser(uid: string): Promise<void> {
      try {
        await auth.deleteUser(uid);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'auth/user-not-found') {
          // Already gone: deleting the account is idempotent.
          return;
        }
        throw error;
      }
    },
  };
}

// Token only, no membership: the caller is someone Firebase knows (accepting an invitation).
// Failures are 401: the app refreshes the token and retries.
export function makeRequireSignedIn(tokens: TokenVerifier) {
  return async function requireSignedIn(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization;
    if (header === undefined || !header.startsWith('Bearer ')) {
      throw unauthorized(ErrorCode.missingToken);
    }
    const token = header.slice('Bearer '.length);
    try {
      const verified = await tokens.verify(token);
      request.uid = verified.uid;
      request.email = verified.email;
    } catch (error) {
      if (error instanceof TokenRejectedError) {
        request.log.warn({ reason: error.message }, 'token rejected');
        throw unauthorized(ErrorCode.invalidToken);
      }
      request.log.error({ err: error }, 'token check failed');
      throw serviceUnavailable(ErrorCode.authUnavailable);
    }
  };
}

// preHandler for every route that needs a member: a valid token, then a member record.
// Not a member: 403 not_invited (the app shows "Ask an Admin to invite you").
// Removed member: 401 (signs out). A bad token stays 401, never 403.
export function makeRequireUser(tokens: TokenVerifier, access: AccessService) {
  const requireSignedIn = makeRequireSignedIn(tokens);
  return async function requireUser(request: FastifyRequest): Promise<void> {
    await requireSignedIn(request);
    const lookup = await access.lookup(request.uid);
    if (lookup.status === 'unknown') {
      request.log.warn({ uid: request.uid }, 'not a member');
      throw forbidden(ErrorCode.notInvited, 'Ask an Admin to invite you');
    }
    if (lookup.status === 'removed') {
      request.log.warn({ uid: request.uid }, 'removed member');
      throw unauthorized(ErrorCode.memberRemoved);
    }
    request.member = lookup.member;
  };
}
