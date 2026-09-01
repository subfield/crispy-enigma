-- Smink initial schema.
--
-- Creates only the smink_* objects. `users` and `receiving_addresses` are
-- owned by the auth and admin apps and must already exist; this file only
-- references them for foreign keys.
--
-- Idempotent, so it is safe to re-run.

BEGIN;

DO $$ BEGIN
  CREATE TYPE "public"."smink_bet_status" AS ENUM('open', 'won', 'lost', 'cashed_out', 'void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."smink_control_mode" AS ENUM('off', 'bias', 'force_win', 'force_loss');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."smink_game_category" AS ENUM('instant', 'grid', 'wheel');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."smink_tx_status" AS ENUM('pending', 'confirmed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."smink_tx_type" AS ENUM('deposit', 'withdrawal', 'stake', 'payout', 'bonus', 'adjustment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "smink_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"tagline" varchar(255),
	"category" "smink_game_category" DEFAULT 'instant' NOT NULL,
	"thumbnail" varchar(500),
	"min_bet" numeric(18, 2) DEFAULT '1' NOT NULL,
	"max_bet" numeric(18, 2) DEFAULT '1000' NOT NULL,
	"house_edge" numeric(6, 4) DEFAULT '0.02' NOT NULL,
	"max_multiplier" numeric(12, 2) DEFAULT '100' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"under_maintenance" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "smink_games_slug_unique" UNIQUE("slug")
);

CREATE TABLE IF NOT EXISTS "smink_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"bonus_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"locked_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_wagered" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_won" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_deposited" numeric(18, 2) DEFAULT '0' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "smink_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "smink_tx_type" NOT NULL,
	"status" "smink_tx_status" DEFAULT 'pending' NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"balance_after" numeric(18, 2),
	"coin" varchar(20),
	"network" varchar(50),
	"address" varchar(255),
	"amount_crypto" numeric(36, 18),
	"exchange_rate" numeric(18, 8),
	"reference" varchar(64) NOT NULL,
	"metadata" jsonb,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "smink_transactions_reference_unique" UNIQUE("reference")
);

CREATE TABLE IF NOT EXISTS "smink_bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"reference" varchar(64) NOT NULL,
	"stake" numeric(18, 2) NOT NULL,
	"multiplier" numeric(12, 4) DEFAULT '0' NOT NULL,
	"payout" numeric(18, 2) DEFAULT '0' NOT NULL,
	"status" "smink_bet_status" DEFAULT 'open' NOT NULL,
	"selection" jsonb,
	"outcome" jsonb,
	"server_seed" varchar(128) NOT NULL,
	"server_seed_hash" varchar(128) NOT NULL,
	"client_seed" varchar(128) NOT NULL,
	"nonce" integer DEFAULT 0 NOT NULL,
	"was_controlled" boolean DEFAULT false NOT NULL,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "smink_bets_reference_unique" UNIQUE("reference")
);

CREATE TABLE IF NOT EXISTS "smink_game_excluded" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "smink_user_game_control" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid,
	"mode" "smink_control_mode" DEFAULT 'off' NOT NULL,
	"win_rate" numeric(5, 4),
	"force_rounds" integer DEFAULT 0 NOT NULL,
	"max_win_multiplier" numeric(12, 2),
	"note" varchar(500),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "smink_wallets" ADD CONSTRAINT "smink_wallets_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "smink_transactions" ADD CONSTRAINT "smink_transactions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "smink_bets" ADD CONSTRAINT "smink_bets_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "smink_bets" ADD CONSTRAINT "smink_bets_game_id_smink_games_id_fk"
    FOREIGN KEY ("game_id") REFERENCES "public"."smink_games"("id") ON DELETE restrict;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "smink_game_excluded" ADD CONSTRAINT "smink_game_excluded_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "smink_game_excluded" ADD CONSTRAINT "smink_game_excluded_game_id_smink_games_id_fk"
    FOREIGN KEY ("game_id") REFERENCES "public"."smink_games"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "smink_user_game_control" ADD CONSTRAINT "smink_user_game_control_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "smink_user_game_control" ADD CONSTRAINT "smink_user_game_control_game_id_smink_games_id_fk"
    FOREIGN KEY ("game_id") REFERENCES "public"."smink_games"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "smink_games_position_idx" ON "smink_games" USING btree ("position");
CREATE UNIQUE INDEX IF NOT EXISTS "smink_wallets_user_id_unique" ON "smink_wallets" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "smink_transactions_user_id_idx" ON "smink_transactions" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "smink_transactions_created_at_idx" ON "smink_transactions" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "smink_bets_user_id_idx" ON "smink_bets" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "smink_bets_game_id_idx" ON "smink_bets" USING btree ("game_id");
CREATE INDEX IF NOT EXISTS "smink_bets_created_at_idx" ON "smink_bets" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "smink_bets_status_idx" ON "smink_bets" USING btree ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "smink_game_excluded_unique" ON "smink_game_excluded" USING btree ("user_id","game_id");
CREATE INDEX IF NOT EXISTS "smink_user_game_control_user_id_idx" ON "smink_user_game_control" USING btree ("user_id");

COMMIT;
