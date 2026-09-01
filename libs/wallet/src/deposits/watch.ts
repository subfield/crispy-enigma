import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, gt, inArray, or } from "drizzle-orm";
import { CHANNEL_EVENTS } from "@game/contracts";
import {
  DRIZZLE,
  type Database,
  sminkTransactions,
  sminkWallets,
  users,
} from "@game/db";
import { RealtimeService } from "@game/realtime";
import { type IncomingTx, listIncoming } from "./chain";
import {
  classifyReceived,
  COIN_QUOTE,
  matchWindowFor,
  type QuoteCoin,
} from "./coins";
import { creditDeposit, flagDepositForReview } from "./credit";
import { sendDepositCreditedEmail } from "../mail";

const WATCH_STATUSES = ["pending"] as const;

type PendingDeposit = {
  id: string;
  userId: string;
  reference: string;
  amount: string;
  amountCrypto: string | null;
  coin: string | null;
  network: string | null;
  address: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  userCreatedAt: Date;
};

/**
 * Polls public explorers for pending Smink deposits and auto-credits
 * amounts inside the spacer. Start this from the worker only — never the engine.
 */
@Injectable()
export class DepositWatchService {
  private readonly logger = new Logger(DepositWatchService.name);
  private timer: NodeJS.Timeout | null = null;
  private simTimer: NodeJS.Timeout | null = null;
  private running = false;
  private simulating = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly realtime: RealtimeService,
  ) {}

  start() {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 20_000);
    this.simTimer = setInterval(() => void this.simulateTick(), 2_000);
    this.logger.log("Watching pending Smink deposits every 20s");
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.simTimer) clearInterval(this.simTimer);
    this.timer = null;
    this.simTimer = null;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.scan("chain");
    } catch (error) {
      this.logger.error("Deposit watch failed", error as Error);
    } finally {
      this.running = false;
    }
  }

  async simulateTick() {
    if (this.simulating) return;
    this.simulating = true;
    try {
      await this.scan("simulate");
    } catch (error) {
      this.logger.error("Deposit simulate tick failed", error as Error);
    } finally {
      this.simulating = false;
    }
  }

  private async scan(mode: "chain" | "simulate") {
    const pending = await this.db
      .select({
        id: sminkTransactions.id,
        userId: sminkTransactions.userId,
        reference: sminkTransactions.reference,
        amount: sminkTransactions.amount,
        amountCrypto: sminkTransactions.amountCrypto,
        coin: sminkTransactions.coin,
        network: sminkTransactions.network,
        address: sminkTransactions.address,
        metadata: sminkTransactions.metadata,
        createdAt: sminkTransactions.createdAt,
        userCreatedAt: users.createdAt,
      })
      .from(sminkTransactions)
      .innerJoin(users, eq(users.id, sminkTransactions.userId))
      .where(
        and(
          eq(sminkTransactions.type, "deposit"),
          inArray(sminkTransactions.status, [...WATCH_STATUSES]),
        ),
      )
      .orderBy(desc(sminkTransactions.createdAt));

    const creditedHashes = await this.creditedHashes();

    for (const deposit of pending) {
      const simulated = Boolean(deposit.metadata?.simulate);
      if (mode === "simulate" && !simulated) continue;
      if (mode === "chain" && simulated) continue;
      await this.inspect(deposit, pending, creditedHashes, mode);
    }
  }

  private async creditedHashes() {
    const rows = await this.db
      .select({ metadata: sminkTransactions.metadata })
      .from(sminkTransactions)
      .where(
        and(
          eq(sminkTransactions.type, "deposit"),
          or(
            eq(sminkTransactions.status, "confirmed"),
            eq(sminkTransactions.status, "review"),
          ),
        ),
      );
    return new Set(
      rows
        .map((row) => String(row.metadata?.txHash || ""))
        .filter(Boolean),
    );
  }

  private async inspect(
    deposit: PendingDeposit,
    allPending: Array<{ id: string; address: string | null; amountCrypto: string | null }>,
    creditedHashes: Set<string>,
    mode: "chain" | "simulate",
  ) {
    if (!deposit.coin || !deposit.address) return;
    if (!(deposit.coin in COIN_QUOTE)) return;

    const meta = deposit.metadata ?? {};
    const expiresAt = meta.expiresAt ? Date.parse(String(meta.expiresAt)) : NaN;
    const quoteCoin = deposit.coin as QuoteCoin;
    const required = Number(
      meta.requiredConfirmations ?? COIN_QUOTE[quoteCoin]?.confirmations ?? 3,
    );
    const expected = Number(deposit.amountCrypto);
    const window = Number(
      meta.matchWindow ??
        (COIN_QUOTE[quoteCoin] ? matchWindowFor(quoteCoin, expected) : 0),
    );
    const usd = Number(deposit.amount);

    if (Number.isFinite(expiresAt) && Date.now() > expiresAt + 6 * 60 * 60 * 1000) {
      await this.db
        .update(sminkTransactions)
        .set({
          status: "cancelled",
          completedAt: new Date(),
          updatedAt: new Date(),
          metadata: { ...meta, cancelReason: "expired" },
        })
        .where(eq(sminkTransactions.id, deposit.id));
      await this.notify(deposit, {
        status: "cancelled",
        confirmations: Number(meta.confirmations ?? 0),
        requiredConfirmations: required,
      });
      return;
    }

    let incoming: IncomingTx[] = [];
    if (mode === "simulate") {
      const simulated = this.simulatedIncoming(deposit, required);
      if (!simulated) return;
      incoming = [simulated];
    } else {
      try {
        incoming = await listIncoming(
          deposit.coin,
          deposit.network || "",
          deposit.address,
        );
      } catch (error) {
        this.logger.warn(
          `Chain lookup failed for ${deposit.coin} ${deposit.reference}: ${(error as Error).message}`,
        );
        return;
      }
    }

    const fresh = incoming.filter((tx) => !creditedHashes.has(tx.hash));
    const classified = Number.isFinite(expected)
      ? fresh
          .map((tx) => ({
            tx,
            kind: classifyReceived(expected, tx.amount, quoteCoin),
          }))
          .filter((row) => row.kind !== "ignore")
      : [];

    const match = classified.find((row) => row.kind === "match")?.tx;
    const near = classified.find((row) => row.kind === "review")?.tx;

    if (!match && near) {
      await this.progress(deposit, near, required, {
        silent: near.confirmations >= required,
      });
      if (near.confirmations < required) return;
      await flagDepositForReview(this.db, deposit.id, ["amount_mismatch"], {
        txHash: near.hash,
        receivedCrypto: near.amount,
        confirmations: near.confirmations,
      });
      await this.notify(deposit, {
        status: "review",
        confirmations: near.confirmations,
        requiredConfirmations: required,
        receivedCrypto: near.amount,
      });
      return;
    }

    if (!match) return;

    const reasons: string[] = [];
    if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
      reasons.push("expired_payment");
    }

    const collisions = allPending.filter(
      (row) =>
        row.id !== deposit.id &&
        row.address === deposit.address &&
        Number.isFinite(Number(row.amountCrypto)) &&
        Math.abs(Number(row.amountCrypto) - match.amount) <= window,
    );
    if (collisions.length > 0) reasons.push("shared_address_collision");

    const accountAgeMs = Date.now() - deposit.userCreatedAt.getTime();
    if (accountAgeMs < 30 * 60 * 1000 && usd >= 500) {
      reasons.push("new_account_large");
    }

    const [wallet] = await this.db
      .select({ totalDeposited: sminkWallets.totalDeposited })
      .from(sminkWallets)
      .where(eq(sminkWallets.userId, deposit.userId))
      .limit(1);
    if (Number(wallet?.totalDeposited ?? 0) <= 0 && usd >= 1000) {
      reasons.push("large_first_deposit");
    }

    const recent = await this.db
      .select({ id: sminkTransactions.id })
      .from(sminkTransactions)
      .where(
        and(
          eq(sminkTransactions.userId, deposit.userId),
          eq(sminkTransactions.type, "deposit"),
          gt(sminkTransactions.createdAt, new Date(Date.now() - 10 * 60 * 1000)),
        ),
      );
    if (recent.length >= 3) reasons.push("rapid_deposits");

    await this.progress(deposit, match, required, {
      silent: match.confirmations >= required,
    });

    if (match.confirmations < required) return;

    if (reasons.length > 0) {
      await flagDepositForReview(this.db, deposit.id, reasons, {
        txHash: match.hash,
        receivedCrypto: match.amount,
        confirmations: match.confirmations,
        fromAddress: match.from,
      });
      await this.notify(deposit, {
        status: "review",
        confirmations: match.confirmations,
        requiredConfirmations: required,
        receivedCrypto: match.amount,
      });
      this.logger.warn(
        `Deposit ${deposit.id} held for review: ${reasons.join(", ")}`,
      );
      return;
    }

    const credited = await creditDeposit(this.db, deposit.id, {
      txHash: match.hash,
      receivedCrypto: match.amount,
      confirmations: match.confirmations,
      creditedBy: mode === "simulate" ? "simulate" : "chain",
    });
    if (credited) {
      creditedHashes.add(match.hash);
      await this.notify(deposit, {
        status: "confirmed",
        confirmations: match.confirmations,
        requiredConfirmations: required,
        receivedCrypto: match.amount,
        balance: Number(credited.balanceAfter ?? 0),
      });
      void sendDepositCreditedEmail(this.db, credited);
      this.logger.log(`Auto-credited deposit ${credited.reference}`);
    }
  }

  private simulatedIncoming(deposit: PendingDeposit, required: number): IncomingTx | null {
    const simulate = deposit.metadata?.simulate;
    if (!simulate || typeof simulate !== "object") return null;
    const body = simulate as {
      amount?: number;
      hash?: string;
      confirmations?: number;
      tickedAt?: number;
      appearAt?: number;
    };
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;

    const created =
      deposit.createdAt instanceof Date
        ? deposit.createdAt.getTime()
        : Date.parse(String(deposit.createdAt));
    const appearAt = Number(
      body.appearAt ??
        (Number.isFinite(created) ? created + 8_000 : Date.now()),
    );
    const now = Date.now();
    if (now < appearAt) return null;

    const current = Math.max(0, Number(body.confirmations ?? 0));
    const due = Math.min(
      required,
      1 + Math.floor((now - appearAt) / 4_000),
    );
    if (due <= current) return null;

    return {
      hash: String(body.hash || `sim_${deposit.id}`),
      amount,
      confirmations: due,
      timestamp: Date.now(),
    };
  }

  private async progress(
    deposit: PendingDeposit,
    tx: IncomingTx,
    required: number,
    options: { silent?: boolean } = {},
  ) {
    const meta = deposit.metadata ?? {};
    const unchanged =
      Number(meta.confirmations ?? -1) === tx.confirmations &&
      String(meta.txHash ?? "") === tx.hash;
    const simulate =
      meta.simulate && typeof meta.simulate === "object"
        ? {
            ...(meta.simulate as Record<string, unknown>),
            confirmations: tx.confirmations,
            tickedAt: Date.now(),
          }
        : meta.simulate;

    if (!unchanged) {
      await this.db
        .update(sminkTransactions)
        .set({
          metadata: {
            ...meta,
            simulate,
            txHash: tx.hash,
            receivedCrypto: tx.amount,
            confirmations: tx.confirmations,
            fromAddress: tx.from,
          },
          updatedAt: new Date(),
        })
        .where(eq(sminkTransactions.id, deposit.id));
    }

    if (options.silent || unchanged) return;

    await this.notify(deposit, {
      status: "pending",
      confirmations: tx.confirmations,
      requiredConfirmations: required,
      receivedCrypto: tx.amount,
    });
  }

  private async notify(
    deposit: PendingDeposit,
    payload: {
      status: string;
      confirmations: number;
      requiredConfirmations: number;
      receivedCrypto?: number;
      balance?: number;
    },
  ) {
    await this.realtime.publishToUser(deposit.userId, CHANNEL_EVENTS.depositUpdated, {
      reference: deposit.reference,
      ...payload,
    });
    if (payload.status === "confirmed" && Number.isFinite(payload.balance)) {
      await this.realtime.publishToUser(deposit.userId, CHANNEL_EVENTS.balanceChanged, {
        balance: payload.balance,
      });
    }
  }
}
