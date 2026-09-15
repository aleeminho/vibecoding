---
name: DUO
description: A split-bill PWA shaped as an Indonesian carbon-copy kwitansi pad — paper, pre-printed ink, one orange stamp.
colors:
  ground: "#e7ebe0"
  sheet: "#f6f8f1"
  sheet-2: "#eef1e7"
  sheet-3: "#e0e5d6"
  paper: "#fbfcf7"
  write-in: "#fdfef9"
  rule: "#c6ccba"
  rule-strong: "#98a18c"
  ink: "#1b2f5e"
  ink-2: "#4a5a7d"
  ink-3: "#64708c"
  stamp: "#d04a02"
  stamp-deep: "#9e3802"
  stamp-tint: "rgba(208, 74, 2, 0.12)"
  stamp-wash: "#fbeee5"
  serial: "#b0362b"
  carbon: "#6b5a86"
  carbon-tint: "#efeaf3"
  warn: "#7d5400"
  warn-tint: "#f5eed6"
  warn-rule: "#d8c48c"
  ok: "#1e6b46"
  ok-tint: "#e5efe7"
  ok-rule: "#aac9b1"
  bad: "#a02a1e"
  bad-tint: "#f6e6e2"
  bad-rule: "#d9aaa1"
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
  sheet-warn:
    backgroundColor: "{colors.warn-tint}"
    rounded: "{rounded.radius}"
  sheet-ok:
    backgroundColor: "{colors.ok-tint}"
    rounded: "{rounded.radius}"
  sheet-bad:
    backgroundColor: "{colors.bad-tint}"
    rounded: "{rounded.radius}"
  sheet-carbon:
    backgroundColor: "{colors.carbon-tint}"
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
    textColor: "{colors.serial}"
    typography: "{typography.serial}"
  serial-ink:
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
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    height: "50px"
---

# Design System: DUO

## Overview

**Creative North Star: "The Kwitansi Pad"**

DUO is an Indonesian carbon-copy receipt pad, not a dashboard. Every bill is a serially numbered kwitansi torn from the pad: pre-printed labels, ruled write-in lines, an amount box for the one figure that is a decision, a perforated counterfoil carrying the numbering-machine serial, and one orange rubber stamp pressed onto a line when the money arrives. The carbon copy underneath takes the same mark, so the payer's page and the nota read as the second ply of the form the operator filled in.

The material is flat paper on a table. Surfaces are opaque and one step lighter than the ground they sit on; separation is a hairline rule or a 2px ink rule; nothing blurs, nothing floats, nothing is translucent. Orange has exactly one meaning — the stamp, and the commit that does the same thing ("this happened") — and is spent accordingly: the primary button, the pressed stamp square, the brand mark, the focus ring, the active index tab's top edge. Everything else is printed ink on paper: blue-black for text, numbering-machine red for serials, carbon purple for duplicates, amber/green/red for the printed notices.

The world also decides what the app is not. It is not a fintech dashboard (no cards floating over gradients, no charts, no pills), not a chat feed, and not glass — an earlier pass dressed it in Apple's Liquid Glass and was rejected twice. The two documents (the nota and the payer page) are light and paint their own colours, because they leave the app as links pasted into a WhatsApp group, as screenshots, and as paper.

**Key Characteristics:**
- A pale green-grey ground with near-white forms on it; blue-black pre-printed ink; one orange stamp; numbering-machine red; carbon purple.
- Money is ink, tabular and right-aligned; orange never colours an amount.
- State is carried by shape and word as well as colour: dashed square → half-pressed → solid stamp, lettered LUNAS, printed notices.
- Flat by construction — depth is tonal, never a shadow.
- Phone-width pad: a 520px centred column of form on any viewport; a separate 830px sheet for the nota.
- Documents are light, self-painted and webfont-free; the app's chrome stops at the paper.

## Colors

The palette is paper plus one ink family that means the stamp. Papers, rules and text account for most of the values; nearly the whole colour budget goes to the stamp orange and the three notice inks. The ground is a pale green-grey rather than cream on purpose — the kwitansi pad this world is named after is printed on green, and warm cream is what every model reaches for when handed "paper".

### Primary
- **Stamp Orange** (`--stamp`, #d04a02): the pinned brand colour, spent only as a stamp and a commit. It fills the primary button, the pressed stamp square, the 36px brand mark and the 60px saved-form mark; it draws the focus ring and the active tab's 2px top edge; it is the `::selection` wash (`--stamp-tint`). White labels only — as small text on paper the base orange fails AA, which is what the deep sibling is for.
- **Stamp Deep** (`--stamp-deep`, #9e3802): the stamp ink at small-ink weight, and the border on every stamp fill. Tinted buttons, plain text actions, the LUNAS lettering, the nota's Pay link and due figure, the payer page's settled verdict. On paper it clears AA where the base orange does not.
- **Stamp Tint** (`--stamp-tint`, rgba(208, 74, 2, 0.12)): a chosen person chip, a chosen payment-method segment, the input focus halo, text selection. A wash, never a fill for small text.
- **Stamp Wash** (`--stamp-wash`, #fbeee5): the settled verdict panel on the payer page — the stamp pressed onto the carbon copy.

### Secondary
- **Numbering-Machine Red** (`--serial`, #b0362b): ref codes, the vertical counterfoil serial, machine-issued identity. Never a warning.
- **Carbon Purple** (`--carbon` / `--carbon-tint`, #6b5a86 / #efeaf3): the second ply. The proof queue is a carbon-tinted sheet with a carbon hairline between entries; a duplicate is purple, not red.

### Tertiary — the printed notices
- **Attention Amber** (`--warn` / `--warn-tint` / `--warn-rule`, #7d5400 / #f5eed6 / #d8c48c): work not yet done and the model's doubts — unassigned items, a blurry amount, service-charge uncertainty.
- **Settled Green** (`--ok` / `--ok-tint` / `--ok-rule`, #1e6b46 / #e5efe7 / #aac9b1): all clear and all paid.
- **Form Red** (`--bad` / `--bad-tint` / `--bad-rule`, #a02a1e / #f6e6e2 / #d9aaa1): destruction and failure — delete, mismatch, a network error. Distinct from the serial red, which is identity.

### Neutral
- **Desk Ground** (`--ground`, #e7ebe0): the table the pad sits on — page background, and the fill of the active index tab.
- **Form Sheet** (`--sheet`, #f6f8f1): every list, the letterhead, the tab bar, the commit bar. Opaque, one step lighter than the ground.
- **Counterfoil Shade / Pressed Paper** (`--sheet-2` / `--sheet-3`, #eef1e7 / #e0e5d6): the opened-item editor and a settled row's shade (sheet-2), the tap shade (sheet-3).
- **Document Paper** (`--paper`, #fbfcf7): the nota's and payer page's own ground; painted by those routes rather than inherited.
- **Blank Write-In** (`--write-in`, #fdfef9): the blank a pen fills — inputs, amount boxes, the empty stamp square, QR frames.
- **Hairline Rule / Form Frame** (`--rule` / `--rule-strong`, #c6ccba / #98a18c): the line between two rows (rule), the frame around a sheet, input or amount box (rule-strong).
- **Pre-Printed Ink / Secondary / Faint** (`--ink` / `--ink-2` / `--ink-3`, #1b2f5e / #4a5a7d / #64708c): all text and drawn icons; names and money in full ink, captions in ink-2, faint meta in ink-3.

### Named Rules
**The One-Stamp Rule.** Orange means "this happened" — the stamp and the commit. It never decorates: no orange headings, no orange ornament, no orange money in a ledger.

**The Ledger-Is-Ink Rule.** In the app's ledgers an amount is ink: an outstanding figure is `--ink` at 700, a part-paid remainder the same ink heavier. The only orange on a share row is the stamp square. (The nota's due band is the documents' deliberate exception: the figure the reader must act on sits in `--stamp-deep`, the small-ink weight, beside its Pay control.)

**The Two-Ply Rule.** Carbon purple is a duplicate, never a warning. A warning is amber.

## Typography

**Display Font:** System sans (`-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif`)
**Body Font:** System sans (same stack)
**Label/Mono Font:** System mono (`ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace`)

**Character:** The type does no branding work; it does form work. Labels are small, bold and letter-spaced like pre-printed field names. Money is large, tabular and right-aligned. Monospace is reserved for machine-issued data — ref codes, tokens, account numbers — which is the one thing on the form a typewriter printed.

### Hierarchy
- **Document title** (700, 30px, line-height 1, −0.02em, `--paper` documents): the nota's "Split bill"; documents set their own sizes inside the same two stacks.
- **Page title** (750, 26px / `--text-xl`, −0.02em): the app's screen title; it scrolls away while the letterhead stays.
- **Lead** (700, 19px / `--text-lg`, −0.015em): hero and notice leads.
- **Body** (400, 16px / `--text-base`, line-height 1.4): every row, input and paragraph.
- **Small** (400, 13px / `--text-sm`): captions, meta, helper text, notice bodies.
- **Label** (700, 11px / `--text-xs`, 0.09em, uppercase): pre-printed field and section labels (`.group-title`, `.field-label`); they label paper, they are not shouty kickers.
- **Serial** (mono, 11px, 0.06em): ref codes, pay tokens, account numbers, the counterfoil's vertical serial.
- **Money** (650–700, tabular figures): every amount, always `font-variant-numeric: tabular-nums`, always right-aligned where it forms a column.

### Named Rules
**The No-Webfont Rule.** System sans and system mono only, in the app and in the documents. A webfont is a third-party round trip before the first paint of a page someone is standing in a restaurant waiting for, and the form's character comes from its print, not its face.

**The Money-Never-Wraps Rule.** Every amount carries tabular figures and `white-space: nowrap`. A figure that breaks after "Rp" prints as two numbers, and a column of figures that does not align cannot be added up by eye.

## Layout

App screens live in a **520px column, centred**, at every viewport width; the letterhead and the index tab bar are capped to the same width, so a wide screen gets a centred column of pad rather than a kilometre of ruled line. A screen is a stack of groups 20px apart (`.screen`), a group is a sheet with an 8px gap under its title, and the column's side gutter is 16px (`.group` margin). Rows are at least 44px tall with 10px/14px internal padding, so the whole row can be the tap target.

Two sticky chrome bars, both 2px ink-ruled: the letterhead (`min-height: 56px`, brand mark + DUO) and the index tab bar (`min-height: var(--tab-space)` = 62px plus the bottom safe-area inset). `--tab-space` is the single published measurement of the tab bar so the Review screen's commit bar can stick directly on top of it (`bottom: var(--tab-space)`, z-index 9 against the tab bar's 10) and the two can never overlap. Both bars are `position: sticky`, not fixed — fixed positions against the viewport, and the dev phone frame would lie about the layout.

Documents have widths of their own. The nota is an **830px sheet** (54px/56px padding at wide viewports; at 720px and below the padding tightens and the two-column slips, the masthead and the QR row collapse to one column). The payer page is a **480px (30rem) sheet**. Both are centred and paint their own paper; `body.paper` turns the page behind them to #fbfcf7.

Print is a first-class layout, not an afterthought: the nota and payer page carry no app chrome at all, the Report screen declares a print head that only paper sees, and `@media print` drops the bars and the `.no-print` groups and strips the paper's fills (white ground, black text, sheets transparent, borders #ccc).

### Named Rules
**The Pad-Is-Phone-Width Rule.** App chrome and content never exceed the 520px column; only documents get widths of their own (830px nota, 480px payer page). A wide screen is a wider table around the same pad, never a wider pad.

## Elevation & Depth

Flat by construction. The system has no shadows at rest — the single `box-shadow` in the code is the input focus halo (`0 0 0 3px var(--stamp-tint)`), and the only other depth response is the 2px `:focus-visible` outline. Depth is tonal: ground → sheet → sheet-2 → sheet-3, each step lighter or deeper than its neighbour. Separation is drawn, never cast: a hairline (`--rule`) between two rows, a frame (`--rule-strong`) around a sheet, input or amount box, a 2px solid ink rule where a bar or a document header meets content, and a 3px double ink rule under a ledger total. Tinted notices are opaque paper printed in another ink — never a translucent wash, because a translucent wash over paper is glass, and glass is the thing this world was asked to replace.

### Named Rules
**The Flat-By-Construction Rule.** If something must stand out it gets a rule, a frame, or a deeper sheet. Nothing blurs, nothing floats, nothing is translucent: no `backdrop-filter`, no raised cards, no drop shadows, no alpha fills except `--stamp-tint` as a state wash.

## Shapes

Printed forms are square, so the radius is a press mark, not a capsule: **4px** (`--radius`) on sheets, buttons and inputs, **3px** (`--radius-sm`) on small parts — amount box, stamp square, chips, the lettered stamp, the tab's bottom corners. There are no 999px pills and no circles except the receipt-reading spinner.

The borders carry the world's grammar:
- **1px solid `--rule`**: the hairline between two fields on the same form (inset 14px from the left, so the ruled line starts where the text does).
- **1px solid `--rule-strong`**: the frame around a sheet, an input, the amount box, a proof's QR frame.
- **2px solid `--ink`**: the letterhead's and tab bar's edge, the commit bar's top, and a document's header rule.
- **3px double `--ink`**: the total line under a ledger column.
- **1px dashed `--rule-strong`**: the counterfoil's tear line.
- **1.5px dashed `--ink-3`**: the empty stamp square.
- **1px dotted `--rule-strong`**: the write-in line under an unassigned item's name, and the dotted underline of a tappable group title.

State lives in the silhouette. The 24px stamp square has three: **dashed empty** (1.5px dashed `--ink-3` on write-in paper), **half-pressed partial** (`linear-gradient(180deg, write-in 50%, stamp 50%)` behind a solid stamp border — the stamp is halfway down, the paper stained below the press mark), and **pressed** (solid `--stamp` fill, `--stamp-deep` border). The lettered LUNAS stamp is outlined, letter-spaced, rotated −2°; the brand mark and the saved-form mark wear the same skew (−2°, −3°), and they are the only skew in the world.

Icons are drawn SVG strokes (1.6–2.4 weight), never glyph characters, and the disclosure indicator is two borders rotated into a chevron. State never relies on a coloured side stripe: an unassigned item is a dashed sheet whose name sits on a dotted write-in line, and it says "Belum dibagi" in words.

### Named Rules
**The Press-Mark Radius Rule.** Corners are 4px, or 3px on small parts. Printed forms are square; a capsule or pill is a different world.

**The State-Is-Shape Rule.** Every state is carried by shape and word as well as colour: dashed/filled stamps, a lettered LUNAS, a bordered notice, "Belum dibagi", "kurang Rp …". Reading it in greyscale must still work.

## Components

### Buttons
- **Shape:** 4px radius (`--radius`), 1px border, `min-height: 44px`, 18px side padding, weight 560.
- **Primary (the commit):** solid stamp fill (`--stamp`), `--stamp-deep` border, white label, weight 650. It appears once per screen at the point of commit: Simpan, Ambil foto struk, Bagikan link nota, Upload bukti bayar, Simpan PDF.
- **Tinted (secondary):** sheet fill, stamp border, `--stamp-deep` label, weight 620 — Kembali, Tambah, the export buttons.
- **Plain (text action):** no background, no border, `--stamp-deep` label, 13px, `min-height: 36px`, 10px side padding; destructive variants take `--bad` instead.
- **Press / Focus:** a button goes down under the finger (`transform: translateY(1px)` at 0.12s ease), it does not shrink. Disabled is `opacity: 0.45`. Keyboard focus is the drawn ring: 2px solid `--stamp`, 2px offset, on every ground.
- **Busy:** the label itself changes ("Menyimpan…", "Lagi dicek…") — a spinner replaces the label only on Capture.

### Chips
- **Person chips (`.pick`)**: a name box on the form, not a capsule — 3px radius, 1px `--rule-strong` border, sheet fill, 13px ink label, 36px tall. Chosen takes the stamp tint: `--stamp-tint` fill, `--stamp` border, `--stamp-deep` label. The remove "×" on a roster chip is inline SVG, not a glyph; a `36px` chip is deliberately dense inside a list row.
- **Payment-method segments (`.segment`)**: three options in one row, each a field box at 38px; the chosen one takes the stamp tint and border. A segmented control rather than a select, so the alternatives stay visible.

### Cards / Containers
- **The list sheet (`.list`)**: the form's unit — `--sheet` fill, 1px `--rule-strong` frame, 4px radius, `overflow: hidden`. Rows inside are 44px minimum with 10px/14px padding, separated by the hairline (`.row + .row::before`, inset 14px). A `tappable` row darkens to `--sheet-2` under the finger.
- **Sheet tints**: `.tint-warn` / `.tint-ok` / `.tint-bad` are the same sheet printed in another ink (tint fill + matching rule colour); `.tint-carbon` is the duplicate ply, not a warning. A notice is a tinted sheet with a 18px drawn icon and 13px text in the ink of its family.
- **Group titles (`.group-title`) and field labels (`.field-label`)**: 11px, 700, 0.09em, uppercase, `--ink-2` — pre-printed section and field names; the rare tappable title keeps the group-title look and takes a dotted underline.
- **The value column (`.row-value`)**: a row's right-hand figure — `--ink-2` by default, `.strong` for ink at 650, `.owed` for outstanding money (ink at 700), `.partial` for a part-paid remainder (the same ink, heavier). All tabular, none wrap.
- **The counterfoil stub**: each history bill is a `.stub-card` — 30px of left padding, a 29px column carrying the ref code bottom-up in mono 10px serial red, closed by a 1px dashed tear line. It is hidden from assistive tech because the same code appears in the card's meta row.

### Inputs / Fields
- **Boxed fields** (`input`, `select`): 44px tall, write-in paper, 1px `--rule-strong` frame, 4px radius, 16px ink text; placeholder `--ink-3`. Text inputs never shrink below 16px, so iOS does not zoom the page on focus.
- **Focus:** the border turns `--stamp` and a 3px `--stamp-tint` halo replaces the outline — the only shadow in the system, and it is a state.
- **Field rows** (sign-in, destination, payment settings): the row is the field — a fixed-width label column in 13–16px ink plus a chrome-less input, right-aligned, with no border of its own; focus-within backgrounds the row (`--sheet-2`). This is a settings-form field, not a box inside a box.
- **Money input:** text input with `inputmode="numeric"`, right-aligned tabular figures, an edit buffer so a half-typed number never cascades through the live totals, and a blur that snaps back to canonical formatting (`25.000`).
- **The amount box (`.amount-box`)**: the kwitansi's printed box around a figure that is a decision — write-in paper, 1px `--rule-strong` frame, 3px radius, 3px/9px padding, ink, 700, tabular, never wraps. On the payer page it grows to 32px as the one number that page exists to state.

### Navigation
- **Letterhead**: a sticky sheet bar, 56px minimum, capped at 520px, closed by a 2px ink rule. Left: a 36px stamp-orange square holding "D", rotated −2°, plus DUO / "Split Bill". Right: Keluar as a plain action when signed in.
- **Index tabs**: four flat tabs welded to the bottom edge, `min-height: var(--tab-space)`, 2px ink top rule. Each tab is a 23px drawn icon over a 10px label in `--ink-2`; the active tab is pulled forward — `--ground` fill, `--rule` sides, and a 2px `--stamp` edge across its top. Orange marks the tab; the icon and label stay ink.
- **Commit bar (Review)**: sticks directly on top of the tab bar, same 2px ink top rule, sheet fill, z-index 9. It shows the blockers in `--bad` and carries the one primary button, whose label names the next step ("Bagi 1 item lagi", "Isi rekening tujuan dulu") instead of "Belum bisa disimpan".

### The Stamp Square (signature)
The control that replaces a switch. A 24px square at the leading edge of a share row, so the column of squares can be read in one pass — how many are still empty is the question the screen exists to answer. Tapping the whole row toggles it; it is `aria-pressed`, and the settled row recedes to `--sheet-2` while the stamped square is the only orange on it. Partial is the half-pressed gradient; settled rows also print the lettered mark beside the name.

### The Lettered Stamp (signature)
`.stamp-mark` — "Lunas" in 10px 800, 0.12em tracking, uppercase, outlined 1.5px in `--stamp-deep`, 3px radius, rotated −2°. It sits beside the person's name on a settled line, the way a kwitansi is stamped on its own line. The same device, scaled up to a 60px filled square with a white check, is the saved-bill confirmation on Review; the payer page's verdict uses the outlined version at 20px inside a `--stamp-wash` panel.

### Notices (signature)
A notice is a sheet printed in another ink, opaque, with its family's border: amber for attention and unassigned work, green for all-clear, red for destruction and failure, carbon purple for duplicates. On Review they carry a drawn triangle icon and read at 13px; the flagged-proof queue is the carbon one, with a 1px `--carbon` hairline between entries and "Lihat bukti / Tandai lunas" as plain actions.

### Documents (signature)
The nota and the payer page are the carbon copies. They are light (`--paper`), self-painted, and webfont-free, and the app's chrome does not follow them.
- **The nota sheet**: 830px, letterhead with place and date on the left and "Split bill" with the Bill/Items/Total-paid meta grid on the right, closed by a 2px ink rule. A people ledger with the 3px double ink total line, then one slip per person — name, Pay link against the right edge in `--stamp-deep`, itemised lines, subtotal and charge, and a due band bled to the card's edges on `--sheet-2`. Unsettled due figures are `--stamp-deep` (the figure to act on); settled slips recede to `--ink-2`. The ledger mismatch, when there is one, is said out loud rather than hidden.
- **The payer page**: 480px of paper with the amount box at 32px, the QRIS block on white with a real quiet zone, the destination as a mono detail row, one solid-stamp "Upload bukti bayar" commit plus a quieter camera variant, and notices for mismatch/unclear. It never shows other people or the bill total.

## Do's and Don'ts

### Do:
- **Do** keep `--stamp` for the stamp and the commit only — one primary button per screen, the pressed square, the mark, the focus ring, the tab edge.
- **Do** use `--stamp-deep` for small orange ink; the base `--stamp` is a fill and a border, never small text (4.25:1 on the ground fails AA).
- **Do** keep money in tabular figures, right-aligned, `nowrap`; outstanding figures in ink, part-paid remainders in heavier ink.
- **Do** carry state by shape and word as well as colour: dashed/half/solid stamp square, lettered LUNAS, a bordered notice, "Belum dibagi".
- **Do** keep controls at least 44px tall and make the whole row the target when the row is the control (buttons, inputs, selects, rows).
- **Do** keep documents light, self-painted, and webfont-free; they are read in chats, as screenshots, and on paper.
- **Do** keep labels small, uppercase, and letter-spaced (0.09em) — they are pre-printed on the form, not headlines.
- **Do** keep depth tonal: a rule, a frame, or a deeper sheet.

### Don't:
- **Don't** put orange on a heading, a decoration, or a money figure in a ledger. Orange that is not the stamp or the commit dilutes the one thing it means.
- **Don't** blur, float, or use translucent fills: no `backdrop-filter`, no raised cards, no drop shadows, no alpha washes except `--stamp-tint` as state.
- **Don't** use capsules, 999px radii, or pill chips — corners are 4px (`--radius`) or 3px (`--radius-sm`), because printed forms are square.
- **Don't** use a coloured side stripe as state; a dashed sheet, a dotted write-in line and a word say it without shouting.
- **Don't** use glyph characters as icons; draw SVG strokes (the chip's ×, the chevron, the tab icons, the notice triangle are all drawn).
- **Don't** add webfonts, and don't give the nota or the payer page dark chrome.
- **Don't** replace the stamp square with a switch or a tick-in-a-box; a tick is a checkbox, and a stamp is an event that happened.
- **Don't** let a money figure wrap or break mid-number; each amount is one unbreakable token.
