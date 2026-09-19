/**
 * Tests for the display helpers.
 *
 * `timeAgo` is the only real logic here and it is date arithmetic, which is the
 * classic silent-wrong category: a boundary off by one prints "kemarin" for
 * something that happened this morning, and nothing crashes. The test pins the
 * boundaries with an injected `now` so it never races a real clock.
 */

import { describe, expect, test } from 'bun:test'
import { timeAgo } from './format'

const now = new Date('2026-09-19T12:00:00+07:00')

const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('timeAgo', () => {
  test('under a minute reads as just now', () => {
    expect(timeAgo(ago(20_000), now)).toBe('baru aja')
  })

  test('minutes and hours', () => {
    expect(timeAgo(ago(12 * MINUTE), now)).toBe('12 menit lalu')
    expect(timeAgo(ago(59 * MINUTE), now)).toBe('59 menit lalu')
    expect(timeAgo(ago(HOUR), now)).toBe('1 jam lalu')
    expect(timeAgo(ago(23 * HOUR), now)).toBe('23 jam lalu')
  })

  test('a day is yesterday, up to a week, then the date', () => {
    expect(timeAgo(ago(DAY), now)).toBe('kemarin')
    expect(timeAgo(ago(4 * DAY), now)).toBe('4 hari lalu')
    expect(timeAgo(ago(7 * DAY), now)).toBe('12 Sep 2026')
  })

  test('clock skew into the future is not a negative age', () => {
    expect(timeAgo(new Date(now.getTime() + 5 * MINUTE).toISOString(), now)).toBe('baru aja')
  })

  test('an unparseable timestamp comes back as-is rather than as NaN', () => {
    expect(timeAgo('entah', now)).toBe('entah')
  })
})
