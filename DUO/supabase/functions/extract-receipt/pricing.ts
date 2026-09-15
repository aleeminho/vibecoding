/**
 * What a DeepSeek call costs, in USD.
 *
 * Prices are `deepseek-flash`'s, per one million tokens, read from
 * https://api-docs.deepseek.com/quick_start/pricing on 2026-09-16. Off-peak is
 * half of peak; peak is 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday.
 * DeepSeek reserves the right to change them, so a price change is a two-line
 * edit here rather than arithmetic buried in a log statement.
 *
 * This module is deliberately dependency-free: the Edge Function imports it,
 * and so does scripts/pricing.test.ts under Bun.
 */

export const PRICES = {
  inputCacheHit: { peak: 0.006, offPeak: 0.003 },
  inputCacheMiss: { peak: 0.3, offPeak: 0.15 },
  output: { peak: 1.2, offPeak: 0.6 },
} as const

/** DeepSeek's peak windows: 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday. */
export function isPeak(at: Date): boolean {
  const weekday = at.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const hour = at.getUTCHours()
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

export type Usage = {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_cache_hit_tokens?: number
  prompt_cache_miss_tokens?: number
}

/** The cost of one call, line by line. `at` is injectable so tests can pin the tier. */
export function priceCall(usage: Usage, at: Date = new Date()) {
  const peak = isPeak(at)
  const hitRate = peak ? PRICES.inputCacheHit.peak : PRICES.inputCacheHit.offPeak
  const missRate = peak ? PRICES.inputCacheMiss.peak : PRICES.inputCacheMiss.offPeak
  const outRate = peak ? PRICES.output.peak : PRICES.output.offPeak

  const hit = usage.prompt_cache_hit_tokens ?? 0
  // The split is what DeepSeek bills on, but if a response ever omits it, the
  // whole prompt is charged at the miss rate rather than dropped on the floor.
  const miss = usage.prompt_cache_miss_tokens ?? usage.prompt_tokens ?? 0
  const out = usage.completion_tokens ?? 0

  const inputHit = (hit / 1e6) * hitRate
  const inputMiss = (miss / 1e6) * missRate
  const output = (out / 1e6) * outRate

  return {
    tier: peak ? 'peak' : 'off-peak',
    hit,
    miss,
    out,
    inputHit,
    inputMiss,
    output,
    total: inputHit + inputMiss + output,
  }
}
