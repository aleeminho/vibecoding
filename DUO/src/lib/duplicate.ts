/**
 * Is this the same place, written twice?
 *
 * The check that matters before saving a bill is "have I already scanned
 * this?", and the two things that make that answerable are the total and the
 * date. Place is the third, and it is the one that cannot be compared with
 * `=`: the receipt says "LUCKY CAT COFFEE & KITCHEN", the operator typed
 * "Lucky Cat", and a third scan of the same receipt might come out as
 * "Lucky Cat Coffee and Kitchen" because the model read the ampersand
 * differently that time.
 *
 * So: token overlap. Enough to catch the same name written three ways, loose
 * enough not to care which way. This is not fuzzy matching and does not try to
 * be — it decides whether to show a warning, and a warning the operator
 * dismisses by reading it is cheap. A missed duplicate costs a double-charged
 * friend.
 */

/** Words that carry no identity, dropped before comparing. */
const NOISE = new Set(['and', 'the', 'dan', 'di', 'at', 'of', '&', '-', 'pt', 'cv'])

function tokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      // Punctuation to spaces rather than deleted, so "kopi-kenangan" and
      // "kopi kenangan" tokenise the same instead of the first becoming one
      // word nobody else will ever produce.
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(' ')
      .filter((t) => t.length > 0 && !NOISE.has(t)),
  )
}

/**
 * Jaccard overlap of the two names, 0 to 1.
 *
 * Symmetric on purpose. A `contains` check would call "Warung Bu Siti" and
 * "Warung" the same place, and would miss the reverse — where the longer name
 * is the one already stored.
 */
export function placeSimilarity(a: string, b: string): number {
  const left = tokens(a)
  const right = tokens(b)
  if (left.size === 0 || right.size === 0) return 0

  let shared = 0
  for (const token of left) if (right.has(token)) shared++

  return shared / (left.size + right.size - shared)
}

/**
 * The threshold, picked against the cases this actually sees rather than from
 * a table.
 *
 * "Lucky Cat" against "Lucky Cat Coffee & Kitchen" is 2/4 = 0.5, and that
 * pair MUST warn — it is the same receipt. "Kopi Kenangan Senopati" against
 * "Kopi Kenangan" is 2/3 = 0.67. Two genuinely different warungs that share
 * the word "warung" score 1/3 = 0.33.
 *
 * 0.5 puts the real duplicate on the line and the different-place case well
 * under it.
 */
export const SAME_PLACE = 0.5

export function looksLikeSamePlace(a: string, b: string): boolean {
  return placeSimilarity(a, b) >= SAME_PLACE
}
