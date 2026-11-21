import type pg from 'pg';
import { RejectReason } from '../../../constants/http/error-codes.js';
import { withTransaction } from '../../../data/pool.js';
import { createRepositories } from '../../../data/repositories.js';
import type { IssueChange } from '../../notifications/issue-notifier.js';
import { applyBatch } from './apply.js';
import { PG, pgCode } from './sql.js';
import type { Mutation, MutationResult, PushContext, PushOutcome } from './types.js';
import { MUTATION_STATUS } from '../../../constants/data/sync.js';

export type { Mutation, MutationResult, PushContext, PushOutcome, PushResult } from './types.js';

function isForeignKeyViolation(error: unknown): boolean {
  return pgCode(error) === PG.foreignKeyViolation;
}

// Fast path: the whole batch in one transaction. Foreign keys are checked at commit; if one
// fails we cannot tell which row, so the slow path retries one mutation per transaction.
export async function pushMutations(
  pool: pg.Pool,
  context: PushContext,
  mutations: Mutation[],
): Promise<PushOutcome> {
  try {
    return await withTransaction(pool, (client) => applyBatch(client, context, mutations));
  } catch (error) {
    if (!isForeignKeyViolation(error)) {
      throw error;
    }
  }

  const results: MutationResult[] = [];
  const issueChanges: IssueChange[] = [];
  for (const mutation of mutations) {
    try {
      const single = await withTransaction(pool, (client) =>
        applyBatch(client, context, [mutation]),
      );
      results.push(single.results[0]!);
      issueChanges.push(...single.issueChanges);
    } catch (error) {
      if (!isForeignKeyViolation(error)) {
        throw error;
      }
      results.push({
        id: mutation.id,
        status: MUTATION_STATUS.rejected,
        reason: RejectReason.missingParent,
      });
    }
  }
  const serverRev = await createRepositories(pool).syncState.currentRev();
  return { results, serverRev, issueChanges };
}
