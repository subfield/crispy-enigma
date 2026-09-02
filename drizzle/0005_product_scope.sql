DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'receiving_addresses'
  ) THEN
    ALTER TABLE "receiving_addresses"
      ADD COLUMN IF NOT EXISTS "product" varchar(32) NOT NULL DEFAULT 'oraixo';
    CREATE INDEX IF NOT EXISTS "receiving_addresses_product_idx"
      ON "receiving_addresses" ("product");
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'kyc'
  ) THEN
    ALTER TABLE "kyc"
      ADD COLUMN IF NOT EXISTS "product" varchar(32) NOT NULL DEFAULT 'oraixo';
    CREATE INDEX IF NOT EXISTS "kyc_product_idx"
      ON "kyc" ("product");
  END IF;
END $$;
