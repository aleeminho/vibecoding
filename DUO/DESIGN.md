---
name: DUO
description: A split-bill PWA shaped as an Indonesian carbon-copy kwitansi pad — white form paper, near-black ink, one orange that stamps what happened and prints what needs attention.
colors:
  ground: "#f0f0ee"
  sheet: "#ffffff"
  sheet-2: "#f7f7f5"
  sheet-3: "#ececea"
  paper: "#fffefa"
  write-in: "#ffffff"
  rule: "#e4e4e1"
  rule-strong: "#c2c2bc"
  ink: "#14161c"
  ink-2: "#565b66"
  ink-3: "#7b8089"
  stamp: "#d04a02"
  stamp-deep: "#9e3802"
  stamp-tint: "rgba(208, 74, 2, 0.12)"
  attention-tint: "#fdf1ea"
  attention-rule: "#eec3ab"
  ok: "#1c6b47"
  ok-tint: "#e6f0e9"
  ok-rule: "#a9c9b3"
  bad: "#a32b1e"
  bad-tint: "#f7e7e3"
  bad-rule: "#d9aca3"
typography:
  document-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
  page-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 750
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  lead:
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.015em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.4
  small:
    fontSize: "13px"
    lineHeight: 1.4
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.09em"
  serial:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "11px"
    letterSpacing: "0.06em"
  money:
    fontSize: "16px"
    fontWeight: 650
    fontFeature: "tnum"
rounded:
  radius: "4px"
  radius-sm: "3px"
spacing:
  gutter: "16px"
  group-gap: "8px"
  screen-gap: "20px"
  control-min: "44px"
  tab-space: "calc(62px + env(safe-area-inset-bottom))"
components:
  button-primary:
    backgroundColor: "{colors.stamp}"
    textColor: "#ffffff"
    rounded: "{rounded.radius}"
    padding: "0 18px"
    height: "44px"
  button-tinted:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.stamp-deep}"
    rounded: "{rounded.radius}"
    padding: "0 18px"
    height: "44px"
  button-plain:
    backgroundColor: "transparent"
    textColor: "{colors.stamp-deep}"
    rounded: "{rounded.radius}"
    padding: "0 10px"
    height: "36px"
  input:
    backgroundColor: "{colors.write-in}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.radius}"
    padding: "0 12px"
    height: "44px"
  sheet:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.radius}"
  sheet-attention:
    backgroundColor: "{colors.attention-tint}"
    rounded: "{rounded.radius}"
  sheet-ok:
    backgroundColor: "{colors.ok-tint}"
    rounded: "{rounded.radius}"
  sheet-bad:
    backgroundColor: "{colors.bad-tint}"
    rounded: "{rounded.radius}"
  row:
    padding: "10px 14px"
    height: "44px"
  group-title:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
  field-label:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
  serial:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.serial}"
  amount-box:
    backgroundColor: "{colors.write-in}"
    textColor: "{colors.ink}"
    typography: "{typography.money}"
    rounded: "{rounded.radius-sm}"
    padding: "3px 9px 2px"
  stamp-square:
    backgroundColor: "{colors.write-in}"
    rounded: "{rounded.radius-sm}"
    width: "24px"
    height: "24px"
  stamp-square-paid:
    backgroundColor: "{colors.stamp}"
    rounded: "{rounded.radius-sm}"
    width: "24px"
    height: "24px"
  stamp-mark:
    backgroundColor: "transparent"
    textColor: "{colors.stamp-deep}"
    rounded: "{rounded.radius-sm}"
    padding: "0 5px 1px"
  pick:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.radius-sm}"
    padding: "0 12px"
    height: "36px"
  pick-on:
    backgroundColor: "{colors.stamp-tint}"
    textColor: "{colors.stamp-deep}"
    rounded: "{rounded.radius-sm}"
    padding: "0 12px"
    height: "36px"
  segment:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.radius}"
    padding: "0 8px"
    height: "38px"
  segment-on:
    backgroundColor: "{colors.stamp-tint}"
    textColor: "{colors.stamp-deep}"
    rounded: "{rounded.radius}"
    padding: "0 8px"
    height: "38px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    height: "50px"
  tab-active:
    backgroundColor: "{colors.stamp}"
    textColor: "#ffffff"
    height: "50px"
---

# Design System: DUO

## Overview

**Creative North Star: "The Kwitansi Pad"**

DUO is an Indonesian carbon-copy receipt pad, not a dashboard. Every bill is a serially numbered kwitansi torn from the pad: pre-printed labels, ruled write-in lines, an amount box for the one figure that is a decision, a perforated counterfoil carrying the numbering-machine serial, and one orange rubber stamp pressed onto a line when the money arrives. The carbon copy underneath takes the same mark, so the payer's page and the nota read as the second ply of the form the operator filled in — which is also why the mark is a stamped square with its carbon copy behind it.

The material is white paper on a grey desk, flat by construction. An earlier build of this world used pale green-grey paper, a navy ink, a numbering-machine red and a carbon purple; an attended review rejected the cast ("nothing is clean"), and the palette was rebuilt **white-out, orange-forward**. The forms are pure white, the ink is near-black, and the stamp orange now does two jobs at once: it is the stamped mark and the attention ink — the pressed square and the unpaid money, the commit and the proof still to read. Green stays functional (settled); red stays functional (destruction); there is no separate warning hue. The Liquid Glass pass this app was dressed in even earlier is likewise still banned: nothing blurs, nothing floats, nothing is translucent.

The world also decides what the app is not. It is not a fintech dashboard (no cards floating over gradients, no charts, no pills), and not a chat feed. The two documents (the nota and the payer page) are light and paint their own colours, because they leave the app as links pasted into a WhatsApp group, as screenshots, and as paper.

**Key Characteristics:**
- A grey desk with pure white forms on it; near-black pre-printed ink; one orange that is both the stamp and the attention ink; green for settled, red for destruction.
- The mark is the **Dua Ply** — the stamped square with its outlined carbon copy behind it.
- State is carried by shape and word as well as colour: dashed square → half-pressed → solid stamp, lettered LUNAS, printed notices.
- Flat by construction — depth is tonal, never a shadow.
- Two scenes at one breakpoint (1100px): a 520px phone column with the index tabs welded to the bottom edge; a wide screen with a full-width letterhead, the same four tabs as a left rail, and two-pane screens.
- Documents (the 830px nota and the 480px payer page) are light, self-painted and webfont-free; the app's chrome stops at the paper.

## Colors

The palette is white paper plus one ink family that means the stamp. Nearly the whole colour budget goes to the stamp orange and the functional notices; the desk and the forms account for almost everything else. The ground is a clean neutral grey (`#f0f0ee`), not a paper tint on purpose — the paper is the pure white sheets and the grey only exists so they can sit on something.

### Primary
- **Stamp Orange** (`--stamp`, #d04a02): the pinned brand colour, now the chrome as well as the stamp. It fills the primary button, the pressed stamp square, the 36px/40px Dua Ply mark and the 60px saved-form mark, the active index tab and active rail tab, and the 2px rules under the letterhead and above the tab bar; it draws the focus ring and the `::selection` wash. White labels only — as small text on paper the base orange fails AA, which is what the deep sibling is for.
- **Stamp Deep** (`--stamp-deep`, #9e3802): the stamp ink at small-ink weight, and the border on every stamp fill. Attention text (`.attention`), plain text actions, the LUNAS lettering, outstanding money (`.owed`), the nota's Pay links and due figures, the payer page's settled verdict. On paper it clears AA where the base orange does not.
- **Stamp Tint** (`--stamp-tint`, rgba(208, 74, 2, 0.12)): a chosen person chip, a chosen payment-method segment, the input focus halo, text selection. A wash, never a fill for small text.
- **Attention Wash / Attention Rule** (`--attention-tint` #fdf1ea, `--attention-rule` #eec3ab): the attention states — the money still out, the proof to read, the step not done — printed as the same paper in the stamp family, opaque. The selected bill on the wide Tagihan screen, the flagged-proof queue, the model's doubts, the missing-config banner.

### Tertiary — the printed notices
- **Settled Green** (`--ok` #1c6b47 / `--ok-tint` #e6f0e9 / `--ok-rule` #a9c9b3): all clear and all paid — "Semua lunas", a settled verdict, a fully assigned bill.
- **Form Red** (`--bad` #a32b1e / `--bad-tint` #f7e7e3 / `--bad-rule` #d9aca3): destruction and failure — delete, mismatch, a network error, a blocker in the commit bar. Never a warning.

### Neutral
- **Desk Ground** (`--ground`, #f0f0ee): the table the pad sits on — page background and the browser theme colour.
- **Form Sheet** (`--sheet`, #ffffff): every list, the letterhead, the tab bar, the rail, the commit bar. Opaque, one step lighter than the ground.
- **Counterfoil Shade / Pressed Paper** (`--sheet-2` / `--sheet-3`, #f7f7f5 / #ececea): the opened-item editor, a settled share row, the nota's due band and table footer (sheet-2), the tap shade (sheet-3).
- **Document Paper** (`--paper`, #fffefa): the nota's and payer page's own ground — the warmest white in the palette, painted by those routes rather than inherited (`body.paper`).
- **Blank Write-In** (`--write-in`, #ffffff): the blank a pen fills — inputs, amount boxes, the empty stamp square, QR frames.
- **Hairline Rule / Form Frame** (`--rule` / `--rule-strong`, #e4e4e1 / #c2c2bc): the line between two rows (rule), the frame around a sheet, input, button or amount box (rule-strong). The documents keep a softer #f7f7f5 rule inside their tables.
- **Pre-Printed Ink / Secondary / Faint** (`--ink` / `--ink-2` / `--ink-3`, #14161c / #565b66 / #7b8089): all text and drawn icons; names and money in full ink, captions in ink-2, faint meta in ink-3.

### Named Rules
**The One Orange Rule.** Orange means the stamp ("this happened": the commit, the pressed square, the active tab, the mark) and it means attention ("this needs you": the money still out, the proof to read, the work not done). Those are the same meaning — the thing to act on — so it is one ink, and it never decorates: no orange headings, no orange ornament.

**The Owed-Is-Attention Rule.** Outstanding money is the one figure allowed to take the stamp ink outside the stamp itself: `.owed` at `--stamp-deep` 700 (the Tagihan ledger, Report's all-time panel, in an amount box), the Orang screen's remaining figure, the nota's due figures.

**The Functional-Colour Rule.** Green is settled and red is destruction; there is no third state hue. Everything that needs attention prints in the stamp family, and everything finished recedes to grey or green. The first build's amber warning family, serial red and carbon purple were deleted with the green-grey palette and do not come back.

## Typography

**Display Font:** System sans (`-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif`)
**Body Font:** System sans (same stack)
**Label/Mono Font:** System mono (`ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace`)

**Character:** The type does no branding work; it does form work. Labels are small, bold and letter-spaced like pre-printed field names. Money is tabular and right-aligned. Monospace is reserved for machine-issued data — ref codes, pay tokens, account numbers — which is the one thing on the form a typewriter printed.

### Hierarchy
- **Document title** (700, 30px, line-height 1, −0.02em): the nota's "Split bill"; documents set their own sizes inside the same two stacks.
- **Page title** (750, 26px / `--text-xl`, −0.02em): the app's screen title; it scrolls away while the letterhead stays, and on a wide screen it steps aside for the rail.
- **Lead** (700, 19px / `--text-lg`, −0.015em): hero and notice leads, the desktop detail pane's place name.
- **Body** (400, 16px / `--text-base`, line-height 1.4): every row, input and paragraph.
- **Small** (400, 13px / `--text-sm`): captions, meta, helper text, notice bodies.
- **Label** (700, 11px / `--text-xs`, 0.09em, uppercase): pre-printed field and section labels (`.group-title`, `.field-label`); they label paper, they are not shouty kickers.
- **Serial** (mono, 11px, 0.06em): ref codes, pay tokens, account numbers, the counterfoil's vertical serial. Set in ink-2, not a colour.
- **Money** (650–700, tabular figures): every amount, always `font-variant-numeric: tabular-nums`, always right-aligned where it forms a column.

### Named Rules
**The No-Webfont Rule.** System sans and system mono only, in the app and in the documents. A webfont is a third-party round trip before the first paint of a page someone is standing in a restaurant waiting for, and the form's character comes from its print, not its face.

**The Money-Never-Wraps Rule.** Every amount carries tabular figures and `white-space: nowrap`. A figure that breaks after "Rp" prints as two numbers, and a column of figures that does not align cannot be added up by eye.

## Layout

**Two scenes, one breakpoint: 1100px** (`src/lib/viewport.svelte.ts` — one constant, shared by the shell and the routes so they cannot disagree).

**Phone (below 1100px).** Everything lives in a 520px column, centred. The letterhead is capped to it (`min-height: 56px`, 16px side padding plus the top safe-area inset) and closed by a 2px stamp rule. The content is a stack of groups 20px apart; a group is a sheet with an 8px gap under its title, and the column's gutter is 16px. Rows are at least 44px tall with 10px/14px padding, so the whole row can be the tap target. The index tabs are welded to the bottom edge: a sticky bar, same 520px cap, `min-height: var(--tab-space)` (62px plus the bottom safe-area inset) and a 2px stamp top rule. `--tab-space` is the single published measurement of that bar, so Review's commit bar can stick directly on top of it (`bottom: var(--tab-space)`, z-index 9 against the tab bar's 10) and the two can never overlap or leave a stripe between them.

**Wide (1100px and up).** The letterhead runs the full width (`min-height: 64px`, 8px/28px padding) and grows the operator email and Keluar; the Dua Ply mark goes from 36px to 40px. The same four tabs — **Tagihan, Foto, Tagih, Report** — move into a 92px left rail (sheet fill, 1px `--rule` right edge, 24px icons over 10.5px labels, 12px/10px padding), and the phone tab bar is hidden. Page titles step aside because the rail carries orientation. The content stops being a phone column: `main` goes full width with 22px/28px/28px padding, and each route decides what to do with the room.

**The two-pane compositions (wide screens only).** All of them keep the left pane as the record and the right pane as the thing being worked on, with a `minmax(0, 1fr)` column so nothing can force the grid wider:
- **Tagihan** (`Bills.svelte`): a 440px ledger column plus the selected bill's open form, 22px gap, capped at 1360px. The form pane is `.detail-col`, sticky at `top: 86px`, so the ledger stays readable beside it; the selected ledger card wears the attention wash and a stamp border, so both panes agree on what is open. `.form-head` opens the pane with the place at 19px/750, the date and payment method at 13px, and the bill total as the right-aligned stamp-deep figure.
- **Review** (`Review.svelte`): `.work-col` (the items, the assignment work) plus a fixed 460px `.side-col` (who pays the vendor, the roster, the destination, the result), 26px gap, capped at 1360px. The commit bar leaves its sticky position and becomes `.side-commit`: a framed 1px `--rule-strong` block at the foot of the side column, so the commit is the line the form is signed on, in the column that holds the result.
- **Report** (`Report.svelte`): the month's spend plus a 460px side column of what is still out, the exports, and the change log; the print head spans both.
- **Settle** (`Settle.svelte`): the collection cards go two-up (`1fr 1fr`, 22px gap); on a phone they stack.

Capture, Orang and SignIn are centred caps on a wide screen (560px, 720px and 440px), because one photo form and one person do not become a two-pane layout. The dev phone frame (`src/lib/frame.ts`) applies only between 420px and the breakpoint and is stripped from production; it is a measurement aid, not part of the system.

**Documents have widths of their own.** The nota is an **830px sheet** (54px/56px padding; at 720px and below the padding tightens, the masthead stacks, the slips go one column and the QR row stacks). The payer page is a **480px (30rem) sheet**. Both are centred, paint their own `--paper` (#fffefa), and `body.paper` turns the page behind them to the same warm white. Print is a first-class layout: the two documents carry no app chrome at all, the Report screen declares a print head that only paper sees, and `@media print` drops the bars and the `.no-print` groups and strips the paper's fills (white ground, black text, sheets transparent, borders #ccc).

### Named Rules
**The Two-Scenes Rule.** One breakpoint, 1100px. Below it the app is a phone pad: a 520px column with the index tabs at the bottom edge. At and above it the letterhead runs full width, the same four tabs become a left rail, and the screens that can use the room go two-pane. There is no third layout.

**The Pad-Is-Phone-Width Rule.** The phone column never widens. Only documents get widths of their own (830px nota, 480px payer page); a wide screen re-composes the phone column into panes around it, never a wider pad.

## Elevation & Depth

Flat by construction. There are no shadows at rest — the single `box-shadow` in the system is the input focus halo (`0 0 0 3px var(--stamp-tint)`), and the only other depth response is the 2px `:focus-visible` outline. Depth is tonal: ground → sheet → sheet-2 → sheet-3, each step lighter or deeper than its neighbour. Separation is drawn, never cast: a hairline (`--rule`) between two rows, a frame (`--rule-strong`) around a sheet, input or amount box, a 2px solid rule where chrome or a document header meets content (stamp orange on the letterhead, tab bar and commit bar; ink on the documents), and a 3px double ink rule under a ledger total. Tinted notices are opaque paper printed in another ink — never a translucent wash, because a translucent wash over paper is glass, and glass is the thing this world was asked to replace.

### Named Rules
**The Flat-By-Construction Rule.** If something must stand out it gets a rule, a frame, or a deeper sheet. Nothing blurs, nothing floats, nothing is translucent: no `backdrop-filter`, no raised cards, no drop shadows, no alpha fills except `--stamp-tint` as a state wash.

## Shapes

Printed forms are square, so the radius is a press mark, not a capsule: **4px** (`--radius`) on sheets, buttons, inputs and the rail tabs, **3px** (`--radius-sm`) on small parts — amount box, stamp square, chips, the lettered stamp, the phone tab's bottom corners. There are no 999px pills and no circles except the receipt-reading spinner.

The borders carry the world's grammar:
- **1px solid `--rule`**: the hairline between two fields on the same form (inset 14px from the left, so the ruled line starts where the text does), and the rail's edge.
- **1px solid `--rule-strong`**: the frame around a sheet, an input, a button, the amount box, a proof's QR frame, the desktop side-commit.
- **2px solid `--stamp`**: the letterhead's bottom edge, the tab bar's top edge, and the Review commit bar's top edge — the pad's chrome.
- **2px solid `--ink`**: a document's masthead rule, the nota's due band.
- **3px double `--ink`**: the total line under a ledger column.
- **1px dashed `--rule-strong`**: the counterfoil's tear line. **1.5px dashed `--ink-3`**: the empty stamp square. **1px dotted `--rule-strong`**: the write-in line under an unassigned item's name, and the dotted underline of a tappable group title.

State lives in the silhouette. The 24px stamp square has three: **dashed empty** (1.5px dashed `--ink-3` on write-in paper), **half-pressed partial** (`linear-gradient(180deg, write-in 50%, stamp 50%)` behind a solid stamp border — the stamp is halfway down, the paper stained below the press mark), and **pressed** (solid `--stamp` fill, `--stamp-deep` border; no tick — a tick is a checkbox, a stamp is an event). The lettered LUNAS stamp is outlined, letter-spaced, rotated −2°; the Dua Ply mark is square-on; the saved-form mark is the same device pressed one degree further (−3°). Those are the only skews in the world.

Icons are drawn SVG strokes (1.6–2.4 weight), never glyph characters, and the disclosure indicator is two borders rotated into a chevron. State never relies on a coloured side stripe: an unassigned item is a dashed sheet whose name sits on a dotted write-in line, and it says "Belum dibagi" in words.

### Named Rules
**The Press-Mark Radius Rule.** Corners are 4px, or 3px on small parts. Printed forms are square; a capsule or pill is a different world.

**The State-Is-Shape Rule.** Every state is carried by shape and word as well as colour: dashed/filled stamps, a lettered LUNAS, a bordered notice, "Belum dibagi", "kurang Rp …". Reading it in greyscale must still work.

## Components

### Buttons
- **Shape:** 4px radius (`--radius`), 1px border, `min-height: 44px`, 18px side padding, weight 560.
- **Primary (the commit):** solid stamp fill (`--stamp`), `--stamp-deep` border, white label, weight 650. It appears once per screen at the point of commit: Simpan, Ambil foto struk, Bagikan link nota, Upload bukti bayar, Simpan PDF, Masuk.
- **Tinted (secondary):** sheet fill, stamp border, `--stamp-deep` label, weight 620 — Kembali, Tambah, the export buttons.
- **Plain (text action):** no background, no border, `--stamp-deep` label, 13px, `min-height: 36px`, 10px side padding; destructive variants take `--bad` instead.
- **Press / Focus:** a button goes down under the finger (`transform: translateY(1px)` at 0.12s ease), it does not shrink. Disabled is `opacity: 0.45`. Keyboard focus is the drawn ring: 2px solid `--stamp`, 2px offset, on every ground.
- **Busy:** the label itself changes ("Menyimpan…", "Lagi dicek…") — a spinner replaces the label only on Capture.

### Chips
- **Person chips (`.pick`)**: a name box on the form, not a capsule — 3px radius, 1px `--rule-strong` border, sheet fill, 13px ink label, 36px tall. Chosen takes the stamp tint: `--stamp-tint` fill, `--stamp` border, `--stamp-deep` label. The remove "×" on a roster chip is inline SVG, not a glyph; a 36px chip is deliberately dense inside a list row.
- **Payment-method segments (`.segment`)**: three options in one row, each a field box at 38px; the chosen one takes the stamp tint and border. A segmented control rather than a select, so the alternatives stay visible.

### Cards / Containers
- **The list sheet (`.list`)**: the form's unit — `--sheet` fill, 1px `--rule-strong` frame, 4px radius, `overflow: hidden`. Rows inside are 44px minimum with 10px/14px padding, separated by the hairline (`.row + .row::before`, inset 14px). A `tappable` row darkens to `--sheet-2` under the finger.
- **Sheet tints**: `.tint-attention` (attention wash + attention rule), `.tint-ok` (green), `.tint-bad` (red) are the same sheet printed in another ink, always opaque. A notice is a tinted sheet with an 18px drawn icon and 13px text in the ink of its family.
- **Group titles (`.group-title`) and field labels (`.field-label`)**: 11px, 700, 0.09em, uppercase, `--ink-2` — pre-printed section and field names; the rare tappable title keeps the group-title look and takes a dotted underline.
- **The value column (`.row-value`)**: a row's right-hand figure — `--ink-2` by default, `.strong` for ink at 650, `.owed` for outstanding money (stamp-deep at 700), `.partial` for a part-paid remainder (heavier ink), `.sisa` on the Orang screen (stamp-deep). All tabular, none wrap.
- **The counterfoil stub**: every history bill is a `.stub-card` — 30px of left padding, a 29px column carrying the ref code bottom-up in mono 10px ink-2, closed by a 1px dashed tear line. It is hidden from assistive tech because the same code appears in the card's meta row.

### Inputs / Fields
- **Boxed fields** (`input`, `select`): 44px tall, write-in paper, 1px `--rule-strong` frame, 4px radius, 16px ink text; placeholder `--ink-3`. Text inputs never shrink below 16px, so iOS does not zoom the page on focus.
- **Focus:** the border turns `--stamp` and a 3px `--stamp-tint` halo replaces the outline — the only shadow in the system, and it is a state.
- **Field rows** (sign-in, destination, payment settings): the row is the field — a fixed-width label column in 13–16px ink plus a chrome-less input, right-aligned, with no border of its own; focus-within backgrounds the row (`--sheet-2`). This is a settings-form field, not a box inside a box.
- **Money input:** text input with `inputmode="numeric"`, right-aligned tabular figures, an edit buffer so a half-typed number never cascades through the live totals, and a blur that snaps back to canonical formatting (`25.000`).
- **The amount box (`.amount-box`)**: the kwitansi's printed box around a figure that is a decision — write-in paper, 1px `--rule-strong` frame, 3px radius, 3px/9px padding, ink, 700, tabular, never wraps. On the payer page it grows to 32px as the one number that page exists to state.

### Navigation
- **Letterhead**: a sticky sheet bar, 56px minimum on a phone and 64px on a wide screen, closed by a 2px stamp rule. Left: the 36px Dua Ply mark (40px wide) plus DUO / "Split Bill". Right: on a wide screen only, the operator email in mono and Keluar as a plain action when signed in.
- **Index tabs (phone)**: four flat tabs welded to the bottom edge, `min-height: var(--tab-space)`, 2px stamp top rule. Each tab is a 23px drawn icon over a 10px label in `--ink-2`; the active tab is **filled with the stamp** — white icon and label, `--stamp-deep` border — a pressed button rather than a highlighted label.
- **Left rail (wide)**: the same four tabs, moved to a 92px column of the pad's left edge: 24px icons over 10.5px labels, weight 650, sheet fill, 1px `--rule` right edge. The active tab is filled with the stamp exactly as the phone tab is, with a 4px radius.
- **Commit bar (Review)**: sticks directly on top of the tab bar at `bottom: var(--tab-space)`, same sheet fill, z-index 9, ruled off with its 2px stamp top edge — if it ever painted under the nav, the most important control on the screen would be invisible with nothing to say it was there. It shows the blockers in `--bad` and carries the one primary button, whose label names the next step ("Bagi 1 item lagi", "Isi rekening tujuan dulu") instead of "Belum bisa disimpan".

### The Dua Ply Mark (signature)
The brand mark: a stamped square with its carbon copy behind it, drawn as SVG paths so it inherits the stamp ink and stays crisp at any size. A 39×39 rounded square (rx 6) in solid `--stamp` at 8,8 with a white "D" knocked out; behind it, offset 9px down-right, a second square outlined at 3px in `--stamp` at 40% opacity. It is `public/favicon.svg`, the inline mark in the letterhead, and the rendered PNG set (`icon-192`, `icon-512`, `icon-maskable-512`, `apple-touch-icon`) — the same geometry everywhere, fill `#d04a02` in the raster set.

### The Stamp Square (signature)
The control that replaces a switch. A 24px square at the leading edge of a share row, so the column of squares can be read in one pass — how many are still empty is the question the screen exists to answer. Tapping the whole row toggles it; it is `aria-pressed`, and the settled row recedes to `--sheet-2` while the stamped square is the only orange on it. Partial is the half-pressed gradient; settled rows also print the lettered mark beside the name.

### The Lettered Stamp (signature)
`.stamp-mark` — "Lunas" in 10px 800, 0.12em tracking, uppercase, outlined 1.5px in `--stamp-deep`, 3px radius, rotated −2°. It sits beside the person's name on a settled line, the way a kwitansi is stamped on its own line. The same device, scaled up to a 60px filled square with a white check (rotated −3°), is the saved-bill confirmation on Review; the payer page's verdict uses the outlined version at 20px inside an attention-wash panel.

### Notices (signature)
A notice is a sheet printed in another ink, opaque, with its family's border: the attention wash for work not done and the model's doubts, green for all-clear, red for destruction and failure. On Review they carry a drawn triangle icon and read at 13px; the flagged-proof queue is the attention one, with a 1px `--attention-rule` hairline between entries and "Lihat bukti / Tandai lunas" as plain actions.

### Documents (signature)
The nota and the payer page are the carbon copies. They are light (`--paper` #fffefa), self-painted, and webfont-free, and the app's chrome does not follow them.
- **The nota sheet**: 830px, letterhead with place and date on the left and "Split bill" with the Bill/Items/Total-paid meta grid on the right, closed by a 2px ink rule. A people ledger inside a 1px-ruled card with the 3px double ink total line, then two slips per row — name, Pay link against the right edge in `--stamp-deep`, itemised lines, subtotal and charge, and a due band bled to the card's edges on the sheet-2 shade with a 2px ink top rule. Unsettled due figures are `--stamp-deep` (the figure to act on); settled slips recede to `--ink-2`. The ledger mismatch, when there is one, is said out loud in the stamp ink rather than hidden.
- **The payer page**: 480px of paper with the amount box at 32px, the QRIS block on white with a real quiet zone, the destination as a mono detail row, one solid-stamp "Upload bukti bayar" commit plus a quieter camera variant, and notices for mismatch/unclear. It never shows other people or the bill total.

## Do's and Don'ts

### Do:
- **Do** keep `--stamp` for the stamp, the commit and the chrome — one primary button per screen, the pressed square, the active tab and rail fill, the mark, the 2px letterhead and tab-bar rules, the focus ring.
- **Do** use `--stamp-deep` for small orange ink; the base `--stamp` is a fill and a border, never small text (it fails AA on paper).
- **Do** print the money that needs action in the stamp ink — `.owed`, `.attention`, the Orang remainder, the nota's due figures — and keep a bill's own ledger amounts in ink.
- **Do** keep money in tabular figures, right-aligned, `nowrap`.
- **Do** carry state by shape and word as well as colour: dashed/half/solid stamp square, lettered LUNAS, a bordered notice, "Belum dibagi".
- **Do** keep controls at least 44px tall and make the whole row the target when the row is the control (buttons, inputs, selects, rows).
- **Do** keep documents light, self-painted, and webfont-free; they are read in chats, as screenshots, and on paper.
- **Do** keep labels small, uppercase, and letter-spaced (0.09em) — they are pre-printed on the form, not headlines.
- **Do** keep depth tonal: a rule, a frame, or a deeper sheet.
- **Do** keep the two scenes at the one breakpoint: below 1100px the phone column with the tabs at the bottom edge, at 1100px and up the rail and the two-pane screens, with the same four tabs either way.

### Don't:
- **Don't** put orange on a heading, a decoration, or an amount inside a bill — orange that is not the stamp or an attention figure dilutes both meanings.
- **Don't** blur, float, or use translucent fills: no `backdrop-filter`, no raised cards, no drop shadows, no alpha washes except `--stamp-tint` as state.
- **Don't** use capsules, 999px radii, or pill chips — corners are 4px (`--radius`) or 3px (`--radius-sm`), because printed forms are square.
- **Don't** use a coloured side stripe as state; a dashed sheet, a dotted write-in line and a word say it without shouting.
- **Don't** use glyph characters as icons; draw SVG strokes (the chip's ×, the chevron, the tab icons, the notice triangle are all drawn).
- **Don't** add webfonts, and don't give the nota or the payer page dark chrome.
- **Don't** replace the stamp square with a switch or a tick-in-a-box; a tick is a checkbox, and a stamp is an event that happened.
- **Don't** let a money figure wrap or break mid-number; each amount is one unbreakable token.
- **Don't** reintroduce the rejected palette: no green-grey paper, no navy ink, no serial red, no carbon purple, no amber. The world is white paper and one orange that also carries attention.
