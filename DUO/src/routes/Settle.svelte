<script lang="ts">
  /**
   * Settle up.
   *
   * The PRD asked for debt netting: work out the net position between every
   * pair of people and simplify it into the fewest possible transfers. That is
   * the right feature, and it cannot be built on this data model.
   *
   * Here a bill has one owner, and every participant on it owes that owner.
   * There is no way to record "Andi paid for the taxi, so I owe Andi" — the
   * payer is implicit and it is always the person holding the account. So every
   * debt points the same way, and a netting algorithm has nothing to net:
   * the answer it would produce is N transfers, all to the same destination,
   * which is not a simplification of anything.
   *
   * What is actually useful in that situation is this: what to collect from
   * each person, and which bills it came from, so the number can be explained
   * when somebody asks. That is what this screen is, and the wording is
   * deliberately "yang harus ditagih" rather than "settle up", because calling
   * it settle-up would promise an algorithm that is not here.
   *
   * Making the PRD version real means letting a bill record who actually paid —
   * a change to the core table and to the review screen, and a decision worth
   * taking deliberately rather than smuggling in.
   */
  import { onMount } from 'svelte'
  import { formatDate, rupiah } from '../lib/format'
  import { listSettleUp, type SettleUpEntry } from '../lib/api'
  import { copyText } from '../lib/clipboard'

  let entries = $state<SettleUpEntry[]>([])
  let status = $state<'loading' | 'ready' | 'error'>('loading')
  let message = $state('')
  let copied = $state<string | null>(null)

  async function load() {
    status = 'loading'
    try {
      entries = await listSettleUp()
      status = 'ready'
    } catch (err) {
      status = 'error'
      message = (err as Error).message
    }
  }

  /** Per person, in the order the view returns them. */
  let byPerson = $derived.by(() => {
    const grouped = new Map<string, SettleUpEntry[]>()
    for (const entry of entries) {
      const list = grouped.get(entry.person) ?? []
      list.push(entry)
      grouped.set(entry.person, list)
    }
    return [...grouped.entries()].map(([person, bills]) => ({
      person,
      bills,
      total: bills.reduce((acc, b) => acc + b.amount_owed, 0),
    }))
  })

  let grandTotal = $derived(byPerson.reduce((acc, p) => acc + p.total, 0))

  /**
   * A short breakdown to send someone who asks what they owe.
   *
   * Plain text rather than the full bill message: this is the chase, not the
   * original share, and it has to read sensibly out of context.
   */
  function chaseText(person: string, bills: SettleUpEntry[], total: number): string {
    const lines = [`Yang belum kelar, ${person}:`, '']
    for (const b of bills) {
      lines.push(`${b.place} (${formatDate(b.bill_date)}) — ${rupiah(b.amount_owed)}`)
    }
    lines.push('', `Total ${rupiah(total)}`)
    return lines.join('\n')
  }

  async function copyChase(person: string, bills: SettleUpEntry[], total: number) {
    copied = (await copyText(chaseText(person, bills, total))) ? person : null
    setTimeout(() => (copied = null), 2000)
  }

  onMount(load)
</script>

{#if status === 'error'}
  <div class="group">
    <div class="list"><div class="row error">{message}</div></div>
  </div>
{:else if status === 'loading'}
  <p class="pad dim">Memuat…</p>
{:else if byPerson.length === 0}
  <div class="group">
    <div class="list"><div class="row ok">Semua lunas. Nggak ada yang perlu ditagih.</div></div>
  </div>
{:else}
  <div class="screen">
    <!--
      Says out loud what the screen is, because the PRD-shaped expectation is
      that it settles debts between people, and this one does not.
    -->
    <p class="pad dim small">
      Semua tagihan di sini utangnya ke lu. Ini yang perlu ditagih, sama asalnya
      dari bill mana.
    </p>

    <div class="group">
      <div class="list">
        <div class="row">
          <span class="strong">Total belum masuk</span>
          <span class="row-value strong num">{rupiah(grandTotal)}</span>
        </div>
      </div>
    </div>

    {#each byPerson as person (person.person)}
      <h3 class="group-title">{person.person}</h3>
      <div class="group">
        <div class="list">
          {#each person.bills as bill (bill.bill_id)}
            <div class="row">
              <div class="stack">
                <span>{bill.place}</span>
                <span class="faint small num">
                  {formatDate(bill.bill_date)} · {bill.ref_code}
                </span>
              </div>
              <span class="row-value num">{rupiah(bill.amount_owed)}</span>
            </div>
          {/each}

          <div class="row">
            <span class="strong">Total</span>
            <span class="row-value strong num">{rupiah(person.total)}</span>
          </div>

          <div class="row actions">
            <button
              class="plain"
              onclick={() => copyChase(person.person, person.bills, person.total)}
            >
              {copied === person.person ? 'Tersalin ✓' : 'Copy buat nagih'}
            </button>
          </div>
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

  .small {
    font-size: var(--text-sm);
  }

  .strong {
    font-weight: 600;
  }

  .actions {
    justify-content: flex-end;
  }
</style>
