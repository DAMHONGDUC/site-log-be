import { randomInt } from 'node:crypto';
import { VERIFICATION_CODE_ALPHABET } from '../../../constants/runtime/limits.js';

export function newVerificationCode(length: number = 10): string {
  let code = '';

  for (let index = 0; index < length; index += 1) {
    const position = randomInt(VERIFICATION_CODE_ALPHABET.length);

    code += VERIFICATION_CODE_ALPHABET[position];
  }

  return code;
}
