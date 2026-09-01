import type { GameOutcome } from "./games";

/**
 * RabbitMQ routing keys.
 *
 * Everything published here describes a fact that is already committed to
 * Postgres. Nothing on the money path waits for these, so a dropped message
 * costs a ticker entry, never a balance.
 */
export const ROUTING_KEYS = {
  betSettled: "bet.settled",
  minesStarted: "mines.started",
  minesSettled: "mines.settled",
  towersStarted: "towers.started",
  towersSettled: "towers.settled",
  depositPending: "deposit.pending",
  depositConfirmed: "deposit.confirmed",
  withdrawalRequested: "withdrawal.requested",
  sessionStarted: "session.started",
  sessionEnded: "session.ended",
} as const;

export type RoutingKey = (typeof ROUTING_KEYS)[keyof typeof ROUTING_KEYS];

interface BaseEvent {
  /** Deduplication key for idempotent consumers. */
  eventId: string;
  occurredAt: string;
  userId: string;
}

export interface BetSettledEvent extends BaseEvent {
  betReference: string;
  sessionId: string | null;
  gameSlug: string;
  stake: number;
  multiplier: number;
  payout: number;
  won: boolean;
  outcome: GameOutcome;
  wasControlled: boolean;
}

export interface SessionEvent extends BaseEvent {
  sessionId: string;
  gameSlug: string;
}

export interface DepositEvent extends BaseEvent {
  reference: string;
  amountUsd: number;
  coin: string;
}

export type SminkEvent = BetSettledEvent | SessionEvent | DepositEvent;
