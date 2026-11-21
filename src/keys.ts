// F19: object keys follow the project, not the person (01-api §7.1).
// Checking the full shape stops a caller from signing URLs for paths like "../".

const UUID = '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}';

const capturePattern = new RegExp(
  `^projects/(${UUID})/(${UUID})/(${UUID})\\.(jpg|heic|png|mov|mp4|m4a)$`,
);
const planPattern = new RegExp(`^projects/(${UUID})/plans/(${UUID})\\.(pdf|jpg|png|heic)$`);
const brandingPattern = new RegExp(`^company/branding/(${UUID})\\.(png|jpg)$`);

export type ParsedKey =
  | { kind: 'capture'; projectId: string; sessionId: string; captureId: string }
  | { kind: 'plan'; projectId: string; sheetId: string }
  | { kind: 'branding'; projectId: null; logoId: string };

export function parseKey(key: string): ParsedKey | undefined {
  const capture = capturePattern.exec(key);
  if (capture !== null) {
    return {
      kind: 'capture',
      projectId: capture[1]!.toLowerCase(),
      sessionId: capture[2]!.toLowerCase(),
      captureId: capture[3]!.toLowerCase(),
    };
  }
  const plan = planPattern.exec(key);
  if (plan !== null) {
    return { kind: 'plan', projectId: plan[1]!.toLowerCase(), sheetId: plan[2]!.toLowerCase() };
  }
  const branding = brandingPattern.exec(key);
  if (branding !== null) {
    return { kind: 'branding', projectId: null, logoId: branding[1]!.toLowerCase() };
  }
  return undefined;
}
