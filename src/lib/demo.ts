/**
 * Dev-only fixture data, so screens that need rows can be looked at.
 *
 * The problem it solves: Tagihan and Report read from the database, every table
 * is behind row level security, and there is no session in a headless browser.
 * So those screens can only ever be seen empty, which means their layout gets
 * written blind — and designing blind is what produced the first version of
 * this UI.
 *
 * Activated by a `demo` segment in the hash, and only in a dev build:
 *
 *   #/preview                    -> the Review screen
 *   #/bills?demo                 -> Tagihan with rows
 *   #/report?demo                -> Report with rows
 *
 * Every function in api.ts checks demoMode() first and returns something from
 * here instead of calling Supabase. The guard is `import.meta.env.DEV`, so the
 * whole module is stripped from a production bundle.
 */

import type { BillWithShares } from './api'

/**
 * True when the URL asks for fixture data. Only meaningful in a dev build.
 *
 * CALLERS MUST WRITE `import.meta.env.DEV && isDemo()`, not `isDemo()` alone.
 * That is not redundant, and getting it wrong is how this was caught:
 *
 * Vite replaces `import.meta.env.DEV` with `false` in a production build. With
 * the check written literally at the call site, `false && isDemo()` folds to
 * `false`, the branch becomes dead code, the reference to the fixtures
 * disappears, and the bundler drops them entirely.
 *
 * Behind a function call it cannot: the bundler sees a call whose result it
 * does not know, keeps the branch, keeps the reference, and ships several
 * kilobytes of fake bills to production. Which is exactly what happened — the
 * guard looked right and did nothing.
 */
export function isDemo(): boolean {
  return location.hash.includes('demo')
}

const PEOPLE = ['Budi', 'Sarah', 'Andi', 'Dewi', 'Rina', 'Tono']

/** Bill rows as the Tagihan screen consumes them. */
export const DEMO_BILLS: BillWithShares[] = [
  {
    id: 'demo-1',
    ref_code: 'BILL_20260626_001',
    place: 'Lucky Cat Coffee & Kitchen',
    bill_date: '2026-06-26',
    total: 456225,
    receipt_path: 'demo/BILL_20260626_001.jpg',
    notes: 'Nongkrong sore',
    shares: [
      { person: 'Budi', amount_owed: 127050, status: 'belum lunas', paid_date: null },
      { person: 'Sarah', amount_owed: 98175, status: 'belum lunas', paid_date: null },
      { person: 'Andi', amount_owed: 121275, status: 'lunas', paid_date: '2026-07-02' },
      { person: 'Dewi', amount_owed: 109725, status: 'belum lunas', paid_date: null },
    ],
  },
  {
    id: 'demo-2',
    ref_code: 'BILL_20260614_001',
    place: 'Warung Bu Siti',
    bill_date: '2026-06-14',
    total: 75900,
    receipt_path: 'demo/BILL_20260614_001.jpg',
    notes: null,
    shares: [
      { person: 'Budi', amount_owed: 42760, status: 'lunas', paid_date: '2026-06-15' },
      { person: 'Sarah', amount_owed: 33140, status: 'lunas', paid_date: '2026-06-15' },
    ],
  },
  {
    id: 'demo-3',
    ref_code: 'BILL_20260530_001',
    place: 'Sate Taichan Bang Jali',
    bill_date: '2026-05-30',
    total: 312000,
    receipt_path: null,
    notes: 'Traktiran Andi',
    shares: [
      { person: 'Budi', amount_owed: 78000, status: 'belum lunas', paid_date: null },
      { person: 'Andi', amount_owed: 156000, status: 'lunas', paid_date: '2026-05-31' },
      { person: 'Rina', amount_owed: 78000, status: 'belum lunas', paid_date: null },
    ],
  },
  {
    id: 'demo-4',
    ref_code: 'BILL_20260526_001',
    place: 'Kopi Kenangan Senopati',
    bill_date: '2026-05-26',
    total: 94500,
    receipt_path: null,
    notes: null,
    shares: [
      { person: 'Sarah', amount_owed: 47250, status: 'lunas', paid_date: '2026-05-27' },
      { person: 'Dewi', amount_owed: 47250, status: 'lunas', paid_date: '2026-05-27' },
    ],
  },
]

export const DEMO_PEOPLE = PEOPLE.map((person, i) => ({
  person,
  bill_count: 6 - i,
  last_seen: `2026-06-${String(26 - i * 3).padStart(2, '0')}`,
}))

export const DEMO_MONTHLY = [
  { month: '2026-06-01', person: 'Budi', total: 169810, bills: 2 },
  { month: '2026-06-01', person: 'Sarah', total: 131315, bills: 2 },
  { month: '2026-06-01', person: 'Andi', total: 121275, bills: 1 },
  { month: '2026-06-01', person: 'Dewi', total: 109725, bills: 1 },
  { month: '2026-05-01', person: 'Budi', total: 78000, bills: 1 },
  { month: '2026-05-01', person: 'Andi', total: 156000, bills: 1 },
  { month: '2026-05-01', person: 'Rina', total: 78000, bills: 1 },
  { month: '2026-05-01', person: 'Sarah', total: 47250, bills: 1 },
  { month: '2026-05-01', person: 'Dewi', total: 47250, bills: 1 },
]

export const DEMO_OUTSTANDING = [
  { person: 'Budi', outstanding: 205050, bills: 2 },
  { person: 'Sarah', outstanding: 98175, bills: 1 },
  { person: 'Dewi', outstanding: 109725, bills: 1 },
  { person: 'Rina', outstanding: 78000, bills: 1 },
]
