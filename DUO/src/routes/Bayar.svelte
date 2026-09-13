<script lang="ts">
  /**
   * The page a payer opens.
   *
   * The only screen in the app that is not for the operator. It is opened by
   * someone the operator split a bill with, from a link in a WhatsApp message,
   * on a phone, probably once. They have no account, no context, and no reason
   * to trust it.
   *
   * So it says three things and stops: who you are, what you owe, and where to
   * send it. It deliberately does not show the other participants, the items,
   * or the bill total — none of that is theirs, and a public link that leaks a
   * table of who owes what is a worse problem than the one this solves.
   *
   * Light, like the nota it is linked from. The two are read one after the
   * other and should look like the same piece of paper.
   */
  import { onMount } from 'svelte'
  import { formatDate, rupiah } from '../lib/format'
  import { paymentPage, submitProof, type PaymentPageInfo, type ProofResult } from '../lib/api'
  import { prepareReceiptImage } from '../lib/image'

  const token = new URLSearchParams(location.hash.split('?')[1] ?? '').get('t') ?? ''

  let info = $state<PaymentPageInfo | null>(null)
  let status = $state<'loading' | 'ready' | 'missing' | 'error'>('loading')
  let error = $state('')
  let busy = $state(false)
  let result = $state<ProofResult | null>(null)

  onMount(async () => {
    if (!token) {
      status = 'missing'
      return
    }
    try {
      info = await paymentPage(token)
      status = info ? 'ready' : 'missing'
    } catch (err) {
      error = (err as Error).message
      status = 'error'
    }
  })

  async function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file || busy) return

    busy = true
    error = ''

    try {
      // Compressed before it leaves the phone. A screenshot straight off a
      // modern phone is several megabytes, which is slow to upload on mobile
      // data and over the function's cap.
      const prepared = await prepareReceiptImage(file)
      result = await submitProof(token, prepared.base64, 'image/jpeg')
      if (result.verdict === 'matched' || result.verdict === 'already_paid') {
        status = 'ready'
      }
    } catch (err) {
      error = (err as Error).message
    } finally {
      busy = false
      input.value = ''
    }
  }
</script>

<svelte:head>
  <title>Bayar — DUO</title>
</svelte:head>

<div class="sheet">
  {#if status === 'loading'}
    <p class="msg">Memuat…</p>
  {:else if status === 'missing'}
    <p class="msg">Link-nya nggak dikenali. Mungkin salah ketik, atau tagihannya udah dihapus.</p>
  {:else if status === 'error'}
    <p class="msg">{error}</p>
  {:else if info}
    <header class="head">
      <p class="who">{info.person}</p>
      <p class="meta">{info.place} · {formatDate(info.bill_date)}</p>
      <p class="amount">{rupiah(info.amount_owed)}</p>
    </header>

    {#if result?.verdict === 'matched'}
      <div class="done">
        <p class="done-title">Lunas</p>
        <p class="done-body">{result.message}</p>
      </div>
    {:else if result?.verdict === 'already_paid'}
      <div class="done">
        <p class="done-title">Udah lunas</p>
        <p class="done-body">Tagihan ini udah kelar sebelumnya.</p>
      </div>
    {:else}
      {#if info.bank_name && info.account_number}
        <div class="dest">
          <span class="dest-label">Transfer ke</span>
          <span class="dest-value">
            {info.bank_name} {info.account_number}{#if info.account_holder}
              · {info.account_holder}{/if}
          </span>
        </div>
      {/if}

      <!--
        Two inputs, one with capture and one without, because `capture` removes
        the photo library option entirely on iOS — and a transfer confirmation
        is almost always already a screenshot in the library, not something to
        photograph.
      -->
      <label class="upload" class:busy>
        <input type="file" accept="image/*" onchange={pick} disabled={busy} />
        <span>{busy ? 'Lagi dicek…' : 'Upload bukti bayar'}</span>
      </label>
      <label class="upload secondary" class:busy>
        <input type="file" accept="image/*" capture="environment" onchange={pick} disabled={busy} />
        <span>Foto layar transfernya</span>
      </label>

      {#if result?.verdict === 'mismatch'}
        <div class="notice bad">
          <p class="notice-title">Belum bisa dikonfirmasi</p>
          <p class="notice-body">{result.message}</p>
        </div>
      {:else if result?.verdict === 'unclear'}
        <div class="notice warn">
          <p class="notice-title">Buktinya masuk</p>
          <p class="notice-body">{result.message}</p>
        </div>
      {/if}

      {#if error}
        <div class="notice bad"><p class="notice-body">{error}</p></div>
      {/if}

      <p class="hint">
        Gambarnya dibaca otomatis. Kalau nominal dan penerimanya cocok, statusnya
        langsung lunas.
      </p>
    {/if}
  {/if}
</div>

<style>
  /*
   * The page is not the app. Someone opening a link from a group chat has never
   * seen DUO, so the chrome would be noise and the dark theme would read as a
   * different product from the nota that sent them here.
   */
  .sheet {
    --paper: #ffffff;
    --ink: #1c1917;
    --soft: #6b6560;
    --rule: #e3ded8;
    --accent: #d04a02;
    --fig: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;

    min-height: 100dvh;
    max-width: 30rem;
    margin: 0 auto;
    padding: 3rem 1.5rem;
    background: var(--paper);
    color: var(--ink);
    font-size: 15px;
    line-height: 1.5;
  }

  .head {
    padding-bottom: 1.5rem;
    border-bottom: 2px solid var(--ink);
  }

  .who {
    margin: 0;
    font-size: 22px;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .meta {
    margin: 2px 0 0;
    font-size: 13px;
    color: var(--soft);
  }

  .amount {
    margin: 1.25rem 0 0;
    font-family: var(--fig);
    font-variant-numeric: tabular-nums;
    font-size: 34px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--accent);
  }

  .dest {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-top: 1.5rem;
    padding: 14px 16px;
    border: 1px solid var(--rule);
    border-radius: 12px;
  }

  .dest-label {
    font-size: 13px;
    color: var(--soft);
  }

  .dest-value {
    font-family: var(--fig);
    font-size: 14px;
    font-weight: 600;
    text-align: right;
  }

  .upload {
    display: block;
    margin-top: 1.5rem;
    padding: 16px;
    border: none;
    border-radius: 14px;
    background: var(--accent);
    color: #fff;
    text-align: center;
    font-weight: 640;
    cursor: pointer;
  }

  .upload.secondary {
    margin-top: 8px;
    background: none;
    border: 1px solid var(--rule);
    color: var(--soft);
    font-weight: 500;
  }

  .upload input {
    display: none;
  }

  .upload.busy {
    opacity: 0.5;
    pointer-events: none;
  }

  .notice {
    margin-top: 1.5rem;
    padding: 14px 16px;
    border-radius: 12px;
  }

  .notice.bad {
    background: #fdf0ee;
    border: 1px solid #f3c9c2;
  }

  .notice.warn {
    background: #fdf6e6;
    border: 1px solid #f0dfb4;
  }

  .notice-title {
    margin: 0 0 4px;
    font-weight: 640;
    font-size: 14px;
  }

  .notice-body {
    margin: 0;
    font-size: 14px;
    color: #5a534e;
  }

  .done {
    margin-top: 2rem;
    padding: 24px 20px;
    border-radius: 14px;
    background: #eef8f2;
    border: 1px solid #c4e6d4;
    text-align: center;
  }

  .done-title {
    margin: 0;
    font-size: 20px;
    font-weight: 650;
    color: #14603c;
  }

  .done-body {
    margin: 6px 0 0;
    font-size: 14px;
    color: #3d6b55;
  }

  .hint {
    margin: 1.5rem 0 0;
    font-size: 13px;
    color: var(--soft);
  }

  .msg {
    padding: 3rem 0;
    text-align: center;
    color: var(--soft);
  }
</style>
