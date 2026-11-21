// The public surface of the notifications feature: other features, the data layer and the entry
// points import from here, never from a file inside it.
export { DueSoonService } from './due-soon-service.js';
export { IssueNotifier, type IssueChange } from './issue-notifier.js';
export { NotificationService } from './notification-service.js';
