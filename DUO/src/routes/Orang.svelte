<script lang="ts">
  /**
   * One person's history.
   *
   * The bills screen answers "who owes me", and answers it per bill. The
   * question that has no home there is the one somebody actually asks in a
   * group chat — "wait, how much have I paid you in total?" — because answering
   * it means scrolling four bills and adding up by hand.
   *
   * Read from listBills and filtered here rather than from a new view. That is
   * deliberate: the numbers on this screen are the same rows the bills screen
   * shows, from the same read, so the two cannot disagree. A view of its own
   * would be a second implementation of the same arithmetic.
   *
   * The ceiling worth naming: listBills returns the most recent 60 bills, so a
   * history that reaches further back than that is incomplete. For a circle
   * this size that is months of dinners, and a paged version is a change to
   * this screen alone when it stops being true.
   */
  import { onMount } from 'svelte'
  import { formatDate, rupiah } from '../lib/format'
  import { listBills, shareRemaining, shareState, type BillWithShares } from '../lib/api'

  const person = new URLSearchParams(location.hash.split('?')[1] ?? '').get('p') ?? ''

  let bills = $state<BillWithShares[]>([])
  let status = $state<'loading' | 'ready' | 'error'>('loading')
  let message = $state('')

  /**
   * Only the bills this person is on, newest first — the order listBills
   * already returns them in.
   */
  let mine = $derived(
    bills
      .map((bill) => ({ bill, share: bill.shares.find((s) => s.person === person) }))
      .filter((row): row is { bill: BillWithShares; share: NonNullable<typeof row.share> } =>
        Boolean(row.share),
      ),
  )

  /**
   * What is still owed, and what has already come in.
   *
   * `terbayar` follows the same rule as everywhere else: a share the operator
   * marked settled counts as paid in full, whether or not a proof was ever
   * uploaded. Anything else counts what actually reached the account. Getting
   * this from `shareState` rather than re-deriving it is what keeps this screen
   * agreeing with the outstanding total on the bills screen.
   */
  let totals = $derived.by(() => {
    let paid = 0
    let due = 0
    for (const { share } of mine) {
      const settled = shareState(share) === 'lunas'
      paid += settled ? share.amount_owed : share.amount_paid
      due += settled ? 0 : shareRemaining(share)
    }
    return { paid, due }
  })

  onMount(async () => {
    if (!person) {
      status = 'error'
      message = 'Nggak ada nama yang diminta.'
      return
    }
    try {
      bills = await listBills()
      status = 'ready'
    } catch (err) {
      status = 'error'
      message = (err as Error).message
    }
  })
</script>

<svelte:head>
  <title>{person || 'Orang'} — DUO</title>
</svelte:head>

{#if status === 'error'}
  <div class="group">
    <div class="list"><div class="row error">{message}</div></div>
  </div>
{:else if status === 'loading'}
  <p class="pad dim">Memuat…</p>
{:else}
  <div class="screen">
    <!--
      The page title, written here rather than by the shell. Every other route
      gets one from a lookup table, and this one's title is a name — "Orang"
      above "Budi" would be the same word twice.
    -->
    <h1 class="name">{person}</h1>

    {#if mine.length === 0}
      <div class="group">
        <div class="list"><div class="row dim">Belum pernah ikut tagihan.</div></div>
      </div>
    {:else}
      <div class="group">
        <div class="list">
          <div class="row">
            <div class="stack">
              <span class="strong">{rupiah(totals.due)}</span>
              <span class="faint small">masih harus dibayar</span>
            </div>
            <div class="stack right">
              <span class="strong num">{rupiah(totals.paid)}</span>
              <span class="faint small">udah masuk</span>
            </div>
          </div>
        </div>
      </div>

      <h3 class="group-title">Riwayat</h3>
      {#each mine as { bill, share } (bill.id)}
        {@const state = shareState(share)}
        {@const sisa = state === 'lunas' ? 0 : shareRemaining(share)}
        {@const open = () => (location.hash = `#/nota?id=${bill.id}`)}

        <div class="group">
          <div class="list">
            <!--
              The figure is what their share of the bill WAS, for everyone. It
              is a history, so the column reads as what each outing cost them,
              and a settled row showing "Rp 0" would say nothing about the meal
              and make the column impossible to scan.

              A bill they still owe on opens its nota, because that is where the
              itemisation and their payment link live. A settled one does not —
              sending somebody a payment link for a bill they have paid is a
              good way to get them to pay twice.
            -->
            {#if state === 'lunas'}
              <div class="row">
                <div class="stack">
                  <span class="strong">{bill.place}</span>
                  <span class="faint small meta">
                    {formatDate(bill.bill_date)} · <span class="num">{bill.ref_code}</span>
                  </span>
                </div>
                <span class="row-value num faint">{rupiah(share.amount_owed)}</span>
              </div>
              <div class="row faint small">
                <span class="ok">Lunas</span>
                {#if share.paid_date}
                  <span class="row-value num">{formatDate(share.paid_date)}</span>
                {/if}
              </div>
            {:else}
              <button class="row tappable" onclick={open}>
                <div class="stack">
                  <span class="strong">{bill.place}</span>
                  <span class="faint small meta">
                    {formatDate(bill.bill_date)} · <span class="num">{bill.ref_code}</span>
                  </span>
                </div>
                <span class="row-value num">{rupiah(share.amount_owed)}</span>
                <span class="chevron"></span>
              </button>
              {#if state === 'sebagian'}
                <div class="row small">
                  <span class="faint">Sisa</span>
                  <span class="row-value num sisa">{rupiah(sisa)}</span>
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .screen {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  /* Matches `.page-title` in the shell, minus the container padding — this one
     sits inside `.screen`, which already has its own. */
  .name {
    padding: 0 16px 4px;
    font-size: var(--text-xl);
    font-weight: 750;
    letter-spacing: -0.02em;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .pad {
    padding: 0 16px;
  }

  .small {
    font-size: var(--text-sm);
  }

  .strong {
    font-weight: 650;
  }

  /* The second figure in the summary row, right-aligned so the two numbers sit
     on the same axis as every other amount in the app. */
  .stack.right {
    align-items: flex-end;
    text-align: right;
  }

  /* One line, always. A long place name would otherwise push the date and the
     ref code onto a second line and make that row taller than the ones around
     it — a ragged list where the eye is trying to compare amounts. */
  .meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-value.sisa {
    color: var(--stamp-deep);
    font-weight: 700;
  }

  /* One person is one narrow column, however wide the desk gets. */
  @media (min-width: 1100px) {
    .screen {
      max-width: 720px;
      margin: 0 auto;
    }
  }
</style>
