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

  /** What is still owed on one bill, after anything already paid. */
  const sisa = (b: SettleUpEntry) => Math.max(0, b.amount_owed - b.amount_paid)

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
      total: bills.reduce((acc, b) => acc + sisa(b), 0),
      days: daysSinceOldest(bills),
    }))
  })

  let grandTotal = $derived(byPerson.reduce((acc, p) => acc + p.total, 0))

  /**
   * How many days the oldest unpaid bill has been sitting.
   *
   * The oldest rather than the newest or an average: what makes a nudge
   * reasonable is the one that has been outstanding longest, and averaging
   * would let a large old debt hide behind a fresh one.
   *
   * Local midnight to local midnight, because "3 days" should mean three days
   * to the person reading it, in their timezone, not 72 hours of UTC.
   */
  function daysSinceOldest(bills: SettleUpEntry[]): number {
    const oldest = bills.reduce((min, b) => (b.bill_date < min ? b.bill_date : min), bills[0].bill_date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const days = Math.round(
      (today.getTime() - new Date(`${oldest}T00:00:00`).getTime()) / 86_400_000,
    )
    return Math.max(0, days)
  }

  /**
   * After how many days a chase turns into a reminder.
   *
   * Adjustable, and kept in localStorage rather than in the database. It is a
   * preference about tone, not a fact about anyone's money — an extra table and
   * a settings screen for one number would cost more than it explains, and it
   * belongs to this device anyway.
   */
  const REMINDER_CHOICES = [1, 3, 7, 14]
  let threshold = $state(Number(localStorage.getItem('duo:reminder-days')) || 3)

  function setThreshold(days: number) {
    threshold = days
    localStorage.setItem('duo:reminder-days', String(days))
  }

  /**
   * The message to send someone who owes money.
   *
   * Two versions on purpose, and the difference is tone rather than content —
   * both state the same amounts. Before the threshold it is a chase, which
   * assumes the other person simply has not got to it. After, it is a reminder,
   * which is softer because by then the silence has gone on long enough that
   * the likely reason is that they forgot, and a firmer message would cost more
   * than the money is worth.
   */
  function messageFor(person: string, bills: SettleUpEntry[], total: number, overdue: boolean): string {
    const lines = overdue
      ? [`Halo ${person}, ngingetin pelan-pelan ya 🙏`, '']
      : [`Yang belum kelar, ${person}:`, '']

    for (const b of bills) {
      const amount = sisa(b)
      lines.push(
        `${b.place} (${formatDate(b.bill_date)}) — ${rupiah(amount)}` +
          (b.amount_paid > 0 ? ` (dari ${rupiah(b.amount_owed)}, udah masuk ${rupiah(b.amount_paid)})` : ''),
      )
    }

    lines.push('', `Total ${rupiah(total)}`)
    if (overdue) lines.push('', 'Kalau udah transfer, kabarin aja ya — nanti gua cek.')
    return lines.join('\n')
  }

  async function copyChase(person: string, bills: SettleUpEntry[], total: number, overdue: boolean) {
    copied = (await copyText(messageFor(person, bills, total, overdue))) ? person : null
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
        <div class="row">
          <span class="dim small">Ingetin kalau udah lewat</span>
          <span class="row-value">
            <select
              class="days"
              value={threshold}
              onchange={(e) => setThreshold(Number(e.currentTarget.value))}
              aria-label="Batas hari sebelum diingetin"
            >
              {#each REMINDER_CHOICES as days (days)}
                <option value={days}>{days} hari</option>
              {/each}
            </select>
          </span>
        </div>
      </div>
    </div>

    {#each byPerson as person (person.person)}
      {@const overdue = person.days >= threshold}
      <h3 class="group-title">
        <button
          class="who"
          onclick={() => (location.hash = `#/orang?p=${encodeURIComponent(person.person)}`)}
        >
          {person.person}
        </button>
        {#if overdue}<span class="due">lewat {person.days} hari</span>{/if}
      </h3>
      <div class="group">
        <div class="list">
          {#each person.bills as bill (bill.bill_id)}
            <div class="row">
              <div class="stack">
                <span>{bill.place}</span>
                <span class="faint small num">
                  {formatDate(bill.bill_date)} · {bill.ref_code}
                  <!--
                    A part-paid bill shows both numbers, because the amount on
                    the right is now the remainder and a row that says
                    "Rp 27.050" about a Rp 127.050 dinner needs the context.
                  -->
                  {#if bill.amount_paid > 0}
                    · udah masuk {rupiah(bill.amount_paid)}
                  {/if}
                </span>
              </div>
              <span class="row-value num" class:partial={bill.amount_paid > 0}>
                {rupiah(sisa(bill))}
              </span>
            </div>
          {/each}

          <div class="row">
            <span class="strong">Total</span>
            <span class="row-value strong num">{rupiah(person.total)}</span>
          </div>

          <div class="row actions">
            <button
              class="plain"
              onclick={() => copyChase(person.person, person.bills, person.total, overdue)}
            >
              {copied === person.person
                ? 'Tersalin'
                : overdue
                  ? 'Copy teks reminder'
                  : 'Copy buat nagih'}
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
    gap: 20px;
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

  .actions {
    justify-content: flex-end;
  }

  /* The remainder, on a bill that has had something paid against it. Heavier
     ink marks it as a different quantity from every other figure in the
     column; orange stays the stamp's, and the caption above carries what has
     already landed. */
  .row-value.partial {
    color: var(--ink);
    font-weight: 700;
  }

  /* The name is a link, but it has to keep reading as the section heading it
     sits in — the global button style would give it a card, a border and a
     44px hit area, none of which belong in a group title. */
  .who {
    min-height: 0;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 3px;
  }

  .who:active {
    opacity: 0.55;
    transform: none;
  }

  /* Beside the name rather than on a line of its own: this is a note about who
     to chase, not a heading for a section. */
  .due {
    margin-left: 8px;
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
    color: var(--warn);
  }

  /*
   * Sized down from the global control style. A full-height input in a list row
   * would set the row's height and make one settings line twice as tall as
   * every bill around it.
   */
  .days {
    width: auto;
    min-height: 34px;
    padding: 0 8px;
    font-size: var(--text-sm);
  }
</style>
