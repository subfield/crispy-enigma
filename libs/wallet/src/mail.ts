import { Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { type Database, users } from "@game/db";

const logger = new Logger("SminkMail");

async function queueEmail(options: {
  to: string[];
  subject: string;
  template: string;
  context: Record<string, unknown>;
}) {
  const base = process.env.MAILER_BASE_URL;
  const key = process.env.MAILER_API_KEY;
  if (!base || !key) {
    logger.warn("MAILER_BASE_URL / MAILER_API_KEY not set; skip email");
    return;
  }

  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/v1/email/send`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(options),
    });
    if (!response.ok) {
      logger.warn(`Mailer responded ${response.status} for ${options.template}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to queue email: ${message}`);
  }
}

function dashboardUrl() {
  return process.env.SMINK_DASHBOARD_URL || "http://localhost:5642";
}

async function playerFor(db: Database, userId: string) {
  const [player] = await db
    .select({
      email: users.email,
      firstName: users.firstName,
      username: users.username,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return player;
}

export async function sendDepositCreditedEmail(
  db: Database,
  tx: { userId: string; amount: string | number; coin: string | null; reference: string },
) {
  const player = await playerFor(db, tx.userId);
  if (!player?.email) return;

  await queueEmail({
    to: [player.email],
    subject: "Your Smink deposit is in",
    template: "smink-deposit-completed",
    context: {
      userName: player.firstName || player.username,
      amount: Number(tx.amount).toFixed(2),
      paymentMethod: tx.coin || "Crypto",
      reference: tx.reference,
      dashboardUrl: dashboardUrl(),
    },
  });
}

export async function sendWithdrawalPaidEmail(
  db: Database,
  tx: {
    userId: string;
    amount: string | number;
    coin: string | null;
    reference: string;
    address?: string | null;
  },
) {
  const player = await playerFor(db, tx.userId);
  if (!player?.email) return;

  await queueEmail({
    to: [player.email],
    subject: "Your Smink withdrawal has been sent",
    template: "smink-withdrawal-sent",
    context: {
      userName: player.firstName || player.username,
      amount: Math.abs(Number(tx.amount)).toFixed(2),
      paymentMethod: tx.coin || "Crypto",
      reference: tx.reference,
      destination: tx.address || "",
      dashboardUrl: dashboardUrl(),
    },
  });
}
