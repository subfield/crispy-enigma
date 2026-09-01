BEGIN;

CREATE TABLE IF NOT EXISTS "smink_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"bet_count" integer DEFAULT 0 NOT NULL,
	"total_staked" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total_won" numeric(18, 2) DEFAULT '0' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);

DO $$ BEGIN
  ALTER TABLE "smink_sessions" ADD CONSTRAINT "smink_sessions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "smink_sessions" ADD CONSTRAINT "smink_sessions_game_id_smink_games_id_fk"
    FOREIGN KEY ("game_id") REFERENCES "public"."smink_games"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "smink_sessions_user_id_idx" ON "smink_sessions" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "smink_sessions_game_id_idx" ON "smink_sessions" USING btree ("game_id");
CREATE INDEX IF NOT EXISTS "smink_sessions_started_at_idx" ON "smink_sessions" USING btree ("started_at");

ALTER TABLE "smink_bets" ADD COLUMN IF NOT EXISTS "session_id" uuid;

DO $$ BEGIN
  ALTER TABLE "smink_bets" ADD CONSTRAINT "smink_bets_session_id_smink_sessions_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "public"."smink_sessions"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "smink_bets_session_id_idx" ON "smink_bets" USING btree ("session_id");

COMMIT;
