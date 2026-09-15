# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One operator per account: the person who paid for the meal and collects from
everyone else. They are on a phone at the table, photograph the receipt, and
later chase friends in a group chat. Their participants — a handful per bill —
have no account and never see the app's chrome; they open the nota and their own
payment link.

## Product Purpose

Turn a photographed receipt into a split everyone can read, a bill the operator
can collect, and a payment record that reconciles without manual arithmetic.
Success: the operator's outstanding balance reaches zero with no hand-added
figures and no chasing twice.

## Positioning

The payer never needs an account. Their entire interface is a tokenized link
that says who they are, what they owe, and where to send it, and accepts a
transfer screenshot as proof. The model reads the receipt; every figure after
that comes from deterministic code, and nothing is saved until the operator has
reviewed and assigned it.

## Operating Context

- Restaurant table, phone in hand, receipt photographed on the spot; or a photo
  from the gallery filed later.
- The PWA is installed to the home screen (iOS Safari) and must survive being
  opened once a week without losing the session.
- The nota travels as a link pasted into a WhatsApp group. Everyone's payment
  links are in that one message, by the operator's explicit choice; the amount
  check at the payer's end is what catches a mis-tap.
- Payments move by bank transfer or static QRIS. Indonesian rupiah, informal
  Indonesian copy.
- Monthly reports are printed or exported from the browser (print to PDF, CSV),
  not from a database dashboard.
- Code ships itself on a push; schema changes are applied by hand.

## Capabilities and Constraints

- Svelte 5 + Vite + TypeScript on bun; Supabase for Postgres, RLS, storage, and
  one edge function; hash-routed SPA.
- One operator account, created by hand in the Supabase dashboard. No self-serve
  signup: the PRD makes it conditional on opening up beyond a small circle, and
  that has not happened.
- The model is used only to read receipts. Normalisation, validation gates, and
  split arithmetic are deterministic client code.
- Payment proof validation is a public edge function keyed only by the pay
  token; the payer holds no session, and the function accepts a token and an
  image and nothing else.
- Bills are soft-deleted and restorable.
- Debt netting (PRD 7) cannot be built on the current data model — one owner per
  bill, every debt points the same way. The settle screen says so out loud.
- Deploy order means code can go live before the schema it wants; reads are
  accordingly defensive. The nota's RPC is the deliberate exception: a function
  whose shape is fixed at creation should fail loudly, not half-work.
- Phone-first PWA: fast first paint on restaurant wifi and mobile data.

## Brand Commitments

- The name DUO.
- PwC orange `#d04a02` is the brand colour and stays binding through the
  redesign; everything around it is open.
- Tagline: "Split the bill. Not the friendship."
- Voice: informal Indonesian, direct, no hype. Money is stated plainly and
  failures are named rather than softened.

## Evidence on Hand

- Demo fixtures with Indonesian places, names, and payment states, including
  part-payments and unreadable proofs (`src/lib/demo.ts`).
- Both PRDs and the full spec, in the repo.
- An extraction test fixture with one real, manually verified receipt
  (`scripts/test-extract.ts`).
- `public/demo/qris.png` placeholder.
- No real testimonials, press, benchmarks, or pricing exist; none should be
  invented.

## Product Principles

1. The payer never logs in — the pay token is the whole security model and the
   only interface they get.
2. AI reads; code decides. Every extracted value is reviewable and editable
   before a bill exists.
3. A bill must reconcile: every figure traces back to the receipt, and the nota
   states a mismatch out loud instead of hiding it.
4. Documents leave the app. Nota, proofs, and reports are read in chats, on
   paper, and in screenshots; they are designed for that scene.
5. One operator until the circle widens: signup, netting, and multi-operator
   work wait on a product decision, not on an implementation gap.

## Accessibility & Inclusion

- Established in code and to be preserved: body text meets AA contrast against
  its surface (brand orange is never small text), tap targets are at least 44px,
  state is carried by shape as well as colour, the UI is Indonesian, and
  pinch-zoom on receipt photos stays enabled.
