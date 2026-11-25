import { DEEP_LINK, FALLBACK_NAME, type PushKind } from '../../constants/domain/push.js';
import { ISSUE_STATUS_LABEL, SEVERITY_LABEL } from '../../constants/domain/issues.js';
import { LIMITS } from '../../constants/runtime/limits.js';
import { ROLE_LABEL, type Role } from '../../constants/domain/roles.js';
import { TEXT_CUT } from '../../constants/runtime/units.js';
import { PUSH_TEXT } from '../../constants/messages/push-text.js';
import { ACCESS_CHANGE } from '../../constants/domain/team.js';

// What each push kind needs to be written.
export interface PushData {
  uploadsVerified: { sessionId: string; files: number | null; projectName: string | null };
  issueAssigned: { issueId: string; title: string; severity: string; dueDate: string | null };
  issueRechecked: { issueId: string; title: string; status: string; actorName: string };
  dueSoon: { projectId: string; projectName: string; count: number; titles: string[] };
  access:
    | {
        change: typeof ACCESS_CHANGE.added;
        projectId: string;
        projectName: string;
        actorName: string;
      }
    | { change: typeof ACCESS_CHANGE.removed; projectName: string; actorName: string }
    | { change: typeof ACCESS_CHANGE.role; role: Role; actorName: string };
}

export interface PushContent {
  title: string;
  body: string;
  deepLink: string;
}

type Templates = { [K in PushKind]: (data: PushData[K]) => PushContent };

// One template per kind: a new kind is one entry here (and its PushData shape).
export const PUSH_TEMPLATES: Templates = {
  uploadsVerified: ({ sessionId, files, projectName }) => ({
    title: PUSH_TEXT.uploadsVerified.title,
    body: PUSH_TEXT.uploadsVerified.body(files, projectName),
    deepLink: DEEP_LINK.session(sessionId),
  }),
  issueAssigned: ({ issueId, title, severity, dueDate }) => ({
    title: PUSH_TEXT.issueAssigned.title(SEVERITY_LABEL[severity]),
    body: PUSH_TEXT.issueAssigned.body(title, dueDate?.slice(0, TEXT_CUT.isoDate) ?? null),
    deepLink: DEEP_LINK.issue(issueId),
  }),
  issueRechecked: ({ issueId, title, status, actorName }) => ({
    title: PUSH_TEXT.issueRechecked.title(ISSUE_STATUS_LABEL[status] ?? status),
    body: PUSH_TEXT.issueRechecked.body(actorName || FALLBACK_NAME.actor, title),
    deepLink: DEEP_LINK.issue(issueId),
  }),
  dueSoon: ({ projectId, projectName, count, titles }) => ({
    title: PUSH_TEXT.dueSoon.title(count),
    body: PUSH_TEXT.dueSoon.body(projectName, titles.slice(0, LIMITS.dueSoonTitlesInBody)),
    deepLink: DEEP_LINK.project(projectId),
  }),
  access: (data) => {
    const actor = data.actorName || FALLBACK_NAME.admin;
    const text = PUSH_TEXT.access;

    if (data.change === ACCESS_CHANGE.role) {
      return {
        title: text.roleTitle(ROLE_LABEL[data.role]),
        body: text.roleBody(actor),
        deepLink: DEEP_LINK.none,
      };
    }
    if (data.change === ACCESS_CHANGE.added) {
      return {
        title: text.addedTitle(data.projectName || FALLBACK_NAME.project),
        body: text.addedBody(actor),
        deepLink: DEEP_LINK.project(data.projectId),
      };
    }

    return {
      title: text.removedTitle(data.projectName || FALLBACK_NAME.project),
      body: text.removedBody(actor),
      deepLink: DEEP_LINK.none,
    };
  },
};
