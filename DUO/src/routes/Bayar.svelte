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
   * Light, like the nota it is linked from, and drawn with the same sheet, the
   * same two families and the same one accent. The two are read one after the
   * other and should look like the same piece of paper.
   */
  import { onMount } from 'svelte'
  import { formatDate, rupiah, rupiahDigits } from '../lib/format'
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

  /**
   * What is still due, not what the bill started at. This is the page someone
   * opens to decide how much to transfer, and showing the original amount after
   * they have already sent half of it asks for the money twice.
   */
  let sisa = $derived(Math.max(0, (info?.amount_owed ?? 0) - (info?.amount_paid ?? 0)))

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
  <!--
    The same two families the nota is set in, loaded per route rather than
    app-wide: this page is the second half of that document and nothing else in
    the app uses them.
  -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@400;600&display=swap"
  />
</svelte:head>

<div class="screen">
  <main class="sheet">
    {#if status === 'loading'}
      <p class="msg">Memuat…</p>
    {:else if status === 'missing'}
      <p class="msg">Link-nya nggak dikenali. Mungkin salah ketik, atau tagihannya udah dihapus.</p>
    {:else if status === 'error'}
      <p class="msg">{error}</p>
    {:else if info}
      <header class="masthead">
        <div class="brand">
          <p class="brand__mark">{info.person}</p>
          <p class="brand__sub">{info.place} · {formatDate(info.bill_date)}</p>
        </div>

        <div class="doc">
          <p class="doc__title">Yang harus dibayar</p>
          <p class="due"><span class="cur">Rp</span>{rupiahDigits(sisa)}</p>
          <!--
            Only once something has landed, so it never explains a number that
            did not need explaining.
          -->
          {#if info.amount_paid > 0}
            <p class="part">
              Dari {rupiah(info.amount_owed)} · udah masuk {rupiah(info.amount_paid)}
            </p>
          {/if}
        </div>
      </header>

      {#if result?.verdict === 'matched' || result?.verdict === 'already_paid'}
        <!--
          The settled band, the same one the nota puts under a share that is
          done with. The two documents say the same thing the same way, and this
          is the good news they are both capable of.
        -->
        <div class="band">
          <p class="band__label">
            {result.verdict === 'matched' ? 'Lunas' : 'Udah lunas'}
          </p>
          <p class="band__note">
            {result.verdict === 'matched' ? result.message : 'Tagihan ini udah kelar sebelumnya.'}
          </p>
        </div>
      {:else}
        <section class="block">
          <h2 class="section-label">Cara bayar</h2>

          <div class="pay">
            {#if showQris}
              <!--
                The code first when it is offered, because scanning is the
                easier of the two and the one most people reach for. On white
                with a quiet margin on all four sides — that margin is the quiet
                zone a scanner needs to find the code's edges, not padding, and
                cropping it is the commonest way to make a QR that reads fine on
                screen and fails on a phone camera.
              -->
              <img class="pay__qr" src={qrisUrl(info.qris_path!)} alt="Kode QRIS" />
            {/if}

            <div class="pay__body">
              {#if showQris}
                <p class="pay__lead">Scan pakai m-banking atau e-wallet apa aja</p>
                <p class="pay__line">
                  Masukin sendiri jumlahnya — kodenya nggak dikunci ke satu nominal.
                </p>
              {/if}

              {#if showBank && info.bank_name && info.account_number}
                {#if showQris}
                  <p class="pay__lead">Atau transfer</p>
                {/if}
                <p class="pay__dest">
                  {info.bank_name} {info.account_number}{#if info.account_holder}, a.n. {info
                      .account_holder}{/if}
                </p>
              {/if}
            </div>
          </div>
        </section>

        <section class="block">
          <h2 class="section-label">Bukti bayar</h2>
          <p class="section-note">
            Transfernya dibaca otomatis. Kalau nominal dan penerimanya cocok,
            statusnya langsung lunas.
          </p>

          <!--
            Two inputs, one with capture and one without, because `capture`
            removes the photo library option entirely on iOS — and a transfer
            confirmation is almost always already a screenshot in the library,
            not something to photograph.
          -->
          <label class="upload" class:busy>
            <input type="file" accept="image/*" onchange={pick} disabled={busy} />
            <span>{busy ? 'Lagi dicek…' : 'Upload bukti bayar'}</span>
          </label>
          <label class="upload secondary" class:busy>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onchange={pick}
              disabled={busy}
            />
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
        </section>
      {/if}
    {/if}
  </main>
</div>

<style>
  /*
   * The page is not the app. Someone opening a link from a group chat has never
   * seen DUO, so the chrome would be noise and the dark theme would read as a
   * different product from the nota that sent them here.
   *
   * The same sheet the nota is drawn on, so the two documents are the same
   * document seen twice rather than two designs that happen to share a colour.
   */
  .screen {
    min-height: 100dvh;
    background: var(--desk, #eceef1);
  }

  .sheet {
    --paper: #ffffff;
    --ink: #14171c;
    --ink-2: #5a616e;
    --ink-3: #868d99;
    --rule: #dce0e6;
    --rule-soft: #eef0f3;
    --accent: #d04a02;
    --accent-deep: #a83b00;
    --accent-wash: #fdf2ea;
    --bad: #b3261e;
    --bad-wash: #fdf0ee;

    --sans: 'IBM Plex Sans', ui-sans-serif, system-ui, 'Segoe UI', sans-serif;
    --serif: 'IBM Plex Serif', ui-serif, Georgia, serif;

    max-width: 830px;
    margin: 0 auto;
    padding: 58px 60px 46px;
    background: var(--paper);
    color: var(--ink);
    font: 400 15px/1.55 var(--sans);
    -webkit-font-smoothing: antialiased;
    box-shadow:
      0 1px 2px rgba(20, 23, 28, 0.06),
      0 12px 32px rgba(20, 23, 28, 0.09);
  }

  /* ---- masthead ---- */

  .masthead {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 40px;
    padding-bottom: 34px;
    border-bottom: 3px solid var(--accent);
  }

  /* The payer's own name where the nota puts the restaurant's: on this page the
     person reading it is the subject, not the place. */
  .brand__mark {
    margin: 0;
    font: 600 23px/1.1 var(--serif);
    letter-spacing: -0.015em;
  }

  .brand__sub {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--ink-2);
  }

  .doc {
    flex: none;
    text-align: right;
  }

  .doc__title {
    margin: 0 0 6px;
    font: 500 12px/1 var(--sans);
    color: var(--ink-3);
  }

  .due {
    margin: 0;
    font: 600 34px/1 var(--serif);
    letter-spacing: -0.02em;
    color: var(--accent);
  }

  .cur {
    margin-right: 4px;
    font: 400 15px/1 var(--sans);
    color: var(--accent-deep);
  }

  .part {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--ink-2);
  }

  /* ---- sections ---- */

  .block {
    margin-top: 44px;
  }

  .section-label {
    margin: 0 0 16px;
    font: 500 12px/1 var(--sans);
    color: var(--ink-3);
  }

  .section-note {
    margin: -8px 0 20px;
    max-width: 52ch;
    font-size: 13px;
    line-height: 1.6;
    color: var(--ink-2);
  }

  /* ---- how to pay ---- */

  .pay {
    display: flex;
    align-items: flex-start;
    gap: 26px;
  }

  .pay__qr {
    flex: none;
    width: 220px;
    height: 220px;
    padding: 12px;
    border: 1px solid var(--rule);
    border-radius: 6px;
    background: var(--paper);
  }

  .pay__body {
    max-width: 48ch;
  }

  .pay__lead {
    margin: 0 0 8px;
    font: 600 16px/1.3 var(--sans);
  }

  .pay__line {
    margin: 0 0 16px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--ink-2);
  }

  /* The account number is the one thing on this page somebody copies by hand,
     so it is set the way the nota sets a figure. */
  .pay__dest {
    margin: 0;
    font: 600 16px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-variant-numeric: tabular-nums;
  }

  /* ---- upload ---- */

  .upload {
    display: block;
    margin-top: 8px;
    padding: 16px;
    border: 1px solid var(--accent);
    border-radius: 8px;
    background: var(--accent);
    color: #fff;
    text-align: center;
    font: 600 15px/1.4 var(--sans);
    cursor: pointer;
  }

  .upload:first-of-type {
    margin-top: 0;
  }

  .upload.secondary {
    background: none;
    border-color: var(--rule);
    color: var(--ink-2);
    font-weight: 500;
  }

  .upload input {
    display: none;
  }

  .upload.busy {
    opacity: 0.5;
    pointer-events: none;
  }

  /* ---- the settled band ---- */

  .band {
    margin-top: 34px;
    padding: 20px 22px;
    border-top: 3px solid var(--accent);
    border-radius: 0 0 6px 6px;
    background: var(--accent-wash);
  }

  .band__label {
    margin: 0;
    font: 600 26px/1.1 var(--serif);
    letter-spacing: -0.02em;
    color: var(--accent-deep);
  }

  .band__note {
    margin: 8px 0 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--ink-2);
  }

  /* ---- notices ---- */

  .notice {
    margin-top: 14px;
    padding: 14px 16px;
    border-radius: 6px;
  }

  .notice.bad {
    background: var(--bad-wash);
    border: 1px solid #f3c9c2;
  }

  .notice.warn {
    background: var(--rule-soft);
    border: 1px solid var(--rule);
  }

  .notice-title {
    margin: 0 0 4px;
    font: 600 14px/1.3 var(--sans);
  }

  .notice.bad .notice-title {
    color: var(--bad);
  }

  .notice-body {
    margin: 0;
    font-size: 14px;
    line-height: 1.55;
    color: var(--ink-2);
  }

  .msg {
    padding: 3rem 0;
    text-align: center;
    color: var(--ink-2);
  }

  /* ---- narrow screens ---- */

  @media (max-width: 720px) {
    .sheet {
      padding: 34px 26px 32px;
    }

    .masthead {
      flex-direction: column;
      gap: 26px;
      padding-bottom: 26px;
    }

    .doc {
      text-align: left;
    }

    .pay {
      flex-direction: column;
      gap: 18px;
    }
  }
</style>
