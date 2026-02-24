import { fetchQuaiUsdPrice } from './quaiUsdPrice.js';

type QueryFn = <T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
) => Promise<T[]>;

type PriceTickRow = {
  price_usd: string;
  source: string;
  sampled_at: string;
};

export async function ensureFreshQuaiUsdPrice(
  queryFn: QueryFn,
  opts?: { now?: Date; maxAgeMs?: number; fetchFn?: typeof fetch }
): Promise<{ priceUsd: number; source: string } | null> {
  const now = opts?.now ?? new Date();
  const maxAgeMs = opts?.maxAgeMs ?? 5 * 60 * 1000;
  const fetchFn = opts?.fetchFn ?? fetch;

  const latest = (
    await queryFn<PriceTickRow>(
      `
      SELECT price_usd::text AS price_usd, source, sampled_at::text AS sampled_at
      FROM quai_price_ticks
      ORDER BY sampled_at DESC
      LIMIT 1
      `
    )
  )[0];

  const latestPrice = latest?.price_usd ? Number(latest.price_usd) : null;
  const latestAt = latest?.sampled_at ? new Date(latest.sampled_at) : null;
  const latestFresh =
    latestPrice !== null &&
    Number.isFinite(latestPrice) &&
    latestAt !== null &&
    Number.isFinite(latestAt.getTime()) &&
    now.getTime() - latestAt.getTime() <= maxAgeMs;

  if (latestFresh) {
    return { priceUsd: latestPrice!, source: latest!.source };
  }

  const sampled = await fetchQuaiUsdPrice(fetchFn);
  if (!sampled) {
    if (latestPrice !== null && Number.isFinite(latestPrice)) return { priceUsd: latestPrice, source: latest?.source ?? 'db' };
    return null;
  }

  const inserted = (
    await queryFn<PriceTickRow>(
      `
      INSERT INTO quai_price_ticks (price_usd, source)
      VALUES ($1, $2)
      RETURNING price_usd::text AS price_usd, source, sampled_at::text AS sampled_at
      `,
      [String(sampled.priceUsd), sampled.source]
    )
  )[0];

  const price = inserted?.price_usd ? Number(inserted.price_usd) : sampled.priceUsd;
  return { priceUsd: price, source: inserted?.source ?? sampled.source };
}
