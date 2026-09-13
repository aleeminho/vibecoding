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

import type {
  AuditEntry,
  BillWithShares,
  FlaggedPayment,
  PaymentPageInfo,
  SettleUpEntry,
} from './api'
import type { ExportBill } from './export'

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
    bank_name: 'BCA',
    account_number: '1234567890',
    account_holder: 'Alee',
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
    bank_name: 'BCA',
    account_number: '1234567890',
    account_holder: 'Alee',
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
    bank_name: 'GoPay',
    account_number: '081234567890',
    account_holder: 'Alee',
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
    bank_name: 'BCA',
    account_number: '1234567890',
    account_holder: 'Alee',
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

export const DEMO_SETTLE_UP: SettleUpEntry[] = [
  { bill_id: 'demo-1', ref_code: 'BILL_20260626_001', place: 'Lucky Cat Coffee & Kitchen', bill_date: '2026-06-26', person: 'Budi', amount_owed: 127050 },
  { bill_id: 'demo-2', ref_code: 'BILL_20260614_001', place: 'Warung Bu Siti', bill_date: '2026-06-14', person: 'Budi', amount_owed: 78000 },
  { bill_id: 'demo-1', ref_code: 'BILL_20260626_001', place: 'Lucky Cat Coffee & Kitchen', bill_date: '2026-06-26', person: 'Sarah', amount_owed: 98175 },
  { bill_id: 'demo-1', ref_code: 'BILL_20260626_001', place: 'Lucky Cat Coffee & Kitchen', bill_date: '2026-06-26', person: 'Dewi', amount_owed: 109725 },
  { bill_id: 'demo-3', ref_code: 'BILL_20260530_001', place: 'Sate Taichan Bang Jali', bill_date: '2026-05-30', person: 'Rina', amount_owed: 78000 },
]

export const DEMO_AUDIT: AuditEntry[] = [
  { id: 'a-1', action: 'share.paid', ref_code: 'BILL_20260626_001', detail: { person: 'Andi' }, created_at: '2026-07-02T11:20:00Z' },
  { id: 'a-2', action: 'bill.amount_changed', ref_code: 'BILL_20260614_001', detail: { field: 'total', from: 75900, to: 75900 }, created_at: '2026-06-15T09:04:00Z' },
  { id: 'a-3', action: 'share.paid', ref_code: 'BILL_20260614_001', detail: { person: 'Budi' }, created_at: '2026-06-15T08:31:00Z' },
]

/**
 * The demo bill for the detailed export, with items as well as shares.
 *
 * The numbers here are the same ones computeSplit produces for this receipt, so
 * the exported CSV can be checked against the worked example in the spec rather
 * than against itself.
 */
export const DEMO_EXPORT_BILLS: ExportBill[] = [
  {
    ref_code: 'BILL_20260614_001',
    bill_date: '2026-06-14',
    place: 'Warung Bu Siti',
    total: 75900,
    bank_name: 'BCA',
    account_number: '1234567890',
    account_holder: 'Alee',
    items: [
      { name: 'Nasi Goreng', qty: 1, line_total: 25000, assigned_to: ['Budi'] },
      { name: 'Es Teh', qty: 2, line_total: 16000, assigned_to: ['Budi', 'Sarah'] },
      { name: 'Kentang Goreng Gede', qty: 1, line_total: 30000, assigned_to: ['Sarah'] },
    ],
    shares: [
      { person: 'Budi', pay_token: '00000000-0000-4000-8000-000000000001', discount_share: 2817, tax_share: 3718, service_share: 1859, rounding_share: 0, amount_owed: 42760, status: 'lunas', paid_date: '2026-06-15' },
      { person: 'Sarah', pay_token: '00000000-0000-4000-8000-000000000002', discount_share: 2183, tax_share: 2882, service_share: 1441, rounding_share: 0, amount_owed: 33140, status: 'lunas', paid_date: '2026-06-15' },
    ],
  },
  {
    // The awkward one: seven items, four people, three of them sharing, and
    // every share a number that does not divide evenly. This is the fixture
    // that proves the itemisation reconciles, because a fixture where everyone
    // orders exactly one thing would reconcile no matter how broken the
    // allocation was.
    ref_code: 'BILL_20260626_001',
    bill_date: '2026-06-26',
    place: 'Lucky Cat Coffee & Kitchen',
    total: 456225,
    bank_name: 'BCA',
    account_number: '1234567890',
    account_holder: 'Alee',
    items: [
      { name: 'Long Black', qty: 1, line_total: 35000, assigned_to: ['Budi'] },
      { name: 'Ice Caramel Latte', qty: 1, line_total: 45000, assigned_to: ['Sarah'] },
      { name: 'Lychee Tea', qty: 2, line_total: 80000, assigned_to: ['Budi', 'Sarah'] },
      { name: 'Peach Tea', qty: 3, line_total: 120000, assigned_to: ['Andi', 'Dewi'] },
      { name: 'Ice Latte', qty: 1, line_total: 45000, assigned_to: ['Andi'] },
      { name: 'Japanese', qty: 1, line_total: 35000, assigned_to: ['Dewi'] },
      { name: 'Aqua Reflections Natural', qty: 1, line_total: 35000, assigned_to: ['Budi'] },
    ],
    shares: [
      { person: 'Budi', pay_token: '00000000-0000-4000-8000-000000000003', discount_share: 0, tax_share: 11550, service_share: 5500, rounding_share: 0, amount_owed: 127050, status: 'belum lunas', paid_date: null },
      { person: 'Sarah', pay_token: '00000000-0000-4000-8000-000000000004', discount_share: 0, tax_share: 8925, service_share: 4250, rounding_share: 0, amount_owed: 98175, status: 'belum lunas', paid_date: null },
      { person: 'Andi', pay_token: '00000000-0000-4000-8000-000000000005', discount_share: 0, tax_share: 11025, service_share: 5250, rounding_share: 0, amount_owed: 121275, status: 'lunas', paid_date: '2026-07-02' },
      { person: 'Dewi', pay_token: '00000000-0000-4000-8000-000000000006', discount_share: 0, tax_share: 9975, service_share: 4750, rounding_share: 0, amount_owed: 109725, status: 'belum lunas', paid_date: null },
    ],
  },
]

/**
 * The payer's page for a demo token.
 *
 * Derived from DEMO_EXPORT_BILLS rather than written out a second time, so a
 * token that appears on the nota always resolves here — the two cannot drift.
 * An unknown token returns null, which is what the live RPC returns too, so the
 * demo lands on the real "link not recognised" screen rather than a special one.
 */
export function demoPaymentPage(token: string): PaymentPageInfo | null {
  for (const bill of DEMO_EXPORT_BILLS) {
    const share = bill.shares.find((s) => s.pay_token === token)
    if (!share) continue
    return {
      participant_id: token,
      person: share.person,
      place: bill.place,
      bill_date: bill.bill_date,
      ref_code: bill.ref_code,
      amount_owed: share.amount_owed,
      status: share.status,
      bank_name: bill.bank_name,
      account_number: bill.account_number,
      account_holder: bill.account_holder,
    }
  }
  return null
}

/**
 * Proofs waiting on a human.
 *
 * Three rows, one of each shape the queue actually has to render: read short,
 * read long, and could-not-read-at-all. The last one is the one worth having a
 * fixture for — it is the case where `amount_read` is null and a layout that
 * assumes a number renders "Rp NaN".
 */
export const DEMO_FLAGGED: FlaggedPayment[] = [
  {
    id: 'p-1',
    bill_id: 'demo-1',
    ref_code: 'BILL_20260626_001',
    place: 'Lucky Cat Coffee & Kitchen',
    person: 'Budi',
    amount_owed: 127050,
    amount_read: 100000,
    recipient_read: 'BCA 1234567890',
    recipient_expected: 'BCA 1234567890',
    verdict: 'mismatch',
    note: null,
    image_path: 'bukti/BILL_20260626_001/3f2a1b9c.jpg',
    created_at: '2026-07-02T11:20:00Z',
  },
  {
    id: 'p-2',
    bill_id: 'demo-1',
    ref_code: 'BILL_20260626_001',
    place: 'Lucky Cat Coffee & Kitchen',
    person: 'Dewi',
    amount_owed: 109725,
    amount_read: 150000,
    recipient_read: 'BCA 1234567890',
    recipient_expected: 'BCA 1234567890',
    verdict: 'mismatch',
    note: null,
    image_path: 'bukti/BILL_20260626_001/9c4d2e7f.jpg',
    created_at: '2026-07-02T09:02:00Z',
  },
  {
    id: 'p-3',
    bill_id: 'demo-3',
    ref_code: 'BILL_20260530_001',
    place: 'Sate Taichan Bang Jali',
    person: 'Rina',
    amount_owed: 78000,
    amount_read: null,
    recipient_read: null,
    recipient_expected: 'GoPay 081234567890',
    verdict: 'unclear',
    note: 'Gambarnya kek buram, nominalnya nggak kebaca.',
    image_path: 'bukti/BILL_20260530_001/1a7f3b20.jpg',
    created_at: '2026-05-31T20:41:00Z',
  },
]
