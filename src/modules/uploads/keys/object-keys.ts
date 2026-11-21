import { KEY_KIND, KEY_SHAPE } from '../../../constants/domain/object-keys.js';
// F19: object keys follow the project, not the person (01-api §7.1).
// Checking the full shape stops a caller from signing URLs for paths like "../".

export type ParsedKey =
  | { kind: typeof KEY_KIND.capture; projectId: string; sessionId: string; captureId: string }
  | { kind: typeof KEY_KIND.plan; projectId: string; sheetId: string }
  | { kind: typeof KEY_KIND.branding; projectId: null; logoId: string };

export function parseKey(key: string): ParsedKey | undefined {
  const capture = KEY_SHAPE.capture.exec(key);
  if (capture !== null) {
    return {
      kind: KEY_KIND.capture,
      projectId: capture[1]!.toLowerCase(),
      sessionId: capture[2]!.toLowerCase(),
      captureId: capture[3]!.toLowerCase(),
    };
  }
  const plan = KEY_SHAPE.plan.exec(key);
  if (plan !== null) {
    return {
      kind: KEY_KIND.plan,
      projectId: plan[1]!.toLowerCase(),
      sheetId: plan[2]!.toLowerCase(),
    };
  }
  const branding = KEY_SHAPE.branding.exec(key);
  if (branding !== null) {
    return { kind: KEY_KIND.branding, projectId: null, logoId: branding[1]!.toLowerCase() };
  }
  return undefined;
}
