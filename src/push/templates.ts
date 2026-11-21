import { DEEP_LINK, FALLBACK_NAME, type PushKind } from '../constants/push.js';
import { ISSUE_STATUS_LABEL, SEVERITY_LABEL } from '../constants/issues.js';
import { LIMITS } from '../constants/limits.js';
import { ROLE_LABEL, type Role } from '../constants/roles.js';
import { TEXT_CUT } from '../constants/units.js';

// What each push kind needs to be written.
export interface PushData {
  uploadsVerified: { sessionId: string; files: number | null; projectName: string | null };
  issueAssigned: { issueId: string; title: string; severity: string; dueDate: string | null };
  issueRechecked: { issueId: string; title: string; status: string; actorName: string };
  dueSoon: { projectId: string; projectName: string; count: number; titles: string[] };
  access:
    | { change: 'added'; projectId: string; projectName: string; actorName: string }
    | { change: 'removed'; projectName: string; actorName: string }
    | { change: 'role'; role: Role; actorName: string };
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
    title: 'Walkthrough is safe',
    body: `All ${files ?? 'the'} files${projectName ? ` of ${projectName}` : ''} are uploaded and verified.`,
    deepLink: DEEP_LINK.session(sessionId),
  }),
  issueAssigned: ({ issueId, title, severity, dueDate }) => ({
    title: `Assigned to you · ${SEVERITY_LABEL[severity] ?? 'Issue'}`,
    body: `${title}.${dueDate ? ` Due ${dueDate.slice(0, TEXT_CUT.isoDate)}.` : ''}`,
    deepLink: DEEP_LINK.issue(issueId),
  }),
  issueRechecked: ({ issueId, title, status, actorName }) => ({
    title: `Re-check: ${ISSUE_STATUS_LABEL[status] ?? status}`,
    body: `${actorName || FALLBACK_NAME.actor} re-checked ${title}.`,
    deepLink: DEEP_LINK.issue(issueId),
  }),
  dueSoon: ({ projectId, projectName, count, titles }) => ({
    title: count === 1 ? '1 issue due tomorrow' : `${count} issues due tomorrow`,
    body: `${projectName} · ${titles.slice(0, LIMITS.dueSoonTitlesInBody).join(', ')}`,
    deepLink: DEEP_LINK.project(projectId),
  }),
  access: (data) => {
    const actor = data.actorName || FALLBACK_NAME.admin;
    if (data.change === 'role') {
      return {
        title: `Your role is now ${ROLE_LABEL[data.role]}`,
        body: `${actor} changed your role.`,
        deepLink: DEEP_LINK.none,
      };
    }
    if (data.change === 'added') {
      return {
        title: `Added to ${data.projectName || FALLBACK_NAME.project}`,
        body: `${actor} added you to this project.`,
        deepLink: DEEP_LINK.project(data.projectId),
      };
    }
    return {
      title: `Removed from ${data.projectName || FALLBACK_NAME.project}`,
      body: `${actor} removed you from this project.`,
      deepLink: DEEP_LINK.none,
    };
  },
};
