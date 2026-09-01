import {
  allocateUniqueAmount,
  COIN_QUOTE,
  matchWindowFor,
  type QuoteCoin,
  roundCrypto,
  uniquenessStepFor,
} from "./coins";

const GECKO_IDS = Object.values(COIN_QUOTE)
  .map((coin) => coin.geckoId)
  .join(",");

export async function usdPrice(coin: QuoteCoin): Promise<number> {
  const meta = COIN_QUOTE[coin];
  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${GECKO_IDS}&vs_currencies=usd`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!response.ok) {
    throw new Error("Could not fetch a live price");
  }
  const body = (await response.json()) as Record<string, { usd?: number }>;
  const price = Number(body[meta.geckoId]?.usd);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`No USD price for ${coin}`);
  }
  return price;
}

export async function quoteCryptoAmount(
  coin: QuoteCoin,
  amountUsd: number,
  usedAmounts: number[],
) {
  const meta = COIN_QUOTE[coin];
  const rate = await usdPrice(coin);
  const base = amountUsd / rate;
  const amountCrypto = allocateUniqueAmount(
    base,
    usedAmounts,
    uniquenessStepFor(coin, base),
    meta.decimals,
  );
  const quoted = roundCrypto(amountCrypto, meta.decimals);
  return {
    amountCrypto: quoted,
    exchangeRate: roundCrypto(rate, 8),
    confirmations: meta.confirmations,
    decimals: meta.decimals,
    step: uniquenessStepFor(coin, quoted),
    matchWindow: matchWindowFor(coin, quoted),
  };
}
