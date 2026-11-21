import type { Member, Reach } from '../../domain/member.js';
import type { AccessService } from '../../services/access-service.js';
import type { IssueChange } from '../../services/issue-notifier.js';

export interface Mutation {
  table: string;
  id: string;
  op: 'upsert' | 'delete';
  clientUpdatedAt: string;
  fields: Record<string, unknown>;
}

export type MutationResult =
  | { id: string; status: 'applied' }
  | { id: string; status: 'superseded'; serverRow: Record<string, unknown> }
  | { id: string; status: 'rejected'; reason: string };

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
