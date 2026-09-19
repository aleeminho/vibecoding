<script lang="ts">
  /**
   * Notifikasi — the feed of proofs that landed on the operator's bills.
   *
   * The unit is the invoice, not the transfer. A bill three people paid is one
   * entry on this screen, because the question the operator is asking is "which
   * of my bills has something waiting", not "list every transfer". Tapping a
   * bundle opens its counterfoil: the individual proofs underneath, with the
   * actions for the ones still waiting (open the screenshot, or settle it from
   * here).
   *
   * Every line wears the pad's own marks — the stamp square at the leading edge
   * (pressed when the bill is settled, half-pressed while a person still has to
   * decide), the lettered LUNAS, the counterfoil shade for anything already
   * looked at. What is still new sits under a "Baru" heading.
   *
   * The seen marker is claimed once per visit, at open, but the split shown here
   * is the one from before that claim — so the rows the operator came to read
   * stay marked "Baru" while they read them, and are grey on the next visit.
   */
  import { onMount } from 'svelte'
  import { notifications } from '../lib/notifications.svelte'
  import { bundleByBill, isSettled, type NotifBundle } from '../lib/notify'
  import { setShareStatus, signedReceiptUrl } from '../lib/api'
  import { rupiah, timeAgo } from '../lib/format'
  import type { NotifItem } from '../lib/types'

  /** The marker as this visit found it, held still while the visit lasts. */
  const before = notifications.seenAt

  let bundles = $derived(bundleByBill(notifications.items))
  let fresh = $derived(bundles.filter((b) => b.newest > before))
  let older = $derived(bundles.filter((b) => b.newest <= before))

  /** Which bundles are unfolded. More than one may be open at a time. */
  let expanded = $state<string[]>([])

  let error = $state<string | null>(null)
  let busy = $state<string | null>(null)

  const isOpen = (id: string) => expanded.includes(id)

  function toggle(id: string) {
    expanded = isOpen(id) ? expanded.filter((x) => x !== id) : [...expanded, id]
  }

  onMount(async () => {
    try {
      await notifications.load()
    } catch (err) {
      // Named rather than swallowed: an empty list and a feed that never
      // arrived look identical, and only one of them is the truth.
      error = (err as Error).message
    }
    notifications.markSeen()
  })

  /**
   * Inside an open bundle: a settled payment is a document the operator can
   * show (their own nota); a proof still waiting opens the evidence it is
   * about, which is the question that got it flagged.
   */
  function openEntry(n: NotifItem) {
    if (isSettled(n)) location.hash = `#/nota?id=${n.bill_id}`
    else void viewProof(n)
  }

  async function viewProof(n: NotifItem) {
    error = null
    // The tab is opened inside the tap gesture, before anything is awaited:
    // waiting for the signed URL first drops the user activation, and mobile
    // Safari then blocks the new tab as a popup — which would turn the row's
    // one job, showing the proof, into a tap that does nothing. The placeholder
    // gets its address once the link resolves.
    const tab = window.open('', '_blank')
    // Same isolation the old `noopener` gave, without giving up the handle that
    // is needed to set the address after the await.
    if (tab) tab.opener = null
    try {
      const url = await signedReceiptUrl(n.image_path)
      if (tab) tab.location.href = url
      // Popups blocked outright: navigating this tab at least shows the image,
      // and the back gesture returns to the app.
      else window.location.href = url
    } catch (err) {
      tab?.close()
      error = (err as Error).message
    }
  }

  async function accept(n: NotifItem) {
    busy = n.id
    error = null
    try {
      await setShareStatus(n.bill_id, n.person, true)
      notifications.resolve(n.id)
    } catch (err) {
      error = (err as Error).message
    } finally {
      busy = null
    }
  }
</script>

{#snippet entry(n: NotifItem)}
  {@const done = isSettled(n)}
  <div class="inner-item">
    <button class="row tappable inner" class:has-actions={!done} onclick={() => openEntry(n)}>
      <span class="stack">
        <span class="strong">
          {n.verdict === 'matched'
            ? `${n.person} bayar ${rupiah(n.amount_read ?? n.amount_owed)}`
            : `${n.person} upload bukti`}
        </span>
        <span class="dim small">{timeAgo(n.created_at)}</span>
      </span>
      {#if done}
        <span class="stamp-mark">Lunas</span>
      {:else}
        <span class="flag">Perlu dicek</span>
      {/if}
    </button>

    {#if !done}
      <div class="actions">
        <button class="plain" onclick={() => viewProof(n)}>Lihat bukti</button>
        <button class="plain" disabled={busy === n.id} onclick={() => accept(n)}>
          {busy === n.id ? 'Menyimpan…' : 'Tandai lunas'}
        </button>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet bundle(b: NotifBundle, read: boolean)}
  {@const waiting = b.unsettled.length > 0}
  <div class="item">
    <button
      class="row tappable bill"
      class:read
      class:open={isOpen(b.bill_id)}
      aria-expanded={isOpen(b.bill_id)}
      onclick={() => toggle(b.bill_id)}
    >
      <span class="check" class:pressed={!waiting} class:half={waiting} aria-hidden="true"></span>
      <span class="stack">
        <span class="strong">{b.place}</span>
        <span class="dim small meta">
          <span class="serial">{b.ref_code}</span> · {timeAgo(b.newest)}{#if b.items.length > 1} · {b.items.length} bukti{/if}
        </span>
      </span>
      {#if waiting}
        <span class="flag">Perlu dicek</span>
      {:else}
        <span class="stamp-mark">Lunas</span>
      {/if}
      <span class="chevron" class:up={isOpen(b.bill_id)}></span>
    </button>

    {#if isOpen(b.bill_id)}
      <div class="detail">
        {#each b.items as n (n.id)}
          {@render entry(n)}
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<div class="screen">
  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if !notifications.loaded}
    <!--
      The first fetch, before anything is known. Gated on `loaded` rather than
      on an empty list, because an empty list is also what a request still in
      the air looks like — and "Belum ada notifikasi." over a request that has
      not answered yet is the screen stating something it cannot know.
    -->
    {#if !error}
      <div class="group">
        <div class="list">
          <div class="row">
            <span class="dim">Memuat…</span>
          </div>
        </div>
      </div>
    {/if}
  {:else if notifications.items.length === 0}
    <div class="group">
      <div class="list">
        <div class="row">
          <span class="dim">Belum ada notifikasi.</span>
        </div>
      </div>
    </div>
    <p class="hint">
      Tiap bukti bayar yang masuk lewat link nota muncul di sini — yang otomatis
      lunas maupun yang perlu dicek.
    </p>
  {:else}
    {#if fresh.length > 0}
      <h3 class="group-title">Baru · {fresh.length}</h3>
      <div class="group">
        <div class="list">
          {#each fresh as b (b.bill_id)}
            {@render bundle(b, false)}
          {/each}
        </div>
      </div>
    {/if}

    {#if older.length > 0}
      <h3 class="group-title">Sebelumnya</h3>
      <div class="group">
        <div class="list">
          {#each older as b (b.bill_id)}
            {@render bundle(b, true)}
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  /*
   * The stack of groups, 20px apart, like every other route's screen: the
   * global labels and sheets carry their own margins, and the gap is what
   * separates one group from the next.
   */
  .screen {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  /*
   * The stamp square, same device as a share row on Tagihan: dashed empty,
   * half-pressed while a proof is still waiting, pressed solid once the bill is
   * settled. Decorative here — the row says the state in words too, which is
   * the rule this world keeps.
   */
  .check {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    border: 1.5px dashed var(--ink-3);
    background: var(--write-in);
  }

  .check.half {
    border: 1.5px solid var(--stamp);
    background: linear-gradient(180deg, var(--write-in) 50%, var(--stamp) 50%);
  }

  .check.pressed {
    background: var(--stamp);
    border: 1.5px solid var(--stamp-deep);
  }

  /* The rubber stamp: lettered, outlined, pressed slightly askew. */
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
    white-space: nowrap;
  }

  /* Work still to do prints in the attention ink, and says what it is. */
  .flag {
    align-self: flex-start;
    margin-top: 3px;
    color: var(--stamp-deep);
    font-size: var(--text-sm);
    font-weight: 650;
    white-space: nowrap;
  }

  .stack {
    min-width: 0;
  }

  .strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Counterfoil amounts stack into a column, so they take tabular figures. */
  .inner .strong {
    font-variant-numeric: tabular-nums;
  }

  /*
   * One line that truncates from its end, so what gets cut is always the least
   * important part: the ref code and the age come first, the proof count — the
   * only half of this line the bundle can spare — is last.
   */
  .meta {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The ref code is a machine-issued serial, so it is set as one. */
  .serial {
    font-family: var(--mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    color: var(--ink-2);
  }

  /*
   * Looked at: the line recedes to the counterfoil shade, the way a settled
   * share row does. The record stays; only the claim of newness goes.
   */
  .bill.read {
    background: var(--sheet-2);
  }

  .bill.read:active {
    background: var(--sheet-3);
  }

  .bill.open {
    background: var(--sheet-2);
  }

  /*
   * The opened bundle is the counterfoil — same device as an opened item on
   * Review: the sheet one shade deeper under the line that was torn open.
   */
  .detail {
    background: var(--sheet-2);
    border-top: 1px solid var(--rule);
  }

  .inner-item + .inner-item {
    border-top: 1px solid var(--rule);
  }

  .inner .stack {
    padding-left: 36px;
  }

  .inner:active {
    background: var(--sheet-3);
  }

  .inner.has-actions {
    padding-bottom: 4px;
  }

  /*
   * The hairline between two bundles. The global one is written for sibling
   * `.row`s, and these are wrapped so a bundle can carry its counterfoil — so
   * the rule is drawn on the wrapper with the same inset the pad uses.
   */
  .item + .item {
    position: relative;
  }

  .item + .item::before {
    content: '';
    position: absolute;
    top: 0;
    left: 14px;
    right: 0;
    height: 1px;
    background: var(--rule);
  }

  .actions {
    display: flex;
    gap: 4px;
    padding: 0 4px 10px 40px;
  }

  .error {
    margin: 0 16px 16px;
    padding: 8px 12px;
    background: var(--bad-tint);
    border: 1px solid var(--bad-rule);
    border-radius: var(--radius);
    color: var(--bad);
    font-size: var(--text-sm);
  }

  .hint {
    padding: 0 16px;
    font-size: var(--text-sm);
    color: var(--ink-2);
  }

  /* A feed is one narrow column, however wide the desk gets. */
  @media (min-width: 1100px) {
    .screen {
      max-width: 720px;
      margin: 0 auto;
    }
  }
</style>
