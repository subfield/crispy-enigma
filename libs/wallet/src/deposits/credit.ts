import { and, eq, inArray, sql } from "drizzle-orm";
import {
  type Database,
  sminkTransactions,
  sminkWallets,
} from "@game/db";

const CREDITABLE = ["pending", "review"] as const;

export async function creditDeposit(
  db: Database,
  depositId: string,
  extraMetadata: Record<string, unknown> = {},
) {
  const [current] = await db
    .select()
    .from(sminkTransactions)
    .where(
      and(
        eq(sminkTransactions.id, depositId),
        eq(sminkTransactions.type, "deposit"),
        inArray(sminkTransactions.status, [...CREDITABLE]),
      ),
    )
    .limit(1);

  if (!current) return null;

  const [claimed] = await db
    .update(sminkTransactions)
    .set({
      status: "confirmed",
      completedAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        ...(current.metadata ?? {}),
        ...extraMetadata,
        creditedAt: new Date().toISOString(),
      },
    })
    .where(
      and(
        eq(sminkTransactions.id, depositId),
        inArray(sminkTransactions.status, [...CREDITABLE]),
      ),
    )
    .returning();

  if (!claimed) return null;

  const amount = Number(claimed.amount);
  await db
    .insert(sminkWallets)
    .values({ userId: claimed.userId })
    .onConflictDoNothing({ target: sminkWallets.userId });

  const [wallet] = await db
    .update(sminkWallets)
    .set({
      balance: sql`${sminkWallets.balance} + ${amount.toFixed(2)}`,
      totalDeposited: sql`${sminkWallets.totalDeposited} + ${amount.toFixed(2)}`,
      updatedAt: new Date(),
    })
    .where(eq(sminkWallets.userId, claimed.userId))
    .returning({ balance: sminkWallets.balance });

  if (!wallet) {
    await db
      .update(sminkTransactions)
      .set({
        status: current.status,
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(sminkTransactions.id, depositId));
    return null;
  }

  const [updated] = await db
    .update(sminkTransactions)
    .set({ balanceAfter: wallet.balance, updatedAt: new Date() })
    .where(eq(sminkTransactions.id, depositId))
    .returning();

  return updated ?? claimed;
}

export async function flagDepositForReview(
  db: Database,
  depositId: string,
  reasons: string[],
  extraMetadata: Record<string, unknown> = {},
) {
  const [current] = await db
    .select({
      id: sminkTransactions.id,
      status: sminkTransactions.status,
      metadata: sminkTransactions.metadata,
    })
    .from(sminkTransactions)
    .where(eq(sminkTransactions.id, depositId))
    .limit(1);

  if (!current || current.status !== "pending") return null;

  return db
    .update(sminkTransactions)
    .set({
      status: "review",
      updatedAt: new Date(),
      metadata: {
        ...(current.metadata ?? {}),
        ...extraMetadata,
        needsReview: true,
        reviewReasons: reasons,
        flaggedAt: new Date().toISOString(),
      },
    })
    .where(
      and(
        eq(sminkTransactions.id, depositId),
        eq(sminkTransactions.status, "pending"),
      ),
    )
    .returning();
}
