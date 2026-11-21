import type pg from 'pg';
import { RejectReason } from '../../../constants/http/error-codes.js';
import type { Action } from '../../../constants/domain/roles.js';
import { reaches } from '../../team/members/member.js';
import { can } from '../../team/access/permissions.js';
import type { SyncTable } from '../tables.js';
import type { Batch, Mutation, PushContext } from './types.js';

// Created by the caller, today in the site time zone (Inspectors may delete those).
async function ownSameDay(
  client: pg.PoolClient,
  stored: Record<string, unknown>,
  context: PushContext,
): Promise<boolean> {
  if (stored.created_by !== context.member.uid || !('server_created_at' in stored)) {
    return false;
  }
  const result = await client.query<{ same: boolean }>(
    `select (($1::timestamptz at time zone $2)::date = (now() at time zone $2)::date) as same`,
    [stored.server_created_at, context.siteTimeZone],
  );
  return result.rows[0]?.same === true;
}

function actionFor(table: SyncTable, mutation: Mutation, isNew: boolean): Action {
  if (mutation.op === 'delete') {
    return table.deleteAction;
  }
  if (table.scope === 'projects' && isNew) {
    return 'project.create';
  }
  return table.writeAction;
}

// null = allowed; otherwise the rejection reason (05 §3, enforced row by row).
export async function permissionProblem(
  client: pg.PoolClient,
  batch: Batch,
  table: SyncTable,
  mutation: Mutation,
  stored: Record<string, unknown> | undefined,
  projectId: string | null,
): Promise<string | null> {
  const { member } = batch.context;
  const isNew = stored === undefined;
  const action = actionFor(table, mutation, isNew);
  if (table.scope === 'personal') {
    if (!isNew && stored.uid !== member.uid) {
      return RejectReason.forbidden;
    }
  } else {
    const creatingProject = table.scope === 'projects' && isNew;
    if (!creatingProject && !reaches(batch.reach, projectId)) {
      return RejectReason.forbiddenAction(action);
    }
  }
  const own =
    mutation.op === 'delete' && !isNew && (await ownSameDay(client, stored, batch.context));
  if (!can(member.role, action, { ownSameDay: own })) {
    return RejectReason.forbiddenAction(action);
  }
  return null;
}
