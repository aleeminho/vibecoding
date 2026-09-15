# Progress — 16 Sep 2026

This file is a point-in-time record of what shipped and what is still open, so
the next session starts from the truth rather than from the last thing anyone
remembers. The durable rules live in [CLAUDE.md](./CLAUDE.md) and
[DESIGN.md](./DESIGN.md); nothing here should be read as guidance that outranks
them.

## Shipped

| Commit | What |
|---|---|
| `5c5db37` | Redesign: the whole app became a kwitansi pad — every screen and both documents rebuilt, the old dark/glass look replaced |
| `b9148ce` | White-out palette (the green cast deleted), orange-forward chrome and attention ink, Dua Ply mark (favicon + PWA icon set + letterhead), desktop layout at ≥1100px (rail + two-pane Tagihan/Review/Report) |
| `b8d1b0d` | "Copy teks buat WA": the nota button copies a full group message — summary, per-person share, link, payment info — instead of just the URL |
| `dd8b7d6` | Cleanup migration `20260916000000_clean_run_data.sql`: run data deleted, `bills_ref_code_was` dropped, `receipts` bucket recreated |
| `69f28d1` | Edge Function logs DeepSeek's `usage` for every scan (Supabase → Edge Functions → Logs) |
| `edd47f9` | The log line prices the scan in USD — `pricing.ts` carries the per-token rates and the peak/off-peak rule, `scripts/pricing.test.ts` pins the math, and `test:extract` prints the same cost |

## Production state

- **Database**: no bills, no audit rows. The operator account, the schema, the
  views and the functions are untouched. `next_ref_code` counts from the rows
  in `bills`, so ref codes start at 001 again on their own.
- **Storage**: the `receipts` and `qris` buckets are empty and still exist.
  (`rm -r` on a bucket root deletes the bucket itself; the cleanup migration
  puts `receipts` back exactly as migration 0001 created it.)
- **Code**: deploys itself on a push to `main` (Jagoan, Pages, Functions).
  No pending migrations.

## Verified

- `bun run check` clean; `bun test` 130 pass.
- 22 full-page captures at 390px and 1440px in `.impeccable/review/`, taken
  after the palette change; the desktop pages match the approved mocks.
- `20260916000000` shows applied in `bunx supabase migration list`.

## Still open

- **9router provider**: `~/.config/opencode/opencode.jsonc` points at
  `http://localhost:20128/v1`. The service answers `/v1/models` but 401s on
  `/v1/chat/completions`; the key is not `%APPDATA%\9router\auth\cli-secret`,
  so the real API key (or where the router stores it) is still unknown.
- **PRD items deliberately not built**: self-serve signup (the PRD makes it
  conditional on opening up beyond a small circle), debt netting (cannot be
  built on one-owner-per-bill data), and `bill.amount_changed` (no producer —
  amounts cannot be edited after commit).

## Running it

```
bun run dev                 # localhost:5173
bun run dev -- --host       # plus a LAN address, for testing on the phone
bun run check && bun test
bunx supabase migration list
```

Demo routes (dev build only): `#/bills?demo`, `#/report?demo`, `#/preview`,
`#/preview?done`, `#/preview?fresh`, `#/preview?crowd`,
`#/nota?id=demo-1&demo`,
`#/bayar?t=00000000-0000-4000-8000-000000000003&demo`.
