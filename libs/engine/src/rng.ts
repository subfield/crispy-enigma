
import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Commit-reveal RNG.
 *
 * The server seed is generated up front and only its hash is exposed while a
 * round is live, so a player can verify afterwards that the result was fixed
 * before they committed a stake.
 */
export function createServerSeed() {
  const serverSeed = randomBytes(32).toString("hex");
  return { serverSeed, serverSeedHash: hashSeed(serverSeed) };
}

export function hashSeed(seed: string) {
  return createHash("sha256").update(seed).digest("hex");
}

export function createClientSeed() {
  return randomBytes(8).toString("hex");
}

/**
 * Deterministic float in [0, 1) derived from the seed triple.
 *
 * `cursor` lets one round draw several independent numbers (Mines needs one
 * per placed mine) without reusing a value.
 */
export function seededFloat(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  cursor = 0,
): number {
  const hmac = createHmac("sha256", serverSeed)
    .update(`${clientSeed}:${nonce}:${cursor}`)
    .digest("hex");

  // 52 bits keeps the result inside the exact-integer range of a double.
  const slice = hmac.slice(0, 13);
  return Number.parseInt(slice, 16) / 2 ** 52;
}

/** Integer in [min, max]. */
export function seededInt(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  min: number,
  max: number,
  cursor = 0,
): number {
  const float = seededFloat(serverSeed, clientSeed, nonce, cursor);
  return min + Math.floor(float * (max - min + 1));
}

/**
 * Fisher-Yates over a seeded stream. Used to lay out the Mines grid.
 *
 * `cursorOffset` keeps independent shuffles from colliding when one round
 * draws several of them (Towers needs one shuffle per floor).
 */
export function seededShuffle<T>(
  items: readonly T[],
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  cursorOffset = 0,
): T[] {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(
      seededFloat(serverSeed, clientSeed, nonce, cursorOffset + i) * (i + 1),
    );
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}
