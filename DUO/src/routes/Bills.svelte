<script lang="ts">
  /**
   * The ledger. Spec section 4.
   *
   * Two questions, in the order the operator asks them: who still owes me
   * money, and what were the bills. The first is the number that actually
   * matters at the end of the month, so it goes on top.
   *
   * Settling is per person, because that is the granularity money actually
   * arrives at: one transfer, weeks before the rest. The database shape was
   * always per person — the bill-level toggle that was here first was the
   * screen disagreeing with its own schema, and a wrong tap on it could
   * silently un-settle someone who had already paid.
   *
   * The control is a whole tappable row with a leading checkbox, not a switch.
   * A switch says "this is a setting, on or off, leave it how you like"; paying
   * someone back is an event that either happened or has not, and the list is a
   * checklist. That is not a matter of taste — it changes what the operator
   * thinks the screen is for, and whether the state is readable at a glance.
   *
   * There is still a "mark all" for the case where the whole table settles at
   * once, but as a secondary action rather than the only way.
   */
  import { onMount } from 'svelte'
  import { formatDate, rupiah } from '../lib/format'
  import {
    deleteBill,
    findOwnerId,
    listBills,
    listFlaggedPayments,
    listOutstanding,
    setBillPayment,
    setBillStatus,
    setShareStatus,
    qrisUrl,
    uploadQris,
    shareRemaining,
    shareState,
    signedReceiptUrl,
    type BillWithShares,
    type FlaggedPayment,
    type PaymentMethod,
    type Outstanding,
  } from '../lib/api'
  import { isDemo } from '../lib/demo'
  import { session } from '../lib/session.svelte'
  import { desktop } from '../lib/viewport.svelte'
  import { prepareReceiptImage } from '../lib/image'

  let outstanding = $state<Outstanding[]>([])
  let bills = $state<BillWithShares[]>([])
  let flagged = $state<FlaggedPayment[]>([])
  let status = $state<'loading' | 'ready' | 'error'>('loading')
  let message = $state('')
  let open = $state<string | null>(null)
  /** Which bill the wide screen's right-hand form is showing. */
  let selected = $state<string | null>(null)
  let busy = $state<string | null>(null)

  let selectedBill = $derived(bills.find((bill) => bill.id === selected) ?? null)

  /** The pad's control total: what every unstamped line adds up to. */
  let owedTotal = $derived(outstanding.reduce((acc, row) => acc + row.outstanding, 0))

  /**
   * `silent` reloads without dropping the screen back to "Memuat…".
   *
   * This matters more than it looks. Every tick of a paid switch used to call
   * the plain load(), which sets status = 'loading' — so the list was replaced
   * by a loading line and then rebuilt, for each person, every time. Ticking
   * four people meant four full-screen flashes. A refresh that the operator did
   * not ask for should never take the screen away from them.
   *
   * A silent refresh that fails keeps the list and reports the error instead of
   * blanking to the error state: the rows on screen are still true, and a list
   * you can read beats an error page.
   */
  async function load({ silent = false } = {}) {
    if (!silent) status = 'loading'
    try {
      const [owed, list, proofs] = await Promise.all([
        listOutstanding(),
        listBills(),
        listFlaggedPayments(),
      ])
      outstanding = owed
      bills = list
      flagged = proofs
      message = ''
      status = 'ready'
    } catch (err) {
      message = (err as Error).message
      if (!silent) status = 'error'
    }
  }

  async function toggleShare(bill: BillWithShares, person: string, paid: boolean) {
    const before = bill.shares

    // Optimistic, because the tap means the money already arrived — the check
    // should be on screen before the round trip finishes, not after. There is
    // deliberately no in-flight lock: the request sets an absolute value rather
    // than toggling, so tapping the same row twice simply ends up where the
    // second tap asked, and tapping four people in a row does not drop three of
    // them on the floor.
    bills = bills.map((b) =>
      b.id === bill.id
        ? {
            ...b,
            shares: b.shares.map((s) =>
              s.person === person ? { ...s, status: paid ? 'lunas' : 'belum lunas' } : s,
            ),
          }
        : b,
    )

    try {
      await setShareStatus(bill.id, person, paid)
      // Refetched rather than only patched: the outstanding summary is derived
      // from the same rows, and patching one without the other is how the two
      // drift apart.
      await load({ silent: true })
    } catch (err) {
      bills = bills.map((b) => (b.id === bill.id ? { ...b, shares: before } : b))
      message = (err as Error).message
    }
  }

  async function togglePaid(bill: BillWithShares, paid: boolean) {
    busy = bill.id
    try {
      await setBillStatus(bill.id, paid)
      await load({ silent: true })
    } catch (err) {
      message = (err as Error).message
    } finally {
      busy = null
    }
  }

  /**
   * Open the bill as a document.
   *
   * The nota is where the WhatsApp share happens, and what it shares is a link
   * rather than a file: a web page cannot attach anything to a WhatsApp message
   * — `wa.me` only pre-fills text — and it no longer needs to. One screen, one
   * path, and the thing it hands the group stays readable, keeps its arithmetic
   * and still works when it is opened a week later.
   */
  function openNota(bill: BillWithShares) {
    location.hash = `#/nota?id=${bill.id}`
  }

  /**
   * Delete, with a confirmation that says what is being deleted.
   *
   * A bare "Yakin?" trains people to tap through it. Naming the place, the date
   * and the amount is what makes the dialog do its job — the mistake it is
   * guarding against is deleting the wrong bill, not deleting a bill.
   */
  async function removeBill(bill: BillWithShares) {
    const ok = window.confirm(
      `Hapus tagihan ini?\n\n${bill.place}\n${formatDate(bill.bill_date)} · ${rupiah(bill.total)}\n\n` +
        `Tagihannya disembunyikan, bukan dihapus permanen — datanya masih ada kalau salah.`,
    )
    if (!ok) return

    busy = bill.id
    try {
      await deleteBill(bill.id, bill.ref_code)
      await load({ silent: true })
    } catch (err) {
      message = (err as Error).message
    } finally {
      busy = null
    }
  }

  async function openReceipt(path: string) {
    // Opened inside the tap gesture, before anything is awaited: waiting for
    // the signed URL first drops the user activation, and mobile Safari then
    // blocks the new tab as a popup. The placeholder window is given its
    // address once the link resolves.
    const tab = window.open('', '_blank')
    // Same isolation the old `noopener` gave, without giving up the handle that
    // is needed to set the address after the await.
    if (tab) tab.opener = null
    try {
      const url = await signedReceiptUrl(path)
      if (tab) tab.location.href = url
      // Popups blocked outright: navigating this tab at least shows the image,
      // and the back gesture returns to the app.
      else window.location.href = url
    } catch (err) {
      tab?.close()
      message = (err as Error).message
    }
  }

  /**
   * Accept a proof the model would not.
   *
   * Marking the share paid is what clears the row — the queue re-reads and the
   * entry is gone, because `listFlaggedPayments` drops anything already settled.
   * There is no "dismiss": a proof nobody has decided on is still a decision
   * waiting to be made, and a queue you can empty without answering is a queue
   * that gets emptied without answering.
   *
   * Addressed by bill id rather than by looking the bill up in `bills`, so it
   * still works on an entry whose bill has scrolled past the list's limit.
   */
  async function acceptProof(p: FlaggedPayment) {
    busy = p.id
    try {
      await setShareStatus(p.bill_id, p.person, true)
      await load({ silent: true })
    } catch (err) {
      message = (err as Error).message
    } finally {
      busy = null
    }
  }

  // ---- how a bill can be paid -------------------------------------------

  const PAY_METHODS: { value: PaymentMethod; label: string }[] = [
    { value: 'bank', label: 'Transfer' },
    { value: 'qris', label: 'QRIS' },
    { value: 'both', label: 'Dua-duanya' },
  ]

  let payOpen = $state<string | null>(null)

  /**
   * What the payer page will actually show.
   *
   * Says "QRIS" only when there is a code to show. A method set to qris with no
   * upload is a bill whose payer page offers nothing, and the label is the one
   * place that mismatch can be noticed before somebody opens the link and finds
   * an empty page.
   */
  function methodLabel(bill: BillWithShares): string {
    const hasCode = Boolean(bill.qris_path)
    if (bill.payment_method === 'qris') {
      return hasCode ? 'QRIS aja' : 'QRIS — tapi kodenya belum diupload'
    }
    if (bill.payment_method === 'both') {
      return hasCode ? 'Transfer sama QRIS' : 'Transfer — kodenya belum diupload'
    }
    return 'Transfer bank aja'
  }

  async function chooseMethod(bill: BillWithShares, method: PaymentMethod) {
    busy = bill.id
    // Optimistic, like the paid tick: the tap means the choice is made, and the
    // segmented control should move under the thumb rather than after a round
    // trip.
    bills = bills.map((b) => (b.id === bill.id ? { ...b, payment_method: method } : b))
    try {
      await setBillPayment(bill.id, { method })
    } catch (err) {
      bills = bills.map((b) => (b.id === bill.id ? { ...b, payment_method: bill.payment_method } : b))
      message = (err as Error).message
    } finally {
      busy = null
    }
  }

  /**
   * Attach a QRIS image to a bill that already exists.
   *
   * Uploaded before the row is updated, so a failed upload leaves the bill
   * exactly as it was rather than pointing at an object that is not there.
   */
  async function attachQris(bill: BillWithShares, event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    busy = bill.id
    try {
      const ownerId = await findOwnerId()
      const prepared = await prepareReceiptImage(file)
      const blob = await fetch(prepared.dataUrl).then((r) => r.blob())

      const path = await uploadQris(ownerId, blob)
      // A first upload switches the bill to offering it, because uploading a
      // code and then having nothing change is a confusing thing for a tap to
      // do. Changing it back is one tap away in the segmented control.
      const method = bill.payment_method === 'bank' ? 'both' : bill.payment_method
      await setBillPayment(bill.id, { qrisPath: path, method })
      await load({ silent: true })
    } catch (err) {
      message = (err as Error).message
    } finally {
      busy = null
    }
  }

  async function removeQris(bill: BillWithShares) {
    if (!window.confirm('Hapus kode QRIS dari tagihan ini?')) return
    busy = bill.id
    try {
      await setBillPayment(bill.id, { qrisPath: null, method: 'bank' })
      await load({ silent: true })
    } catch (err) {
      message = (err as Error).message
    } finally {
      busy = null
    }
  }

  function allPaid(bill: BillWithShares): boolean {
    return bill.shares.every((share) => share.status === 'lunas')
  }

  onMount(async () => {
    await load()
    // In demo mode the first bill is opened automatically, because the expanded
    // state is otherwise only reachable by tapping and a screenshot cannot tap.
    if (import.meta.env.DEV && isDemo() && bills.length > 0) {
      open = bills[0].id
      selected = bills[0].id
      payOpen = bills[0].id
    }
  })
</script>

{#snippet billPanel(bill: BillWithShares)}
  {@const settled = allPaid(bill)}
  {#each bill.shares as share (share.person)}
    <!--
      The tick is the stored flag, not the arithmetic. It is what the
      tap toggles, and it means one thing: the operator says this is
      settled. `.partial` is the arithmetic disagreeing with it, and
      that gets said in words rather than by half-filling a checkbox,
      which would read as a control in an in-between state.
    -->
    {@const paid = share.status === 'lunas'}
    {@const state = shareState(share)}
    {@const remaining = shareRemaining(share)}
    <button
      class="row tappable pay"
      class:paid
      class:partial={state === 'sebagian'}
      aria-pressed={paid}
      aria-label="{share.person}: {state === 'lunas'
        ? 'sudah lunas'
        : state === 'sebagian'
          ? `kurang ${rupiah(remaining)}`
          : 'belum lunas'}"
      onclick={() => toggleShare(bill, share.person, !paid)}
    >
      <span class="check" aria-hidden="true"></span>
      <span class="stack">
        <span class="strong" class:faint={paid}>{share.person}</span>
        {#if paid}
          <!--
            The line carries the stamp, lettered, pressed askew — the
            same mark the operator has put on a kwitansi a thousand
            times. The square at the leading edge is the control; this
            is what the control records.
          -->
          <span class="stamp-mark">Lunas</span>
        {:else if state === 'sebagian'}
          <!--
            The original amount is kept beside what has landed, not
            replaced by it. "Kurang 27.050" on its own is a number
            with no denominator, and the first question anyone asks
            is "out of how much?".
          -->
          <span class="faint small">
            sudah {rupiah(share.amount_paid)} dari {rupiah(share.amount_owed)}
          </span>
        {/if}
      </span>
      <span class="row-value num" class:faint={paid}>
        {rupiah(state === 'sebagian' ? remaining : share.amount_owed)}
      </span>
    </button>
  {/each}

  <div class="row faint small meta">
    <span class="num">{bill.ref_code}</span>
    {#if bill.notes}<span>· {bill.notes}</span>{/if}
  </div>

  {#if bill.account_number}
    <div class="row dest">
      <span class="faint small">Transfer ke</span>
      <span class="row-value small num">
        {bill.bank_name} {bill.account_number}
        {#if bill.account_holder}· {bill.account_holder}{/if}
      </span>
    </div>
  {/if}

  <div class="row actions">
    {#if bill.receipt_path}
      <button class="plain" onclick={() => openReceipt(bill.receipt_path!)}>
        Lihat struk
      </button>
    {/if}
    <button class="plain" onclick={() => openNota(bill)}>Nota &amp; WA</button>
  </div>

  <!--
    How this bill can be paid. Collapsed behind a disclosure rather
    than always shown, because most bills keep whatever the last one
    was and a control that is always open is a control that gets
    scrolled past.
  -->
  <button class="row tappable" onclick={() => (payOpen = payOpen === bill.id ? null : bill.id)}>
    <div class="stack">
      <span class="strong">Cara bayar</span>
      <span class="faint small">{methodLabel(bill)}</span>
    </div>
    <span class="chevron" class:up={payOpen === bill.id}></span>
  </button>

  {#if payOpen === bill.id}
    <div class="row pay-choice">
      <span class="dim small">Yang ditampilin ke yang bayar</span>
      <div class="segments">
        {#each PAY_METHODS as option (option.value)}
          <button
            class="segment"
            class:on={bill.payment_method === option.value}
            disabled={busy === bill.id}
            onclick={() => chooseMethod(bill, option.value)}
          >
            {option.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="row actions">
      <label class="plain qris-pick">
        <input
          type="file"
          accept="image/*"
          disabled={busy === bill.id}
          onchange={(e) => attachQris(bill, e)}
        />
        <span>{busy === bill.id ? '…' : bill.qris_path ? 'Ganti QRIS' : 'Upload QRIS'}</span>
      </label>
      {#if bill.qris_path}
        <button class="plain destructive-text" disabled={busy === bill.id} onclick={() => removeQris(bill)}>
          Hapus QRIS
        </button>
      {/if}
    </div>

    {#if bill.qris_path}
      <div class="row qris-preview">
        <img src={qrisUrl(bill.qris_path)} alt="QRIS tagihan ini" />
      </div>
    {/if}
  {/if}

  <div class="row actions">
    <button
      class="plain"
      class:destructive-text={settled}
      disabled={busy === bill.id}
      onclick={() => togglePaid(bill, !settled)}
    >
      {busy === bill.id ? '…' : settled ? 'Batalkan semua' : 'Tandai semua lunas'}
    </button>
    <button
      class="plain destructive-text"
      disabled={busy === bill.id}
      onclick={() => removeBill(bill)}
    >
      Hapus
    </button>
  </div>
{/snippet}

{#if status === 'error'}
  <div class="group">
    <div class="list"><div class="row error">{message}</div></div>
  </div>
{:else if status === 'loading'}
  <p class="pad dim">Memuat…</p>
{:else}
  <div class="screen">
    <div class="ledger-col">
    <!--
      Errors from a refresh or a receipt link used to be set and then never
      shown: the only place that rendered `message` was the full-screen error
      branch, which by definition is not the branch you are in when the list is
      already up. A tap that silently failed looked exactly like a tap that
      worked.
    -->
    {#if message}
      <div class="group">
        <div class="list tint-bad">
          <div class="row error small">{message}</div>
        </div>
      </div>
    {/if}

    <!--
      The control band: the operator's name in the pad's field grid and the one
      figure the whole screen exists to answer, printed in the amount box a
      kwitansi keeps for a decision.
    -->
    <div class="group">
      <div class="list">
        <div class="row">
          <span class="field-label">Operator</span>
          <span class="row-value serial">{session.email ?? '—'}</span>
        </div>
        <div class="row">
          <span class="field-label">Belum lunas</span>
          <span class="row-value strong num amount-box">{rupiah(owedTotal)}</span>
        </div>
      </div>
    </div>

    {#if outstanding.length > 0}
      <div class="group">
        <div class="list">
          {#each outstanding as row (row.person)}
            <!--
              The total is the question; "which bills is that made of" is the
              next one, and it has an answer. Making the row the way in is what
              stops the name being a dead end.
            -->
            <button
              class="row tappable"
              onclick={() => (location.hash = `#/orang?p=${encodeURIComponent(row.person)}`)}
            >
              <div class="stack">
                <span class="strong">{row.person}</span>
                <span class="faint small">{row.bills} tagihan</span>
              </div>
              <span class="row-value num owed">{rupiah(row.outstanding)}</span>
              <span class="chevron"></span>
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <div class="group">
        <div class="list"><div class="row ok">Semua lunas. Nggak ada yang nunggak.</div></div>
      </div>
    {/if}

    <!--
      Proofs the model would not settle on its own.

      Above the ledger rather than inside it, because this is the only part of
      the screen that is asking for something. Everything below is a record.
    -->
    {#if flagged.length > 0}
      <h3 class="group-title">Bukti perlu dicek</h3>
      <div class="group">
        <div class="list tint-attention">
          {#each flagged as p (p.id)}
            <div class="proof">
              <div class="proof-who">
                <span class="strong">{p.person}</span>
                <span class="faint small">
                  {p.place} · <span class="serial">{p.ref_code}</span>
                </span>
              </div>

              <p class="proof-read">
                {#if p.amount_read === null}
                  Nominalnya nggak kebaca.
                {:else}
                  Kebaca <span class="num">{rupiah(p.amount_read)}</span>
                  {#if p.amount_read < p.amount_owed}
                    — kurang <span class="num owed">{rupiah(p.amount_owed - p.amount_read)}</span>
                  {:else if p.amount_read > p.amount_owed}
                    — lebih <span class="num">{rupiah(p.amount_read - p.amount_owed)}</span>
                  {/if}
                {/if}
              </p>

              <!--
                Only when it adds something. The line above already states the
                amount and its remainder, so the note is redundant on a plain
                short transfer — printing both says "kurang Rp 27.050" twice in
                two phrasings. It earns its place when the amount is not the
                problem: a transfer to the wrong account, or one that could not
                be read at all.
              -->
              {#if p.note && (p.amount_read === null || p.recipient_ok !== true)}
                <p class="proof-note">{p.note}</p>
              {/if}

              <div class="proof-actions">
                <button class="plain" onclick={() => openReceipt(p.image_path)}>Lihat bukti</button>
                <button
                  class="plain"
                  disabled={busy === p.id}
                  onclick={() => acceptProof(p)}
                >
                  Tandai lunas
                </button>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <h3 class="group-title">Riwayat</h3>

    {#if bills.length === 0}
      <div class="group">
        <div class="list">
          <div class="row dim">Belum ada tagihan. Mulai dari tab Foto.</div>
        </div>
      </div>
    {/if}

    {#each bills as bill (bill.id)}
      {@const settled = allPaid(bill)}
      {@const unpaid = bill.shares.filter((s) => s.status === 'belum lunas').length}
      {@const isOpen = open === bill.id}

      <div class="group">
        <div class="list stub-card" class:selected={desktop.current && selected === bill.id}>
          <span class="stub" aria-hidden="true">{bill.ref_code}</span>
          <button
            class="row tappable"
            onclick={() => {
              // Wide screen: the row opens the form in the right pane. Phone:
              // it expands in place, where there is no second column.
              if (desktop.current) selected = bill.id
              else open = isOpen ? null : bill.id
            }}
          >
            <div class="stack">
              <span class="strong">{bill.place}</span>
              <span class="faint small">
                {formatDate(bill.bill_date)}
                {#if settled}
                  · <span class="ok">Lunas</span>
                {:else}
                  · <span class="attention">{unpaid} belum lunas</span>
                {/if}
              </span>
            </div>
            <span class="row-value num">{rupiah(bill.total)}</span>
            <span class="chevron" class:up={isOpen || (desktop.current && selected === bill.id)}></span>
          </button>

          {#if isOpen && !desktop.current}
            {@render billPanel(bill)}
          {/if}
        </div>
      </div>
    {/each}
    </div>

    <!--
      The wide screen's second pane: the bill the operator selected, as an open
      form. The ledger stays readable beside it, which is the whole reason the
      desktop layout exists — no drill-in to answer "which bill is that?".
    -->
    {#if desktop.current && selectedBill}
      <div class="detail-col">
        <div class="list stub-card">
          <span class="stub" aria-hidden="true">{selectedBill.ref_code}</span>
          <div class="form-head">
            <span class="place">{selectedBill.place}</span>
            <span class="meta">
              {formatDate(selectedBill.bill_date)} · {methodLabel(selectedBill)}
            </span>
            <span class="ref num">{rupiah(selectedBill.total)}</span>
          </div>
          {@render billPanel(selectedBill)}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .screen {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .ledger-col {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-width: 0;
  }

  .form-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--rule);
  }

  .form-head .place {
    font-size: 19px;
    font-weight: 750;
    letter-spacing: -0.01em;
  }

  .form-head .meta {
    font-size: 13px;
    color: var(--ink-2);
  }

  .form-head .ref {
    margin-left: auto;
    color: var(--stamp-deep);
    font-weight: 700;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .pad {
    padding: 0 16px;
  }

  .strong {
    font-weight: 650;
  }

  .small {
    font-size: var(--text-sm);
  }

  .faint {
    color: var(--ink-3);
  }

  .meta {
    gap: 6px;
  }

  /* The ref code is a machine-issued serial, so it is set as one. */
  .meta .num {
    font-family: var(--mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    color: var(--ink-2);
  }

  .actions {
    gap: 4px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .dest {
    gap: 8px;
    flex-wrap: wrap;
  }

  .destructive-text {
    color: var(--bad);
  }

  /* The disclosure indicator points down when the row is open, as on iOS. */
  .chevron.up::after {
    transform: rotate(45deg);
    margin-bottom: 4px;
  }

  /*
   * The stamp square, not a switch.
   *
   * A switch is the right control for a setting that is on or off — something
   * you could reasonably leave either way. "Lunas" is not a setting: it is an
   * event that either happened or has not, and on a kwitansi it is exactly one
   * mark — the stamp pressed into the line's empty square.
   *
   * It sits at the LEADING edge on purpose. Down the left, the column of
   * squares can be read in one pass — how many are still empty is the question
   * the screen exists to answer. Trailing, beside the amounts, the squares
   * would be competing with the numbers for the same glance.
   *
   * State is carried by shape (the square is empty, half-pressed, or filled)
   * as well as by colour, so it survives being looked at by someone who cannot
   * separate the orange from the paper.
   */
  .check {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    border: 1.5px dashed var(--ink-3);
    background: var(--write-in);
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }

  /* Pressed: the square fills with stamp ink. The tick that used to sit in it
     is gone — a tick is a checkbox, and the lettered stamp beside the name is
     what this world uses to say a line has been paid. */
  .row.pay.paid .check {
    background: var(--stamp);
    border: 1.5px solid var(--stamp-deep);
  }

  /* The rubber stamp itself: lettered, outlined, pressed slightly askew. */
  .stamp-mark {
    align-self: flex-start;
    margin-top: 3px;
    padding: 0 5px 1px;
    border: 1.5px solid var(--stamp-deep);
    border-radius: var(--radius-sm);
    color: var(--stamp-deep);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    transform: rotate(-2deg);
  }

  /* A partial payment: the stamp is already half down, paper stained below
     the press mark — a shape no other row on the screen has. */
  .row.pay.partial .check {
    border: 1.5px solid var(--stamp);
    background: linear-gradient(180deg, var(--write-in) 50%, var(--stamp) 50%);
  }

  /* Settled rows recede to the counterfoil, so the ones still owing are what
     the eye lands on. The shade is paper, not a colour: the stamped square is
     the only settled signal, and it is the one channel orange owns. */
  .row.pay.paid {
    background: var(--sheet-2);
  }

  .row.pay.paid:active {
    background: var(--sheet-3);
  }

  /* The whole row is the target, not a 24px stamp in the corner — this gets
     tapped one-handed, standing up, on a phone. */
  /* `.strong` only. Putting `nowrap` on `.stack` as well — which is what the
     first version of this did — clips the "sudah X dari Y" line mid-number
     with no ellipsis, because the overflow is hidden one level above where
     the truncation is declared. The name truncates; the caption wraps. */
  .row.pay .strong {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* A part-paid row is neither settled nor untouched, and the amount shown is
     the remainder — a different number from every other row on the screen. It
     is set in ink, heavier than the column: the half-pressed square is the
     only orange on the row, because orange means the stamp and nothing else. */
  .row.pay.partial .row-value {
    color: var(--ink);
    font-weight: 700;
  }

  /*
   * The counterfoil: every bill is a sheet torn from the pad, and its stub
   * carries the serial the numbering machine printed. The tear line is dashed;
   * the serial reads bottom-up, the way a stub is printed to be read when the
   * sheet is torn away. Hidden from assistive tech because the same code is in
   * the card's own meta row.
   */
  .stub-card {
    position: relative;
    padding-left: 30px;
  }

  .stub {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 29px;
    display: grid;
    place-items: center;
    border-right: 1px dashed var(--rule-strong);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    color: var(--ink-2);
    writing-mode: vertical-rl;
    text-orientation: mixed;
    transform: rotate(180deg);
  }

  /* The stub costs the header the width it used to have, and a truncated
     "Lucky Cat Coffee & ..." is a worse bill name than one that runs two
     lines. Place names may wrap; the ragged row height is the stub's price. */
  .stub-card .stack > .strong {
    white-space: normal;
  }

  /* ---- proofs needing a decision ---- */

  /*
   * Not a `.row`. A row is one line with a value on the right, and this is a
   * question: who, what was read, and what the operator can do about it. The
   * sentence and its two actions need to stack.
   */
  .proof {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px;
  }

  .proof + .proof {
    border-top: 1px solid var(--attention-rule);
  }

  /*
   * Stacked, not spread. This was copied from `.row`'s label/value pair and
   * space-between was wrong here — there is no value on the right, so the
   * second line drifted to the middle and the name and the place read as one
   * run-on sentence.
   */
  .proof-who {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .proof-read {
    font-size: var(--text-sm);
    color: var(--ink-2);
  }

  .proof-read .num {
    color: var(--ink);
    font-weight: 650;
  }

  .proof-note {
    font-size: var(--text-xs);
    color: var(--ink-3);
  }

  /* ---- how a bill can be paid ---- */

  .pay-choice {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding-bottom: 12px;
  }

  /*
   * Three options, one row, no wrapping. A select would be smaller but this is
   * a choice between three things the operator picks at a glance, and three
   * tappable targets show the alternatives where a dropdown hides two of them.
   * Each option is a field box; the chosen one takes the stamp ink.
   */
  .segments {
    display: flex;
    gap: 6px;
  }

  .segment {
    flex: 1;
    min-height: 38px;
    padding: 0 8px;
    font-size: var(--text-sm);
    background: var(--sheet);
    border-color: var(--rule-strong);
  }

  .segment.on {
    background: var(--stamp-tint);
    border-color: var(--stamp);
    color: var(--stamp-deep);
    font-weight: 650;
  }

  /* A file input cannot be styled, so the label is the button and the input is
     hidden — the same trick the payer page uses. */
  .qris-pick input {
    display: none;
  }

  .qris-preview {
    justify-content: center;
    padding-bottom: 14px;
  }

  .qris-preview img {
    width: 140px;
    padding: 8px;
    background: #fff;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
  }

  .proof-actions {
    display: flex;
    gap: 4px;
    margin: 4px 0 0 -10px;
  }

  /*
   * The wide screen: the ledger and the selected bill's open form side by
   * side. The form pane is sticky, so it stays in view while the operator
   * scrolls who owes what.
   */
  @media (min-width: 1100px) {
    .screen {
      display: grid;
      grid-template-columns: 440px minmax(0, 1fr);
      gap: 22px;
      align-items: start;
      max-width: 1360px;
    }

    /* The selected row wears the wash, so both panes agree on what is open. */
    .list.selected {
      background: var(--attention-tint);
      border-color: var(--stamp);
    }

    .detail-col {
      position: sticky;
      top: 86px;
      align-self: start;
      min-width: 0;
    }
  }
</style>
