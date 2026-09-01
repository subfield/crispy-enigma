export interface IncomingTx {
  hash: string;
  amount: number;
  confirmations: number;
  timestamp: number | null;
  from?: string;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }
  return (await response.json()) as T;
}

async function postRpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }
  const body = (await response.json()) as { result?: T; error?: { message?: string } };
  if (body.error) {
    throw new Error(body.error.message || method);
  }
  return body.result as T;
}

async function btcFamily(base: string, address: string): Promise<IncomingTx[]> {
  const [tip, txs] = await Promise.all([
    getJson<number>(`${base}/blocks/tip/height`),
    getJson<
      Array<{
        txid: string;
        status?: { confirmed?: boolean; block_height?: number; block_time?: number };
        vout?: Array<{ value: number; scriptpubkey_address?: string }>;
      }>
    >(`${base}/address/${address}/txs`),
  ]);

  return txs.flatMap((tx) => {
    const received = (tx.vout ?? [])
      .filter((out) => out.scriptpubkey_address === address)
      .reduce((sum, out) => sum + out.value, 0);
    if (received <= 0) return [];
    const height = tx.status?.block_height;
    const confirmations = height ? Math.max(0, tip - height + 1) : 0;
    return [
      {
        hash: tx.txid,
        amount: received / 1e8,
        confirmations,
        timestamp: tx.status?.block_time ? tx.status.block_time * 1000 : null,
      },
    ];
  });
}

async function ethNative(address: string): Promise<IncomingTx[]> {
  const body = await getJson<{
    items?: Array<{
      hash: string;
      value: string;
      timestamp?: string;
      confirmations?: number;
      from?: { hash?: string };
      to?: { hash?: string };
    }>;
  }>(`https://eth.blockscout.com/api/v2/addresses/${address}/transactions`);

  return (body.items ?? [])
    .filter((tx) => tx.to?.hash?.toLowerCase() === address.toLowerCase())
    .map((tx) => ({
      hash: tx.hash,
      amount: Number(tx.value) / 1e18,
      confirmations: Number(tx.confirmations ?? 0),
      timestamp: tx.timestamp ? Date.parse(tx.timestamp) : null,
      from: tx.from?.hash,
    }));
}

async function ethToken(address: string, symbol: string): Promise<IncomingTx[]> {
  const body = await getJson<{
    items?: Array<{
      transaction_hash: string;
      total?: { value?: string; decimals?: string };
      timestamp?: string;
      from?: { hash?: string };
      to?: { hash?: string };
      token?: { symbol?: string };
    }>;
  }>(
    `https://eth.blockscout.com/api/v2/addresses/${address}/token-transfers?type=ERC-20`,
  );

  return (body.items ?? [])
    .filter(
      (tx) =>
        tx.token?.symbol?.toUpperCase() === symbol &&
        tx.to?.hash?.toLowerCase() === address.toLowerCase(),
    )
    .map((tx) => {
      const decimals = Number(tx.total?.decimals ?? 6);
      return {
        hash: tx.transaction_hash,
        amount: Number(tx.total?.value ?? 0) / 10 ** decimals,
        confirmations: 12,
        timestamp: tx.timestamp ? Date.parse(tx.timestamp) : null,
        from: tx.from?.hash,
      };
    });
}

async function usdtTrc20(address: string): Promise<IncomingTx[]> {
  const body = await getJson<{
    data?: Array<{
      transaction_id: string;
      value: string;
      token_info?: { decimals?: number; symbol?: string };
      block_timestamp?: number;
      from?: string;
      to?: string;
    }>;
  }>(
    `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?only_to=true&limit=30`,
  );

  return (body.data ?? [])
    .filter((tx) => (tx.token_info?.symbol || "USDT").toUpperCase() === "USDT")
    .map((tx) => {
      const decimals = Number(tx.token_info?.decimals ?? 6);
      return {
        hash: tx.transaction_id,
        amount: Number(tx.value) / 10 ** decimals,
        confirmations: 12,
        timestamp: tx.block_timestamp ?? null,
        from: tx.from,
      };
    });
}

async function solana(address: string): Promise<IncomingTx[]> {
  const signatures = await postRpc<Array<{ signature: string }>>(
    "https://api.mainnet-beta.solana.com",
    "getSignaturesForAddress",
    [address, { limit: 20 }],
  );

  const incoming: IncomingTx[] = [];
  for (const item of signatures.slice(0, 12)) {
    const tx = await postRpc<{
      blockTime?: number;
      meta?: { postBalances?: number[]; preBalances?: number[] };
      transaction?: { message?: { accountKeys?: Array<string | { pubkey?: string }> } };
    }>("https://api.mainnet-beta.solana.com", "getTransaction", [
      item.signature,
      { encoding: "json", maxSupportedTransactionVersion: 0 },
    ]);
    const keys = (tx.transaction?.message?.accountKeys ?? []).map((key) =>
      typeof key === "string" ? key : key.pubkey || "",
    );
    const index = keys.findIndex((key) => key === address);
    if (index < 0) continue;
    const pre = tx.meta?.preBalances?.[index] ?? 0;
    const post = tx.meta?.postBalances?.[index] ?? 0;
    const delta = (post - pre) / 1e9;
    if (delta <= 0) continue;
    incoming.push({
      hash: item.signature,
      amount: delta,
      confirmations: 32,
      timestamp: tx.blockTime ? tx.blockTime * 1000 : null,
    });
  }
  return incoming;
}

export async function listIncoming(
  coin: string,
  network: string,
  address: string,
): Promise<IncomingTx[]> {
  switch (coin) {
    case "BTC":
      return btcFamily("https://blockstream.info/api", address);
    case "LTC":
      return btcFamily("https://litecoinspace.org/api", address);
    case "ETH":
      return ethNative(address);
    case "USDC":
      return ethToken(address, "USDC");
    case "USDT":
      return network.toUpperCase().includes("TRC")
        ? usdtTrc20(address)
        : ethToken(address, "USDT");
    case "SOL":
      return solana(address);
    default:
      return [];
  }
}

export function amountsMatch(expected: number, received: number, window: number) {
  return Math.abs(expected - received) <= window;
}
