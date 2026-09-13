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
   * Light, always. The app is dark, but this leaves the app — through a PDF, a
   * print, or a screenshot in a group chat — and a dark document is worse in
   * all three. Colours are set here rather than inherited for that reason.
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
   * The PDF is this page, printed.
   *
   * It used to be drawn by a PDF writer in `pdf.ts`, one primitive at a time,
   * and the result was a document that shared the design's structure and none
   * of its type: one face embedded where the design uses two, no leaders,
   * square cards, one column. Reimplementing a layout engine to approximate a
   * page the browser can already render exactly is a bad trade, and it was the
   * approximation that showed.
   *
   * The cost is the tap: this opens the print sheet, where the document is
   * saved or shared from. That is two or three taps where the writer was one,
   * and it is worth it — the thing being sent is the thing that was designed.
   */
  function printNota() {
    window.print()
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

  /**
   * Hand one person their link.
   *
   * The PDF carries these too, for the one-tap case. This is for sending one
   * link to one person without the whole group seeing it — the link is the
   * credential that lets somebody mark a share paid, so the two routes trade
   * convenience against who ends up holding a copy.
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
  <!--
    The document's own two families, loaded here rather than app-wide: nothing
    outside this route and the payer page uses them, and a font request on the
    bills screen would be paid on every visit to a screen that does not want it.

    Plex Sans for words, Plex Serif for the figures that carry the document —
    the title, the totals, the amount each person owes. The serif is not
    decoration: it is what makes a number read as a stated amount rather than as
    a value inside a sentence.

    `display=swap` so a slow font never holds up a document somebody is standing
    in a restaurant waiting for, and the stack falls back to the system serif
    and sans if the request never lands at all.
  -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@400;600&display=swap"
  />
</svelte:head>

{#if error}
  <p class="msg">{error}</p>
{:else if !bill}
  <p class="msg">Memuat…</p>
{:else}
  <div class="screen">
    <div class="controls no-print">
      <button class="go" onclick={printNota}>Print / simpan PDF</button>
      <button class="back" onclick={() => history.back()}>Kembali</button>
      <p class="hint">
        {#if note}
          {note}
        {:else}
          Di layar print, pilih <strong>Simpan sebagai PDF</strong> — di iPhone
          tombol Share di situ bisa langsung ke WhatsApp. Link bayarnya dikirim
          satu-satu: tap <strong>link bayar</strong> di samping nama, dan
          WhatsApp-nya kebuka.
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
            <dd>{bill.ref_code}</dd>
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
          <p class="warn">
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

                An anchor rather than a button so that long-press offers the
                address and so the screen still works if the handler does not,
                but the click is intercepted: here the reader is the operator,
                and what they want is the link sent to somebody rather than
                opened by themselves.

                `no-print`, and that is not a style choice. The browser's print
                pipeline drops link annotations — a bare `<a href>` on a blank
                page comes out of it with no /URI at all — so a printed "link
                bayar" would be a word that looks tappable and is not, in a
                document about money. The links travel the way they did before
                the PDF carried them: one message each, from this screen.
              -->
              <h3 class="slip__name">
                {person.person}
                {#if linkOf(person)}
                  <a
                    class="slip__pay no-print"
                    href={linkOf(person)}
                    onclick={(e) => {
                      e.preventDefault()
                      sendLink(person.person)
                    }}>{sent === person.person ? 'link copied' : 'link bayar'}</a
                  >
                {/if}
              </h3>

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

                <!--
                  The last resort, when neither the share sheet nor the
                  clipboard works. Never printed: it is the operator's copy of
                  a URL, not part of the document.
                -->
                {#if shown && shown === linkOf(person)}
                  <!--
                    A textarea, not an input, and that is the whole point: an
                    input never wraps, so a 90-character URL is shown with its
                    tail cut off — still copyable, but not readable, and this
                    exists to be read. readonly rather than disabled, because a
                    disabled field cannot be selected and selecting it by hand
                    is why it is here at all. `onfocus` takes the lot so one tap
                    then Copy is enough.
                  -->
                  <textarea
                    class="slip__url no-print"
                    readonly
                    rows="3"
                    onfocus={(e) => e.currentTarget.select()}
                  >{shown}</textarea>
                {/if}
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
   * The sheet, not the screen. Two families with separate jobs: the system sans
   * for words, and a serif for the figures that state an amount. Everything
   * else here is structure — rules, a wash, and one accent spent twice.
   *
   * Flat by construction: opaque surfaces, hairline borders, no blur and no
   * translucency anywhere. The one shadow is on the sheet itself, and it exists
   * to lift paper off a desk, which is a thing paper does.
   */
  .screen {
    min-height: 100dvh;
    background: var(--desk, #eceef1);
  }

  .sheet {
    --paper: #ffffff;
    --ink: #14171c;
    --ink-2: #5a616e;
    --ink-3: #868d99;
    --rule: #dce0e6;
    --rule-soft: #eef0f3;
    --accent: #d04a02;
    --accent-deep: #a83b00;
    --accent-wash: #fdf2ea;

    /* The app's own orange already, so the document and the app agree on what
       the brand colour is without either importing the other. */
    --sans: 'IBM Plex Sans', ui-sans-serif, system-ui, 'Segoe UI', sans-serif;
    --serif: 'IBM Plex Serif', ui-serif, Georgia, serif;

    max-width: 830px;
    margin: 0 auto;
    padding: 58px 60px 46px;
    background: var(--paper);
    color: var(--ink);
    font: 400 15px/1.55 var(--sans);
    -webkit-font-smoothing: antialiased;
    box-shadow:
      0 1px 2px rgba(20, 23, 28, 0.06),
      0 12px 32px rgba(20, 23, 28, 0.09);
  }

  /* Every figure on this page is money or a count. Align it. */
  .num {
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
  }

  /* ---- controls, never printed ---- */

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
    font-weight: 600;
    border-radius: 8px;
    cursor: pointer;
  }

  .go {
    border: 1px solid var(--brand, #d04a02);
    background: var(--brand, #d04a02);
    color: #fff;
  }

  .back {
    margin-top: 8px;
    border: 1px solid #dce0e6;
    background: none;
    color: #5a616e;
    min-height: 44px;
    font-weight: 500;
  }

  .hint {
    margin: 10px 0 0;
    font-size: 12px;
    color: #c8ccd4;
  }

  /* ---- masthead ---- */

  .masthead {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 40px;
    padding-bottom: 34px;
    border-bottom: 3px solid var(--accent);
  }

  .brand__mark {
    margin: 0;
    font: 600 23px/1.1 var(--serif);
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
    font: 400 30px/1 var(--serif);
    letter-spacing: -0.01em;
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

  .warn {
    margin: 14px 0 0;
    font-size: 13px;
    color: var(--accent-deep);
  }

  /* ---- the ledger ---- */

  .ledger-wrap {
    overflow-x: auto;
  }

  .ledger {
    width: 100%;
    border-collapse: collapse;
  }

  .ledger thead th {
    padding: 0 0 9px;
    font: 500 12px/1 var(--sans);
    color: var(--ink-3);
    text-align: left;
    border-bottom: 2px solid var(--accent);
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

  .ledger--people tfoot th,
  .ledger--people tfoot td {
    padding: 15px 0;
    font-size: 14px;
    font-weight: 600;
    text-align: left;
    border-top: 3px solid var(--accent);
    background: var(--accent-wash);
  }

  .ledger--people tfoot th {
    color: var(--accent-deep);
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
    border-radius: 6px;
  }

  .slip__name {
    margin: 0 0 11px;
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
    border-top: 3px solid var(--accent);
    border-radius: 0 0 5px 5px;
    background: var(--accent-wash);
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
    font-weight: 500;
    color: var(--accent-deep);
  }

  .slip__amount {
    font: 600 21px/1 var(--serif);
    letter-spacing: -0.02em;
    color: var(--accent);
  }

  .cur {
    margin-right: 3px;
    font: 400 12px/1 var(--sans);
    color: var(--accent-deep);
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
   * Beside the name, quiet and underlined, and never printed.
   *
   * Not a button and not bold, because on screen it is an address the operator
   * hands out rather than a control in an app. Weight is what a heading does;
   * this is not a heading.
   */
  .slip__pay {
    margin-left: 8px;
    font: 400 12px/1.4 var(--sans);
    color: var(--accent-deep);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  /* Monospace and small so a 90-character URL fits the width without wrapping
     into something that looks broken, and read-only so a tap selects rather
     than opening the keyboard. It only ever appears after both automatic
     routes failed, so it never competes with them. */
  .slip__url {
    display: block;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--accent);
    border-radius: 8px;
    background: var(--paper);
    color: var(--ink);
    font: 400 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    overflow-wrap: anywhere;
    resize: none;
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
    font: 400 15px/1.4 var(--serif);
  }

  .colophon__fine {
    margin-top: 7px !important;
    font: 400 12px/1.6 var(--sans) !important;
    color: var(--ink-3);
  }

  .msg {
    padding: 3rem 1.5rem;
    text-align: center;
    color: #6b6560;
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

    .ledger tbody td.num {
      padding-left: 12px;
    }
  }

  /* ---- print ---- */

  @media print {
    @page {
      size: A4;
      margin: 14mm;
    }

    .no-print {
      display: none !important;
    }

    /*
     * Everything behind the sheet is painted white rather than left alone.
     *
     * The app's own shell is dark and it prints, and it showed as a hairline
     * around the document wherever the two boxes did not quite meet — a line
     * with nothing behind it, which reads as a rendering fault. `:global`
     * because the shell lives in App.svelte.
     *
     * White and not `none`: the paper is white, so saying so costs nothing and
     * an explicitly painted colour cannot be the thing that surprises anybody.
     *
     * `!important` because the shell's own rule lives in App.svelte, where
     * Svelte scopes it to two classes — `.shell.svelte-xxxx` — and a single
     * `:global(.shell)` from here loses to it. The dark background then printed
     * as a 15px sliver down the side of every page, which is the whole bug.
     */
    :global(.shell),
    :global(#app),
    :global(body),
    .screen,
    .sheet {
      background: #fff !important;
    }

    .screen {
      min-height: 0;
    }

    /*
     * No max-width and no padding: the @page margin is the margin now, and
     * applying both would print the document inset inside an inset.
     */
    .sheet {
      max-width: none;
      padding: 0;
      box-shadow: none;
    }

    /*
     * The page's layout, stated rather than inherited.
     *
     * Some mobile browsers evaluate print media queries against the width of
     * the device instead of the page box, so a 390px phone printed the phone
     * layout onto A4: the slips came out one per row at the full width of the
     * sheet, which is what "too wide" looked like from the other end.
     *
     * A paper size is not a viewport. Whatever the screen did, this is the
     * arrangement the page gets, so it cannot depend on which breakpoint the
     * browser happened to pick.
     */
    .masthead {
      flex-direction: row;
      gap: 40px;
      padding-bottom: 34px;
    }

    .doc {
      text-align: right;
    }

    .doc__meta {
      grid-template-columns: 1fr auto;
      gap: 5px 20px;
    }

    .slips {
      grid-template-columns: 1fr 1fr;
    }

    .pay__row {
      flex-direction: row;
      gap: 26px;
    }

    /* The headings may wrap on a phone; on paper they have room. */
    .ledger thead th.num {
      white-space: nowrap;
    }

    .ledger tbody td.num {
      padding-left: 24px;
    }

    /*
     * Two parts, in one file: the bill in the aggregate, then the same bill
     * item by item with how to pay underneath it.
     *
     * The break is before the slips and only there — `:not(.pay)` — because
     * "how to pay" belongs with the slips rather than on a page of its own. It
     * is the answer to the question the slips ask, and a reader who has just
     * found their own name should not have to turn a page for the account
     * number.
     *
     * The first section was never separable from the masthead, and the two ran
     * together, so a page ended in the middle of the slips and the reader had
     * to hold a table in their head across the turn.
     */
    .block + .block:not(.pay) {
      break-before: page;
    }

    .slip,
    .pay,
    .ledger tr {
      break-inside: avoid;
    }

    /* Keep the accent and the wash from printing grey. */
    .slip__due,
    .slip--settled .slip__due,
    .ledger--people tfoot th,
    .ledger--people tfoot td {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
