ALTER TABLE "receiving_addresses"
  ADD COLUMN IF NOT EXISTS "product" varchar(32) NOT NULL DEFAULT 'oraixo';

ALTER TABLE "kyc"
  ADD COLUMN IF NOT EXISTS "product" varchar(32) NOT NULL DEFAULT 'oraixo';

CREATE INDEX IF NOT EXISTS "receiving_addresses_product_idx"
  ON "receiving_addresses" ("product");

CREATE INDEX IF NOT EXISTS "kyc_product_idx"
  ON "kyc" ("product");
