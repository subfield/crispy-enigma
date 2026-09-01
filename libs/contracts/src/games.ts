export type GameSlug =
  | "dice"
  | "coin-flip"
  | "limbo"
  | "wheel"
  | "mines"
  | "plinko"
  | "towers"
  | "keno";

export const INSTANT_GAMES = [
  "dice",
  "coin-flip",
  "limbo",
  "wheel",
  "plinko",
  "keno",
] as const;
export type InstantGameSlug = (typeof INSTANT_GAMES)[number];

export function isInstantGame(slug: string): slug is InstantGameSlug {
  return (INSTANT_GAMES as readonly string[]).includes(slug);
}

export type PlinkoRisk = "low" | "medium" | "high";
export type TowersDifficulty = "easy" | "medium" | "hard" | "expert";

/* Player selections */

export interface DiceSelection {
  target: number;
  direction: "over" | "under";
}
export interface CoinFlipSelection {
  side: "heads" | "tails";
}
export interface LimboSelection {
  target: number;
}
export interface WheelSelection {
  risk: "low" | "medium" | "high";
}
export interface MinesSelection {
  mineCount: number;
}
export interface PlinkoSelection {
  risk: PlinkoRisk;
  rows: number;
}
export interface TowersSelection {
  difficulty: TowersDifficulty;
}
export interface KenoSelection {
  picks: number[];
}

export type GameSelection =
  | DiceSelection
  | CoinFlipSelection
  | LimboSelection
  | WheelSelection
  | MinesSelection
  | PlinkoSelection
  | TowersSelection
  | KenoSelection;

/* Server outcomes */

export interface DiceOutcome {
  roll: number;
}
export interface CoinFlipOutcome {
  result: "heads" | "tails";
}
export interface LimboOutcome {
  result: number;
}
export interface WheelOutcome {
  segment: number;
  multiplier: number;
}
export interface MinesOutcome {
  minePositions: number[];
  revealed: number[];
}
export interface PlinkoOutcome {
  bucket: number;
  path: number[];
  multiplier: number;
}
export interface TowersOutcome {
  traps: number[][];
  picks: number[];
}
export interface KenoOutcome {
  drawn: number[];
  hits: number[];
  hitCount: number;
}

export type GameOutcome =
  | DiceOutcome
  | CoinFlipOutcome
  | LimboOutcome
  | WheelOutcome
  | MinesOutcome
  | PlinkoOutcome
  | TowersOutcome
  | KenoOutcome;

export interface RoundResult {
  won: boolean;
  multiplier: number;
  outcome: GameOutcome;
}

/** `null` means roll honestly. Set by the admin control layer. */
export type ForcedResult = boolean | null;

export interface SeedContext {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

/* API payloads */

export interface SettledBet {
  reference: string;
  sessionId: string | null;
  gameSlug: string;
  won: boolean;
  stake: number;
  multiplier: number;
  payout: number;
  outcome: GameOutcome;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  balance: number;
  settledAt: string;
}

export interface MinesRoundState {
  reference: string;
  sessionId: string | null;
  mineCount: number;
  revealed: number[];
  multiplier: number;
  nextMultiplier: number;
  status: "open" | "won" | "lost" | "cashed_out";
  minePositions?: number[];
  payout?: number;
  balance?: number;
}

export interface TowersRoundState {
  reference: string;
  sessionId: string | null;
  difficulty: TowersDifficulty;
  tiles: number;
  rows: number;
  picks: number[];
  multiplier: number;
  nextMultiplier: number;
  status: "open" | "won" | "lost" | "cashed_out";
  traps?: number[][];
  payout?: number;
  balance?: number;
}

export interface WalletSummary {
  balance: number;
  bonusBalance: number;
  lockedBalance: number;
  playable: number;
  totalWagered: number;
  totalWon: number;
  totalDeposited: number;
  netProfit: number;
  isLocked: boolean;
}

export interface GameSessionDto {
  id: string;
  gameSlug: string;
  startedAt: string;
  endedAt: string | null;
  betCount: number;
  totalStaked: number;
  totalWon: number;
  history: SessionHistoryItem[];
}

export interface SessionHistoryItem {
  reference: string;
  won: boolean;
  stake: number;
  multiplier: number;
  payout: number;
  status: "open" | "won" | "lost" | "cashed_out" | "void";
  outcome: GameOutcome | Record<string, unknown> | null;
  settledAt: string | null;
}
