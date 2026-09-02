ALTER TABLE "smink_wallets"
  ADD COLUMN IF NOT EXISTS "difficulty" integer,
  ADD COLUMN IF NOT EXISTS "game_difficulties" jsonb NOT NULL DEFAULT '{}'::jsonb;
