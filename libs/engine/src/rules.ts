
import { seededFloat, seededInt, seededShuffle } from "./rng";
import type {
  CoinFlipSelection,
  DiceSelection,
  ForcedResult,
  KenoSelection,
  LimboSelection,
  MinesSelection,
  PlinkoSelection,
  RoundResult,
  SeedContext,
  TowersSelection,
  WheelSelection,
} from "@game/contracts";

export const MINES_TILE_COUNT = 25;

/** Payout for a fair bet at `winChance`, minus the house's cut. */
function fairMultiplier(winChance: number, houseEdge: number) {
  if (winChance <= 0) return 0;
  return round2((1 - houseEdge) / winChance);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------------------------------------------ *
 * Dice — roll 0.00-99.99, bet over or under a target
 * ------------------------------------------------------------------ */

export function diceWinChance(selection: DiceSelection) {
  const { target, direction } = selection;
  return direction === "under" ? target / 100 : (100 - target) / 100;
}

export function resolveDice(
  selection: DiceSelection,
  seeds: SeedContext,
  houseEdge: number,
  forced: ForcedResult,
): RoundResult {
  const { target, direction } = selection;
  const chance = diceWinChance(selection);
  const multiplier = fairMultiplier(chance, houseEdge);
  const float = seededFloat(seeds.serverSeed, seeds.clientSeed, seeds.nonce);

  let roll: number;

  if (forced === null) {
    roll = round2(float * 100);
  } else if (forced) {
    // Land anywhere inside the winning band.
    roll =
      direction === "under"
        ? round2(float * Math.max(target - 0.01, 0))
        : round2(target + 0.01 + float * (99.99 - target));
  } else {
    roll =
      direction === "under"
        ? round2(target + float * (99.99 - target))
        : round2(float * Math.max(target - 0.01, 0));
  }

  roll = clamp(roll, 0, 99.99);
  const won = direction === "under" ? roll < target : roll > target;

  return { won, multiplier: won ? multiplier : 0, outcome: { roll } };
}

/* ------------------------------------------------------------------ *
 * Coin Flip
 * ------------------------------------------------------------------ */

export function resolveCoinFlip(
  selection: CoinFlipSelection,
  seeds: SeedContext,
  houseEdge: number,
  forced: ForcedResult,
): RoundResult {
  const multiplier = fairMultiplier(0.5, houseEdge);
  const float = seededFloat(seeds.serverSeed, seeds.clientSeed, seeds.nonce);
  const natural: "heads" | "tails" = float < 0.5 ? "heads" : "tails";
  const opposite = selection.side === "heads" ? "tails" : "heads";

  const result = forced === null ? natural : forced ? selection.side : opposite;
  const won = result === selection.side;

  return { won, multiplier: won ? multiplier : 0, outcome: { result } };
}

/* ------------------------------------------------------------------ *
 * Limbo — a multiplier is drawn; you win if it reaches your target
 * ------------------------------------------------------------------ */

export function resolveLimbo(
  selection: LimboSelection,
  seeds: SeedContext,
  houseEdge: number,
  forced: ForcedResult,
  maxMultiplier: number,
): RoundResult {
  const target = clamp(selection.target, 1.01, maxMultiplier);
  const float = seededFloat(seeds.serverSeed, seeds.clientSeed, seeds.nonce);

  let result: number;

  if (forced === null) {
    // Inverse-transform sample so results follow the real 1/x distribution.
    result = round2(
      clamp((1 - houseEdge) / Math.max(float, 1e-9), 1, maxMultiplier),
    );
  } else if (forced) {
    result = round2(
      clamp(target + float * (maxMultiplier - target), target, maxMultiplier),
    );
  } else {
    result = round2(clamp(1 + float * (target - 1.01), 1, target - 0.01));
  }

  const won = result >= target;

  return { won, multiplier: won ? round2(target) : 0, outcome: { result } };
}

/* ------------------------------------------------------------------ *
 * Wheel — segments of fixed multipliers, three risk profiles
 * ------------------------------------------------------------------ */

export const WHEEL_SEGMENTS: Record<WheelSelection["risk"], number[]> = {
  low: [0, 1.2, 1.5, 1.2, 0, 1.5, 1.2, 2, 0, 1.2, 1.5, 1.2],
  medium: [0, 1.5, 2, 0, 3, 1.5, 0, 2, 5, 0, 1.5, 3],
  high: [0, 0, 0, 0, 5, 0, 0, 10, 0, 0, 0, 50],
};

export function resolveWheel(
  selection: WheelSelection,
  seeds: SeedContext,
  _houseEdge: number,
  forced: ForcedResult,
): RoundResult {
  const segments = WHEEL_SEGMENTS[selection.risk];

  const winningIndexes = segments
    .map((m, i) => (m > 1 ? i : -1))
    .filter((i) => i >= 0);
  const losingIndexes = segments
    .map((m, i) => (m <= 1 ? i : -1))
    .filter((i) => i >= 0);

  let segment: number;

  if (forced === null) {
    segment = seededInt(
      seeds.serverSeed,
      seeds.clientSeed,
      seeds.nonce,
      0,
      segments.length - 1,
    );
  } else {
    const pool = forced ? winningIndexes : losingIndexes;
    const fallback = forced ? losingIndexes : winningIndexes;
    const chosen = pool.length > 0 ? pool : fallback;
    const pick = seededInt(
      seeds.serverSeed,
      seeds.clientSeed,
      seeds.nonce,
      0,
      chosen.length - 1,
    );
    segment = chosen[pick];
  }

  const multiplier = segments[segment];

  return {
    won: multiplier > 0,
    multiplier,
    outcome: { segment, multiplier },
  };
}

/* ------------------------------------------------------------------ *
 * Mines — 25 tiles, reveal safe ones, cash out before hitting a mine
 * ------------------------------------------------------------------ */

/**
 * Payout after `revealed` safe tiles.
 *
 * The odds of surviving that many picks are
 * C(safe, revealed) / C(total, revealed), so the fair payout is its inverse.
 */
export function minesMultiplier(
  mineCount: number,
  revealed: number,
  houseEdge: number,
) {
  if (revealed <= 0) return 0;

  const safeTiles = MINES_TILE_COUNT - mineCount;
  if (revealed > safeTiles) return 0;

  let survivalOdds = 1;
  for (let i = 0; i < revealed; i++) {
    survivalOdds *= (safeTiles - i) / (MINES_TILE_COUNT - i);
  }

  return round2((1 - houseEdge) / survivalOdds);
}

/**
 * Lays out the grid for a Mines round.
 *
 * When the admin has forced a win the mines are pushed to the end of the
 * shuffle, so the tiles a player is most likely to open early are safe.
 */
export function buildMinesGrid(
  selection: MinesSelection,
  seeds: SeedContext,
  forced: ForcedResult,
): number[] {
  const positions = Array.from({ length: MINES_TILE_COUNT }, (_, i) => i);
  const shuffled = seededShuffle(
    positions,
    seeds.serverSeed,
    seeds.clientSeed,
    seeds.nonce,
  );
  const mineCount = clamp(
    Math.round(selection.mineCount),
    1,
    MINES_TILE_COUNT - 1,
  );

  if (forced === false) {
    // Bias mines toward the centre and corners players open first.
    const hotSpots = [12, 0, 4, 20, 24, 6, 8, 16, 18];
    const forcedMines = hotSpots.slice(0, mineCount);
    const remaining = shuffled.filter((p) => !forcedMines.includes(p));
    return [
      ...forcedMines,
      ...remaining.slice(0, Math.max(0, mineCount - forcedMines.length)),
    ]
      .slice(0, mineCount)
      .sort((a, b) => a - b);
  }

  return shuffled.slice(0, mineCount).sort((a, b) => a - b);
}

/* ------------------------------------------------------------------ *
 * Plinko — binomial drop into multiplier buckets
 * ------------------------------------------------------------------ */

export const PLINKO_ROWS = [8, 12, 16] as const;

/** Buckets = rows + 1. Values are Stake-style tables with the edge baked in. */
export const PLINKO_BUCKETS: Record<
  PlinkoSelection["risk"],
  Record<(typeof PLINKO_ROWS)[number], number[]>
> = {
  low: {
    8: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    12: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    16: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
  },
  medium: {
    8: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
  },
  high: {
    8: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    12: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
    16: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};

function plinkoPathForBucket(
  rows: number,
  bucket: number,
  seeds: SeedContext,
): number[] {
  const indices = seededShuffle(
    Array.from({ length: rows }, (_, i) => i),
    seeds.serverSeed,
    seeds.clientSeed,
    seeds.nonce,
    80,
  );
  const rights = new Set(indices.slice(0, bucket));
  return Array.from({ length: rows }, (_, i) => (rights.has(i) ? 1 : 0));
}

export function resolvePlinko(
  selection: PlinkoSelection,
  seeds: SeedContext,
  _houseEdge: number,
  forced: ForcedResult,
  maxMultiplier: number,
): RoundResult {
  const rows = selection.rows as (typeof PLINKO_ROWS)[number];
  const buckets = PLINKO_BUCKETS[selection.risk][rows];

  let path: number[];
  let bucket: number;

  if (forced === null) {
    path = Array.from({ length: rows }, (_, i) =>
      seededFloat(seeds.serverSeed, seeds.clientSeed, seeds.nonce, i) < 0.5
        ? 0
        : 1,
    );
    bucket = path.reduce((sum, step) => sum + step, 0);
  } else {
    const winning = buckets
      .map((m, i) => (m >= 1 ? i : -1))
      .filter((i) => i >= 0);
    const losing = buckets
      .map((m, i) => (m < 1 ? i : -1))
      .filter((i) => i >= 0);
    const pool = (forced ? winning : losing).length
      ? forced
        ? winning
        : losing
      : forced
        ? losing
        : winning;
    const pick = seededInt(
      seeds.serverSeed,
      seeds.clientSeed,
      seeds.nonce,
      0,
      pool.length - 1,
      90,
    );
    bucket = pool[pick];
    path = plinkoPathForBucket(rows, bucket, seeds);
  }

  const multiplier = Math.min(buckets[bucket], maxMultiplier);

  return {
    won: multiplier > 0,
    multiplier,
    outcome: { bucket, path, multiplier },
  };
}

/* ------------------------------------------------------------------ *
 * Towers — climb floors, cash out before a trap
 * ------------------------------------------------------------------ */

export const TOWER_DIFFICULTY = {
  easy: { tiles: 4, mines: 1, rows: 10 },
  medium: { tiles: 3, mines: 2, rows: 10 },
  hard: { tiles: 2, mines: 1, rows: 10 },
  expert: { tiles: 3, mines: 2, rows: 6 },
} as const;

export function towersConfig(difficulty: TowersSelection["difficulty"]) {
  return TOWER_DIFFICULTY[difficulty];
}

/** Share of Easy floors that are not 3-win / 1-trap. */
const EASY_TRAP_VARY = 0.45;

function easyTrapsOnFloor(seeds: SeedContext, row: number) {
  const roll = seededFloat(
    seeds.serverSeed,
    seeds.clientSeed,
    seeds.nonce,
    (row + 1) * 40,
  );
  if (roll >= EASY_TRAP_VARY) return 1;
  return roll < EASY_TRAP_VARY / 2 ? 3 : 2;
}

function towersSurviveRate(difficulty: TowersSelection["difficulty"]) {
  const { tiles, mines } = TOWER_DIFFICULTY[difficulty];
  if (difficulty !== "easy") return (tiles - mines) / tiles;

  const vary = EASY_TRAP_VARY;
  const half = vary / 2;
  return (1 - vary) * (3 / 4) + half * (2 / 4) + half * (1 / 4);
}

export function towersMultiplier(
  difficulty: TowersSelection["difficulty"],
  climbed: number,
  houseEdge: number,
) {
  if (climbed <= 0) return 0;
  const survive = towersSurviveRate(difficulty);
  return round2((1 - houseEdge) / survive ** climbed);
}

/**
 * One shuffled trap layout per floor. Positions come from this climb's
 * seeds so the board changes every start. Easy mostly stays 3-win / 1-trap;
 * about 45% of floors roll 2-win / 2-trap or 1-win / 3-trap instead.
 */
export function buildTowersGrid(
  selection: TowersSelection,
  seeds: SeedContext,
  _forced: ForcedResult,
): number[][] {
  const { tiles, mines, rows } = TOWER_DIFFICULTY[selection.difficulty];

  return Array.from({ length: rows }, (_, row) => {
    const trapCount =
      selection.difficulty === "easy"
        ? easyTrapsOnFloor(seeds, row)
        : mines;
    const positions = Array.from({ length: tiles }, (_, i) => i);
    const shuffled = seededShuffle(
      positions,
      seeds.serverSeed,
      seeds.clientSeed,
      seeds.nonce,
      (row + 1) * 40,
    );
    return shuffled.slice(0, trapCount).sort((a, b) => a - b);
  });
}

/* ------------------------------------------------------------------ *
 * Keno — pick 1–10 spots from 50, ten are drawn
 * ------------------------------------------------------------------ */

export const KENO_SPOT_COUNT = 50;
export const KENO_DRAW_COUNT = 10;
export const KENO_MAX_PICKS = 10;

/** Paytable[pickCount][hitCount] = multiplier. Missing keys pay 0. */
export const KENO_PAYTABLE: Record<number, Record<number, number>> = {
  1: { 1: 3.96 },
  2: { 2: 17 },
  3: { 2: 2.2, 3: 48 },
  4: { 2: 1.6, 3: 6, 4: 90 },
  5: { 3: 3.3, 4: 13, 5: 300 },
  6: { 3: 2, 4: 5, 5: 48, 6: 710 },
  7: { 4: 6, 5: 18, 6: 120, 7: 800 },
  8: { 5: 10, 6: 50, 7: 400, 8: 1000 },
  9: { 5: 6, 6: 22, 7: 120, 8: 800, 9: 1000 },
  10: { 5: 5, 6: 24, 7: 80, 8: 500, 9: 800, 10: 1000 },
};

export function kenoPayout(pickCount: number, hitCount: number) {
  return KENO_PAYTABLE[pickCount]?.[hitCount] ?? 0;
}

function kenoMinPayingHits(pickCount: number) {
  const table = KENO_PAYTABLE[pickCount] ?? {};
  const hits = Object.keys(table).map(Number);
  return hits.length ? Math.min(...hits) : pickCount;
}

export function resolveKeno(
  selection: KenoSelection,
  seeds: SeedContext,
  _houseEdge: number,
  forced: ForcedResult,
  maxMultiplier: number,
): RoundResult {
  const picks = [...new Set(selection.picks)].sort((a, b) => a - b);
  const pool = Array.from({ length: KENO_SPOT_COUNT }, (_, i) => i + 1);
  const others = pool.filter((n) => !picks.includes(n));

  let drawn: number[];

  if (forced === null) {
    drawn = seededShuffle(
      pool,
      seeds.serverSeed,
      seeds.clientSeed,
      seeds.nonce,
    ).slice(0, KENO_DRAW_COUNT);
  } else {
    const need = kenoMinPayingHits(picks.length);
    const hitCount = forced
      ? need
      : seededInt(
          seeds.serverSeed,
          seeds.clientSeed,
          seeds.nonce,
          0,
          Math.max(0, need - 1),
          70,
        );
    const hitPool = seededShuffle(
      picks,
      seeds.serverSeed,
      seeds.clientSeed,
      seeds.nonce,
      20,
    );
    const missPool = seededShuffle(
      others,
      seeds.serverSeed,
      seeds.clientSeed,
      seeds.nonce,
      40,
    );
    drawn = [
      ...hitPool.slice(0, hitCount),
      ...missPool.slice(0, KENO_DRAW_COUNT - hitCount),
    ];
  }

  drawn.sort((a, b) => a - b);
  const hits = picks.filter((n) => drawn.includes(n));
  const multiplier = Math.min(kenoPayout(picks.length, hits.length), maxMultiplier);

  return {
    won: multiplier > 0,
    multiplier,
    outcome: { drawn, hits, hitCount: hits.length },
  };
}
