<script lang="ts">
  /**
   * Monthly report. Spec section 14.
   *
   * Two numbers, in the order they matter at the end of a month: what each
   * person spent this month, and who still owes what from before. Everything
   * else is a way of getting those out of the app.
   *
   * No PDF library, deliberately. The page renders as a clean printable
   * document and the browser's own Print to PDF does the conversion — which
   * produces a real PDF because the thing doing the converting is a real print
   * engine, rather than a home-made paginator guessing at page breaks.
   *
   * The CSV is generated here rather than exported from a database dashboard:
   * the operator is already in the app, and "go somewhere else to get your own
   * data out" is how a tool stops being used.
   */
  import { onMount } from 'svelte'
  import { formatDate, rupiah } from '../lib/format'
  import { listMonthlySpend, listOutstanding, type MonthlyRow, type Outstanding } from '../lib/api'

  let monthly = $state<MonthlyRow[]>([])
  let outstanding = $state<Outstanding[]>([])
  let status = $state<'loading' | 'ready' | 'error'>('loading')
  let message = $state('')
  /** 'YYYY-MM', or empty until the data says which months exist. */
  let month = $state('')

  let months = $derived([...new Set(monthly.map((r) => r.month.slice(0, 7)))].sort().reverse())

  let rows = $derived(
    monthly.filter((r) => r.month.startsWith(month)).sort((a, b) => b.total - a.total),
  )

  let monthTotal = $derived(rows.reduce((acc, r) => acc + r.total, 0))
  let outstandingTotal = $derived(outstanding.reduce((acc, r) => acc + r.outstanding, 0))

  function monthLabel(ym: string): string {
    if (!ym) return '—'
    return formatDate(`${ym}-01`).replace(/^\d+ /, '')
  }

  function step(delta: number) {
    const next = months[months.indexOf(month) + delta]
    if (next) month = next
  }

  async function load() {
    status = 'loading'
    try {
      const [spend, owed] = await Promise.all([listMonthlySpend(), listOutstanding()])
      monthly = spend
      outstanding = owed
      if (!month) {
        month = [...new Set(spend.map((r) => r.month.slice(0, 7)))].sort().reverse()[0] ?? ''
      }
      status = 'ready'
    } catch (err) {
      status = 'error'
      message = (err as Error).message
    }
  }

  /** RFC 4180 quoting: wrap in quotes and double any quote inside. */
  function csvCell(value: string | number): string {
    const text = String(value)
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  function download(filename: string, content: string) {
    // A BOM, so Excel on Windows reads the file as UTF-8 rather than mangling
    // any non-ASCII names. Amounts stay plain integers so they remain summable.
    const blob = new Blob(['﻿', content], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    // Revoked on the next tick: revoking immediately can cancel the download in
    // some browsers before it has started.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  function exportMonth() {
    const lines: (string | number)[][] = [
      ['bulan', 'orang', 'total', 'jumlah_tagihan'],
      ...rows.map((r) => [month, r.person, r.total, r.bills]),
      [],
      ['', 'TOTAL', monthTotal, ''],
    ]
    download(`duo-${month}.csv`, lines.map((r) => r.map(csvCell).join(',')).join('\r\n'))
  }

  function exportOutstanding() {
    const lines: (string | number)[][] = [
      ['orang', 'belum_lunas', 'jumlah_tagihan'],
      ...outstanding.map((r) => [r.person, r.outstanding, r.bills]),
      [],
      ['TOTAL', outstandingTotal, ''],
    ]
    download('duo-belum-lunas.csv', lines.map((r) => r.map(csvCell).join(',')).join('\r\n'))
  }

  onMount(load)
</script>

{#if status === 'error'}
  <div class="group">
    <div class="list"><div class="row error">{message}</div></div>
  </div>
{:else if status === 'loading'}
  <p class="pad dim">Memuat…</p>
{:else if months.length === 0}
  <div class="group">
    <div class="list">
      <div class="row dim">Belum ada data. Report muncul setelah ada tagihan yang disimpan.</div>
    </div>
  </div>
{:else}
  <div class="screen">
    <!-- Printed only: on paper there is no app header saying what this is. -->
    <div class="print-head">
      <h2>DUO — Report Bulanan</h2>
      <p class="dim">Periode {monthLabel(month)}</p>
    </div>

    <div class="group no-print">
      <div class="list">
        <div class="row stepper">
          <button
            class="plain"
            onclick={() => step(1)}
            disabled={months.indexOf(month) >= months.length - 1}
            aria-label="Bulan sebelumnya"
          >‹</button>
          <span class="strong">{monthLabel(month)}</span>
          <button
            class="plain"
            onclick={() => step(-1)}
            disabled={months.indexOf(month) <= 0}
            aria-label="Bulan berikutnya"
          >›</button>
        </div>
      </div>
    </div>

    <h3 class="group-title">Pengeluaran bulan ini</h3>
    <div class="group">
      <div class="list">
        {#if rows.length === 0}
          <div class="row dim">Nggak ada tagihan di bulan ini.</div>
        {:else}
          {#each rows as row (row.person)}
            <div class="row">
              <span class="strong">{row.person}</span>
              <span class="row-value num">{rupiah(row.total)}</span>
            </div>
          {/each}
          <div class="row">
            <span class="strong">Total {rows.length} orang</span>
            <span class="row-value strong num">{rupiah(monthTotal)}</span>
          </div>
        {/if}
      </div>
    </div>

    <h3 class="group-title">Belum lunas (semua waktu)</h3>
    <div class="group">
      <div class="list">
        {#if outstanding.length === 0}
          <div class="row ok">Semua lunas.</div>
        {:else}
          {#each outstanding as row (row.person)}
            <div class="row">
              <span class="strong">{row.person}</span>
              <span class="row-value num owed">{rupiah(row.outstanding)}</span>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <div class="group actions no-print">
      <button class="tinted" onclick={exportMonth} disabled={rows.length === 0}>
        Export CSV bulan ini
      </button>
      <button class="tinted" onclick={exportOutstanding} disabled={outstanding.length === 0}>
        Export CSV belum lunas
      </button>
      <button class="primary" onclick={() => window.print()}>Simpan PDF</button>
    </div>
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

  .owed {
    color: var(--red);
    font-weight: 600;
  }

  .stepper {
    justify-content: space-between;
  }

  .stepper button {
    font-size: 22px;
    min-width: 44px;
    color: var(--brand-light);
  }

  .actions button {
    width: 100%;
  }

  .print-head {
    display: none;
    padding: 0 16px;
  }

  /* Shown only on paper, where the app's own header is not there to say what
     this page is. Declared after the display:none above so it wins. */
  @media print {
    .print-head {
      display: block;
    }
  }
</style>
