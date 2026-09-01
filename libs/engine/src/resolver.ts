
import { seededFloat } from "./rng";
import {
  resolveCoinFlip,
  resolveDice,
  resolveKeno,
  resolveLimbo,
  resolvePlinko,
  resolveWheel,
  KENO_SPOT_COUNT,
} from "./rules";
import type {
  CoinFlipSelection,
  DiceSelection,
  ForcedResult,
  GameSelection,
  GameSlug,
  KenoSelection,
  LimboSelection,
  PlinkoSelection,
  RoundResult,
  SeedContext,
  WheelSelection,
} from "@game/contracts";

/** A control row as the engine needs it, decoupled from the Drizzle model. */
export interface ControlRule {
  mode: "off" | "bias" | "force_win" | "force_loss";
  winRate: number | null;
  forceRounds: number;
  maxWinMultiplier: number | null;
}

/**
 * Turns an admin control rule into a decision for this specific round.
 *
 * Returning `null` means the round is rolled honestly, which is the default
 * for any player with no control row.
 */
export function decideForcedResult(
  rule: ControlRule | null | undefined,
  seeds: SeedContext,
): ForcedResult {
  if (!rule || rule.mode === "off") return null;

  if (rule.mode === "bias") {
    const rate = rule.winRate;
    if (rate === null || rate < 0 || rate > 1) return null;

    // A separate cursor keeps this draw independent of the game's own roll.
    const draw = seededFloat(
      seeds.serverSeed,
      seeds.clientSeed,
      seeds.nonce,
      9_999,
    );
    return draw < rate;
  }

  // Force modes are metered so a rule can cover a fixed number of rounds.
  if (rule.forceRounds <= 0) return null;

  return rule.mode === "force_win";
}

/**
 * Game-level difficulty is a loss percent: 90 means 90% lose, 10% win.
 * 0 leaves the round on fair odds.
 */
export function decideFromDifficulty(
  difficulty: number,
  seeds: SeedContext,
): ForcedResult {
  const loss = Math.round(Number(difficulty));
  if (!Number.isFinite(loss) || loss <= 0) return null;
  if (loss >= 100) return false;

  return decideForcedResult(
    {
      mode: "bias",
      winRate: (100 - loss) / 100,
      forceRounds: 0,
      maxWinMultiplier: null,
    },
    seeds,
  );
}

/**
 * Profile difficulty wins over the game default. Null/undefined means inherit.
 * An explicit 0 is fair odds for this player, even if the game is harder.
 */
export function effectiveDifficulty(
  profileDifficulty: number | null | undefined,
  gameDifficulty: number | null | undefined,
): number {
  if (profileDifficulty != null && Number.isFinite(Number(profileDifficulty))) {
    return Math.min(100, Math.max(0, Math.round(Number(profileDifficulty))));
  }
  const game = Math.round(Number(gameDifficulty ?? 0));
  if (!Number.isFinite(game)) return 0;
  return Math.min(100, Math.max(0, game));
}

/** Per-game override, then this player's general slider, then null (game default). */
export function walletDifficultyForGame(
  wallet: {
    difficulty?: number | null;
    gameDifficulties?: Record<string, number> | null;
  },
  gameSlug: string,
): number | null {
  const perGame = wallet.gameDifficulties?.[gameSlug];
  if (perGame != null && Number.isFinite(Number(perGame))) {
    return Math.min(100, Math.max(0, Math.round(Number(perGame))));
  }
  if (wallet.difficulty != null && Number.isFinite(Number(wallet.difficulty))) {
    return Math.min(100, Math.max(0, Math.round(Number(wallet.difficulty))));
  }
  return null;
}

/**
 * A per-user admin rule wins over difficulty. A per-game profile override
 * then this player's general slider, then the game default. If none apply,
 * the round is honest.
 */
export function resolveControl(
  userRule: ControlRule | null | undefined,
  profileDifficulty: number | null | undefined,
  gameDifficulty: number,
  seeds: SeedContext,
): ForcedResult {
  const fromUser = decideForcedResult(userRule, seeds);
  if (fromUser !== null) return fromUser;
  return decideFromDifficulty(
    effectiveDifficulty(profileDifficulty, gameDifficulty),
    seeds,
  );
}

/** Caps a controlled win so a forced result can't hand out an unbounded payout. */
export function applyWinCap(
  result: RoundResult,
  rule: ControlRule | null | undefined,
) {
  if (!result.won || !rule?.maxWinMultiplier) return result;
  if (result.multiplier <= rule.maxWinMultiplier) return result;

  return { ...result, multiplier: rule.maxWinMultiplier };
}

/**
 * Single entry point for every instant-settlement game.
 *
 * Mines and Towers are not handled here: they settle across multiple
 * requests and live in their own actions instead.
 */
export function resolveRound(
  slug: Exclude<GameSlug, "mines" | "towers">,
  selection: GameSelection,
  seeds: SeedContext,
  config: { houseEdge: number; maxMultiplier: number },
  forced: ForcedResult,
): RoundResult {
  switch (slug) {
    case "dice":
      return resolveDice(
        selection as DiceSelection,
        seeds,
        config.houseEdge,
        forced,
      );
    case "coin-flip":
      return resolveCoinFlip(
        selection as CoinFlipSelection,
        seeds,
        config.houseEdge,
        forced,
      );
    case "limbo":
      return resolveLimbo(
        selection as LimboSelection,
        seeds,
        config.houseEdge,
        forced,
        config.maxMultiplier,
      );
    case "wheel":
      return resolveWheel(
        selection as WheelSelection,
        seeds,
        config.houseEdge,
        forced,
      );
    case "plinko":
      return resolvePlinko(
        selection as PlinkoSelection,
        seeds,
        config.houseEdge,
        forced,
        config.maxMultiplier,
      );
    case "keno":
      return resolveKeno(
        selection as KenoSelection,
        seeds,
        config.houseEdge,
        forced,
        config.maxMultiplier,
      );
    default: {
      const exhaustive: never = slug;
      throw new Error(`Unsupported game: ${exhaustive}`);
    }
  }
}

/** Rejects malformed input before any money moves. */
export function validateSelection(
  slug: GameSlug,
  selection: unknown,
): { ok: true; value: GameSelection } | { ok: false; error: string } {
  const value = selection as Record<string, unknown>;

  switch (slug) {
    case "dice": {
      const target = Number(value?.target);
      const direction = value?.direction;
      if (!Number.isFinite(target) || target < 2 || target > 98) {
        return { ok: false, error: "Target must be between 2 and 98" };
      }
      if (direction !== "over" && direction !== "under") {
        return { ok: false, error: "Direction must be over or under" };
      }
      return { ok: true, value: { target, direction } };
    }

    case "coin-flip": {
      const side = value?.side;
      if (side !== "heads" && side !== "tails") {
        return { ok: false, error: "Pick heads or tails" };
      }
      return { ok: true, value: { side } };
    }

    case "limbo": {
      const target = Number(value?.target);
      if (!Number.isFinite(target) || target < 1.01) {
        return { ok: false, error: "Target must be at least 1.01x" };
      }
      return { ok: true, value: { target } };
    }

    case "wheel": {
      const risk = value?.risk;
      if (risk !== "low" && risk !== "medium" && risk !== "high") {
        return { ok: false, error: "Pick a risk level" };
      }
      return { ok: true, value: { risk } };
    }

    case "mines": {
      const mineCount = Number(value?.mineCount);
      if (!Number.isInteger(mineCount) || mineCount < 1 || mineCount > 24) {
        return { ok: false, error: "Mines must be between 1 and 24" };
      }
      return { ok: true, value: { mineCount } };
    }

    case "plinko": {
      const risk = value?.risk;
      const rows = Number(value?.rows);
      if (risk !== "low" && risk !== "medium" && risk !== "high") {
        return { ok: false, error: "Pick a risk level" };
      }
      if (rows !== 8 && rows !== 12 && rows !== 16) {
        return { ok: false, error: "Rows must be 8, 12, or 16" };
      }
      return { ok: true, value: { risk, rows } };
    }

    case "towers": {
      const difficulty = value?.difficulty;
      if (
        difficulty !== "easy" &&
        difficulty !== "medium" &&
        difficulty !== "hard" &&
        difficulty !== "expert"
      ) {
        return { ok: false, error: "Pick a difficulty" };
      }
      return { ok: true, value: { difficulty } };
    }

    case "keno": {
      const raw = Array.isArray(value?.picks) ? value.picks : [];
      const picks = raw.map((n: unknown) => Number(n));
      if (picks.length < 1 || picks.length > 10) {
        return { ok: false, error: "Pick between 1 and 10 numbers" };
      }
      if (new Set(picks).size !== picks.length) {
        return { ok: false, error: "Numbers must be unique" };
      }
      if (
        picks.some(
          (n: number) => !Number.isInteger(n) || n < 1 || n > KENO_SPOT_COUNT,
        )
      ) {
        return { ok: false, error: `Numbers must be between 1 and ${KENO_SPOT_COUNT}` };
      }
      return { ok: true, value: { picks: picks.sort((a: number, b: number) => a - b) } };
    }

    default:
      return { ok: false, error: "Unknown game" };
  }
}
