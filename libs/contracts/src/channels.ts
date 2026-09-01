/**
 * Ably channel naming.
 *
 * Tokens issued by the gateway are scoped to exactly the channels a user is
 * allowed on, so a client cannot subscribe to another player's stream.
 */
export const channels = {
  /** Per-user: balance changes, round results, reconnect replays. */
  user: (userId: string) => `smink:user:${userId}`,

  /** Per-session: the history feed for one wait-room-to-play session. */
  session: (sessionId: string) => `smink:session:${sessionId}`,

  /** Public: the lobby live-wins ticker. */
  lobby: () => "smink:lobby",
} as const;

export const CHANNEL_EVENTS = {
  betSettled: "bet.settled",
  minesUpdated: "mines.updated",
  towersUpdated: "towers.updated",
  balanceChanged: "balance.changed",
  sessionStarted: "session.started",
  sessionEnded: "session.ended",
  liveWin: "live.win",
  depositUpdated: "deposit.updated",
} as const;

export type ChannelEvent = (typeof CHANNEL_EVENTS)[keyof typeof CHANNEL_EVENTS];
