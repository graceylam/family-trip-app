import assert from "node:assert/strict";
import test from "node:test";
import { convertedAmount, getLatestExchangeRate } from "../lib/exchangeRates.ts";

test("fetches a daily exchange rate and converts to cents", async () => {
  let requestedUrl = "";
  const request = async (url) => {
    requestedUrl = url;
    return new Response(JSON.stringify({ date: "2026-07-17", base: "EUR", quote: "AUD", rate: 1.7654 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await getLatestExchangeRate("eur", "AUD", request);
  assert.equal(requestedUrl, "https://api.frankfurter.dev/v2/rate/EUR/AUD");
  assert.deepEqual(result, { rate: 1.7654, date: "2026-07-17" });
  assert.equal(convertedAmount(42.5, result.rate), 75.03);
});

test("uses a one-to-one rate without a network call for AUD expenses", async () => {
  const request = async () => { throw new Error("should not fetch"); };
  const result = await getLatestExchangeRate("AUD", "AUD", request);
  assert.equal(result.rate, 1);
  assert.match(result.date, /^\d{4}-\d{2}-\d{2}$/);
});
