import { randomInt } from 'node:crypto';

// No 0/O, 1/I/L: a code printed in a PDF must be easy to type.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function newVerificationCode(length: number = 10): string {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    const position = randomInt(ALPHABET.length);
    code += ALPHABET[position];
  }
  return code;
}
