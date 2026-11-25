// The words of every push (01-api §10). Labels and fallbacks live in domain/push and domain/issues.
export const PUSH_TEXT = {
  uploadsVerified: {
    title: 'Walkthrough is safe',
    body: (files: number | null, projectName: string | null) =>
      `All ${files ?? 'the'} files${projectName ? ` of ${projectName}` : ''} are uploaded and verified.`,
  },
  issueAssigned: {
    title: (severityLabel: string | undefined) => `Assigned to you · ${severityLabel ?? 'Issue'}`,
    body: (title: string, dueDate: string | null) =>
      `${title}.${dueDate ? ` Due ${dueDate}.` : ''}`,
  },
  issueRechecked: {
    title: (statusLabel: string) => `Re-check: ${statusLabel}`,
    body: (actor: string, title: string) => `${actor} re-checked ${title}.`,
  },
  dueSoon: {
    title: (count: number) =>
      count === 1 ? '1 issue due tomorrow' : `${count} issues due tomorrow`,
    body: (projectName: string, titles: string[]) => `${projectName} · ${titles.join(', ')}`,
  },
  access: {
    roleTitle: (roleLabel: string) => `Your role is now ${roleLabel}`,
    roleBody: (actor: string) => `${actor} changed your role.`,
    addedTitle: (projectName: string) => `Added to ${projectName}`,
    addedBody: (actor: string) => `${actor} added you to this project.`,
    removedTitle: (projectName: string) => `Removed from ${projectName}`,
    removedBody: (actor: string) => `${actor} removed you from this project.`,
  },
} as const;
