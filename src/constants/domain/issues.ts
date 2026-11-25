// Issue values as the apps send them (01-api §6.3) and their words in a push.

export const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
};

export const ISSUE_STATUS_LABEL: Record<string, string> = {
  open: 'still open',
  inProgress: 'in progress',
  resolved: 'resolved',
  verified: 'verified',
};

// Statuses that still need work (due-soon pushes).
export const OPEN_ISSUE_STATUSES = ['open', 'inProgress'] as const;
