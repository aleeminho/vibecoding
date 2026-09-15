---
version: 1
slug: "src-app-svelte"
primary_target: "src/App.svelte"
related_targets: ["src/routes/Nota.svelte","src/routes/Bayar.svelte","src/app.css"]
---

# DUO — surface brief

## Scope and mode
Operate. Every screen: the shell chrome (`src/App.svelte`), Tagihan, Foto struk, Review & Bagi, Tagih, Report, Orang, Sign in — plus the two paper documents, the nota and the payer page. Phone-first PWA; the documents also live on paper and in chat previews.

## Audience and job
One operator, a handful of friends. Photograph the receipt, assign items, send the nota to the group, collect. Payers have no account: their whole interface is one tokenized page that states what they owe and accepts a transfer screenshot as proof.

## Chosen direction
Kwitansi — the carbon-copy receipt pad. Chosen from the board's pick card; the roll's assigned direction was Bukti Transfer, and this pick won in an attended round.

## Memorable moment
The stamp: marking a share settled presses an orange LUNAS stamp onto the form's line, and the carbon copy underneath takes the same mark.

## Constraints
- Preserve behaviour, Indonesian copy, hash routes, demo fixtures and the literal `import.meta.env.DEV && isDemo()` guard, print CSS, PWA installability, keyboard focus, and existing accessibility (AA text, 44px targets, state by shape and word).
- PwC orange #d04a02 stays the brand colour; here it is the stamp ink.
- No new dependencies unless the world cannot be built without one.
- The nota and payer page stay light paper documents; they are read in group chats and on paper.

## Unresolved decisions
- Face for the pre-printed field labels: system sans at build time, pending a legibility check at 390px.
- How far the carbon-copy device goes in read-only documents before it becomes costume.

## Direction contract
THESIS: The app is the pad. Every bill is a serially numbered kwitansi, every share a ruled line, every payment an orange stamp; it refuses the fintech dashboard and the chat feed.

OWN-WORLD: Light form paper, ink blue-black, serial red, one orange stamp, carbon purple on duplicates. Pre-printed field labels, dotted write-in rules, amount boxes, perforated counterfoils. System sans for UI, tabular figures for money.

STORY: The operator recognises the form they have signed a thousand times and trusts it instantly. They read who still owes, fill what is missing, and stamp what has arrived.

FIRST VIEWPORT: A paper sheet headed DUO with the operator's name in a field grid; a control-total band, "Belum lunas", its figure in the amount box; below, one ruled line per person — dotted name field, amount box, empty stamp square; the pad's counterfoil column of numbered bills; four index tabs at the foot.

FORM: Grounded candidate, ranked first before the roll; the roll assigned Bukti Transfer, the pick card won. Seed key 26292ba6, locked card: model-pick.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
