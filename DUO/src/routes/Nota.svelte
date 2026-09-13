<script lang="ts">
  /**
   * The bill as a document.
   *
   * This replaced a WhatsApp text template that printed every item as a line of
   * prose. That was unreadable in a group chat and impossible to check: five
   * lines of numbers in a proportional font line up with nothing.
   *
   * What this is instead is a nota — the vernacular of the thing it describes.
   * Money in a column, figures in a tabular face, and the arithmetic visible:
   * each person's items, then the charges that are not items, then their total.
   * At the foot, the four totals stack to the bill's.
   *
   * The point is not decoration. The document exists to be argued with, and it
   * only survives that if every number on it can be traced to the one above it.
   *
   * Light, always. The app is dark, but this leaves the app — through a PDF, a
   * print, or a screenshot in a group chat — and a dark document is worse in all
   * three. Colors are set here rather than inherited for that reason.
   */
  import { onMount } from 'svelte'
  import { formatDate, rupiah, rupiahDigits } from '../lib/format'
  import { getExportBill } from '../lib/api'
  import { allocateBill, type PersonBreakdown } from '../lib/export'
  import { buildNotaPdf } from '../lib/pdf'
  import { copyText } from '../lib/clipboard'

  /**
   * Read from the hash rather than threaded through props, the same way the
   * preview route does it. A plain URL also means a reload or a bookmark comes
   * back to the same document, which props would not survive.
   */
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const billId = params.get('id') ?? ''

  let bill = $state<Awaited<ReturnType<typeof getExportBill>> | null>(null)
  let breakdown = $state<PersonBreakdown[]>([])
  let error = $state<string | null>(null)
  let note = $state<string | null>(null)
  let busy = $state(false)

  /**
   * The PDF, built in the page.
   *
   * One tap, straight to the share sheet. The alternative — `window.print()`
   * and its preview — reaches the same place on iOS but through a dialog that
   * has to be dismissed, and does not exist at all on a desktop browser without
   * a print-to-PDF driver.
   *
   * `navigator.canShare` is checked with the actual file rather than by feature
   * detection on `navigator.share` alone: desktop Chrome has share and will
   * reject a file, so asking about the file specifically is the only version of
   * the question that has a useful answer.
   */
  async function sharePdf() {
    if (!bill || busy) return
    busy = true
    note = null

    try {
      const blob = buildNotaPdf(bill, breakdown)
      const file = new File([blob], `nota-${bill.ref_code}.pdf`, { type: 'application/pdf' })

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Nota ${bill.place}` })
        return
      }

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      note = 'HP-nya nggak dukung share langsung, jadi PDF-nya ke-download.'
    } catch (err) {
      // Dismissing the share sheet is not an error, and telling someone their
      // own cancel failed is a small insult.
      if ((err as Error).name !== 'AbortError') error = (err as Error).message
    } finally {
      busy = false
    }
  }

  let summed = $derived(breakdown.reduce((acc, p) => acc + p.total, 0))

  /**
   * The payer's link for one person, or null if they have no token yet.
   *
   * Built from `location` rather than a configured base URL, so it is correct
   * on localhost, on Pages and on the cPanel host without a build-time setting
   * that would have to be right in all three.
   */
  function linkFor(person: string): string | null {
    const token = bill?.shares.find((s) => s.person === person)?.pay_token
    return token ? `${location.origin}${location.pathname}#/bayar?t=${token}` : null
  }

  /**
   * Hand one person their link.
   *
   * Sent one at a time on purpose. The link is the credential that lets someone
   * mark a bill paid, so a copy that reaches the group is a copy that lets
   * anyone mark anyone paid — which is why the PDF never carries them and this
   * is a per-person action rather than a line in a shared document.
   *
   * Three routes, in order of how good they are on a phone, and the third is
   * the one that matters. `navigator.share` opens the share sheet and gets the
   * link to a specific person in two taps; `copyText` puts it on the clipboard
   * where it works everywhere including plain HTTP, which is how this gets
   * tested off a laptop.
   *
   * Both of those can fail or not exist. What that used to do was show an
   * error — `undefined is not an object (evaluating 'navigator.clipboard
   * .writeText')`, on a LAN address, because the whole clipboard API needs a
   * secure context. Which meant there was NO way to get the link at all, on a
   * screen whose only job is handing it out. So a failure now reveals the URL
   * itself, in a field that can be long-pressed and copied by hand. The link is
   * the whole feature; losing it silently is not an option the screen gets.
   */
  let sent = $state<string | null>(null)
  let shown = $state<string | null>(null)

  async function sendLink(person: string) {
    const url = linkFor(person)
    if (!url) return
    sent = null
    shown = null

    try {
      if (navigator.share) {
        await navigator.share({ url, title: `Bayar ${bill?.place ?? ''}` })
        return
      }
    } catch (err) {
      // Dismissing the share sheet is not a failure — the operator decided
      // against it. Anything else, fall through and offer the link another way.
      if ((err as Error).name === 'AbortError') return
    }

    if (await copyText(url)) {
      sent = person
      return
    }

    // Neither worked. Put the link on screen rather than an error message
    // about why it could not be put on the clipboard.
    shown = url
    note = 'Nggak bisa nyalin otomatis — tekan lama link di bawah terus Copy.'
  }

  onMount(async () => {
    if (!billId) {
      error = 'Nggak ada tagihan yang diminta.'
      return
    }
    try {
      bill = await getExportBill(billId)
      breakdown = allocateBill(bill)
    } catch (err) {
      error = (err as Error).message
    }
  })
</script>

<svelte:head>
  <title>{bill ? `Nota ${bill.place}` : 'Nota'}</title>
</svelte:head>

{#if error}
  <p class="msg">{error}</p>
{:else if !bill}
  <p class="msg">Memuat…</p>
{:else}
  <div class="sheet">
    <div class="controls no-print">
      <button class="go" disabled={busy} onclick={sharePdf}>
        {busy ? 'Nyiapin…' : 'Bagikan PDF'}
      </button>
      <button class="back" onclick={() => history.back()}>Kembali</button>
      <p class="hint">
        {#if note}
          {note}
        {:else}
          PDF-nya ke-generate di HP lu, terus share sheet-nya kebuka — pilih
          WhatsApp dan dokumennya nempel sendiri.
        {/if}
      </p>
    </div>

    <header class="head">
      <h1>{bill.place}</h1>
      <p class="meta">
        {formatDate(bill.bill_date)} · <span class="ref">{bill.ref_code}</span>
      </p>
      <p class="grand">
        <span class="cur">Rp</span>
        <span class="fig">{rupiahDigits(bill.total)}</span>
      </p>
    </header>

    <!--
      Each person is a block, not a table row. The document gets read on a phone
      in a group chat where the first thing anyone does is find their own name,
      and a block is something a person can screenshot for themselves.
    -->
    {#each breakdown as person (person.person)}
      <section class="who">
        <div class="who-head">
          <h2>
            {person.person}
            <!--
              A note beside the name, not a different figure in the column.
              The amount stays the person's share of the split, because the
              footer reconciles the column against the bill total — swap it for
              a remainder and the arithmetic on the page stops adding up, which
              is the one thing this document cannot afford. What has been paid
              is a fact about the debt, and the settle-up screen is where the
              debt is tracked.
            -->
            {#if person.status === 'lunas'}
              <span class="paid">sudah bayar</span>
            {:else if person.amount_paid > 0}
              <span class="paid">udah masuk {rupiah(person.amount_paid)}</span>
            {/if}
          </h2>
          <span class="fig strong">{rupiahDigits(person.total)}</span>
        </div>

        <div class="lines">
          {#each person.items as item (item.name)}
            <span class="label">
              {item.name}
              {#if item.shared > 1}<span class="split">dibagi {item.shared}</span>{/if}
            </span>
            <span class="op"></span>
            <span class="fig">{rupiahDigits(item.amount)}</span>
          {/each}

          {#if person.components.length > 0}
            <span class="rule"></span>
            <span class="rule"></span>
            <span class="rule"></span>

            {#each person.components as part (part.label)}
              <span class="label soft">{part.label}</span>
              <span class="op">{part.amount < 0 ? '−' : '+'}</span>
              <span class="fig soft">{rupiahDigits(Math.abs(part.amount))}</span>
            {/each}
          {/if}
        </div>

        <!--
          The payer's own link, under their own block. Hidden in print and
          absent from the PDF, so the document that goes to the group carries
          the arithmetic and none of the credentials.
        -->
        {#if person.status !== 'lunas' && linkFor(person.person)}
          <div class="pay-link no-print">
            <button class="link" onclick={() => sendLink(person.person)}>
              {sent === person.person ? 'Link-nya udah disalin' : 'Kirim link bayar'}
            </button>
          </div>

          {#if shown === linkFor(person.person)}
            <!--
              A textarea, not an input, and that is the whole point: an input
              never wraps, so a 90-character URL is shown with its tail cut off
              — still copyable, but not readable, and this exists to be read.
              readonly rather than disabled, because a disabled field cannot be
              selected and selecting it by hand is why it is here at all.
              `onfocus` takes the lot so one tap then Copy is enough.
            -->
            <textarea
              class="link-url no-print"
              readonly
              rows="3"
              onfocus={(e) => e.currentTarget.select()}
            >{shown}</textarea>
          {/if}
        {/if}
      </section>
    {/each}

    <footer class="foot">
      <div class="check">
        <span>
          {breakdown.length} orang
          {#if summed === bill.total}— cocok dengan total struk{:else}— <strong
              >TIDAK cocok, total struk {rupiah(bill.total)}</strong
            >{/if}
        </span>
        <span class="fig strong">{rupiahDigits(summed)}</span>
      </div>

      {#if bill.account_number}
        <div class="pay">
          <span class="pay-label">Transfer ke</span>
          <span class="pay-value">
            {bill.bank_name} {bill.account_number}{#if bill.account_holder}
              · {bill.account_holder}{/if}
          </span>
        </div>
      {/if}
    </footer>
  </div>
{/if}

<style>
  /*
   * Two families with clearly separate jobs: the system sans for words, a
   * monospace for money. The monospace is not a styling flourish — it is what a
   * till prints, and it is why the column reads as a figure rather than as a
   * sentence that happens to contain digits.
   */
  .sheet {
    --paper: #ffffff;
    --ink: #1c1917;
    --soft: #6b6560;
    --rule: #e3ded8;
    --accent: #d04a02;
    --fig: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;

    max-width: 34rem;
    min-height: 100dvh;
    margin: 0 auto;
    padding: 2.5rem 1.5rem 4rem;
    background: var(--paper);
    color: var(--ink);
    font-size: 14px;
    line-height: 1.5;
  }

  /* ---- controls, never printed ---- */

  .controls {
    margin-bottom: 2.5rem;
  }

  .go {
    width: 100%;
    min-height: 48px;
    border: none;
    border-radius: 12px;
    background: var(--accent);
    color: #fff;
    font: inherit;
    font-weight: 640;
    cursor: pointer;
  }

  .back {
    width: 100%;
    min-height: 44px;
    margin-top: 8px;
    border: 1px solid var(--rule);
    border-radius: 12px;
    background: none;
    color: var(--soft);
    font: inherit;
    cursor: pointer;
  }

  .hint {
    margin: 10px 0 0;
    font-size: 12px;
    color: var(--soft);
  }

  /* ---- head ---- */

  .head {
    padding-bottom: 1.25rem;
    border-bottom: 2px solid var(--ink);
  }

  .head h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .meta {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--soft);
  }

  .ref {
    font-family: var(--fig);
    letter-spacing: -0.01em;
  }

  /* The one place the accent is spent. Everything else is ink on paper. */
  .grand {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 1rem 0 0;
    color: var(--accent);
  }

  .cur {
    font-size: 13px;
    font-weight: 600;
  }

  .grand .fig {
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  /* ---- one person ---- */

  .who {
    padding-top: 1.5rem;
    /* A person's block is the unit that has to survive a page break. Splitting
       someone's items across two pages is how a document stops being checkable. */
    break-inside: avoid;
  }

  .who-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--rule);
  }

  .who-head h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
    letter-spacing: -0.01em;
  }

  .paid {
    margin-left: 8px;
    font-size: 11px;
    font-weight: 500;
    color: var(--soft);
    letter-spacing: 0.02em;
  }

  /*
   * Three columns: label, operator, figure. The middle column exists so the
   * + and − line up on their own axis and the arithmetic can be read straight
   * down the page — which is the one thing this document is for.
   */
  .lines {
    display: grid;
    grid-template-columns: 1fr 0.75rem auto;
    align-items: baseline;
    row-gap: 3px;
    column-gap: 8px;
    padding-top: 8px;
  }

  .label {
    min-width: 0;
    font-size: 13px;
  }

  .label.soft {
    color: var(--soft);
  }

  .split {
    margin-left: 6px;
    font-size: 11px;
    color: var(--soft);
  }

  .op {
    text-align: center;
    font-size: 12px;
    color: var(--soft);
  }

  .fig {
    font-family: var(--fig);
    font-variant-numeric: tabular-nums;
    font-size: 13px;
    text-align: right;
    white-space: nowrap;
  }

  .fig.soft {
    color: var(--soft);
  }

  .fig.strong {
    font-size: 15px;
    font-weight: 600;
  }

  /*
   * The payer's link, set as a footnote to the block rather than as a control
   * in it. Right-aligned under the figure it belongs to, small, and in the
   * accent — the only other place the accent is spent, and both are things you
   * act on rather than read.
   */
  .pay-link {
    display: flex;
    justify-content: flex-end;
    margin-top: 6px;
  }

  .link {
    min-height: 32px;
    padding: 0 8px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 12px;
    font-weight: 550;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 3px;
  }

  .link:active {
    opacity: 0.55;
    transform: none;
  }

  /*
   * The fallback, when neither the share sheet nor the clipboard is available.
   *
   * Monospace and small so a 70-character URL fits the width without wrapping
   * into something that looks broken, and read-only so a tap selects rather
   * than opening the keyboard. It only ever appears after both automatic
   * routes have failed, so it never competes with them.
   */
  .link-url {
    display: block;
    width: 100%;
    margin-top: 6px;
    padding: 8px 10px;
    border: 1px solid var(--accent);
    border-radius: 8px;
    background: #fff;
    color: var(--ink);
    font-family: var(--fig);
    font-size: 11px;
    line-height: 1.5;
    /* Wraps anywhere rather than at word boundaries. A URL has no spaces, so
       the default would push the whole thing onto one overflowing line —
       which is the truncation this replaced. */
    overflow-wrap: anywhere;
    resize: none;
  }

  /* A separator spanning the grid, drawn as a grid row of empty cells. */
  .rule {
    grid-column: 1 / -1;
    height: 1px;
    margin: 4px 0;
    background: var(--rule);
  }

  /* ---- foot ---- */

  .foot {
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 2px solid var(--ink);
  }

  .check {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
    color: var(--soft);
  }

  .pay {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-top: 1rem;
    padding: 12px 14px;
    border: 1px solid var(--rule);
    border-radius: 10px;
  }

  .pay-label {
    font-size: 12px;
    color: var(--soft);
  }

  .pay-value {
    font-family: var(--fig);
    font-size: 14px;
    font-weight: 600;
    text-align: right;
  }

  .msg {
    padding: 3rem 1.5rem;
    text-align: center;
    color: #6b6560;
  }

  /* ---- print ---- */

  @media print {
    @page {
      margin: 14mm;
    }

    .no-print {
      display: none !important;
    }

    /*
     * The measure is kept, not reset to the full page.
     *
     * A4 with 14mm margins is 182mm wide, and this document is a label on the
     * left with a figure on the right. Let it fill the sheet and the eye has to
     * travel most of a hand-span to connect the two — which is exactly the
     * reading problem the column layout exists to solve.
     */
    .sheet {
      max-width: 34rem;
      padding: 0;
      margin: 0 auto;
    }

    /* The accent is cheap to keep — it is one line — but a printed document
       should not depend on it, so the total is already ink-weight as well as
       coloured. */
    .grand {
      color: var(--accent);
      print-color-adjust: exact;
    }
  }
</style>
