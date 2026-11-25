// Text encodings and hashes handed to Node's Buffer and crypto.
export const ENCODING = {
  utf8: 'utf8',
  base64: 'base64',
  base64url: 'base64url',
  hex: 'hex',
} as const;

export const HASH = { sha256: 'sha256' } as const;

// Joins lines of a plain-text body.
export const NEWLINE = '\n';
