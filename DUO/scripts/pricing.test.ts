/**
 * The money math behind the cost log in extract-receipt.
 *
 * Prices change; the arithmetic must not silently follow. These tests pin the
 * tier switch and the per-line math against DeepSeek's published rates so a
 * price edit that breaks the log shows up here first.
 */
import { describe, expect, test } from 'bun:test'
import { isPeak, priceCall } from '../supabase/functions/extract-receipt/pricing.ts'

// 2026-09-16 is a Wednesday, so it exercises the weekday windows.
const peak = new Date('2026-09-16T02:00:00Z')
const between = new Date('2026-09-16T05:00:00Z')
const offPeak = new Date('2026-09-16T12:00:00Z')
const saturdayPeakHour = new Date('2026-09-19T02:00:00Z')

describe('isPeak', () => {
  test('peak is 01:00-04:00 and 06:00-10:00 UTC on weekdays', () => {
    expect(isPeak(peak)).toBe(true)
    expect(isPeak(new Date('2026-09-16T07:30:00Z'))).toBe(true)
    expect(isPeak(between)).toBe(false)
    expect(isPeak(new Date('2026-09-16T00:59:00Z'))).toBe(false)
    expect(isPeak(new Date('2026-09-16T10:00:00Z'))).toBe(false)
  })

  test('a weekend is off-peak all day', () => {
    expect(isPeak(saturdayPeakHour)).toBe(false)
  })
})

describe('priceCall', () => {
  test('off-peak: hit, miss and output at half the peak rates', () => {
    const cost = priceCall(
      {
        prompt_cache_hit_tokens: 1_000_000,
        prompt_cache_miss_tokens: 2_000_000,
        completion_tokens: 1_000_000,
      },
      offPeak,
    )
    expect(cost.tier).toBe('off-peak')
    expect(cost.inputHit).toBeCloseTo(0.003, 10)
    expect(cost.inputMiss).toBeCloseTo(0.3, 10)
    expect(cost.output).toBeCloseTo(0.6, 10)
    expect(cost.total).toBeCloseTo(0.903, 10)
  })

  test('peak: the same usage costs double', () => {
    const cost = priceCall(
      {
        prompt_cache_hit_tokens: 1_000_000,
        prompt_cache_miss_tokens: 2_000_000,
        completion_tokens: 1_000_000,
      },
      peak,
    )
    expect(cost.tier).toBe('peak')
    expect(cost.total).toBeCloseTo(1.806, 10)
  })

  test('a response without the cache split charges the whole prompt as a miss', () => {
    const cost = priceCall({ prompt_tokens: 1_000_000, completion_tokens: 0 }, offPeak)
    expect(cost.hit).toBe(0)
    expect(cost.miss).toBe(1_000_000)
    expect(cost.total).toBeCloseTo(0.15, 10)
  })

  test('a receipt-sized scan lands around two-tenths of a sen', () => {
    const cost = priceCall(
      {
        prompt_cache_hit_tokens: 1_200,
        prompt_cache_miss_tokens: 2_000,
        completion_tokens: 3_000,
      },
      offPeak,
    )
    expect(cost.total).toBeCloseTo(0.0000036 + 0.0003 + 0.0018, 10)
  })
})
