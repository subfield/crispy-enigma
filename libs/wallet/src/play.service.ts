import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import type {
  GameSessionDto,
  GameSlug,
  MinesRoundState,
  MinesSelection,
  RpcError,
  RpcResult,
  SessionHistoryItem,
  SettledBet,
  TowersDifficulty,
  TowersRoundState,
  TowersSelection,
} from "@game/contracts";
import { isInstantGame } from "@game/contracts";
import {
  bets,
  DRIZZLE,
  type Database,
  gameExcluded,
  games,
  gameSessions,
  sminkTransactions,
  sminkWallets,
  userGameControl,
} from "@game/db";
import {
  applyWinCap,
  buildMinesGrid,
  buildTowersGrid,
  createClientSeed,
  createServerSeed,
  resolveControl,
  walletDifficultyForGame,
  MINES_TILE_COUNT,
  minesMultiplier,
  resolveRound,
  towersConfig,
  towersMultiplier,
  validateSelection,
  type ControlRule,
} from "@game/engine";
import type { SeedContext } from "@game/contracts";
import { reference, roundMoney } from "./ids";
import { WalletService } from "./wallet.service";

type Fail = RpcError;

function fail(error: string, code?: Fail["code"]): Fail {
  return { ok: false, error, code };
}

@Injectable()
export class PlayService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly wallets: WalletService,
  ) {}

  async startSession(userId: string, gameSlug: string): Promise<RpcResult<GameSessionDto>> {
    const game = await this.getPlayableGame(userId, gameSlug);
    if (!game.ok) return game;

    await this.endOpenSessions(userId, game.data.id);

    const [session] = await this.db
      .insert(gameSessions)
      .values({ userId, gameId: game.data.id })
      .returning();

    return {
      ok: true,
      data: await this.toSessionDto(session.id, gameSlug),
    };
  }

  async endSession(userId: string, sessionId: string): Promise<RpcResult<{ ended: true }>> {
    const [session] = await this.db
      .select()
      .from(gameSessions)
      .where(and(eq(gameSessions.id, sessionId), eq(gameSessions.userId, userId)))
      .limit(1);

    if (!session) return fail("Session not found", "VALIDATION");
    if (session.endedAt) return { ok: true, data: { ended: true } };

    await this.db
      .update(gameSessions)
      .set({ endedAt: new Date() })
      .where(eq(gameSessions.id, session.id));

    return { ok: true, data: { ended: true } };
  }

  async getSession(userId: string, sessionId: string): Promise<RpcResult<GameSessionDto>> {
    const [session] = await this.db
      .select({
        id: gameSessions.id,
        slug: games.slug,
      })
      .from(gameSessions)
      .innerJoin(games, eq(gameSessions.gameId, games.id))
      .where(and(eq(gameSessions.id, sessionId), eq(gameSessions.userId, userId)))
      .limit(1);

    if (!session) return fail("Session not found", "VALIDATION");
    return { ok: true, data: await this.toSessionDto(session.id, session.slug) };
  }

  async placeBet(
    userId: string,
    sessionId: string,
    slug: GameSlug,
    stakeInput: number,
    selectionInput: unknown,
  ): Promise<RpcResult<SettledBet>> {
    if (!isInstantGame(slug)) {
      return fail(
        slug === "towers"
          ? "Towers rounds are started with towers.start"
          : "Mines rounds are started with mines.start",
        "VALIDATION",
      );
    }

    const session = await this.requireOpenSession(userId, sessionId, slug);
    if (!session.ok) return session;

    const game = session.game;
    const validated = validateSelection(slug, selectionInput);
    if (!validated.ok) return fail(validated.error, "VALIDATION");

    const stakeCheck = this.parseStake(stakeInput, Number(game.minBet), Number(game.maxBet));
    if (!stakeCheck.ok) return stakeCheck;
    const stake = stakeCheck.stake;

    const wallet = await this.wallets.getOrCreate(userId);
    if (!wallet) return fail("Wallet unavailable", "UNAVAILABLE");
    if (wallet.isLocked) return fail("Your wallet is locked. Contact support.", "UNAVAILABLE");

    const { serverSeed, serverSeedHash } = createServerSeed();
    const clientSeed = createClientSeed();
    const nonce = await this.nextNonce(userId);
    const seeds: SeedContext = { serverSeed, clientSeed, nonce };

    const { rule, rowId } = await this.getControlRule(userId, game.id);
    const forced = resolveControl(
      rule,
      walletDifficultyForGame(wallet, slug),
      Number(game.difficulty ?? 0),
      seeds,
    );
    const raw = resolveRound(slug, validated.value, seeds, {
      houseEdge: Number(game.houseEdge),
      maxMultiplier: Number(game.maxMultiplier),
    }, forced);
    const result = applyWinCap(raw, rule);
    const payout = result.won ? roundMoney(stake * result.multiplier) : 0;
    const net = payout - stake;

    const [updated] = await this.db
      .update(sminkWallets)
      .set({
        balance: sql`${sminkWallets.balance} + ${net.toFixed(2)}`,
        totalWagered: sql`${sminkWallets.totalWagered} + ${stake.toFixed(2)}`,
        totalWon: sql`${sminkWallets.totalWon} + ${payout.toFixed(2)}`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(sminkWallets.userId, userId), sql`${sminkWallets.balance} >= ${stake.toFixed(2)}`),
      )
      .returning({ balance: sminkWallets.balance });

    if (!updated) return fail("Insufficient balance", "INSUFFICIENT");

    const betRef = reference("BET");

    await this.db.insert(bets).values({
      userId,
      gameId: game.id,
      sessionId,
      reference: betRef,
      stake: stake.toFixed(2),
      multiplier: result.multiplier.toFixed(4),
      payout: payout.toFixed(2),
      status: result.won ? "won" : "lost",
      selection: validated.value as unknown as Record<string, unknown>,
      outcome: result.outcome as unknown as Record<string, unknown>,
      serverSeed,
      serverSeedHash,
      clientSeed,
      nonce,
      wasControlled: forced !== null,
      settledAt: new Date(),
    });

    await this.db.insert(sminkTransactions).values([
      {
        userId,
        type: "stake",
        status: "confirmed",
        amount: (-stake).toFixed(2),
        reference: reference("STK"),
        metadata: { betReference: betRef, game: slug, sessionId },
        completedAt: new Date(),
      },
      ...(payout > 0
        ? [
            {
              userId,
              type: "payout" as const,
              status: "confirmed" as const,
              amount: payout.toFixed(2),
              balanceAfter: updated.balance,
              reference: reference("PAY"),
              metadata: { betReference: betRef, game: slug, sessionId },
              completedAt: new Date(),
            },
          ]
        : []),
    ]);

    await this.bumpSession(sessionId, stake, payout);
    await this.consumeForcedRound(rowId, rule);

    return {
      ok: true,
      data: {
        reference: betRef,
        sessionId,
        gameSlug: slug,
        won: result.won,
        stake,
        multiplier: result.multiplier,
        payout,
        outcome: result.outcome,
        serverSeedHash,
        clientSeed,
        nonce,
        balance: Number(updated.balance),
        settledAt: new Date().toISOString(),
      },
    };
  }

  async startMines(
    userId: string,
    sessionId: string,
    stakeInput: number,
    mineCountInput: number,
  ): Promise<RpcResult<MinesRoundState>> {
    const session = await this.requireOpenSession(userId, sessionId, "mines");
    if (!session.ok) return session;

    const game = session.game;
    const validated = validateSelection("mines", { mineCount: mineCountInput });
    if (!validated.ok) return fail(validated.error, "VALIDATION");

    const stakeCheck = this.parseStake(stakeInput, Number(game.minBet), Number(game.maxBet));
    if (!stakeCheck.ok) return stakeCheck;
    const stake = stakeCheck.stake;

    const [open] = await this.db
      .select({ id: bets.id })
      .from(bets)
      .where(and(eq(bets.userId, userId), eq(bets.gameId, game.id), eq(bets.status, "open")))
      .limit(1);

    if (open) return fail("You already have a Mines round in progress", "VALIDATION");

    const wallet = await this.wallets.getOrCreate(userId);
    if (!wallet) return fail("Wallet unavailable", "UNAVAILABLE");
    if (wallet.isLocked) return fail("Your wallet is locked. Contact support.", "UNAVAILABLE");

    const { serverSeed, serverSeedHash } = createServerSeed();
    const clientSeed = createClientSeed();
    const nonce = await this.nextNonce(userId);
    const seeds: SeedContext = { serverSeed, clientSeed, nonce };
    const { rule } = await this.getControlRule(userId, game.id);
    const forced = resolveControl(
      rule,
      walletDifficultyForGame(wallet, "mines"),
      Number(game.difficulty ?? 0),
      seeds,
    );
    const selection = validated.value as MinesSelection;
    const minePositions = buildMinesGrid(selection, seeds, forced);

    const [debited] = await this.db
      .update(sminkWallets)
      .set({
        balance: sql`${sminkWallets.balance} - ${stake.toFixed(2)}`,
        lockedBalance: sql`${sminkWallets.lockedBalance} + ${stake.toFixed(2)}`,
        totalWagered: sql`${sminkWallets.totalWagered} + ${stake.toFixed(2)}`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(sminkWallets.userId, userId), sql`${sminkWallets.balance} >= ${stake.toFixed(2)}`),
      )
      .returning({ balance: sminkWallets.balance });

    if (!debited) return fail("Insufficient balance", "INSUFFICIENT");

    const betRef = reference("MIN");

    await this.db.insert(bets).values({
      userId,
      gameId: game.id,
      sessionId,
      reference: betRef,
      stake: stake.toFixed(2),
      status: "open",
      selection: selection as unknown as Record<string, unknown>,
      outcome: { minePositions, revealed: [] },
      serverSeed,
      serverSeedHash,
      clientSeed,
      nonce,
      wasControlled: forced !== null,
    });

    await this.db.insert(sminkTransactions).values({
      userId,
      type: "stake",
      status: "confirmed",
      amount: (-stake).toFixed(2),
      reference: reference("STK"),
      metadata: { betReference: betRef, game: "mines", sessionId },
      completedAt: new Date(),
    });

    await this.bumpSession(sessionId, stake, 0);

    return {
      ok: true,
      data: {
        reference: betRef,
        sessionId,
        mineCount: selection.mineCount,
        revealed: [],
        multiplier: 0,
        nextMultiplier: minesMultiplier(selection.mineCount, 1, Number(game.houseEdge)),
        status: "open",
      },
    };
  }

  async revealMines(
    userId: string,
    sessionId: string,
    betReference: string,
    tile: number,
  ): Promise<RpcResult<MinesRoundState>> {
    if (!Number.isInteger(tile) || tile < 0 || tile >= MINES_TILE_COUNT) {
      return fail("Invalid tile", "VALIDATION");
    }

    const owned = await this.requireOpenSession(userId, sessionId, "mines");
    if (!owned.ok) return owned;

    const [bet] = await this.db
      .select()
      .from(bets)
      .where(
        and(eq(bets.reference, betReference), eq(bets.userId, userId), eq(bets.sessionId, sessionId)),
      )
      .limit(1);

    if (!bet) return fail("Round not found", "VALIDATION");
    if (bet.status !== "open") return fail("Round already finished", "VALIDATION");

    const outcome = (bet.outcome ?? {}) as { minePositions: number[]; revealed: number[] };
    const minePositions = outcome.minePositions ?? [];
    const revealed = outcome.revealed ?? [];
    if (revealed.includes(tile)) return fail("Tile already revealed", "VALIDATION");

    const stake = Number(bet.stake);
    const mineCount = minePositions.length;
    const houseEdge = Number(owned.game.houseEdge);

    if (minePositions.includes(tile)) {
      await this.db
        .update(sminkWallets)
        .set({
          lockedBalance: sql`GREATEST(${sminkWallets.lockedBalance} - ${stake.toFixed(2)}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(sminkWallets.userId, userId));

      await this.db
        .update(bets)
        .set({
          status: "lost",
          multiplier: "0",
          payout: "0",
          outcome: { minePositions, revealed: [...revealed, tile] },
          settledAt: new Date(),
        })
        .where(eq(bets.id, bet.id));

      return {
        ok: true,
        data: {
          reference: betReference,
          sessionId,
          mineCount,
          revealed: [...revealed, tile],
          multiplier: 0,
          nextMultiplier: 0,
          status: "lost",
          minePositions,
          payout: 0,
        },
      };
    }

    const nextRevealed = [...revealed, tile];
    const multiplier = minesMultiplier(mineCount, nextRevealed.length, houseEdge);
    const safeTiles = MINES_TILE_COUNT - mineCount;

    await this.db
      .update(bets)
      .set({
        multiplier: multiplier.toFixed(4),
        outcome: { minePositions, revealed: nextRevealed },
      })
      .where(eq(bets.id, bet.id));

    if (nextRevealed.length >= safeTiles) {
      return this.cashOutMines(userId, sessionId, betReference);
    }

    return {
      ok: true,
      data: {
        reference: betReference,
        sessionId,
        mineCount,
        revealed: nextRevealed,
        multiplier,
        nextMultiplier: minesMultiplier(mineCount, nextRevealed.length + 1, houseEdge),
        status: "open",
      },
    };
  }

  async cashOutMines(
    userId: string,
    sessionId: string,
    betReference: string,
  ): Promise<RpcResult<MinesRoundState>> {
    const owned = await this.requireOpenSession(userId, sessionId, "mines");
    if (!owned.ok) return owned;

    const [bet] = await this.db
      .select()
      .from(bets)
      .where(
        and(eq(bets.reference, betReference), eq(bets.userId, userId), eq(bets.sessionId, sessionId)),
      )
      .limit(1);

    if (!bet) return fail("Round not found", "VALIDATION");
    if (bet.status !== "open") return fail("Round already finished", "VALIDATION");

    const outcome = (bet.outcome ?? {}) as { minePositions: number[]; revealed: number[] };
    const revealed = outcome.revealed ?? [];
    if (revealed.length === 0) return fail("Reveal at least one tile first", "VALIDATION");

    const stake = Number(bet.stake);
    const multiplier = Number(bet.multiplier);
    const payout = roundMoney(stake * multiplier);

    const [updated] = await this.db
      .update(sminkWallets)
      .set({
        balance: sql`${sminkWallets.balance} + ${payout.toFixed(2)}`,
        lockedBalance: sql`GREATEST(${sminkWallets.lockedBalance} - ${stake.toFixed(2)}, 0)`,
        totalWon: sql`${sminkWallets.totalWon} + ${payout.toFixed(2)}`,
        updatedAt: new Date(),
      })
      .where(eq(sminkWallets.userId, userId))
      .returning({ balance: sminkWallets.balance });

    await this.db
      .update(bets)
      .set({ status: "cashed_out", payout: payout.toFixed(2), settledAt: new Date() })
      .where(eq(bets.id, bet.id));

    await this.db.insert(sminkTransactions).values({
      userId,
      type: "payout",
      status: "confirmed",
      amount: payout.toFixed(2),
      balanceAfter: updated?.balance,
      reference: reference("PAY"),
      metadata: { betReference, game: "mines", sessionId },
      completedAt: new Date(),
    });

    await this.bumpSession(sessionId, 0, payout);

    return {
      ok: true,
      data: {
        reference: betReference,
        sessionId,
        mineCount: (outcome.minePositions ?? []).length,
        revealed,
        multiplier,
        nextMultiplier: 0,
        status: "cashed_out",
        minePositions: outcome.minePositions,
        payout,
        balance: Number(updated?.balance ?? 0),
      },
    };
  }

  async getOpenMines(userId: string, sessionId: string): Promise<RpcResult<MinesRoundState | null>> {
    const owned = await this.requireOpenSession(userId, sessionId, "mines");
    if (!owned.ok) return owned;

    const [bet] = await this.db
      .select()
      .from(bets)
      .where(
        and(
          eq(bets.userId, userId),
          eq(bets.gameId, owned.game.id),
          eq(bets.sessionId, sessionId),
          eq(bets.status, "open"),
        ),
      )
      .orderBy(desc(bets.createdAt))
      .limit(1);

    if (!bet) return { ok: true, data: null };

    const outcome = (bet.outcome ?? {}) as { minePositions: number[]; revealed: number[] };
    const mineCount = (outcome.minePositions ?? []).length;
    const revealed = outcome.revealed ?? [];
    const houseEdge = Number(owned.game.houseEdge);

    return {
      ok: true,
      data: {
        reference: bet.reference,
        sessionId,
        mineCount,
        revealed,
        multiplier: minesMultiplier(mineCount, revealed.length, houseEdge),
        nextMultiplier: minesMultiplier(mineCount, revealed.length + 1, houseEdge),
        status: "open",
      },
    };
  }

  async startTowers(
    userId: string,
    sessionId: string,
    stakeInput: number,
    difficultyInput: TowersDifficulty,
  ): Promise<RpcResult<TowersRoundState>> {
    const session = await this.requireOpenSession(userId, sessionId, "towers");
    if (!session.ok) return session;

    const game = session.game;
    const validated = validateSelection("towers", { difficulty: difficultyInput });
    if (!validated.ok) return fail(validated.error, "VALIDATION");

    const stakeCheck = this.parseStake(stakeInput, Number(game.minBet), Number(game.maxBet));
    if (!stakeCheck.ok) return stakeCheck;
    const stake = stakeCheck.stake;

    const [open] = await this.db
      .select({ id: bets.id })
      .from(bets)
      .where(and(eq(bets.userId, userId), eq(bets.gameId, game.id), eq(bets.status, "open")))
      .limit(1);

    if (open) return fail("You already have a Towers round in progress", "VALIDATION");

    const wallet = await this.wallets.getOrCreate(userId);
    if (!wallet) return fail("Wallet unavailable", "UNAVAILABLE");
    if (wallet.isLocked) return fail("Your wallet is locked. Contact support.", "UNAVAILABLE");

    const { serverSeed, serverSeedHash } = createServerSeed();
    const clientSeed = createClientSeed();
    const nonce = await this.nextNonce(userId);
    const seeds: SeedContext = { serverSeed, clientSeed, nonce };
    const { rule } = await this.getControlRule(userId, game.id);
    const forced = resolveControl(
      rule,
      walletDifficultyForGame(wallet, "towers"),
      Number(game.difficulty ?? 0),
      seeds,
    );
    const selection = validated.value as TowersSelection;
    const traps = buildTowersGrid(selection, seeds, forced);
    const config = towersConfig(selection.difficulty);

    const [debited] = await this.db
      .update(sminkWallets)
      .set({
        balance: sql`${sminkWallets.balance} - ${stake.toFixed(2)}`,
        lockedBalance: sql`${sminkWallets.lockedBalance} + ${stake.toFixed(2)}`,
        totalWagered: sql`${sminkWallets.totalWagered} + ${stake.toFixed(2)}`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(sminkWallets.userId, userId), sql`${sminkWallets.balance} >= ${stake.toFixed(2)}`),
      )
      .returning({ balance: sminkWallets.balance });

    if (!debited) return fail("Insufficient balance", "INSUFFICIENT");

    const betRef = reference("TWR");

    await this.db.insert(bets).values({
      userId,
      gameId: game.id,
      sessionId,
      reference: betRef,
      stake: stake.toFixed(2),
      status: "open",
      selection: selection as unknown as Record<string, unknown>,
      outcome: { traps, picks: [] },
      serverSeed,
      serverSeedHash,
      clientSeed,
      nonce,
      wasControlled: forced !== null,
    });

    await this.db.insert(sminkTransactions).values({
      userId,
      type: "stake",
      status: "confirmed",
      amount: (-stake).toFixed(2),
      reference: reference("STK"),
      metadata: { betReference: betRef, game: "towers", sessionId },
      completedAt: new Date(),
    });

    await this.bumpSession(sessionId, stake, 0);

    return {
      ok: true,
      data: {
        reference: betRef,
        sessionId,
        difficulty: selection.difficulty,
        tiles: config.tiles,
        rows: config.rows,
        picks: [],
        multiplier: 0,
        nextMultiplier: towersMultiplier(selection.difficulty, 1, Number(game.houseEdge)),
        status: "open",
      },
    };
  }

  async revealTowers(
    userId: string,
    sessionId: string,
    betReference: string,
    tile: number,
  ): Promise<RpcResult<TowersRoundState>> {
    const owned = await this.requireOpenSession(userId, sessionId, "towers");
    if (!owned.ok) return owned;

    const [bet] = await this.db
      .select()
      .from(bets)
      .where(
        and(eq(bets.reference, betReference), eq(bets.userId, userId), eq(bets.sessionId, sessionId)),
      )
      .limit(1);

    if (!bet) return fail("Round not found", "VALIDATION");
    if (bet.status !== "open") return fail("Round already finished", "VALIDATION");

    const selection = (bet.selection ?? {}) as unknown as TowersSelection;
    const config = towersConfig(selection.difficulty);
    if (!Number.isInteger(tile) || tile < 0 || tile >= config.tiles) {
      return fail("Invalid tile", "VALIDATION");
    }

    const outcome = (bet.outcome ?? {}) as { traps: number[][]; picks: number[] };
    const traps = outcome.traps ?? [];
    const picks = outcome.picks ?? [];
    const row = picks.length;

    if (row >= config.rows) return fail("Tower is already clear", "VALIDATION");

    const stake = Number(bet.stake);
    const houseEdge = Number(owned.game.houseEdge);
    const rowTraps = traps[row] ?? [];

    if (rowTraps.includes(tile)) {
      await this.db
        .update(sminkWallets)
        .set({
          lockedBalance: sql`GREATEST(${sminkWallets.lockedBalance} - ${stake.toFixed(2)}, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(sminkWallets.userId, userId));

      await this.db
        .update(bets)
        .set({
          status: "lost",
          multiplier: "0",
          payout: "0",
          outcome: { traps, picks: [...picks, tile] },
          settledAt: new Date(),
        })
        .where(eq(bets.id, bet.id));

      return {
        ok: true,
        data: {
          reference: betReference,
          sessionId,
          difficulty: selection.difficulty,
          tiles: config.tiles,
          rows: config.rows,
          picks: [...picks, tile],
          multiplier: 0,
          nextMultiplier: 0,
          status: "lost",
          traps,
          payout: 0,
        },
      };
    }

    const nextPicks = [...picks, tile];
    const multiplier = towersMultiplier(selection.difficulty, nextPicks.length, houseEdge);

    await this.db
      .update(bets)
      .set({
        multiplier: multiplier.toFixed(4),
        outcome: { traps, picks: nextPicks },
      })
      .where(eq(bets.id, bet.id));

    if (nextPicks.length >= config.rows) {
      return this.cashOutTowers(userId, sessionId, betReference);
    }

    return {
      ok: true,
      data: {
        reference: betReference,
        sessionId,
        difficulty: selection.difficulty,
        tiles: config.tiles,
        rows: config.rows,
        picks: nextPicks,
        multiplier,
        nextMultiplier: towersMultiplier(selection.difficulty, nextPicks.length + 1, houseEdge),
        status: "open",
      },
    };
  }

  async cashOutTowers(
    userId: string,
    sessionId: string,
    betReference: string,
  ): Promise<RpcResult<TowersRoundState>> {
    const owned = await this.requireOpenSession(userId, sessionId, "towers");
    if (!owned.ok) return owned;

    const [bet] = await this.db
      .select()
      .from(bets)
      .where(
        and(eq(bets.reference, betReference), eq(bets.userId, userId), eq(bets.sessionId, sessionId)),
      )
      .limit(1);

    if (!bet) return fail("Round not found", "VALIDATION");
    if (bet.status !== "open") return fail("Round already finished", "VALIDATION");

    const selection = (bet.selection ?? {}) as unknown as TowersSelection;
    const config = towersConfig(selection.difficulty);
    const outcome = (bet.outcome ?? {}) as { traps: number[][]; picks: number[] };
    const picks = outcome.picks ?? [];
    if (picks.length === 0) return fail("Climb at least one floor first", "VALIDATION");

    const stake = Number(bet.stake);
    const multiplier = Number(bet.multiplier);
    const payout = roundMoney(stake * multiplier);

    const [updated] = await this.db
      .update(sminkWallets)
      .set({
        balance: sql`${sminkWallets.balance} + ${payout.toFixed(2)}`,
        lockedBalance: sql`GREATEST(${sminkWallets.lockedBalance} - ${stake.toFixed(2)}, 0)`,
        totalWon: sql`${sminkWallets.totalWon} + ${payout.toFixed(2)}`,
        updatedAt: new Date(),
      })
      .where(eq(sminkWallets.userId, userId))
      .returning({ balance: sminkWallets.balance });

    await this.db
      .update(bets)
      .set({ status: "cashed_out", payout: payout.toFixed(2), settledAt: new Date() })
      .where(eq(bets.id, bet.id));

    await this.db.insert(sminkTransactions).values({
      userId,
      type: "payout",
      status: "confirmed",
      amount: payout.toFixed(2),
      balanceAfter: updated?.balance,
      reference: reference("PAY"),
      metadata: { betReference, game: "towers", sessionId },
      completedAt: new Date(),
    });

    await this.bumpSession(sessionId, 0, payout);

    return {
      ok: true,
      data: {
        reference: betReference,
        sessionId,
        difficulty: selection.difficulty,
        tiles: config.tiles,
        rows: config.rows,
        picks,
        multiplier,
        nextMultiplier: 0,
        status: "cashed_out",
        traps: outcome.traps,
        payout,
        balance: Number(updated?.balance ?? 0),
      },
    };
  }

  async getOpenTowers(userId: string, sessionId: string): Promise<RpcResult<TowersRoundState | null>> {
    const owned = await this.requireOpenSession(userId, sessionId, "towers");
    if (!owned.ok) return owned;

    const [bet] = await this.db
      .select()
      .from(bets)
      .where(
        and(
          eq(bets.userId, userId),
          eq(bets.gameId, owned.game.id),
          eq(bets.sessionId, sessionId),
          eq(bets.status, "open"),
        ),
      )
      .orderBy(desc(bets.createdAt))
      .limit(1);

    if (!bet) return { ok: true, data: null };

    const selection = (bet.selection ?? {}) as unknown as TowersSelection;
    const config = towersConfig(selection.difficulty);
    const outcome = (bet.outcome ?? {}) as { traps: number[][]; picks: number[] };
    const picks = outcome.picks ?? [];
    const houseEdge = Number(owned.game.houseEdge);

    return {
      ok: true,
      data: {
        reference: bet.reference,
        sessionId,
        difficulty: selection.difficulty,
        tiles: config.tiles,
        rows: config.rows,
        picks,
        multiplier: towersMultiplier(selection.difficulty, picks.length, houseEdge),
        nextMultiplier: towersMultiplier(selection.difficulty, picks.length + 1, houseEdge),
        status: "open",
      },
    };
  }

  private async toSessionDto(sessionId: string, gameSlug: string): Promise<GameSessionDto> {
    const [session] = await this.db
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId))
      .limit(1);

    const rows = await this.db
      .select({
        reference: bets.reference,
        stake: bets.stake,
        multiplier: bets.multiplier,
        payout: bets.payout,
        status: bets.status,
        outcome: bets.outcome,
        settledAt: bets.settledAt,
      })
      .from(bets)
      .where(eq(bets.sessionId, sessionId))
      .orderBy(desc(bets.createdAt))
      .limit(50);

    const history: SessionHistoryItem[] = rows.map((row) => ({
      reference: row.reference,
      won: row.status === "won" || row.status === "cashed_out",
      stake: Number(row.stake),
      multiplier: Number(row.multiplier),
      payout: Number(row.payout),
      status: row.status,
      outcome: row.outcome,
      settledAt: row.settledAt ? row.settledAt.toISOString() : null,
    }));

    return {
      id: sessionId,
      gameSlug,
      startedAt: session?.startedAt.toISOString() ?? new Date().toISOString(),
      endedAt: session?.endedAt ? session.endedAt.toISOString() : null,
      betCount: session ? session.betCount : history.length,
      totalStaked: Number(session?.totalStaked ?? 0),
      totalWon: Number(session?.totalWon ?? 0),
      history,
    };
  }

  private async requireOpenSession(userId: string, sessionId: string, slug: string) {
    const [row] = await this.db
      .select({
        session: gameSessions,
        game: games,
      })
      .from(gameSessions)
      .innerJoin(games, eq(gameSessions.gameId, games.id))
      .where(and(eq(gameSessions.id, sessionId), eq(gameSessions.userId, userId)))
      .limit(1);

    if (!row) return fail("Start a session from the wait room first", "VALIDATION");
    if (row.session.endedAt) return fail("This session has ended. Open a new one.", "VALIDATION");
    if (row.game.slug !== slug) return fail("Session belongs to a different game", "VALIDATION");
    if (!row.game.isActive) return fail("Game unavailable", "UNAVAILABLE");
    if (row.game.underMaintenance) return fail("Game is under maintenance", "UNAVAILABLE");

    return { ok: true as const, session: row.session, game: row.game };
  }

  private async getPlayableGame(userId: string, slug: string) {
    const [game] = await this.db.select().from(games).where(eq(games.slug, slug)).limit(1);
    if (!game || !game.isActive) return fail("Game unavailable", "UNAVAILABLE");
    if (game.underMaintenance) return fail("Game is under maintenance", "UNAVAILABLE");

    const [hidden] = await this.db
      .select({ id: gameExcluded.id })
      .from(gameExcluded)
      .where(and(eq(gameExcluded.userId, userId), eq(gameExcluded.gameId, game.id)))
      .limit(1);

    if (hidden) return fail("Game unavailable", "UNAVAILABLE");
    return { ok: true as const, data: game };
  }

  private async endOpenSessions(userId: string, gameId: string) {
    await this.db
      .update(gameSessions)
      .set({ endedAt: new Date() })
      .where(
        and(
          eq(gameSessions.userId, userId),
          eq(gameSessions.gameId, gameId),
          isNull(gameSessions.endedAt),
        ),
      );
  }

  private async bumpSession(sessionId: string, staked: number, won: number) {
    await this.db
      .update(gameSessions)
      .set({
        betCount: sql`${gameSessions.betCount} + 1`,
        totalStaked: sql`${gameSessions.totalStaked} + ${staked.toFixed(2)}`,
        totalWon: sql`${gameSessions.totalWon} + ${won.toFixed(2)}`,
      })
      .where(eq(gameSessions.id, sessionId));
  }

  private parseStake(stakeInput: number, minBet: number, maxBet: number) {
    const stake = roundMoney(Number(stakeInput));
    if (!Number.isFinite(stake) || stake <= 0) {
      return fail("Enter a valid stake", "VALIDATION");
    }
    if (stake < minBet) return fail(`Minimum bet is $${minBet.toFixed(2)}`, "VALIDATION");
    if (stake > maxBet) return fail(`Maximum bet is $${maxBet.toFixed(2)}`, "VALIDATION");
    return { ok: true as const, stake };
  }

  private async nextNonce(userId: string) {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(bets)
      .where(eq(bets.userId, userId));
    return (row?.count ?? 0) + 1;
  }

  private async getControlRule(userId: string, gameId: string): Promise<{
    rule: ControlRule | null;
    rowId: string | null;
  }> {
    const rows = await this.db
      .select()
      .from(userGameControl)
      .where(
        and(
          eq(userGameControl.userId, userId),
          or(eq(userGameControl.gameId, gameId), isNull(userGameControl.gameId)),
        ),
      );

    if (rows.length === 0) return { rule: null, rowId: null };
    const row = rows.find((r) => r.gameId === gameId) ?? rows[0];

    return {
      rowId: row.id,
      rule: {
        mode: row.mode,
        winRate: row.winRate === null ? null : Number(row.winRate),
        forceRounds: row.forceRounds,
        maxWinMultiplier: row.maxWinMultiplier === null ? null : Number(row.maxWinMultiplier),
      },
    };
  }

  private async consumeForcedRound(rowId: string | null, rule: ControlRule | null) {
    if (!rowId || !rule) return;
    if (rule.mode !== "force_win" && rule.mode !== "force_loss") return;
    if (rule.forceRounds <= 0) return;

    await this.db
      .update(userGameControl)
      .set({
        forceRounds: sql`GREATEST(${userGameControl.forceRounds} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(userGameControl.id, rowId));
  }
}
