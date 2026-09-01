export const COIN_QUOTE = {
  BTC: {
    geckoId: "bitcoin",
    decimals: 8,
    floor: 0.000001,
    tolerance: 0.15,
    confirmations: 3,
  },
  ETH: {
    geckoId: "ethereum",
    decimals: 8,
    floor: 0.00001,
    tolerance: 0.15,
    confirmations: 12,
  },
  USDT: {
    geckoId: "tether",
    decimals: 6,
    floor: 0.02,
    tolerance: 0.015,
    confirmations: 12,
  },
  USDC: {
    geckoId: "usd-coin",
    decimals: 6,
    floor: 0.02,
    tolerance: 0.015,
    confirmations: 12,
  },
  SOL: {
    geckoId: "solana",
    decimals: 9,
    floor: 0.001,
    tolerance: 0.08,
    confirmations: 32,
  },
  LTC: {
    geckoId: "litecoin",
    decimals: 8,
    floor: 0.00001,
    tolerance: 0.15,
    confirmations: 6,
  },
} as const;

export type QuoteCoin = keyof typeof COIN_QUOTE;

export function roundCrypto(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function formatCrypto(value: number, coin: string) {
  const meta = COIN_QUOTE[coin as QuoteCoin];
  const decimals = meta?.decimals ?? 8;
  return `${value.toFixed(decimals)} ${coin}`;
}

export function matchWindowFor(coin: QuoteCoin, expected: number) {
  const meta = COIN_QUOTE[coin];
  if (!Number.isFinite(expected) || expected <= 0) return meta.floor;
  return Math.max(meta.floor, expected * meta.tolerance);
}

/** Gap between unique quotes: wide enough that match windows never overlap. */
export function uniquenessStepFor(coin: QuoteCoin, expected: number) {
  const meta = COIN_QUOTE[coin];
  return roundCrypto(matchWindowFor(coin, expected) * 2.2, meta.decimals);
}

export function allocateUniqueAmount(
  base: number,
  used: number[],
  step: number,
  decimals: number,
) {
  let amount = roundCrypto(Math.max(step, base), decimals);
  const taken = new Set(used.map((value) => roundCrypto(value, decimals)));
  while (taken.has(amount)) {
    amount = roundCrypto(amount + step, decimals);
  }
  return amount;
}

export function classifyReceived(
  expected: number,
  received: number,
  coin: QuoteCoin,
): "match" | "review" | "ignore" {
  if (!Number.isFinite(expected) || !Number.isFinite(received) || expected <= 0) {
    return "ignore";
  }
  const delta = Math.abs(expected - received);
  if (delta <= matchWindowFor(coin, expected)) return "match";
  if (delta / expected <= 0.5) return "review";
  return "ignore";
}
