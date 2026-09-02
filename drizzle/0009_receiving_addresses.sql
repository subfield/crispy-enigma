-- Deposit wallets are owned by admin, but Smink reads them from this database.
-- Create the table here if auth/admin never provisioned it (hosted Smink Neon).

CREATE TABLE IF NOT EXISTS "receiving_addresses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "address" varchar(255) NOT NULL,
  "name" varchar(255) NOT NULL,
  "qrcode" varchar(500) DEFAULT '' NOT NULL,
  "coin" varchar(255) NOT NULL,
  "network" varchar(255) NOT NULL,
  "image" varchar(500) DEFAULT '' NOT NULL,
  "description" varchar(255),
  "is_active" boolean DEFAULT true NOT NULL,
  "product" varchar(32) DEFAULT 'oraixo' NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "receiving_addresses"
  ADD COLUMN IF NOT EXISTS "product" varchar(32) NOT NULL DEFAULT 'oraixo';

CREATE INDEX IF NOT EXISTS "receiving_addresses_product_idx"
  ON "receiving_addresses" ("product");
