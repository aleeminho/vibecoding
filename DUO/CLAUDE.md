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

## Design: do not reintroduce Liquid Glass

Flat, dark, PwC orange. Opaque surfaces one step lighter than the page, a
hairline border, rounded rectangles. **Nothing blurs, nothing floats, nothing is
translucent.** An earlier pass dressed this in Apple's Liquid Glass and it was
rejected twice — the tells are `backdrop-filter`, `rgba(255,255,255,0.0x)` fills,
`inset 0 1px 0` highlights, and bars with side margins and a 999px radius. See
the note at the top of `src/app.css`.

Tokens are role-based (`--brand`, `--surface`), never hue-based. `--brand`
`#d04a02` is a fill only — it is 4.25:1 on the background and fails AA as small
text. Text uses `--brand-light`.

Documents (the nota, the payer page) are **light**, always, and paint their own
colours rather than inheriting. They arrive as a link pasted into a group chat,
and a dark document is worse there.

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
