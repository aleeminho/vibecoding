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
  import { formatDate, formatDateTime, rupiah } from '../lib/format'
  import { describeAudit } from '../lib/audit'
  import {
    listAuditLog,
    listDeletedBills,
    listExportBills,
    listMonthlySpend,
    listOutstanding,
    restoreBill,
    type AuditEntry,
    type DeletedBill,
    type MonthlyRow,
    type Outstanding,
  } from '../lib/api'
  import { buildExportRows, toCsv } from '../lib/export'

  let deleted = $state<DeletedBill[]>([])
  let audit = $state<AuditEntry[]>([])
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

  let busy = $state<string | null>(null)

  async function restore(bill: DeletedBill) {
    busy = bill.id
    try {
      await restoreBill(bill.id, bill.ref_code)
      await load()
    } catch (err) {
      message = (err as Error).message
    } finally {
      busy = null
    }
  }

  async function load() {
    status = 'loading'
    try {
      const [spend, owed, gone, log] = await Promise.all([
        listMonthlySpend(),
        listOutstanding(),
        listDeletedBills(),
        listAuditLog(50),
      ])
      monthly = spend
      outstanding = owed
      deleted = gone
      audit = log
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

  /**
   * @param bom Prepended by default so Excel on Windows reads the file as UTF-8
   *   rather than the system codepage. The detailed export passes false because
   *   toCsv() already emits one, and two BOMs render as a stray character in
   *   the first cell.
   */
  function download(filename: string, content: string, { bom = true } = {}) {
    const blob = new Blob([bom ? '﻿' : '', content], { type: 'text/csv;charset=utf-8' })
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

  /**
   * The detailed export: one row per item per person for the selected month.
   *
   * The range is the month already on screen rather than a separate date picker.
   * A second control for the same thing would be a way to export a month that is
   * not the one you are looking at, which is never what anyone means.
   */
  let exporting = $state(false)
  let exportNote = $state<string | null>(null)

  async function exportDetail() {
    exporting = true
    exportNote = null
    try {
      const [y, m] = month.split('-').map(Number)
      // Day 0 of the next month is the last day of this one, which handles
      // February without a table of month lengths.
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
      const from = `${month}-01`
      const to = `${month}-${String(last).padStart(2, '0')}`

      const bills = await listExportBills(from, to)
      const detail = buildExportRows(bills)

      if (detail.length === 0) {
        exportNote = 'Nggak ada tagihan di bulan ini.'
        return
      }

      download(`duo-detail-${month}.csv`, toCsv(detail), { bom: false })
      exportNote = `${detail.length} baris dari ${bills.length} tagihan.`
    } catch (err) {
      exportNote = (err as Error).message
    } finally {
      exporting = false
    }
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

    <div class="main-col">
    <div class="group no-print">
      <div class="list">
        <div class="row stepper">          <button
            class="plain step-btn"
            onclick={() => step(1)}
            disabled={months.indexOf(month) >= months.length - 1}
            aria-label="Bulan sebelumnya"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14.5 5.5 8 12l6.5 6.5" />
            </svg>
          </button>
          <span class="strong">{monthLabel(month)}</span>
          <button
            class="plain step-btn"
            onclick={() => step(-1)}
            disabled={months.indexOf(month) <= 0}
            aria-label="Bulan berikutnya"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9.5 5.5 16 12l-6.5 6.5" />
            </svg>
          </button>
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
            <span class="row-value strong num amount-box">{rupiah(monthTotal)}</span>
          </div>
        {/if}
      </div>
    </div>

    <!--
      Bills that were deleted, and the way back. The delete dialog promises the
      data is still there; this is what makes that true rather than a thing the
      dialog says.
    -->
    {#if deleted.length > 0}
      <h3 class="group-title">Terhapus</h3>
      <div class="group">
        <div class="list">
          {#each deleted as bill (bill.id)}
            <div class="row">
              <div class="stack">
                <span class="strong">{bill.place}</span>
                <span class="faint small">
                  {formatDate(bill.bill_date)} · <span class="num">{bill.ref_code}</span>
                </span>
              </div>
              <span class="row-value num faint">{rupiah(bill.total)}</span>
              <button class="plain" disabled={busy === bill.id} onclick={() => restore(bill)}>
                {busy === bill.id ? '…' : 'Balikin'}
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    </div>

    <!--
      What is still out, the ways to get the data out, and the change log. On a
      phone this stacks under the month; on a wide screen it holds the right
      column.
    -->
    <div class="side-col">
    <h3 class="group-title">Belum lunas (semua waktu)</h3>
    <div class="group">
      <div class="list">
        {#if outstanding.length === 0}
          <div class="row ok">Semua lunas.</div>
        {:else}
          {#each outstanding as row (row.person)}
            <div class="row">
              <span class="strong">{row.person}</span>
              <span class="row-value num owed amount-box">{rupiah(row.outstanding)}</span>
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <div class="group actions no-print">
      <button class="tinted" onclick={exportDetail} disabled={exporting}>
        {exporting ? 'Nyiapin…' : 'Export detail (per item)'}
      </button>
      <button class="tinted" onclick={exportMonth} disabled={rows.length === 0}>
        Export rekap bulan ini
      </button>
      <button class="tinted" onclick={exportOutstanding} disabled={outstanding.length === 0}>
        Export CSV belum lunas
      </button>
      <button class="primary" onclick={() => window.print()}>Simpan PDF</button>
    </div>

    <!--
      What was done to whose money, and when. Last on the screen because it is
      the thing nobody opens until something looks wrong.
    -->
    {#if audit.length > 0}
      <h3 class="group-title no-print">Catatan perubahan</h3>
      <div class="group no-print">
        <div class="list">
          {#each audit as entry (entry.id)}
            <div class="row">
              <div class="stack">
                <span>{describeAudit(entry)}</span>
                <span class="faint small">
                  {formatDateTime(entry.created_at)}
                  {#if entry.ref_code}· <span class="num">{entry.ref_code}</span>{/if}
                </span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    </div>

    {#if exportNote}
      <p class="pad dim small">{exportNote}</p>
    {/if}
  </div>
{/if}

<style>
  .screen {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .main-col,
  .side-col {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-width: 0;
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

  .stepper {
    justify-content: space-between;
  }

  .stepper .step-btn {
    color: var(--stamp-deep);
    min-width: 44px;
  }

  .step-btn svg {
    width: 22px;
    height: 22px;
    display: block;
    margin: 0 auto;
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

    .print-head h2 {
      color: #000;
    }
  }

  /* The wide screen: the month on the left, what is still out on the right. */
  @media (min-width: 1100px) {
    .screen {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 460px;
      gap: 26px;
      align-items: start;
      max-width: 1360px;
    }

    .print-head,
    .screen > .pad {
      grid-column: 1 / -1;
    }
  }
</style>
