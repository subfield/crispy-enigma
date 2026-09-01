import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DRIZZLE, type Database, sminkWallets } from "@game/db";

@Injectable()
export class WalletService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async getOrCreate(userId: string) {
    const existing = await this.db
      .select()
      .from(sminkWallets)
      .where(eq(sminkWallets.userId, userId))
      .limit(1);

    if (existing[0]) return existing[0];

    const created = await this.db
      .insert(sminkWallets)
      .values({ userId })
      .onConflictDoNothing({ target: sminkWallets.userId })
      .returning();

    if (created[0]) return created[0];

    const [refetched] = await this.db
      .select()
      .from(sminkWallets)
      .where(eq(sminkWallets.userId, userId))
      .limit(1);

    return refetched;
  }

  summarize(wallet: {
    balance: string;
    bonusBalance: string;
    lockedBalance: string;
    totalWagered: string;
    totalWon: string;
    totalDeposited: string;
    isLocked: boolean;
  }) {
    const balance = Number(wallet.balance);
    const bonus = Number(wallet.bonusBalance);
    const wagered = Number(wallet.totalWagered);
    const won = Number(wallet.totalWon);

    return {
      balance,
      bonusBalance: bonus,
      lockedBalance: Number(wallet.lockedBalance),
      playable: balance + bonus,
      totalWagered: wagered,
      totalWon: won,
      totalDeposited: Number(wallet.totalDeposited),
      netProfit: won - wagered,
      isLocked: wallet.isLocked,
    };
  }
}
