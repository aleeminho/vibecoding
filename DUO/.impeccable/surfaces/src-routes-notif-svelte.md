---
version: 1
slug: "src-routes-notif-svelte"
primary_target: "src/routes/Notif.svelte"
related_targets: ["src/App.svelte","src/lib/notifications.svelte.ts"]
---

# DUO — Notifikasi surface brief

## Scope and mode
Operate. One route: the notification feed (`src/routes/Notif.svelte`) and the
letterhead bell that opens it (`src/App.svelte`). Phone-first, same shell.

## Audience and job
The operator, after sending the nota. Payers upload proofs over the following
hours; the operator needs one place that answers "what came in since I looked",
without opening each bill. Task: scan the list, tell settled from needs-a-look,
tap through. Frequency: a few times a week, in bursts.

## Chosen direction
Extension of the committed kwitansi world. The feed is the pad's inbox, and its
unit is the invoice, not the transfer: one bundle per bill, opened into its
counterfoil — the individual proofs underneath, with the actions for the ones
still waiting. What has been looked at recedes to the counterfoil shade the way
a settled row does on Tagihan.

## Memorable moment
A bundle three people paid opens like a slip torn off the pad: its counterfoil
unfolds into one line per payment, each already stamped or still asking, and the
bell's count is the same stamped square.

## Constraints
- Preserve the literal `import.meta.env.DEV && isDemo()` guard, hash routes,
  Indonesian copy, AA, 44px targets, state by shape and word, flat-by-construction.
- No new dependencies, no push notifications, no notifications table: the feed
  derives from `payments`, unread is a device-local marker.
- The feed must not become a work surface: flagged rows point at Tagihan, where
  the accept actions live.

## Unresolved decisions
- Whether tapping a settled row should open the nota (current) or the bill's
  detail on Tagihan; the nota is the artefact the operator shares.
- Whether the bell deserves a place on the payer-facing documents (no — the
  documents carry no chrome; noted so it is not rediscovered).

## Direction contract
THESIS: The feed is the pad's inbox, bundled per invoice — one line per bill,
unfolded into its counterfoil of proofs — and it refuses the chat feed, the
activity stream with avatars, and the dashboard stat card.

OWN-WORLD: The committed kwitansi materials only: white sheets on the grey
desk, the 24px stamp square at the leading edge (pressed = bill settled,
half-pressed = a person must look), the lettered outlined LUNAS, the
counterfoil shade for anything already seen and for an opened bundle, a
disclosure chevron, pre-printed group labels, money in tabular figures, the ref
code as mono serial, and a meta line that truncates from its end — age before
count.

STORY: The operator opens the app, sees a stamped count on the bell, opens the
list and in one pass learns which bills have something waiting. Tapping a bill
unfolds its proofs; the ones still asking offer the screenshot and "Tandai
lunas" right there, and a bill with nothing waiting wears the pressed square.

FIRST VIEWPORT: On a 390px phone: letterhead with the bell and its stamped
count; the page title; "BARU · n" over a sheet of bill bundles — 24px stamp
square, the place in full ink over "REF · age [· n bukti]", LUNAS or "Perlu
dicek" at the right edge with the chevron; an opened bundle drops to the
counterfoil shade and lists its payments, indented to the text column, each
with its own state and the waiting ones carrying "Lihat bukti / Tandai lunas".
On 1440px the feed is a centred 720px column.

FORM: Local extension of the committed world; no new identity, no seed roll.

FINISH: unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance.
