import bcrypt from "bcrypt";

/**
 * How passwords are hashed: bcrypt at one cost everywhere (signup, reset,
 * unusable placeholder hashes). It was 10 at signup and 12 on reset.
 */
export const BCRYPT_ROUNDS = 12;

/**
 * bcrypt reads at most 72 bytes; anything after is silently ignored. Arabic
 * letters take two bytes each in UTF-8, so the limit is checked in bytes
 * (lib/validations), never in characters.
 */
export const BCRYPT_MAX_BYTES = 72;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * A bcrypt hash of random bytes nobody kept: matches no password. Fixed, so
 * a cold instance spends no extra work making it.
 *
 * Its cost is 10, not BCRYPT_ROUNDS, because most existing accounts were
 * hashed at 10 (signup used 10 until this change), and a failed check costs
 * whatever the stored hash's own cost is. Matching the common case keeps a
 * "no such account" answer as slow as a wrong password on a typical one.
 */
const DUMMY_HASH = "$2b$10$HfTMKIVoNjocWozlibEPdOjCkQA/mkvdj7PdxAmdEulLITuG7sL/W";

/**
 * Spend the same work as a real check when no account (or no password) was
 * found, so a failed sign-in takes as long whether or not the address has an
 * account.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  await bcrypt.compare(password, DUMMY_HASH);
}
