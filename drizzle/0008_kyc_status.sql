DO $$ BEGIN
  CREATE TYPE "public"."kyc_status" AS ENUM('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'kyc'
  ) THEN
    ALTER TABLE "kyc"
      ADD COLUMN IF NOT EXISTS "status" "kyc_status" NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS "is_current" boolean NOT NULL DEFAULT true;
  END IF;
END $$;
