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
    listBills,
    listFlaggedPayments,
    listOutstanding,
    setBillStatus,
    setShareStatus,
    signedReceiptUrl,
    type BillWithShares,
    type FlaggedPayment,
    type Outstanding,
  } from '../lib/api'
  import { isDemo } from '../lib/demo'

  let outstanding = $state<Outstanding[]>([])
  let bills = $state<BillWithShares[]>([])
  let flagged = $state<FlaggedPayment[]>([])
  let status = $state<'loading' | 'ready' | 'error'>('loading')
  let message = $state('')
  let open = $state<string | null>(null)
  let busy = $state<string | null>(null)

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
   * The nota is where the PDF and the WhatsApp share both happen. A web page
   * cannot attach a file to a WhatsApp message directly — `wa.me` only
   * pre-fills text — so the route in is the share sheet, which iOS offers from
   * the print preview. One screen, one path, and it carries a document instead
   * of a wall of text that a proportional font renders as an unreadable column.
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
    try {
      const url = await signedReceiptUrl(path)
      window.open(url, '_blank', 'noopener')
    } catch (err) {
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

  function allPaid(bill: BillWithShares): boolean {
    return bill.shares.every((share) => share.status === 'lunas')
  }

  onMount(async () => {
    await load()
    // In demo mode the first bill is opened automatically, because the expanded
    // state is otherwise only reachable by tapping and a screenshot cannot tap.
    if (import.meta.env.DEV && isDemo() && bills.length > 0) open = bills[0].id
  })
</script>

{#if status === 'error'}
  <div class="group">
    <div class="list"><div class="row error">{message}</div></div>
  </div>
{:else if status === 'loading'}
  <p class="pad dim">Memuat…</p>
{:else}
  <div class="screen">
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

    {#if outstanding.length > 0}
      <h3 class="group-title">Belum lunas</h3>
      <div class="group">
        <div class="list">
          {#each outstanding as row (row.person)}
            <div class="row">
              <div class="stack">
                <span class="strong">{row.person}</span>
                <span class="faint small">{row.bills} tagihan</span>
              </div>
              <span class="row-value num owed">{rupiah(row.outstanding)}</span>
            </div>
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
        <div class="list tint-warn">
          {#each flagged as p (p.id)}
            <div class="proof">
              <div class="proof-who">
                <span class="strong">{p.person}</span>
                <span class="faint small">{p.place} · {p.ref_code}</span>
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

              {#if p.note}<p class="proof-note">{p.note}</p>{/if}

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
        <div class="list">
          <button class="row tappable" onclick={() => (open = isOpen ? null : bill.id)}>
            <div class="stack">
              <span class="strong">{bill.place}</span>
              <span class="faint small">
                {formatDate(bill.bill_date)}
                {#if settled}
                  · <span class="ok">Lunas</span>
                {:else}
                  · <span class="warn">{unpaid} belum lunas</span>
                {/if}
              </span>
            </div>
            <span class="row-value num">{rupiah(bill.total)}</span>
            <span class="chevron" class:up={isOpen}></span>
          </button>

          {#if isOpen}
            {#each bill.shares as share (share.person)}
              {@const paid = share.status === 'lunas'}
              <button
                class="row tappable pay"
                class:paid
                aria-pressed={paid}
                aria-label="{share.person}: {paid ? 'sudah lunas' : 'belum lunas'}"
                onclick={() => toggleShare(bill, share.person, !paid)}
              >
                <span class="check" aria-hidden="true"></span>
                <span class="strong" class:faint={paid}>{share.person}</span>
                <span class="row-value num" class:faint={paid}>{rupiah(share.amount_owed)}</span>
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
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .screen {
    display: flex;
    flex-direction: column;
    gap: 22px;
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
    font-weight: 600;
  }

  .small {
    font-size: var(--text-sm);
  }

  .faint {
    color: var(--label-3);
  }

  .owed {
    color: var(--red);
    font-weight: 600;
  }

  .meta {
    gap: 6px;
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
    color: var(--red);
  }

  /* The disclosure indicator points down when the row is open, as on iOS. */
  .chevron.up::after {
    transform: rotate(45deg);
    margin-bottom: 4px;
  }

  /*
   * A checkbox, not a switch.
   *
   * A switch is the right control for a setting that is on or off — something
   * you could reasonably leave either way. "Lunas" is not a setting: it is an
   * event that either happened or has not. The list is a checklist, and a
   * checklist is a checkbox.
   *
   * It sits at the LEADING edge on purpose. Down the left, the column of ticks
   * can be read in one pass — how many are still empty is the question the
   * screen exists to answer. Trailing, beside the amounts, the ticks would be
   * competing with the numbers for the same glance.
   *
   * The state is carried by shape (a tick is there or it is not) as well as by
   * colour, so it survives being looked at by someone who cannot separate the
   * green from the grey.
   */
  .check {
    position: relative;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 1.5px solid var(--label-3);
    transition:
      background 0.18s ease,
      border-color 0.18s ease;
  }

  .row.pay.paid .check {
    background: var(--green);
    border-color: var(--green);
  }

  /* A dark tick on the green fill, not a white one: white on this green is
     2.5:1, which is under the 3:1 that a graphic needs to be legible. */
  .check::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 5px;
    height: 10px;
    margin: -6px 0 0 -2px;
    border: solid #052e22;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .row.pay.paid .check::after {
    opacity: 1;
  }

  /* Settled rows recede, so the ones still owing are what the eye lands on. */
  .row.pay.paid {
    background: #12241d;
  }

  .row.pay.paid:active {
    background: #1b3329;
  }

  /* The whole row is the target, not a 51px switch in the corner — this gets
     tapped one-handed, standing up, on a phone. */
  .row.pay .strong {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    padding: 12px 16px;
  }

  .proof + .proof {
    border-top: 1px solid rgba(255, 182, 0, 0.22);
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
    color: var(--label-2);
  }

  .proof-read .num {
    color: var(--label);
    font-weight: 600;
  }

  .proof-note {
    font-size: var(--text-xs);
    color: var(--label-3);
  }

  .proof-actions {
    display: flex;
    gap: 4px;
    margin: 4px 0 0 -10px;
  }
</style>
