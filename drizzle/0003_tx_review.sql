DO $$ BEGIN
  ALTER TYPE "public"."smink_tx_status" ADD VALUE IF NOT EXISTS 'review';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
