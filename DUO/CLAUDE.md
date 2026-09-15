# DUO — split-bill PWA

Photograph a receipt, assign items to people, send the group a nota they can
read and pay from. Indonesian UI, one operator per account, a handful of friends
per bill. **Live at <https://splitfair.xyz>.**

Read this before touching anything. It is the stuff that cost real time to
learn and is not derivable from the code.

---

## Running it

```
bun run dev                    # vite, localhost:5173
bun run check                  # svelte-check + tsc  — USE THIS, not `bunx svelte-check`
bun run test                   # bun test
bun run build
bunx supabase migration list   # what is applied vs pending
bunx supabase db push          # apply pending migrations  (needs the user's OK)
```

`bunx svelte-check` on its own **passes on code `bun run check` correctly
fails** — it misses the app tsconfig. Every "0 errors" claim has to come from
`bun run check`.

---

## Deploy: code ships itself, the schema does not

Pushing to `main` deploys everything within a minute:

| | |
|---|---|
| **splitfair.xyz** | Jagoan/cPanel over FTPS — `deploy-jagoan.yml` |
| **aleeminho.github.io/vibecoding** | GitHub Pages — `deploy-duo.yml`, `BASE_PATH=vibecoding` |
| **Edge Functions** | `deploy-functions.yml` |

Migrations are **applied by hand**. So every schema change goes live before the
columns it needs exist, and the window lasts until `db push` runs.

This has broken things twice, both measured:

- PostgREST fails the **entire request** when a select names a column that does
  not exist — `400 column payments_2.recipient_ok does not exist` — so one
  embedded column took the whole bills screen down.
- An Edge Function reading a missing column gets `undefined`, which turned money
  comparisons into `NaN` — `kurang Rp NaN` on every upload, looking like a
  broken feature rather than a missing migration.

**So any new column must be read defensively**: `Number(x) || 0` for a figure, a
retry without the embed for a select (see `paymentsAvailable` in api.ts), a
dropped field for an insert. Keep the guard after the migration lands too.

**And check `migration list` before assuming the database matches the code.**

Other deploy gotchas: `FTP_SERVER` must be the bare host, not a URL. The FTP
account is chrooted to its configured Directory — it must be `public_html`. The
Edge Functions have **opposite** `verify_jwt` settings and the workflow asserts
each; `validate-payment` is public on purpose, `extract-receipt` is not.

---

## Design: the kwitansi pad

Flat, light, paper on a table. The world is an Indonesian receipt form printed
on white paper and stamped in **one orange** (`--stamp`, `#d04a02`): the stamp
square, the lettered LUNAS, the commit button, the focus ring, the active tab,
and the 2px rules under the letterhead and above the tab bar. **Orange is also
the attention ink** — unpaid money, unreadable proofs and work still to do are
printed in it (`--stamp-deep` on the stamp wash, `--attention-tint`), because
in this product the thing that needs attention is the money; green means
settled, red means destruction. State is carried by shape and word as well as
colour (dashed square → half-pressed → solid stamp, lettered LUNAS, "Belum
dibagi"). No serial red, no carbon purple: those were tried and cut.

The mark is the **Dua Ply** — a stamped square with its carbon copy behind it.
`public/favicon.svg` is the tab icon, the letterhead draws it inline, and the
PNG set (`icon-192/512`, `icon-maskable-512`, `apple-touch-icon`) is rendered
from the same geometry.

Nothing blurs, nothing floats, nothing is translucent. The Liquid Glass pass
this app was dressed in earlier was rejected twice, and those bans survived the
redesign: no `backdrop-filter`, no translucent fills, no `inset 0 1px 0`
highlights, no capsule chrome. Printed forms are square — 4px radius, 3px on
small parts. No webfonts, in the app or the documents.

`DESIGN.md` is the full system (tokens, type, layout, components, do's and
don'ts) and `src/app.css` carries the same tokens in code; token names are
role-based (`--sheet`, `--ink`, `--stamp`), never hue-based.

**Two scenes, one breakpoint** (`src/lib/viewport.svelte.ts`, 1100px). A phone
gets the 520px column with the index tabs welded to the bottom edge. A wide
screen gets the full-width letterhead (operator + Keluar move into it), the
same four tabs as a left rail, and the screens that can use the room become
two-pane: Tagihan is ledger + the selected bill's open form, Review is the
assignment work + the running summary and commit, Report is the month +
what is still out. The documents keep widths of their own — the nota is an
830px sheet, the payer page 480px — and stay light and self-painted, because
they arrive as a link pasted into a group chat; a dark document is worse there.

The other rules live in the file that owns them — read them before touching a
surface: the counterfoil and stamp-square grammar on `src/routes/Bills.svelte`,
the 2px-double total rule and the due band on `src/routes/Nota.svelte`, the
"one primary commit" rule on `src/routes/Review.svelte` and `src/routes/Bayar.svelte`.

---

## Things that look wrong and are not

- **`import.meta.env.DEV && isDemo()` must be written literally at the call
  site.** Vite folds it to `false` and drops the fixtures. Behind a helper it
  cannot be eliminated and ships fake bills to production. This already
  happened.
- **The nota is a link, and `nota_page` is what makes it readable without a
  session.** `bills` is owner-scoped, so a reader with no account sees no rows —
  the RPC is the one door through, granted to anon on purpose, with the bill id
  as the credential, which is the same bet `payment_page` makes on `pay_token`.
  **It is the one read with no defensive retry**, unlike the rule above: a
  function's shape is fixed when it is created, so a column it names that does
  not exist is a migration that did not run and should say so rather than
  half-work.
- **Every payment link is on that page, so they all travel together again.** One
  message to the group carries every Pay button in it. The operator knows the
  trade-off — the amount check at the other end is what catches a mis-tap.
- **The payment token is the whole security model.** The payer has no account.
  `validate-payment` accepts a token and an image and *nothing else* — no bill
  id, no person, no amount. Do not add a third input without thinking about who
  could send it.
- **`CommitBill` is the one path that creates a bill.** Widening its argument
  list means dropping and recreating it in a migration. QRIS and `paid_by_person`
  are deliberately written as separate updates *after* the commit instead.
- **`commit_bill` returns the ref code, not the bill id** — it ends with
  `return p_ref_code`. Both are strings, so using one for the other is a Postgres
  error (`22P02 invalid input syntax for type uuid`) and not a compile one. It
  shipped once: the ref code went into a `uuid` column and every save with an
  organiser marked failed. `commitBill` now returns `void` — the caller already
  has the ref code — so `const billId = await commitBill(...)` is a type error
  rather than a bug. Use `findBillId` for an id.
- **A follow-up write must never make a saved bill look unsaved.** `commit()`
  sets `committed` as soon as `commitBill` returns, then does the organiser
  writes in their own try/catch. Otherwise the operator sees a failure, saves
  again, and has two bills.
- **`sum(integer)` returns `bigint`; `sum(bigint)` returns `numeric`.** So
  `create or replace view` refuses a definition that changes a column's type —
  `SQLSTATE 42P16`. Drop the view first.

---

## Verifying UI

Screenshots go through CDP (`Emulation.setDeviceMetricsOverride`), **not**
`chrome --headless --window-size` — that flag sizes the capture, not the layout
viewport, so the page lays out at ~692px and you get a 390px slice that looks
like a CSS bug.

A **synthetic `element.click()` is not user activation**, so `navigator.share`
and `navigator.clipboard` reject it with `NotAllowedError`. Test taps with
`Input.dispatchMouseEvent` or you will "fix" a path that was working.

**Check test fixtures are testing the thing.** Three tests passed while the
payment-link feature was completely broken, because they put the token on the
one person who had already paid — and a settled share is filtered out whether or
not it has a token.

---

## PRD status

Both PRDs are in the repo (`split_bill_app_prd.md`,
`split_bill_app_prd_fitur_tambahan.md`). Every acceptance criterion is met
except these, all deliberate:

- **Item 1, self-serve signup** — the PRD itself makes it conditional on opening
  up beyond a small circle. The user has not. Not built.
- **Item 7, debt netting** — **cannot be built on this data model.** One owner
  per bill, every participant owes that owner, so all debts point the same way
  and netting has nothing to net. The settle-up screen says this out loud.
  Building it for real means letting a bill record who actually paid.
- **`bill.amount_changed`** is in the audit action union with no producer, because
  nothing can edit an amount after commit. That is a scope gap in the PRD, not a
  missing log entry.

## Secrets

`.env.local` is gitignored; keys go there or into Supabase secrets. **Never give
a key a `VITE_` prefix** — that puts it in the browser bundle. Never ask for a
key in chat.

`.env.local` and Supabase secrets hold `DEEPSEEK_API_KEY` separately: rotating
one does not update the other, and an edge function keeps using the old value
until `supabase secrets set` runs again (next invocation picks it up, no
redeploy). To see what production holds without printing the key, sha256 the
`.env.local` value and compare it to the digest in `supabase secrets list`.

---

## Keep this file current — it is part of the change

The point of this file is that a new terminal continues without being briefed. A
version describing the project as it was three weeks ago is worse than none,
because it is confidently wrong.

So when something moves, move it here in the same change:

- A PRD criterion gets met → it comes out of the unmet list.
- A trap costs real time → write it down while it is fresh.
- Guidance goes stale → **delete it.** A comment saying "not built yet" on a
  feature that now exists is the most misleading thing this file can hold.

**This is maintenance, not a changelog.** What does not belong: what the code
already says, what git history already records, or a list of what changed today.
Every line here is loaded into every session, so each one is a cost paid on
every message.
