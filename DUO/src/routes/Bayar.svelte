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
  import {
    paymentPage,
    qrisUrl,
    submitProof,
    type PaymentPageInfo,
    type ProofResult,
  } from '../lib/api'
  import { prepareReceiptImage } from '../lib/image'

  const token = new URLSearchParams(location.hash.split('?')[1] ?? '').get('t') ?? ''


  let info = $state<PaymentPageInfo | null>(null)
  let status = $state<'loading' | 'ready' | 'missing' | 'error'>('loading')
  let error = $state('')
  let busy = $state(false)
  let result = $state<ProofResult | null>(null)
  /**
   * What to offer, from the bill's own setting rather than from what happens to
   * be present. A bill can carry a QRIS and still ask for a transfer, and
   * showing both whenever both exist would overrule the operator's choice.
   *
   * The path check is a second condition, not a substitute: the method can say
   * `qris` while the upload failed, and an `<img>` pointing at nothing is worse
   * than no code at all.
   */
  let showQris = $derived(Boolean(info?.qris_path) && info?.payment_method !== 'bank')
  let showBank = $derived(info?.payment_method !== 'qris')

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

      // Re-read rather than patching the local copy. A part payment that was
      // read and recorded changes the amount still due, and this page is where
      // that number is read off to decide what to transfer — leaving the old
      // one on screen would ask for money that has already arrived.
      //
      // Failing here is not worth an error: the proof is already in and the
      // verdict is already right. A stale header is a smaller problem than a
      // message telling someone their successful upload failed.
      try {
        info = (await paymentPage(token)) ?? info
      } catch {
        // Keep what is on screen.
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
    <!--
      The big number is what is still due, not what the bill started at. This
      is the page someone opens to decide how much to transfer, and showing
      them the original amount after they have already sent half of it asks
      for the money twice.
    -->
    {@const sisa = Math.max(0, info.amount_owed - info.amount_paid)}
    <header class="head">
      <p class="who">{info.person}</p>
      <p class="meta">{info.place} · {formatDate(info.bill_date)}</p>
      <p class="amount">{rupiah(sisa)}</p>
      {#if info.amount_paid > 0}
        <p class="part">
          Dari {rupiah(info.amount_owed)} · udah masuk {rupiah(info.amount_paid)}
        </p>
      {/if}
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
      {#if showQris}
        <!--
          The code first when it is offered, because scanning is the easier of
          the two and the one most people reach for. Sized to be scannable from
          another phone held over this one, on white with a quiet margin — a
          quiet zone is part of how a QR code works, not padding.
        -->
        <div class="qris">
          <img src={qrisUrl(info.qris_path!)} alt="Kode QRIS" />
          <p class="qris-hint">Scan pakai m-banking atau e-wallet apa aja.</p>
        </div>
      {/if}

      {#if showBank && info.bank_name && info.account_number}
        <div class="dest">
          <span class="dest-label">{showQris ? 'Atau transfer ke' : 'Transfer ke'}</span>
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
   * seen DUO, so the chrome would be noise — this is the carbon copy of the
   * form the operator filled in, handed to the person named on it.
   */
  .sheet {
    --paper: #fbfcf7;
    --ink: #1b2f5e;
    --soft: #4a5a7d;
    --rule: #c6ccba;
    --accent: #d04a02;
    --accent-deep: #9e3802;
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
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .meta {
    margin: 2px 0 0;
    font-size: 13px;
    color: var(--soft);
  }

  /* The amount box, at the size the kwitansi prints its figure. */
  .amount {
    display: inline-block;
    margin: 1.25rem 0 0;
    padding: 4px 12px 3px;
    border: 1.5px solid var(--rule);
    border-radius: var(--radius-sm, 3px);
    background: #fdfef9;
    font-variant-numeric: tabular-nums;
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--ink);
  }

  /* Only present once something has landed, so it never explains a number that
     did not need explaining. */
  .part {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--soft);
  }

  .qris {
    margin-top: 1.5rem;
    text-align: center;
  }

  /*
   * White behind the code even on a page that is already paper, and a margin
   * on all four sides. That margin is the quiet zone a scanner needs to find
   * the code's edges; cropping it is the commonest way to make a QR that reads
   * fine on screen and fails on a phone camera.
   */
  .qris img {
    display: block;
    width: 100%;
    max-width: 260px;
    margin: 0 auto;
    padding: 12px;
    background: #fff;
    border: 1px solid var(--rule);
    border-radius: var(--radius, 4px);
  }

  .qris-hint {
    margin: 10px 0 0;
    font-size: 13px;
    color: var(--soft);
  }

  /* The destination details, set like the detail rows of a transfer receipt. */
  .dest {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-top: 1.5rem;
    padding: 12px 14px;
    border: 1px solid var(--rule);
    border-radius: var(--radius, 4px);
    background: #fdfef9;
  }

  .dest-label {
    font-size: 13px;
    color: var(--soft);
  }

  .dest-value {
    font-family: var(--fig);
    letter-spacing: 0.02em;
    font-size: 14px;
    font-weight: 650;
    text-align: right;
  }

  /* The one commit on this page: stamp ink, white label. */
  .upload {
    display: block;
    margin-top: 1.5rem;
    padding: 14px 16px;
    border: 1px solid var(--accent-deep);
    border-radius: var(--radius, 4px);
    background: var(--accent);
    color: #fff;
    text-align: center;
    font-weight: 650;
    cursor: pointer;
  }

  .upload.secondary {
    margin-top: 8px;
    background: var(--paper);
    border: 1px solid var(--rule);
    color: var(--ink);
    font-weight: 600;
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
    border: 1px solid;
    border-radius: var(--radius, 4px);
  }

  .notice.bad {
    background: var(--bad-tint, #f6e6e2);
    border-color: var(--bad-rule, #d9aaa1);
  }

  .notice.warn {
    background: var(--warn-tint, #f5eed6);
    border-color: var(--warn-rule, #d8c48c);
  }

  .notice-title {
    margin: 0 0 4px;
    font-weight: 700;
    font-size: 14px;
  }

  .notice.bad .notice-title {
    color: var(--bad, #a02a1e);
  }

  .notice.warn .notice-title {
    color: var(--warn, #7d5400);
  }

  .notice-body {
    margin: 0;
    font-size: 14px;
    color: var(--ink);
  }

  /* The settled verdict, as the stamp it is. */
  .done {
    margin-top: 2rem;
    padding: 22px 20px;
    border: 2px solid var(--accent-deep);
    border-radius: var(--radius, 4px);
    background: #fbeee5;
    text-align: center;
  }

  .done-title {
    display: inline-block;
    margin: 0;
    padding: 2px 10px 1px;
    border: 2px solid var(--accent-deep);
    border-radius: var(--radius-sm, 3px);
    color: var(--accent-deep);
    font-size: 20px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    transform: rotate(-2deg);
  }

  .done-body {
    margin: 10px 0 0;
    font-size: 14px;
    color: var(--ink);
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
