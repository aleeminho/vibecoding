<script lang="ts">
  /**
   * The bill as a document.
   *
   * Two renderings of one set of numbers, on purpose. The ledger at the top is
   * the whole bill in one glance — who, how much, and that the rows add up to
   * the printed total. The slips below are the same figures at reading size,
   * one per person, which is what somebody finds their own name in.
   *
   * The arithmetic in both is the same arithmetic: each slip's items sum to its
   * subtotal, subtotal plus the tax line is its total, and the ledger's three
   * money columns sum to the footer. That is not decoration — the document
   * exists to be argued with, and it only survives that if every number can be
   * traced to the one above it. The numbers themselves come from `allocateBill`
   * rather than being recomputed here, so this file cannot disagree with the
   * export about what anybody owes.
   *
   * Light, always. The app is dark, but this arrives as a link pasted into a
   * group chat, and it is read on a phone next to the message that carried it
   * rather than inside the app's own shell. Colours are set here rather than
   * inherited for that reason.
   */
  import { onMount } from 'svelte'
  import { formatDate, rupiah, rupiahDigits } from '../lib/format'
  import { getExportBill, qrisUrl } from '../lib/api'
  import { allocateBill, type PersonBreakdown } from '../lib/export'
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

  /**
   * The message the operator pastes into the group chat.
   *
   * The nota is a link, and this is what carries it: the bill's summary, one
   * line per person with what they owe — and what has already landed — and
   * where to send the money. Composed here rather than handed to the OS share
   * sheet, because the confirmed flow is one tap to copy and a manual paste
   * into the group (PRD §4).
   *
   * `bandLabel` is deliberately not reused: it is written for the document's
   * English slips, and this message is the operator talking to the group in
   * Indonesian.
   */
  function notaMessage(): string {
    if (!bill) return ''

    const lines: string[] = [
      `Nota ${bill.place} — ${formatDate(bill.bill_date)}`,
      `Total ${rupiah(bill.total)}`,
      '',
      'Bagiannya:',
    ]

    for (const p of breakdown) {
      let state = ''
      if (p.is_payer) state = ' — udah dibayar di kasir'
      else if (p.status === 'lunas') state = ' — udah lunas'
      else if (p.amount_paid > 0) {
        state = ` — udah masuk ${rupiah(p.amount_paid)}, sisa ${rupiah(p.total - p.amount_paid)}`
      }
      lines.push(`- ${p.person}: ${rupiah(p.total)}${state}`)
    }

    lines.push('', 'Buka notanya di sini, tiap orang ada tombol Pay di kartunya:', location.href)

    const pay: string[] = []
    if (offersBank(bill)) {
      pay.push(
        `transfer ke ${bill.bank_name} ${bill.account_number}` +
          (bill.account_holder ? ` a.n. ${bill.account_holder}` : ''),
      )
    }
    if (offersQris(bill)) pay.push('atau scan QRIS di halaman bayarnya')
    if (pay.length > 0) lines.push('', `Bayarnya: ${pay.join(', ')}.`)

    lines.push('', 'Upload bukti transfernya di halaman itu ya — nanti dicek otomatis.')

    return lines.join('\n')
  }

  /**
   * One tap: the whole message on the clipboard, ready to paste. No share
   * sheet — the operator's path is copy then paste into the group, and a share
   * sheet would only add a second, different path to the same place.
   */
  async function copyNota() {
    note = null
    note = (await copyText(notaMessage()))
      ? 'Teks buat WA-nya udah disalin. Tinggal paste di grupnya.'
      : 'Nggak bisa nyalin otomatis. Coba pencet sekali lagi.'
  }

  let summed = $derived(breakdown.reduce((acc, p) => acc + p.total, 0))
  let owing = $derived(breakdown.filter((p) => !p.is_payer && p.status !== 'lunas').length)

  /**
   * Whether this bill offers its QRIS code, seen from the document's side.
   *
   * Two facts, both required: the operator chose to offer it, and there is a
   * code to offer. A method set to qris with nothing uploaded is a real state —
   * the bills screen names it out loud — and it is not one the document should
   * paper over by printing a transfer the operator turned off.
   */
  const offersQris = (b: NonNullable<typeof bill>) =>
    Boolean(b.qris_path) && b.payment_method !== 'bank'

  const offersBank = (b: NonNullable<typeof bill>) =>
    Boolean(b.account_number) && b.payment_method !== 'qris'

  /**
   * What a person's items come to before tax and service.
   *
   * Derived by subtraction the same way `allocateBill` derives `extra`, so the
   * two are the same arithmetic read in opposite directions — the slip shows
   * subtotal and the charge that turns it into the total, and the two have to
   * meet exactly at `person.total`.
   */
  const subtotalOf = (p: PersonBreakdown) => p.total - p.extra

  /**
   * The line between subtotal and total, named for what it actually does.
   *
   * The bill's charges are five separate things — discount, tax, service,
   * rounding and a residual adjustment — and they are shown here as one net
   * figure, which is the shape a slip wants. But a discount makes that net
   * negative, and calling a negative figure "PPN & service" would be the
   * document lying about the largest number on it.
   */
  const chargeLabel = (p: PersonBreakdown) => (p.extra < 0 ? 'Discount' : 'Tax + service')

  /**
   * The same figure with its sign, for the ledger.
   *
   * `rupiahDigits` returns an absolute value, which is right on a slip: the
   * label above the number already says which way it goes, and "Diskon 4.860"
   * is how a receipt prints it. A column is different — a column is read by
   * adding it up, and the footer is the sum of these cells, so a row that
   * subtracts has to look like it subtracts.
   */
  const signed = (amount: number) => (amount < 0 ? `−${rupiahDigits(amount)}` : rupiahDigits(amount))

  /**
   * What the middle column is called, which depends on what is in it.
   *
   * One line was asked for where the bill's five charges used to be, but a
   * discount makes that line negative, and a column headed "PPN & service"
   * holding a discount is the table saying something untrue about the money.
   */
  let chargeHeader = $derived(
    breakdown.some((p) => p.extra < 0) ? 'Tax, service & discount' : 'Tax + service',
  )

  /**
   * Who a share is owed to, said as a sentence rather than as a state.
   *
   * Three different facts that all look like "settled" from a distance. The
   * payer's share was never a debt — they are in the split because their dinner
   * is part of the bill — so they get the one phrasing that does not raise the
   * question "paid whom?".
   */
  function bandLabel(p: PersonBreakdown): string {
    if (p.is_payer) return 'Their share, already covered'
    if (p.status === 'lunas') return 'Paid'
    // What is left, not what has landed. The band is where somebody looks for
    // the number to transfer, and "100.000 in" beside a figure of 127.050
    // leaves them to do the subtraction on a payment screen.
    if (p.amount_paid > 0) return `Rp ${rupiahDigits(p.total - p.amount_paid)} left`
    return bill?.paid_by_person ? `Owes ${bill.paid_by_person}` : 'Their share'
  }

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
   * The link for one person, or null when they should not have one.
   *
   * Three conditions and all three matter: the payer's share was never a debt,
   * a settled share must not be handed a way to pay twice, and a share with no
   * token has no link to give.
   */
  function linkOf(p: PersonBreakdown): string | null {
    if (p.is_payer || p.status === 'lunas') return null
    return linkFor(p.person)
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
  <!--
    No webfonts here, and that is a decision rather than an omission. This
    document's character comes from the form it is: pre-printed labels, ruled
    detail rows, a serial number, an amount box. A display face would add a
    third-party round trip before the first paint of a document somebody is
    standing in a restaurant waiting for, and change nothing about the form.
  -->
</svelte:head>

{#if error}
  <p class="msg">{error}</p>
{:else if !bill}
  <p class="msg">Memuat…</p>
{:else}
  <div class="screen">
    <div class="controls">
      <button class="go" onclick={copyNota}>Copy teks buat WA</button>
      <button class="back" onclick={() => history.back()}>Kembali</button>
      <p class="hint">
        {#if note}
          {note}
        {:else}
          Pencet tombolnya, terus paste teksnya di grup WA. Tiap orang buka
          notanya sendiri dan pencet tombol <strong>Pay</strong> di kartunya —
          langsung masuk halaman bayarnya.
        {/if}
      </p>
    </div>

    <main class="sheet">
      <header class="masthead">
        <div class="brand">
          <p class="brand__mark">{bill.place}</p>
          <p class="brand__sub">{formatDate(bill.bill_date)}</p>
          {#if bill.paid_by_person}
            <address class="brand__addr">Bill paid by {bill.paid_by_person}</address>
          {/if}
        </div>

        <div class="doc">
          <h1 class="doc__title">Split bill</h1>
          <dl class="doc__meta">
            <dt>Bill</dt>
            <dd class="serial">{bill.ref_code}</dd>
            <dt>Items</dt>
            <dd>{bill.items.length}</dd>
            <dt>Total paid</dt>
            <dd>Rp {rupiahDigits(bill.total)}</dd>
          </dl>
        </div>
      </header>

      <section class="block">
        <h2 class="section-label">Everyone's share</h2>
        <p class="section-note">
          One row per person, tax and service already in. The rows add up to the
          bill exactly — the itemised version of each is below.
        </p>

        <div class="ledger-wrap">
          <table class="ledger ledger--people">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col" class="num">Subtotal</th>
                <th scope="col" class="num">{chargeHeader}</th>
                <th scope="col" class="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {#each breakdown as person (person.person)}
                <tr class:row--settled={person.is_payer}>
                  <th scope="row">
                    <span class="item__name">{person.person}</span>
                    <!--
                      The state belongs beside the name, where the eye is
                      already looking for it, and the band below stays about
                      what to do. Same split as the original document: a note
                      here, the amount in the column.
                    -->
                    {#if person.is_payer}
                      <span class="item__note">Paid the bill</span>
                    {:else if person.status === 'lunas'}
                      <span class="item__note">Paid</span>
                    {:else if person.amount_paid > 0}
                      <span class="item__note">{rupiah(person.amount_paid)} in</span>
                    {/if}
                  </th>
                  <td class="num">{rupiahDigits(subtotalOf(person))}</td>
                  <td class="num">{signed(person.extra)}</td>
                  <td class="num">{rupiahDigits(person.total)}</td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">The bill</th>
                <td class="num">
                  {rupiahDigits(breakdown.reduce((a, p) => a + subtotalOf(p), 0))}
                </td>
                <td class="num">{signed(breakdown.reduce((a, p) => a + p.extra, 0))}</td>
                <td class="num">{rupiahDigits(summed)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!--
          The reconciliation, said out loud only when it fails. A row of
          reassurance on every nota is a row nobody reads, and the one time it
          matters is the one time it would have been skimmed.
        -->
        {#if summed !== bill.total}
          <p class="attention">
            Barisnya berjumlah {rupiah(summed)}, nggak cocok sama total struk
            {rupiah(bill.total)}.
          </p>
        {/if}
      </section>

      <section class="block">
        <h2 class="section-label">Who owes what</h2>

        <div class="slips">
          {#each breakdown as person (person.person)}
            <!--
              The quiet band means nothing to do here, which is true of a
              settled share as much as of the payer's. Leaving a paid share in
              the accent would read as still owed, and the accent only works
              while it means one thing.
            -->
            <article
              class="slip"
              class:slip--settled={person.is_payer || person.status === 'lunas'}
            >
              <!--
                Beside the name, because the link is that person's.

                A real destination, and that is what the link replaced the PDF
                for: the browser's print pipeline drops link annotations, so in
                a printed document this was a word that looked tappable and was
                not — inside a document about money.

                Everyone's button is on the page and they all travel together,
                which is the trade-off the operator made when the links went
                into the document. The amount check at the other end is what
                catches a mis-tap.
              -->
              <div class="slip__head">
                <h3 class="slip__name">{person.person}</h3>
                {#if linkOf(person)}
                  <a class="slip__pay" href={linkOf(person)}>Pay</a>
                {/if}
              </div>

              <ul class="slip__lines">
                {#each person.items as item (item.name)}
                  <li class="slip__line">
                    <span>
                      {item.name}
                      {#if item.shared > 1}<em class="frac">1/{item.shared}</em>{/if}
                    </span>
                    <span class="num">{rupiahDigits(item.amount)}</span>
                  </li>
                {/each}
              </ul>

              <dl class="slip__sub">
                <dt>Subtotal</dt>
                <dd class="num">{rupiahDigits(subtotalOf(person))}</dd>
                {#if person.extra !== 0}
                  <dt>{chargeLabel(person)}</dt>
                  <dd class="num">{rupiahDigits(person.extra)}</dd>
                {/if}
              </dl>

              <div class="slip__due">
                <p class="slip__due-row">
                  <span class="slip__due-label">{bandLabel(person)}</span>
                  <span class="slip__amount num">
                    <span class="cur">Rp</span>{rupiahDigits(person.total)}
                  </span>
                </p>

              </div>
            </article>
          {/each}
        </div>
      </section>

      {#if offersQris(bill) || offersBank(bill)}
        <section class="block pay">
          <h2 class="section-label">How to pay</h2>
          <div class="pay__row">
            {#if offersQris(bill)}
              <img class="pay__qr" src={qrisUrl(bill.qris_path!)} alt="Kode QRIS tagihan ini" />
            {/if}
            <div class="pay__body">
              {#if offersQris(bill)}
                <p class="pay__lead">Scan with any QRIS app</p>
                <p class="pay__line">
                  GoPay, OVO, DANA, ShopeePay, or your mobile banking. Enter your
                  own total — the code is not amount-locked.
                </p>
              {/if}
              {#if offersBank(bill)}
                <p class="pay__lead">{offersQris(bill) ? 'Prefer a transfer?' : 'Transfer'}</p>
                <p class="pay__line">
                  {bill.bank_name} {bill.account_number}{#if bill.account_holder}, a.n. {bill
                      .account_holder}{/if}
                </p>
              {/if}
              <p class="pay__line">Quote the bill number {bill.ref_code} either way.</p>
            </div>
          </div>
        </section>
      {/if}

      <footer class="colophon">
        <p>
          {#if owing === 0}
            Everyone has paid. The table's square.
          {:else if bill.paid_by_person}
            {owing}
            {owing === 1 ? 'payment' : 'payments'} to {bill.paid_by_person} and the table's square.
          {:else}
            {owing} of {breakdown.length} still to pay.
          {/if}
        </p>
        <p class="colophon__fine">Amounts in Indonesian rupiah.</p>
      </footer>
    </main>
  </div>
{/if}

<style>
  /*
   * The sheet, not the screen. Same world as the app — the pad's form — with
   * one difference: this document leaves the app and has to stand on its own,
   * so it is printed in full rather than at phone density.
   *
   * Flat by construction: opaque paper, ruled lines, one orange stamp ink.
   */
  .screen {
    min-height: 100dvh;
    background: var(--ground, #f0f0ee);
  }

  .sheet {
    --paper: #fffefa;
    --rule-soft: #f7f7f5;
    --accent: #d04a02;
    --accent-deep: #9e3802;
    --accent-wash: #fdf1ea;

    /*
     * The app's own palette, not an import: the document and the app agree on
     * what the form looks like without either owning the other's classes.
     */
    --sans: var(--font, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);

    max-width: 830px;
    margin: 0 auto;
    padding: 54px 56px 44px;
    background: var(--paper);
    color: var(--ink, #14161c);
    border-left: 1px solid var(--rule, #e4e4e1);
    border-right: 1px solid var(--rule, #e4e4e1);
    font: 400 15px/1.55 var(--sans);
    -webkit-font-smoothing: antialiased;
  }

  /* Every figure on this page is money or a count. Align it. */
  .num {
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }

  /* ---- controls, outside the sheet ---- */

  .controls {
    max-width: 830px;
    margin: 0 auto 14px;
    padding: 0 16px;
  }

  .controls .go,
  .controls .back {
    width: 100%;
    min-height: 48px;
    font: inherit;
    font-weight: 650;
    border-radius: var(--radius, 4px);
    cursor: pointer;
  }

  .go {
    border: 1px solid var(--stamp, #d04a02);
    background: var(--stamp, #d04a02);
    color: #fff;
  }

  .back {
    margin-top: 8px;
    border: 1px solid var(--rule);
    background: var(--paper);
    color: var(--ink-2);
    min-height: 44px;
    font-weight: 600;
  }

  .hint {
    margin: 10px 0 0;
    font-size: 12px;
    color: var(--ink-2);
  }

  /* ---- masthead ---- */

  .masthead {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 40px;
    padding-bottom: 34px;
    /* The letterhead rule, same 2px ink the app's header wears. */
    border-bottom: 2px solid var(--ink);
  }

  .brand__mark {
    margin: 0;
    font: 700 23px/1.1 var(--sans);
    letter-spacing: -0.015em;
  }

  .brand__sub {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--ink-2);
  }

  .brand__addr {
    margin-top: 18px;
    font-size: 13px;
    line-height: 1.65;
    font-style: normal;
    color: var(--ink-2);
  }

  .doc {
    flex: none;
    text-align: right;
  }

  .doc__title {
    margin: 0 0 14px;
    font: 700 30px/1 var(--sans);
    letter-spacing: -0.02em;
  }

  .doc__meta {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 5px 20px;
    margin: 0;
    font-size: 13px;
  }

  .doc__meta dt {
    color: var(--ink-2);
  }

  .doc__meta dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  /* ---- sections ---- */

  .block {
    margin-top: 44px;
  }

  .section-label {
    margin: 0 0 16px;
    font: 500 12px/1 var(--sans);
    color: var(--ink-3);
  }

  .section-note {
    margin: -8px 0 20px;
    max-width: 52ch;
    font-size: 13px;
    line-height: 1.6;
    color: var(--ink-2);
  }

  .attention {
    margin: 14px 0 0;
    font-size: 13px;
    color: var(--stamp-deep, #9e3802);
  }

  /* ---- the ledger ---- */

  /*
   * The table in a card, which is what the rest of the document is made of.
   *
   * `overflow: hidden` is doing two jobs: it rounds the wash footer off at the
   * bottom instead of squaring it over the corners, and it stops the table
   * escaping the border it now sits inside.
   *
   * No padding here. The room inside the card comes from the first and last
   * cells instead, because the header's rule and the footer's wash have to run
   * the full width of the card — inset them and the card reads as a box with a
   * smaller box inside it rather than as a table.
   */
  .ledger-wrap {
    border: 1px solid var(--rule);
    border-radius: var(--radius, 4px);
    overflow: hidden;
  }

  /*
   * Padding is what keeps a card from looking like a grid someone drew a line
   * around. The first and last cells carry it so the fill and the rules still
   * reach the edges; the asymmetry is not one — the figures are right-aligned,
   * so their column needs the same slack on its far side that the names need
   * on theirs.
   */
  .ledger th:first-child,
  .ledger td:first-child {
    padding-left: 24px;
  }

  .ledger th:last-child,
  .ledger td:last-child {
    padding-right: 24px;
  }

  /*
   * The headings need the same gap their columns have, or at phone width
   * "Subtotal" and "Tax + service" run together and read as one word — the
   * figures underneath were never touching, because the cells carry this and
   * the headings did not.
   */
  .ledger thead th.num {
    padding-left: 24px;
  }

  .ledger {
    width: 100%;
    border-collapse: collapse;
  }

  .ledger thead th {
    /* Down from the card's top edge, which nothing else provides now that the
       wrapper has no padding of its own. */
    padding: 20px 0 10px;
    font: 700 12px/1 var(--sans);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-3);
    text-align: left;
    border-bottom: 2px solid var(--ink);
  }

  .ledger tbody th,
  .ledger tbody td {
    padding: 15px 0;
    border-bottom: 1px solid var(--rule-soft);
    vertical-align: top;
    font-weight: 400;
    text-align: left;
  }

  .ledger tbody td {
    font-size: 14px;
  }

  /* Two classes deep on purpose: the rules above are also one-class-plus-tag
     and would otherwise win, leaving every figure under the wrong heading. */
  .ledger thead th.num,
  .ledger tbody td.num,
  .ledger tfoot td.num {
    text-align: right;
  }

  .ledger tbody td.num {
    padding-left: 24px;
  }

  .item__name {
    display: block;
    font-weight: 500;
    font-size: 15px;
  }

  .item__note {
    display: block;
    margin-top: 3px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink-2);
  }

  /* The total: the form's double rule under the column, and the counterfoil
     shade behind it. */
  .ledger--people tfoot th,
  .ledger--people tfoot td {
    padding: 17px 0;
    font-size: 14px;
    font-weight: 700;
    text-align: left;
    border-top: 3px double var(--ink);
    background: var(--rule-soft);
  }

  .ledger--people tfoot th {
    color: var(--ink);
  }

  .ledger--people tfoot td {
    color: var(--ink);
  }

  /* The payer's row states a fact, not a debt. */
  .ledger--people .row--settled th,
  .ledger--people .row--settled td {
    color: var(--ink-2);
  }

  /* ---- the slips ---- */

  .slips {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }

  /* Column layout so the due band can be pinned to the bottom: cards in a row
     are stretched to equal height, and a slip with fewer lines would otherwise
     float its band up and leave dead space under it. */
  .slip {
    display: flex;
    flex-direction: column;
    padding: 15px 14px 0;
    border: 1px solid var(--rule);
    border-radius: var(--radius, 4px);
  }

  /* The name and its button on one line, the button against the right edge. */
  .slip__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 11px;
  }

  .slip__name {
    margin: 0;
    font: 600 16px/1.2 var(--sans);
  }

  .slip__lines {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /*
   * Name left, figure right, and nothing between them. The dotted leader that
   * used to run across was the reference document's, and it was dropped: on a
   * card this narrow the rule was doing the work the gap already does, and it
   * made every line look like a table row in a document that is not one.
   */
  .slip__line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    padding: 4px 0;
    font-size: 13px;
  }

  .slip__line .num {
    font-size: 13px;
  }

  /* Shared lines carry no styling of their own — the fraction is the only
     marker, so every amount on a slip reads with equal weight. */
  .frac {
    font-style: normal;
    font-size: 11px;
    color: var(--ink-2);
  }

  /*
   * Anchored to the bottom of the card, which is what makes two cards in a row
   * line up.
   *
   * Cards in a grid are stretched to the tallest, and the due band was already
   * pinned down — so the totals matched and everything above them did not. A
   * card with three items put its Subtotal a line lower than the card beside it
   * with two, which reads as two tables that disagree rather than as one
   * document. `margin-top: auto` pushes this block and everything under it to
   * the foot, so Subtotal, the charge line and the band are all on the same
   * rows across the row.
   */
  .slip__sub {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 3px 12px;
    margin: auto 0 13px;
    padding-top: 9px;
    border-top: 1px solid var(--rule-soft);
    font-size: 13px;
  }

  .slip__sub dt {
    color: var(--ink-2);
  }

  .slip__sub dd {
    margin: 0;
  }

  /* The band bleeds past the slip's padding to meet its border. */
  .slip__due {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: auto -14px 0;
    padding: 11px 14px 12px;
    border-top: 2px solid var(--ink);
    border-radius: 0 0 3px 3px;
    background: var(--rule-soft);
  }

  .slip__due-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    margin: 0;
  }

  .slip__due-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--ink-2);
  }

  .slip__amount {
    font: 700 21px/1 var(--sans);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    color: var(--accent-deep);
  }

  .cur {
    margin-right: 3px;
    font: 500 12px/1 var(--sans);
    color: var(--ink-2);
  }

  /* The payer paid the bill — their slip states a fact, not a debt. */
  .slip--settled .slip__due {
    border-top-color: var(--ink-3);
    background: var(--rule-soft);
  }

  .slip--settled .slip__due-label {
    color: var(--ink-2);
  }

  .slip--settled .slip__amount,
  .slip--settled .cur {
    color: var(--ink-2);
  }

  /*
   * The one control on this page. It carries the person's own link — the
   * credential that lets them mark their share paid — and it opens it, because
   * the reader of this page is whoever the operator sent it to.
   *
   * Against the right edge of the card rather than after the name, so that the
   * buttons line up down a column — a name-length-dependent position would put
   * every button somewhere different.
   */
  .slip__pay {
    flex: none;
    padding: 3px 11px;
    border: 1.5px solid var(--stamp, #d04a02);
    border-radius: var(--radius-sm, 3px);
    font: 650 12px/1.5 var(--sans);
    color: var(--stamp-deep, #9e3802);
    text-decoration: none;
    cursor: pointer;
  }

  /* ---- how to pay ---- */

  .pay__row {
    display: flex;
    align-items: flex-start;
    gap: 26px;
  }

  /*
   * Padding is extra quiet zone on top of the code's own, and the height is the
   * image's own too.
   *
   * Forcing a square squashed whatever did not happen to be one — a QR that is
   * taller than it is wide came out stretched, and a stretched QR is one a
   * scanner may refuse. `height: auto` lets the code keep the shape it was
   * photographed in, which is the shape it was made in.
   */
  .pay__qr {
    flex: none;
    width: 148px;
    height: auto;
    padding: 10px;
    border: 1px solid var(--rule);
    border-radius: 6px;
    background: var(--paper);
  }

  .pay__body {
    max-width: 48ch;
  }

  .pay__lead {
    margin: 0 0 8px;
    font: 600 16px/1.3 var(--sans);
  }

  .pay__line {
    margin: 0 0 7px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--ink-2);
  }

  /* ---- colophon ---- */

  .colophon {
    margin-top: 48px;
    padding-top: 22px;
    border-top: 1px solid var(--rule);
  }

  .colophon p {
    margin: 0;
    font: 600 15px/1.4 var(--sans);
  }

  .colophon__fine {
    margin-top: 7px !important;
    font: 400 12px/1.6 var(--sans) !important;
    color: var(--ink-3);
  }

  .msg {
    padding: 3rem 1.5rem;
    text-align: center;
    color: var(--ink-2, #565b66);
  }

  /* ---- narrow screens ---- */

  @media (max-width: 720px) {
    .sheet {
      padding: 34px 26px 32px;
    }

    .masthead {
      flex-direction: column;
      gap: 26px;
      padding-bottom: 26px;
    }

    .doc {
      text-align: left;
    }

    .doc__meta {
      grid-template-columns: auto 1fr;
      gap: 5px 16px;
    }

    .doc__meta dd {
      text-align: right;
    }

    .slips {
      grid-template-columns: 1fr;
    }

    .pay__row {
      flex-direction: column;
      gap: 18px;
    }

    /*
     * The headers may wrap; the figures still may not.
     *
     * At phone width the four columns fit, but not with "PPN & service" held
     * on one line — it ran into "Subtotal" and the two read as one word. The
     * money columns cannot wrap or a figure splits across lines, but a heading
     * breaking in two costs nothing.
     */
    .ledger thead th.num {
      white-space: normal;
    }

    /* Everything the card holds comes in a notch, so the four columns still
       fit a phone without the headings colliding. */
    .ledger th:first-child,
    .ledger td:first-child {
      padding-left: 14px;
    }

    .ledger th:last-child,
    .ledger td:last-child {
      padding-right: 14px;
    }

    .ledger thead th.num,
    .ledger tbody td.num {
      padding-left: 12px;
    }
  }

</style>
