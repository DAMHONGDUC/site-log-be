import { ApiRoutes } from '../../src/constants/http/api-routes.js';
import { expect } from 'vitest';
import { auth, ids, type TestContext } from './helpers.js';

// Push and pull as a user, as the app does. Both must answer 200.
export async function pushAs(context: TestContext, uid: string, mutations: object[]) {
  const response = await context.app.inject({
    method: 'POST',
    url: ApiRoutes.SYNC_PUSH,
    headers: auth(uid),
    payload: { mutations },
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

export async function pullAs(context: TestContext, uid: string, since: number, limit = 500) {
  const response = await context.app.inject({
    method: 'POST',
    url: ApiRoutes.SYNC_PULL,
    headers: auth(uid),
    payload: { since, limit },
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

// Full-row upserts for the F03 tables.
export function projectMutation(id: string, clientUpdatedAt: string, name: string) {
  return {
    table: 'projects',
    id,
    op: 'upsert',
    clientUpdatedAt,
    fields: { name, address: null, clientName: null, createdAt: '2026-11-01T08:00:00.000Z' },
  };
}

export function locationMutation(clientUpdatedAt: string, code: string, id: string = ids.location) {
  return {
    table: 'locations',
    id,
    op: 'upsert',
    clientUpdatedAt,
    fields: { projectId: ids.project, parentId: null, code, kind: 'floor', sortIndex: 0 },
  };
}

export function sessionMutation(clientUpdatedAt: string, state: string) {
  return {
    table: 'sessions',
    id: ids.session,
    op: 'upsert',
    clientUpdatedAt,
    fields: {
      projectId: ids.project,
      startedAt: '2026-11-01T08:00:00.000Z',
      endedAt: null,
      surveyorName: 'An',
      note: '',
      state,
    },
  };
}

// Project, location and session in one batch: the parents most tests need.
export async function seedProject(context: TestContext, uid: string = 'alice') {
  await pushAs(context, uid, [
    projectMutation(ids.project, '2026-11-01T08:00:00.000Z', 'Tower A'),
    locationMutation('2026-11-01T08:00:00.000Z', 'L1'),
    sessionMutation('2026-11-01T08:00:00.000Z', 'active'),
  ]);
}

export function captureMutation(clientUpdatedAt: string, sha256: string, id: string = ids.capture) {
  return {
    table: 'captures',
    id,
    op: 'upsert',
    clientUpdatedAt,
    fields: {
      projectId: ids.project,
      sessionId: ids.session,
      locationId: ids.location,
      kind: 'photo',
      sha256,
      byteSize: 1000,
      capturedAt: '2026-11-01T08:05:00.000Z',
      timeConfidence: 'server',
      latitude: null,
      longitude: null,
      horizontalAccuracy: null,
      deviceModel: 'iPhone17,1',
      durationSeconds: null,
      deviceReading: null,
      remoteKey: null,
      verificationCode: null,
      excludedFromReport: false,
    },
  };
}
