export type QuaiUsdPriceSample = {
  priceUsd: number;
  source: string;
};

function parsePrice(n: unknown): number | null {
  const v = typeof n === 'number' ? n : typeof n === 'string' ? Number(n) : NaN;
  if (!Number.isFinite(v)) return null;
  if (v <= 0) return null;
  return v;
}

async function fetchJson(fetchFn: typeof fetch, url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

async function tryMexc(fetchFn: typeof fetch): Promise<QuaiUsdPriceSample | null> {
  // Centralized exchange fallback. This endpoint is public and returns { symbol, price }.
  const symbol = process.env.QUAI_MEXC_SYMBOL ?? 'QUAIUSDT';
  const url = `https://api.mexc.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
  const payload = await fetchJson(fetchFn, url, 2500);
  if (!payload || typeof payload !== 'object') return null;
  const price = parsePrice((payload as any).price);
  if (price === null) return null;
  return { priceUsd: price, source: `mexc:${symbol}` };
}

async function tryCoinGecko(fetchFn: typeof fetch): Promise<QuaiUsdPriceSample | null> {
  // CoinGecko is not a CEX, but it is a simple public fallback if the token is listed.
  const ids = (process.env.QUAI_COINGECKO_IDS ?? 'quai-network,quai')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) return null;
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd`;
  const payload = await fetchJson(fetchFn, url, 2500);
  if (!payload || typeof payload !== 'object') return null;
  for (const id of ids) {
    const entry = (payload as any)[id];
    const price = entry ? parsePrice(entry.usd) : null;
    if (price !== null) return { priceUsd: price, source: `coingecko:${id}` };
  }
  return null;
}

export async function fetchQuaiUsdPrice(fetchFn: typeof fetch = fetch): Promise<QuaiUsdPriceSample | null> {
  const override = parsePrice(process.env.QUAI_USD_PRICE_OVERRIDE);
  if (override !== null) return { priceUsd: override, source: 'override' };

  // Prefer CEX sources first.
  const mexc = await tryMexc(fetchFn);
  if (mexc) return mexc;

  const cg = await tryCoinGecko(fetchFn);
  if (cg) return cg;

  return null;
}

