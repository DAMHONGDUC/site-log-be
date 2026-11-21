import type { Member, Reach } from '../../team/members/member.js';
import type { AccessService } from '../../team/access/access-service.js';
import type { IssueChange } from '../../notifications/issue-notifier.js';
import { MUTATION_STATUS, type MutationOp } from '../../../constants/data/sync.js';

export interface Mutation {
  table: string;
  id: string;
  op: MutationOp;
  clientUpdatedAt: string;
  fields: Record<string, unknown>;
}

export type MutationResult =
  | { id: string; status: typeof MUTATION_STATUS.applied }
  | { id: string; status: typeof MUTATION_STATUS.superseded; serverRow: Record<string, unknown> }
  | { id: string; status: typeof MUTATION_STATUS.rejected; reason: string };

export interface PushResult {
  results: MutationResult[];
  serverRev: number;
}

export interface PushOutcome extends PushResult {
  // Issue rows written by this push, for the issue pushes sent after commit.
  issueChanges: IssueChange[];
}

export interface PushContext {
  member: Member;
  siteTimeZone: string;
  access: AccessService;
}

// What one batch carries while its mutations are applied.
export class Batch {
  readonly mutations = new Map<string, Mutation>();
  readonly issueChanges: IssueChange[] = [];

  constructor(
    readonly context: PushContext,
    readonly reach: Reach,
    mutations: Mutation[],
  ) {
    for (const mutation of mutations) {
      this.mutations.set(mutation.id, mutation);
    }
  }
}
