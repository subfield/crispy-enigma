CREATE UNIQUE INDEX IF NOT EXISTS "smink_open_deposit_quote_unique"
ON "smink_transactions" ("coin", "amount_crypto")
WHERE "type" = 'deposit'
  AND "status" IN ('pending', 'review')
  AND "amount_crypto" IS NOT NULL;
