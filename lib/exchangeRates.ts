export type ExchangeRate = {
  rate: number;
  date: string;
};

type FrankfurterRateResponse = {
  date?: string;
  base?: string;
  quote?: string;
  rate?: number;
};

export async function getLatestExchangeRate(
  fromCurrency: string,
  toCurrency = "AUD",
  request: typeof fetch = fetch,
): Promise<ExchangeRate> {
  const from = fromCurrency.trim().toUpperCase();
  const to = toCurrency.trim().toUpperCase();
  if (from === to) return { rate: 1, date: new Date().toISOString().slice(0, 10) };

  const response = await request(`https://api.frankfurter.dev/v2/rate/${encodeURIComponent(from)}/${encodeURIComponent(to)}`);
  if (!response.ok) throw new Error("The latest exchange rate is unavailable.");
  const result = await response.json() as FrankfurterRateResponse;
  if (!Number.isFinite(result.rate) || Number(result.rate) <= 0 || !result.date) {
    throw new Error("The exchange-rate service returned an invalid rate.");
  }
  return { rate: Number(result.rate), date: result.date };
}

export function convertedAmount(amount: number, rate: number): number {
  return Math.round((amount * rate + Number.EPSILON) * 100) / 100;
}
