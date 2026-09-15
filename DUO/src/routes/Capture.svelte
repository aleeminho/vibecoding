<script lang="ts">
  /**
   * Capture: get the photo in, hand it to the model, land on Review.
   * Spec section 3, steps 1 and 2.
   *
   * TWO WAYS IN, and the second one matters more than it looks.
   *
   * `capture="environment"` goes straight to the camera, which is right at a
   * restaurant table: the receipt is in hand and the photo needs to be
   * readable, not the last one in the library.
   *
   * But an input with `capture` can ONLY open the camera. There is no way to
   * reach the photo library from it at all. So anyone who photographed the
   * receipt earlier and is filing it later — the normal case for anything
   * deferred past the meal — would have no way in. Hence a second input,
   * without `capture`, which lets iOS offer the library instead.
   *
   * The photo never leaves the phone at full size. It is downscaled to 1568px
   * and re-encoded as JPEG first (image.ts), because iPhone captures are HEIC —
   * which the vision API will not accept at all — and because uploading a full
   * resolution capture from a restaurant with bad signal means the operator
   * stands there watching a spinner. Gallery photos are very often HEIC too,
   * which is exactly the case that fallback chain in image.ts exists for.
   */
  import { prepareReceiptImage } from '../lib/image'
  import { extractReceipt } from '../lib/api'
  import { draft } from '../lib/draft.svelte'

  let { onReview }: { onReview: () => void } = $props()

  let cameraInput = $state<HTMLInputElement | null>(null)
  let galleryInput = $state<HTMLInputElement | null>(null)
  let preview = $state<string | null>(null)
  let stage = $state<'idle' | 'preparing' | 'reading' | 'error'>('idle')
  let message = $state('')

  async function handleFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    stage = 'preparing'
    message = ''
    preview = null

    try {
      const photo = await prepareReceiptImage(file)
      preview = photo.dataUrl

      stage = 'reading'
      const extraction = await extractReceipt(photo.base64)

      draft.start(photo, extraction)
      stage = 'idle'
      onReview()
    } catch (err) {
      stage = 'error'
      message = (err as Error).message
    } finally {
      // Clear the input so that picking the SAME file again still fires a
      // change event. Without this, retrying after an error silently does
      // nothing if they choose the same photo.
      input.value = ''
    }
  }

  function reset() {
    stage = 'idle'
    message = ''
    preview = null
  }
</script>

<div class="screen">
  {#if stage === 'idle'}
    <div class="group">
      <div class="list">
        <div class="row hero">
          <div class="hero-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2a1.5 1.5 0 0 0 1.25-.67l.6-.9A1.5 1.5 0 0 1 9.8 4.8h4.4a1.5 1.5 0 0 1 1.25.67l.6.9A1.5 1.5 0 0 0 17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
              <circle cx="12" cy="13" r="3.3" />
            </svg>
          </div>
          <p class="hero-title">Foto struknya</p>
          <p class="hero-sub">Modelnya baca dan ngisi angkanya. Lu yang cek dan bagiin ke tiap orang — nggak ada yang kesimpen sebelum lu nyimpen.</p>
        </div>
      </div>
    </div>

    <input
      bind:this={cameraInput}
      type="file"
      accept="image/*"
      capture="environment"
      onchange={handleFile}
      hidden
    />
    <input bind:this={galleryInput} type="file" accept="image/*" onchange={handleFile} hidden />

    <div class="group">
      <button class="primary" onclick={() => cameraInput?.click()}>Ambil foto struk</button>
      <button class="tinted" onclick={() => galleryInput?.click()}>Pilih dari galeri</button>
    </div>
  {:else if preview}
    <div class="group">
      <img class="preview" src={preview} alt="Struk yang difoto" />
    </div>
    <div class="group">
      <div class="list">
        <div class="row working">
          <span class="spinner"></span>
          <span>{stage === 'preparing' ? 'Menyiapkan foto…' : 'Membaca struknya…'}</span>
        </div>
      </div>
    </div>
  {:else if stage === 'error'}
    <div class="group">
      <div class="list">
        <div class="row error-text">{message}</div>
      </div>
    </div>
    <div class="group">
      <button class="primary" onclick={reset}>Coba lagi</button>
    </div>
  {/if}
</div>

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

  /*
   * The blank form: a dashed frame where a photo will be written in, with the
   * head of the pad's stamp square. It is the one place in the app that invites
   * rather than reports.
   */
  .hero {
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 6px;
    padding: 30px 24px;
  }

  .hero-icon {
    width: 64px;
    height: 64px;
    display: grid;
    place-items: center;
    margin-bottom: 8px;
    border: 1.5px dashed var(--rule-strong);
    border-radius: var(--radius);
    background: var(--write-in);
    color: var(--stamp-deep);
  }

  .hero-icon svg {
    width: 38px;
    height: 38px;
  }

  .hero-title {
    font-size: var(--text-lg);
    font-weight: 700;
    letter-spacing: -0.015em;
  }

  .hero-sub {
    font-size: var(--text-sm);
    color: var(--ink-2);
    max-width: 30ch;
  }

  /* The photo is clipped to the form like a print in a paper frame. */
  .preview {
    max-height: 46dvh;
    object-fit: contain;
    border-radius: var(--radius);
    background: #000;
    margin: 0 16px;
    width: calc(100% - 32px);
    border: 6px solid #fff;
    outline: 1px solid var(--rule-strong);
  }

  .working {
    gap: 10px;
    color: var(--ink-2);
    font-size: var(--text-sm);
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--rule);
    border-top-color: var(--stamp);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .error-text {
    color: var(--bad);
    font-size: var(--text-sm);
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation-duration: 2s;
    }
  }

  /* One quiet form on a wide desk, still one action. */
  @media (min-width: 1100px) {
    .screen {
      max-width: 560px;
      margin: 0 auto;
      padding-top: 34px;
    }
  }
</style>
