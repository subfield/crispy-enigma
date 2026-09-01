/**
 * RabbitMQ topology.
 *
 * RPC and events are separate on purpose. Play commands wait for a reply on
 * `engineRpc`. Facts that have already been committed go out on the topic
 * exchange and are never on the money path.
 */
export const QUEUES = {
  engineRpc: "smink.engine.rpc",
  workerEvents: "smink.worker.events",
} as const;

export const EXCHANGES = {
  events: "smink.events",
} as const;

export const COMMANDS = {
  ping: "engine.ping",
  startSession: "session.start",
  endSession: "session.end",
  getSession: "session.get",
  placeBet: "bet.place",
  minesStart: "mines.start",
  minesReveal: "mines.reveal",
  minesCashout: "mines.cashout",
  minesOpen: "mines.open",
  towersStart: "towers.start",
  towersReveal: "towers.reveal",
  towersCashout: "towers.cashout",
  towersOpen: "towers.open",
} as const;

export type Command = (typeof COMMANDS)[keyof typeof COMMANDS];

export const BULL_QUEUES = {
  realtime: "smink.realtime",
  session: "smink.session",
} as const;

export interface RpcEnvelope<T = unknown> {
  userId: string;
  payload: T;
}

export interface StartSessionPayload {
  gameSlug: string;
}

export interface SessionIdPayload {
  sessionId: string;
}

export interface PlaceBetPayload {
  sessionId: string;
  slug: string;
  stake: number;
  selection: unknown;
}

export interface MinesStartPayload {
  sessionId: string;
  stake: number;
  mineCount: number;
}

export interface MinesRevealPayload {
  sessionId: string;
  reference: string;
  tile: number;
}

export interface MinesCashoutPayload {
  sessionId: string;
  reference: string;
}

export interface TowersStartPayload {
  sessionId: string;
  stake: number;
  difficulty: "easy" | "medium" | "hard" | "expert";
}

export interface TowersRevealPayload {
  sessionId: string;
  reference: string;
  tile: number;
}

export interface TowersCashoutPayload {
  sessionId: string;
  reference: string;
}

export interface RpcError {
  ok: false;
  error: string;
  code?: "UNAUTHORIZED" | "DISCONNECTED" | "VALIDATION" | "INSUFFICIENT" | "UNAVAILABLE";
}

export interface RpcOk<T> {
  ok: true;
  data: T;
}

export type RpcResult<T> = RpcOk<T> | RpcError;
