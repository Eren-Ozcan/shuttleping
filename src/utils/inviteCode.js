import { randomInt } from 'node:crypto'

// Excludes 0/O/1/I — a passenger reads this off a screen or a text message
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Generates a short human-typeable invite code, e.g. "K7M2QX8P". */
export function generateInviteCode(length = 8) {
  let code = ''
  for (let i = 0; i < length; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)]
  }
  return code
}
