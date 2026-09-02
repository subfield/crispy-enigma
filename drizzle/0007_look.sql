ALTER TABLE "smink_wallets"
  ADD COLUMN IF NOT EXISTS "look_gradient" varchar(32) NOT NULL DEFAULT 'smink-purple',
  ADD COLUMN IF NOT EXISTS "look_font" varchar(32) NOT NULL DEFAULT 'orbitron';
