import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ *
 * Shared tables
 *
 * `users` is owned by the Oraixo auth app and shared across products.
 * It is redeclared here (not extended) so Drizzle can read it; any
 * column change must be made in the auth app first.
 * ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  firstName: varchar("first_name", { length: 255 }),
  lastName: varchar("last_name", { length: 255 }),
  email: varchar("email", { length: 255 }).notNull().unique(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  refCode: varchar("ref_code", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }),
  profileImageUrl: varchar("profile_image_url", { length: 1000 }),
  clerkId: varchar("clerk_id", { length: 255 }),
  isActive: boolean("is_active").notNull().default(true),
  isSuspended: boolean("is_suspended").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Crypto deposit addresses, scoped per website (`product`). */
export const receivingAddresses = pgTable("receiving_addresses", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  address: varchar("address", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  qrcode: varchar("qrcode", { length: 500 }).notNull().default(""),
  coin: varchar("coin", { length: 255 }).notNull(),
  network: varchar("network", { length: 255 }).notNull(),
  image: varchar("image", { length: 500 }).notNull().default(""),
  description: varchar("description", { length: 255 }),
  isActive: boolean("is_active").notNull().default(true),
  product: varchar("product", { length: 32 }).notNull().default("oraixo"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ------------------------------------------------------------------ *
 * Smink enums
 * ------------------------------------------------------------------ */

export const betStatusEnum = pgEnum("smink_bet_status", [
  "open",
  "won",
  "lost",
  "cashed_out",
  "void",
]);

export const gameCategoryEnum = pgEnum("smink_game_category", [
  "instant",
  "grid",
  "wheel",
]);

export const walletTxTypeEnum = pgEnum("smink_tx_type", [
  "deposit",
  "withdrawal",
  "stake",
  "payout",
  "bonus",
  "adjustment",
]);

export const walletTxStatusEnum = pgEnum("smink_tx_status", [
  "pending",
  "review",
  "confirmed",
  "failed",
  "cancelled",
]);

/**
 * How the admin steers a player's results.
 * `bias` nudges the win probability; the force modes decide the next round outright.
 */
export const controlModeEnum = pgEnum("smink_control_mode", [
  "off",
  "bias",
  "force_win",
  "force_loss",
]);

/* ------------------------------------------------------------------ *
 * Play sessions
 *
 * A session begins when the player presses Start in a game's wait room and
 * ends when they leave. It scopes the in-game history feed, and gives Ably a
 * channel to publish that feed on.
 * ------------------------------------------------------------------ */

export const gameSessions = pgTable(
  "smink_sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    betCount: integer("bet_count").notNull().default(0),
    totalStaked: numeric("total_staked", { precision: 18, scale: 2 }).notNull().default("0"),
    totalWon: numeric("total_won", { precision: 18, scale: 2 }).notNull().default("0"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    endedAt: timestamp("ended_at"),
  },
  (table) => [
    index("smink_sessions_user_id_idx").on(table.userId),
    index("smink_sessions_game_id_idx").on(table.gameId),
    index("smink_sessions_started_at_idx").on(table.startedAt),
  ],
);

/* ------------------------------------------------------------------ *
 * Smink wallet — deliberately separate from the investment balances
 * ------------------------------------------------------------------ */

export const sminkWallets = pgTable(
  "smink_wallets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Withdrawable, stakeable cash. */
    balance: numeric("balance", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    /** Promotional credit. Stakeable, not directly withdrawable. */
    bonusBalance: numeric("bonus_balance", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    /** Held by rounds that are still open, e.g. an unfinished Mines game. */
    lockedBalance: numeric("locked_balance", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    totalWagered: numeric("total_wagered", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    totalWon: numeric("total_won", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    totalDeposited: numeric("total_deposited", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    isLocked: boolean("is_locked").notNull().default(false),
    /**
     * Player-level loss percent. Null inherits each game's difficulty.
     * 0 is fair odds for this player even when the game is harder.
     * Used when a game is not listed in `gameDifficulties`.
     */
    difficulty: integer("difficulty"),
    /**
     * Per-game loss percent for this player, keyed by game slug.
     * A missing key uses `difficulty`, then the game slider.
     */
    gameDifficulties: jsonb("game_difficulties")
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    lookGradient: varchar("look_gradient", { length: 32 })
      .notNull()
      .default("smink-purple"),
    lookFont: varchar("look_font", { length: 32 })
      .notNull()
      .default("orbitron"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("smink_wallets_user_id_unique").on(table.userId)],
);

export const sminkTransactions = pgTable(
  "smink_transactions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: walletTxTypeEnum("type").notNull(),
    status: walletTxStatusEnum("status").notNull().default("pending"),
    /** Signed: positive credits the wallet, negative debits it. */
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    balanceAfter: numeric("balance_after", { precision: 18, scale: 2 }),
    coin: varchar("coin", { length: 20 }),
    network: varchar("network", { length: 50 }),
    address: varchar("address", { length: 255 }),
    amountCrypto: numeric("amount_crypto", { precision: 36, scale: 18 }),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 8 }),
    reference: varchar("reference", { length: 64 }).notNull().unique(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    completedAt: timestamp("completed_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("smink_transactions_user_id_idx").on(table.userId),
    index("smink_transactions_created_at_idx").on(table.createdAt),
  ],
);

/* ------------------------------------------------------------------ *
 * Games
 * ------------------------------------------------------------------ */

export const games = pgTable(
  "smink_games",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: varchar("slug", { length: 64 }).notNull().unique(),
    name: varchar("name", { length: 128 }).notNull(),
    tagline: varchar("tagline", { length: 255 }),
    category: gameCategoryEnum("category").notNull().default("instant"),
    thumbnail: varchar("thumbnail", { length: 500 }),
    minBet: numeric("min_bet", { precision: 18, scale: 2 })
      .notNull()
      .default("1"),
    maxBet: numeric("max_bet", { precision: 18, scale: 2 })
      .notNull()
      .default("1000"),
    /** Fraction, e.g. 0.02 == 2%. Folded into every payout calculation. */
    houseEdge: numeric("house_edge", { precision: 6, scale: 4 })
      .notNull()
      .default("0.02"),
    /**
     * Loss percent for every player on this game. 90 means a 90% chance of
     * losing and a 10% chance of winning. 0 leaves the round to fair odds.
     */
    difficulty: integer("difficulty").notNull().default(0),
    maxMultiplier: numeric("max_multiplier", { precision: 12, scale: 2 })
      .notNull()
      .default("100"),
    isActive: boolean("is_active").notNull().default(true),
    underMaintenance: boolean("under_maintenance").notNull().default(false),
    position: integer("position").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("smink_games_position_idx").on(table.position)],
);

export const bets = pgTable(
  "smink_bets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "restrict" }),
    /** Null for bets placed outside a wait-room session. */
    sessionId: uuid("session_id").references(() => gameSessions.id, { onDelete: "set null" }),
    reference: varchar("reference", { length: 64 }).notNull().unique(),
    stake: numeric("stake", { precision: 18, scale: 2 }).notNull(),
    multiplier: numeric("multiplier", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
    payout: numeric("payout", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    status: betStatusEnum("status").notNull().default("open"),
    /** What the player chose: target number, side, tile count, etc. */
    selection: jsonb("selection").$type<Record<string, unknown>>(),
    /** What the server rolled. Written before the client is told anything. */
    outcome: jsonb("outcome").$type<Record<string, unknown>>(),
    serverSeed: varchar("server_seed", { length: 128 }).notNull(),
    serverSeedHash: varchar("server_seed_hash", { length: 128 }).notNull(),
    clientSeed: varchar("client_seed", { length: 128 }).notNull(),
    nonce: integer("nonce").notNull().default(0),
    /** True when an admin control changed what would otherwise have been rolled. */
    wasControlled: boolean("was_controlled").notNull().default(false),
    settledAt: timestamp("settled_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("smink_bets_user_id_idx").on(table.userId),
    index("smink_bets_game_id_idx").on(table.gameId),
    index("smink_bets_session_id_idx").on(table.sessionId),
    index("smink_bets_created_at_idx").on(table.createdAt),
    index("smink_bets_status_idx").on(table.status),
  ],
);

/** Hides specific games from specific users. Mirrors the investment app's plan_excluded. */
export const gameExcluded = pgTable(
  "smink_game_excluded",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("smink_game_excluded_unique").on(table.userId, table.gameId),
  ],
);

/**
 * The admin's control surface over a player's results.
 *
 * A null gameId applies the rule to every game. `forceRounds` counts down so
 * an admin can grant, say, the next three rounds as wins and have it expire.
 */
export const userGameControl = pgTable(
  "smink_user_game_control",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameId: uuid("game_id").references(() => games.id, { onDelete: "cascade" }),
    mode: controlModeEnum("mode").notNull().default("off"),
    /** Used when mode is `bias`: 0 never wins, 1 always wins. */
    winRate: numeric("win_rate", { precision: 5, scale: 4 }),
    /** Used by the force modes. Decremented per settled round; 0 disables the rule. */
    forceRounds: integer("force_rounds").notNull().default(0),
    /** Caps the multiplier a controlled win can reach. */
    maxWinMultiplier: numeric("max_win_multiplier", {
      precision: 12,
      scale: 2,
    }),
    note: varchar("note", { length: 500 }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("smink_user_game_control_user_id_idx").on(table.userId)],
);

export type User = typeof users.$inferSelect;
export type SminkWallet = typeof sminkWallets.$inferSelect;
export type SminkTransaction = typeof sminkTransactions.$inferSelect;
export type Game = typeof games.$inferSelect;
export type Bet = typeof bets.$inferSelect;
export type NewBet = typeof bets.$inferInsert;
export type GameSession = typeof gameSessions.$inferSelect;
export type UserGameControl = typeof userGameControl.$inferSelect;
