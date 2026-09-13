import { describe, expect, test } from 'bun:test'
import { looksLikeSamePlace, placeSimilarity } from './duplicate'

describe('placeSimilarity', () => {
  test('the same name scores 1', () => {
    expect(placeSimilarity('Lucky Cat Coffee', 'Lucky Cat Coffee')).toBe(1)
  })

  test('case and punctuation do not count', () => {
    expect(placeSimilarity('Kopi-Kenangan', 'kopi kenangan')).toBe(1)
  })

  test('"and" and "&" are the same word, so they are both ignored', () => {
    // The model reads the ampersand as "and" about half the time. If these
    // scored differently, the same receipt would stop looking like itself.
    expect(placeSimilarity('Salt & Pepper', 'Salt and Pepper')).toBe(1)
  })

  test('a short name against its full form is on the line, and warns', () => {
    // The case this exists for: the receipt's legal name against what the
    // operator typed. 2 shared of 4.
    expect(placeSimilarity('Lucky Cat', 'Lucky Cat Coffee Kitchen')).toBeCloseTo(0.5, 5)
    expect(looksLikeSamePlace('Lucky Cat', 'Lucky Cat Coffee Kitchen')).toBe(true)
  })

  test('sharing only the generic word does not warn', () => {
    // Two different warungs. This is the false positive that would make the
    // warning useless — if everything called "Warung" collides, the operator
    // learns to dismiss the card without reading it.
    expect(looksLikeSamePlace('Warung Bu Siti', 'Warung Sate Pak Jali')).toBe(false)
  })

  test('nothing in common scores 0', () => {
    expect(placeSimilarity('Sate Taichan', 'Kopi Kenangan')).toBe(0)
  })

  test('an empty or all-noise name never matches anything', () => {
    // Without this, "" against "" would be 0/0 and the guard is what stops it
    // becoming NaN — which compares false against everything and would silently
    // disable the whole check for the bills with no place.
    expect(placeSimilarity('', 'Kopi Kenangan')).toBe(0)
    expect(placeSimilarity('dan', 'dan')).toBe(0)
  })
})
