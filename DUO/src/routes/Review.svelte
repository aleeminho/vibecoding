<script lang="ts">
  /**
   * Review and Assign. Spec section 11.
   *
   * The screen the whole app exists to produce, and deliberately the largest
   * piece of UI: it exists because the model is allowed to be wrong and a human
   * has to decide it is right.
   *
   * Three rules from the spec shape it:
   *
   *   1. The photo is reachable the whole time. A reviewer who cannot see the
   *      evidence cannot review anything.
   *   2. Every extracted value is editable. Reviewing without the ability to
   *      correct is not reviewing.
   *   3. The commit is disabled until the gates pass, and says which one is
   *      failing.
   *
   * On layout, which has been through several answers. The constant is that
   * ASSIGNING is the only actual work here; everything else is checking. An
   * item gets its own card, because an item is the unit of work and a card is
   * somewhere to mark the ones nobody has claimed yet. The bill's own numbers
   * stay folded behind the summary row, because they are right almost every
   * time.
   */
  import { onMount } from 'svelte'
  import MoneyInput from '../components/MoneyInput.svelte'
  import { draft } from '../lib/draft.svelte'
  import { rupiah, formatDate } from '../lib/format'
  import { checkGates, computeSplit } from '../lib/split'
  import {
    commitBill,
    findOwnerId,
    findBillId,
    findSimilarBills,
    listKnownPeople,
    setPaidBy,
    setShareStatus,
    newRefCode,
    normaliseAccountNumber,
    uploadReceipt,
  } from '../lib/api'
  import type { Destination, DuplicateCandidate, KnownPerson } from '../lib/api'
  import type { Extraction, GateReport, RoundingMode } from '../lib/types'

  let { onDone }: { onDone: () => void } = $props()

  const NO_BILL: GateReport = {
    passed: false,
    failures: [{ gate: 0, message: 'Belum ada struk.' }],
  }

  let ext = $derived(draft.extraction)
  let items = $derived(draft.items)
  let roster = $derived(draft.roster)

  /** Gate 0 lets subtotal be null: when the receipt does not print one, the items are the truth. */
  let subtotal = $derived(
    ext?.subtotal ?? items.reduce((acc, item) => acc + item.line_total, 0),
  )

  let gates = $derived(ext ? checkGates({ ...ext, subtotal }, items, roster) : NO_BILL)

  let split = $derived.by(() => {
    if (!ext || !gates.passed) return null
    try {
      return computeSplit(
        items,
        subtotal,
        ext.discount,
        ext.tax,
        ext.service_charge,
        ext.total,
        roster,
        rounding,
      )
    } catch (err) {
      return { error: (err as Error).message }
    }
  })

  let shares = $derived(split && 'participants' in split ? split.participants : null)
  let splitError = $derived(split && 'error' in split ? split.error : null)
  let shareSum = $derived(shares?.reduce((acc, p) => acc + p.amount_owed, 0) ?? 0)
  let gap = $derived(ext ? ext.total - shareSum : 0)

  /**
   * Failures worth repeating in the commit bar: the ones that mean something is
   * actually incorrect. An empty roster and an unassigned item are work not yet
   * done, and for those the button carries the next step instead.
   */
  let blockers = $derived(gates.failures.filter((failure) => !failure.pending))
  let unassigned = $derived(items.filter((item) => item.assigned_to.length === 0))

  let known = $state<KnownPerson[]>([])
  let suggestions = $derived(known.filter((k) => !roster.includes(k.person)))

  let openItem = $state<number | null>(null)
  let newPerson = $state('')
  let photoOpen = $state(false)
  let numbersOpen = $state(false)

  /**
   * Where the money should go, remembered between bills.
   *
   * It is the operator's own account every time, so asking for it on every
   * single bill would be a form to fill in for no reason. Kept in localStorage
   * rather than on the bill, because it is a preference about this device, not
   * a fact about the bill — and prefilling it means the field is almost always
   * already right when the review screen opens.
   */
  const DEST_KEY = 'duo.lastDestination'

  function loadDestination(): Destination {
    try {
      const raw = localStorage.getItem(DEST_KEY)
      if (!raw) return { bankName: '', accountNumber: '', accountHolder: '' }
      const parsed = JSON.parse(raw) as Partial<Destination>
      return {
        bankName: parsed.bankName ?? '',
        accountNumber: parsed.accountNumber ?? '',
        accountHolder: parsed.accountHolder ?? '',
      }
    } catch {
      return { bankName: '', accountNumber: '', accountHolder: '' }
    }
  }

  let destination = $state<Destination>(loadDestination())

  /**
   * How round each share has to be. Remembered like the destination, for the
   * same reason: a group that rounds to 500 wants that every time, and asking
   * again each bill is a decision nobody wants to make twice.
   */
  const ROUND_KEY = 'duo.rounding'

  function loadRounding(): RoundingMode {
    const raw = Number(localStorage.getItem(ROUND_KEY))
    return raw === 100 || raw === 500 ? raw : 0
  }

  let rounding = $state<RoundingMode>(loadRounding())

  function setRounding(mode: RoundingMode) {
    rounding = mode
    try {
      localStorage.setItem(ROUND_KEY, String(mode))
    } catch {
      // see setDestination
    }
  }

  function setDestination(patch: Partial<Destination>) {
    destination = { ...destination, ...patch }
    try {
      localStorage.setItem(DEST_KEY, JSON.stringify(destination))
    } catch {
      // Private browsing with storage disabled. Not worth failing a bill over;
      // the value is still in memory for this session.
    }
  }

  /**
   * Required before commit, per the PRD: a split nobody can pay is not
   * finished. Checked client side where it can be explained, rather than left
   * to the database where a failure arrives as a constraint name.
   */
  let destinationProblem = $derived.by(() => {
    if (!destination.bankName.trim()) return 'Bank atau e-wallet belum diisi.'
    if (!destination.accountHolder.trim()) return 'Nama penerima belum diisi.'
    const digits = normaliseAccountNumber(destination.accountNumber)
    if (digits.length < 6) return 'Nomor tujuan minimal 6 angka.'
    return null
  })

  let committing = $state(false)
  let commitError = $state<string | null>(null)
  let committed = $state<string | null>(null)

  /**
   * What the operator should do next, written on the button itself. A disabled
   * button reading "Belum bisa disimpan" says someone is stuck without saying
   * where; the next step is strictly more useful than the current problem.
   */
  let commitLabel = $derived.by(() => {
    if (committing) return 'Menyimpan…'
    if (splitError) return 'Angka belum balance'
    if (blockers.length > 0) return 'Ada yang perlu dibenerin'
    if (roster.length === 0) return 'Tambahin orang dulu'
    if (unassigned.length > 0) return `Bagi ${unassigned.length} item lagi`
    if (destinationProblem) return 'Isi rekening tujuan dulu'
    return 'Simpan'
  })

  /**
   * Bills that look like the one being saved.
   *
   * Checked once, when the scan lands — not on every keystroke in the place
   * field. The question is "have I already scanned this?", and it is a question
   * about the scan rather than about the edits that came after it.
   *
   * A warning, never a block. The operator is looking at the receipt and the
   * model is looking at a name and a number; between the two of them the
   * operator is the one who knows. So this says what it found and gets out of
   * the way — including when the check itself fails, which leaves `duplicate`
   * empty and commits exactly as it would have.
   */
  let duplicate = $state<DuplicateCandidate[]>([])

  /**
   * Which participant settled with the vendor.
   *
   * A single name rather than a flag per person, so "two people both paid" is
   * not a state that can be reached by tapping — it is not a state that exists.
   *
   * Their share is real and stays in the split: gate 4 requires the shares to
   * sum to the bill total, and the operator ate. What changes is that it is not
   * a debt, so it is written settled and never gets a payment link. Without
   * this the operator is billed for their own dinner, by themselves.
   */
  let paidBy = $state<string | null>(null)

  onMount(async () => {
    try {
      known = await listKnownPeople()
    } catch {
      known = []
    }

    if (ext?.place && ext.date && ext.total != null) {
      try {
        duplicate = await findSimilarBills(ext.place, ext.date, ext.total)
      } catch {
        duplicate = []
      }
    }
  })

  function addPerson(event: SubmitEvent) {
    event.preventDefault()
    draft.addPerson(newPerson)
    newPerson = ''
  }

  function patchHeader(patch: Partial<Extraction>) {
    draft.updateHeader(patch)
  }

  async function commit() {
    if (!ext || !shares || !gates.passed || committing) return

    committing = true
    commitError = null

    if (destinationProblem) {
      commitError = destinationProblem
      return
    }

    try {
      const ownerId = await findOwnerId()
      const refCode = await newRefCode()

      let receiptPath: string | null = null
      if (draft.photo) {
        const blob = await fetch(draft.photo.dataUrl).then((r) => r.blob())
        receiptPath = await uploadReceipt(ownerId, refCode, blob)
      }

      await commitBill({
        refCode,
        place: ext.place!,
        billDate: ext.date!,
        subtotal,
        discount: ext.discount,
        tax: ext.tax,
        serviceCharge: ext.service_charge,
        roundingAdjustment: ext.rounding_adjustment,
        total: ext.total,
        items,
        participants: shares,
        receiptPath,
        notes: draft.notes.trim() || null,
        extraction: ext,
        destination: {
          bankName: destination.bankName.trim(),
          // Normalised so the same account is written the same way on every
          // bill. A CSV where one account appears three ways is a CSV you
          // cannot group by.
          accountNumber: normaliseAccountNumber(destination.accountNumber),
          accountHolder: destination.accountHolder.trim(),
        },
      })

      // Saved. Everything after this point is a follow-up write, and the screen
      // must not say the bill failed if one of them does — the operator would
      // save again and end up with two of them.
      committed = refCode

      // Written after the bill exists, rather than through commit_bill — the
      // same reasoning as the QRIS. A failure here leaves a bill whose organiser
      // looks unpaid, which the Tagihan screen can fix by hand; a failure inside
      // commit_bill would leave no bill at all.
      if (paidBy) {
        try {
          // commit_bill returns the ref code, not the id, and bill_id is a uuid
          // column. Passing the code straight through is a Postgres type error,
          // not a compile one — which is exactly how it shipped and failed on
          // every save with an organiser marked.
          const billId = await findBillId(refCode)
          await setShareStatus(billId, paidBy, true)
          await setPaidBy(billId, paidBy)
        } catch (err) {
          commitError =
            `Tagihannya tersimpan, tapi gagal nandain "${paidBy}" sebagai yang ` +
            `bayar ke vendor: ${(err as Error).message} Buka tagihannya di ` +
            `Tagihan dan tick namanya sendiri.`
        }
      }
    } catch (err) {
      commitError = (err as Error).message
    } finally {
      committing = false
    }
  }

  function finish() {
    draft.reset()
    onDone()
  }
</script>

{#if committed}
  <div class="done">
    <div class="done-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
      </svg>
    </div>
    <h2>Tersimpan</h2>
    <p class="dim num">{committed}</p>
    <button class="primary full" onclick={finish}>Selesai</button>
  </div>
{:else if !ext}
  <p class="empty dim">Nggak ada struk yang lagi diproses.</p>
{:else}
  <div class="screen">
    {#if ext.confidence_notes}
      <div class="group">
        <div class="list tint-warn">
          <div class="row notice-row">
            <span class="notice-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3.6 21 19.2H3z" />
                <path d="M12 9.6v4" />
                <path d="M12 16.4h.01" />
              </svg>
            </span>
            <span class="notice-text">{ext.confidence_notes}</span>
          </div>
        </div>
      </div>
    {/if}

    <!--
      The duplicate warning, before the save rather than after it. It names the
      bill it found, because the honest thing to show is the evidence and not a
      verdict — the operator recognises their own receipt in a second, and a
      "possible duplicate" with no detail is a dialog people learn to dismiss.
    -->
    {#if duplicate.length > 0}
      <div class="group">
        <div class="list tint-warn">
          <div class="row notice-row">
            <span class="notice-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3.6 21 19.2H3z" />
                <path d="M12 9.6v4" />
                <path d="M12 16.4h.01" />
              </svg>
            </span>
            <span class="notice-text">
              Struk ini kayak yang udah pernah dicatat:
              {#each duplicate as d, i (d.id)}
                {#if i > 0}, {/if}<strong>{d.place}</strong>
                {formatDate(d.bill_date)} <span class="num">{d.ref_code}</span>{/each}.
              Kalau memang beda, simpan aja.
            </span>
          </div>
        </div>
      </div>
    {/if}

    <!-- The bill itself. One row, and a way in to correct it. -->
    <div class="group">
      <div class="list">
        <button class="row tappable" onclick={() => (numbersOpen = !numbersOpen)}>
          {#if draft.photo}
            <img class="thumb" src={draft.photo.dataUrl} alt="" />
          {/if}
          <div class="stack">
            <span class="strong">{ext.place ?? 'Tanpa nama'}</span>
            <span class="dim small">
              {ext.date ? formatDate(ext.date) : 'Tanggal belum diisi'} · {rupiah(ext.total)}
            </span>
          </div>
          <span class="chevron"></span>
        </button>

        {#if numbersOpen}
          <div class="fields">
            <label>
              <span class="field-label">Tempat</span>
              <input
                type="text"
                value={ext.place ?? ''}
                oninput={(e) => patchHeader({ place: e.currentTarget.value })}
              />
            </label>
            <label>
              <span class="field-label">Tanggal</span>
              <input
                type="date"
                value={ext.date ?? ''}
                oninput={(e) => patchHeader({ date: e.currentTarget.value })}
              />
            </label>

            <div class="grid">
              <MoneyInput label="Subtotal" value={subtotal} onchange={(v) => patchHeader({ subtotal: v })} />
              <MoneyInput label="Diskon" value={ext.discount} onchange={(v) => patchHeader({ discount: v })} />
              <MoneyInput label="PPN" value={ext.tax} onchange={(v) => patchHeader({ tax: v })} />
              <MoneyInput label="Service" value={ext.service_charge} onchange={(v) => patchHeader({ service_charge: v })} />
              <MoneyInput label="Pembulatan" value={ext.rounding_adjustment} onchange={(v) => patchHeader({ rounding_adjustment: v })} />
              <MoneyInput label="Total" value={ext.total} onchange={(v) => patchHeader({ total: v })} />
            </div>
          </div>
        {/if}
      </div>
    </div>

    {#if photoOpen && draft.photo}
      <div class="group">
        <img class="photo-full" src={draft.photo.dataUrl} alt="Struk" />
        <button class="plain full" onclick={() => (photoOpen = false)}>Tutup foto</button>
      </div>
    {:else if draft.photo}
      <div class="group">
        <div class="list">
          <button class="row tappable" onclick={() => (photoOpen = true)}>
            <span>Lihat foto struk</span>
            <span class="chevron"></span>
          </button>
        </div>
      </div>
    {/if}

    <!-- The work. Everything above is checking; this is doing. -->
    <h3 class="group-title">Bagi ke siapa</h3>
    <div class="group">
      <div class="list" class:tint-ok={unassigned.length === 0} class:tint-warn={unassigned.length > 0}>
        <div class="row">
          {#if unassigned.length === 0}
            <span class="ok">Semua {items.length} item udah dibagi</span>
          {:else}
            <span class="warn">{unassigned.length} dari {items.length} item belum dibagi</span>
          {/if}
        </div>
      </div>
    </div>

    <!--
      One card per item, which is how the original design laid this out.

      It is not only cosmetic: an item is the unit of work here, and giving each
      one its own surface means the unassigned ones can be marked with a left
      accent bar and found by scanning down the left edge instead of read one by
      one. A single list of rows gives nowhere to put that.
    -->
    <div class="items">
      {#each items as item (item.position)}
        {@const isOpen = openItem === item.position}
        {@const empty = item.assigned_to.length === 0}
        <div class="list item" class:unassigned={empty}>
          <button class="row tappable" onclick={() => (openItem = isOpen ? null : item.position)}>
            <div class="stack">
              <span class="strong">{item.name}</span>
              {#if empty}
                <span class="warn small">Belum dibagi</span>
              {:else}
                <span class="small assignees">
                  {item.assigned_to.join(', ')}{#if item.assigned_to.length > 1}<span
                      class="faint"
                    >
                      · dibagi {item.assigned_to.length}</span
                    >{/if}
                </span>
              {/if}
            </div>
            <span class="row-value num">{rupiah(item.line_total)}</span>
            <span class="chevron"></span>
          </button>

          {#if isOpen}
            <div class="fields">
              <div class="grid-2">
                <label>
                  <span class="field-label">Nama</span>
                  <input
                    type="text"
                    value={item.name}
                    oninput={(e) => draft.updateItem(item.position, { name: e.currentTarget.value })}
                  />
                </label>
                <MoneyInput
                  value={item.line_total}
                  onchange={(v) => draft.updateItem(item.position, { line_total: v })}
                />
              </div>

              <div class="picks">
                {#each roster as person (person)}
                  <button
                    class="pick"
                    class:on={item.assigned_to.includes(person)}
                    onclick={() => draft.toggleAssignee(item.position, person)}
                  >
                    {person}
                  </button>
                {/each}
                {#if roster.length === 0}
                  <span class="faint small">Tambahin orangnya dulu di bawah.</span>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <!--
      Its own section rather than a mark on the roster chips, because a roster
      chip already means something on tap: it removes that person. Two meanings
      on one target is how somebody deletes a participant trying to say they
      paid.
    -->
    {#if roster.length > 0}
      <h3 class="group-title">Yang bayar ke vendor</h3>
      <div class="group">
        <div class="list">
          <div class="row wrap">
            {#each roster as person (person)}
              <button
                class="pick"
                class:on={paidBy === person}
                onclick={() => (paidBy = paidBy === person ? null : person)}
              >
                {person}
              </button>
            {/each}
          </div>
          <div class="row faint small">
            {#if paidBy}
              Share {paidBy} langsung kesimpen lunas dan nggak dapet link bayar.
            {:else}
              Belum ada yang ditandai — semua orang bakal ditagih, termasuk lu
              kalau ikut makan.
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <h3 class="group-title">Orang</h3>
    <div class="group">
      <div class="list">
        {#if roster.length > 0}
          <div class="row wrap">
            {#each roster as person (person)}
              <button class="pick on" onclick={() => draft.removePerson(person)}>
                {person}<span class="x" aria-hidden="true"
                  ><svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg
                  ></span
                >
              </button>
            {/each}
          </div>
        {/if}

        <form class="row add" onsubmit={addPerson}>
          <input type="text" placeholder="Nama" autocomplete="off" bind:value={newPerson} />
          <button class="tinted" type="submit" disabled={!newPerson.trim()}>Tambah</button>
        </form>

        {#if suggestions.length > 0}
          <div class="row wrap suggest">
            <span class="field-label full-width">Sering bareng</span>
            {#each suggestions as person (person.person)}
              <button class="pick" onclick={() => draft.addPerson(person.person)}>
                {person.person}<span class="faint count">{person.bill_count}×</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <h3 class="group-title">Rekening tujuan</h3>
    <div class="group">
      <div class="list">
        <label class="row">
          <span class="key">Bank / e-wallet</span>
          <input
            class="inline"
            type="text"
            placeholder="BCA, GoPay, …"
            value={destination.bankName}
            oninput={(e) => setDestination({ bankName: e.currentTarget.value })}
          />
        </label>
        <label class="row">
          <span class="key">Nomor tujuan</span>
          <input
            class="inline num"
            type="text"
            inputmode="numeric"
            placeholder="1234567890"
            value={destination.accountNumber}
            oninput={(e) => setDestination({ accountNumber: e.currentTarget.value })}
          />
        </label>
        <label class="row">
          <span class="key">Nama penerima</span>
          <input
            class="inline"
            type="text"
            placeholder="Nama di rekening"
            value={destination.accountHolder}
            oninput={(e) => setDestination({ accountHolder: e.currentTarget.value })}
          />
        </label>
      </div>
      {#if destinationProblem}
        <p class="hint">{destinationProblem}</p>
      {:else}
        <p class="hint">Kesimpen, jadi bill berikutnya udah keisi otomatis.</p>
      {/if}
    </div>

    {#if shares}
      <h3 class="group-title">Hasil</h3>
      <div class="group">
        <div class="list">
          <!--
            The rounding rule. Shown with the result rather than hidden in a
            settings screen, because it changes the numbers directly underneath
            it and seeing that happen is the only way to judge whether the
            trade is worth it.
          -->
          <div class="row rounding">
            <span class="dim small">Bulatkan</span>
            <div class="picks">
              {#each [0, 100, 500] as const as mode (mode)}
                <button
                  class="pick"
                  class:on={rounding === mode}
                  onclick={() => setRounding(mode)}
                >
                  {mode === 0 ? 'Nggak' : mode}
                </button>
              {/each}
            </div>
          </div>

          {#each shares as share (share.person)}
            <div class="row share">
              <div class="stack">
                <span class="strong">{share.person}</span>
                <!--
                  Each amount is its own unbreakable unit, and the line wraps
                  between them. Without this the breakdown wraps mid-number —
                  "Rp 5.500" arriving as "Rp" / "5.500" — which reads as two
                  numbers rather than as one that ran out of room.
                -->
                <span class="faint small num breakdown">
                  <span class="term">{rupiah(share.item_subtotal)}</span>
                  {#if share.discount_share > 0}
                    <span class="term">− {rupiah(share.discount_share)}</span>
                  {/if}
                  <span class="term">+ {rupiah(share.tax_share)}</span>
                  <span class="term">+ {rupiah(share.service_share)}</span>
                  {#if share.rounding_share}
                    <span class="term warn">
                      {share.rounding_share > 0 ? '+' : '−'}{rupiah(
                        Math.abs(share.rounding_share),
                      )} pembulatan
                    </span>
                  {/if}
                </span>
              </div>
              <span class="row-value strong num amount-box">{rupiah(share.amount_owed)}</span>
            </div>
          {/each}
          <div class="row">
            <span class={gap === 0 ? 'ok' : 'error'}>
              {gap === 0 ? 'Pas — sama dengan total struk' : 'Selisih'}
            </span>
            <span class="row-value num amount-box">{gap === 0 ? rupiah(ext.total) : rupiah(gap)}</span>
          </div>
        </div>
      </div>
    {/if}

    <div class="group">
      <div class="list">
        <div class="row">
          <input
            class="bare"
            type="text"
            placeholder="Catatan (opsional)"
            value={draft.notes}
            oninput={(e) => (draft.notes = e.currentTarget.value)}
          />
        </div>
      </div>
    </div>
  </div>

  <!--
    Above the tab bar, not under it: the tab bar is sticky to the same edge and
    comes later in the DOM, so without the offset it paints over the commit
    button — the most important control on the screen, invisible, with nothing
    to indicate it is there.
  -->
  <footer class="commit-bar">
    {#if splitError}
      <p class="blocker error">{splitError}</p>
    {/if}
    {#each blockers as failure, i (i)}
      <p class="blocker error">{failure.message}</p>
    {/each}
    {#if commitError}
      <p class="blocker error">{commitError}</p>
    {/if}

    <button
      class="primary full"
      disabled={!gates.passed || !!splitError || committing}
      onclick={commit}
    >
      {commitLabel}
    </button>
  </footer>
{/if}

<style>
  .screen {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding-bottom: 8px;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* ---- rows ---- */

  .strong {
    font-weight: 650;
  }

  .small {
    font-size: var(--text-sm);
  }

  .row.wrap {
    flex-wrap: wrap;
  }

  /* One card per item, with a gap between them. */
  .items {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0 16px;
  }

  .item {
    position: relative;
  }

  /*
   * An unassigned item is a form with a blank field, not a card with a stripe:
   * the sheet is dashed where the others are solid, and the name carries the
   * dotted write-in line that is waiting for someone to be written on it.
   * There is no coloured border-left here on purpose — an unmatched item says
   * so in words, in the field, at full size.
   */
  .item.unassigned {
    border-style: dashed;
  }

  .item.unassigned .strong {
    display: inline-block;
    border-bottom: 1px dotted var(--rule-strong);
    padding-bottom: 1px;
  }

  .thumb {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-sm);
    object-fit: cover;
    object-position: top;
    background: #000;
    flex-shrink: 0;
    border: 3px solid #fff;
    outline: 1px solid var(--rule-strong);
  }

  .notice-row {
    align-items: flex-start;
    padding-top: 12px;
    padding-bottom: 12px;
  }

  .notice-mark {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    margin-top: 1px;
    color: var(--warn);
  }

  .notice-mark svg {
    width: 18px;
    height: 18px;
    display: block;
  }

  .notice-text {
    font-size: var(--text-sm);
    color: var(--warn);
  }

  .assignees {
    color: var(--stamp-deep);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .photo-full {
    width: 100%;
    max-height: 70dvh;
    object-fit: contain;
    border-radius: var(--radius);
    background: #000;
    border: 6px solid #fff;
    outline: 1px solid var(--rule-strong);
  }

  /* ---- inline editors ---- */

  /* The opened item is the counterfoil: the same sheet, one shade deeper. */
  .fields {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 14px 16px;
    background: var(--sheet-2);
    border-top: 1px solid var(--rule);
  }

  .field-label {
    display: block;
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--ink-2);
    margin-bottom: 6px;
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 120px;
    gap: 12px;
  }

  .full-width {
    width: 100%;
  }

  /* ---- person picker ---- */

  .picks,
  .suggest {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .suggest {
    flex-direction: column;
    align-items: flex-start;
  }

  /*
   * A roster chip is a name box on the form, not a capsule: a small ruled
   * square with the name beside it. Selected names take the stamp tint and
   * border, because a name written onto a line is the act of assignment.
   */
  .pick {
    display: inline-flex;
    align-items: center;
    min-height: 36px;
    border-radius: var(--radius-sm);
    padding: 0 12px;
    font-size: var(--text-sm);
    background: var(--sheet);
    border-color: var(--rule-strong);
    color: var(--ink);
  }

  .pick:active:not(:disabled) {
    opacity: 0.7;
  }

  .pick.on {
    background: var(--stamp-tint);
    border-color: var(--stamp);
    color: var(--stamp-deep);
    font-weight: 650;
  }

  .x {
    display: inline-flex;
    width: 13px;
    height: 13px;
    margin-left: 7px;
    opacity: 0.75;
  }

  .x svg {
    width: 13px;
    height: 13px;
    display: block;
  }

  /* ---- destination fields ---- */

  /* The label column and the field on one row, the same shape the sign-in
     screen uses. */
  .key {
    width: 116px;
    flex-shrink: 0;
    color: var(--ink);
    font-size: var(--text-sm);
  }

  .inline {
    flex: 1;
    min-width: 0;
    border: none;
    background: none;
    box-shadow: none;
    padding: 0;
    min-height: auto;
    text-align: right;
    border-radius: 0;
    font-size: var(--text-base);
  }

  .inline:focus {
    outline: none;
    box-shadow: none;
  }

  .row:focus-within {
    background: var(--sheet-2);
  }

  .hint {
    padding: 0 16px;
    font-size: var(--text-sm);
    color: var(--ink-2);
  }

  .rounding {
    justify-content: space-between;
    gap: 8px;
  }

  /* Amounts are atomic; the line breaks between them. */
  .term {
    white-space: nowrap;
  }

  .breakdown {
    display: block;
  }

  .count {
    margin-left: 6px;
    font-size: 12px;
  }

  /* ---- add person ---- */

  .add {
    display: flex;
    gap: 8px;
  }

  .add button {
    flex-shrink: 0;
  }

  /* A field with no chrome, for a row that is itself the input. */
  .bare {
    background: none;
    padding: 0;
    min-height: auto;
    border-radius: 0;
  }

  .bare:focus {
    outline: none;
  }

  /* ---- commit bar ---- */

  /*
   * The signature strip: a flat bar that stacks directly on top of the index
   * tabs, ruled off from the form with the same 2px ink line the letterhead
   * wears — all three read as the pad's chrome.
   *
   * `--tab-space` is the room the tab bar occupies, so the two never overlap —
   * the failure mode that once put the commit button underneath the nav with
   * nothing to indicate it was there.
   */
  .commit-bar {
    position: sticky;
    bottom: var(--tab-space);
    z-index: 9;
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 10px 16px;
    background: var(--sheet);
    border-top: 2px solid var(--ink);
  }

  .blocker {
    font-size: var(--text-sm);
    color: var(--bad);
  }

  .full {
    width: 100%;
  }

  /* ---- done ---- */

  .done {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 56px 16px;
    text-align: center;
  }

  /* The saved form takes the stamp, pressed askew like the mark it imitates. */
  .done-mark {
    width: 60px;
    height: 60px;
    border-radius: var(--radius);
    background: var(--stamp);
    border: 1.5px solid var(--stamp-deep);
    color: #fff;
    display: grid;
    place-items: center;
    margin-bottom: 8px;
    transform: rotate(-3deg);
  }

  .done-mark svg {
    width: 32px;
    height: 32px;
  }

  .empty {
    padding: 24px 16px;
  }
</style>
