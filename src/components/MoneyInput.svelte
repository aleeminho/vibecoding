<script lang="ts">
  /**
   * A number input for rupiah, shared by the header fields and the item rows.
   *
   * The operator is reading numbers off a photo and typing corrections, so this
   * has to survive them mid-keystroke: typing "2" on the way to "25000" must not
   * momentarily set the field to 2 and cascade through every live total.
   *
   * The trick is `editing`. While it holds a string, that string is what the
   * input shows and the prop is ignored. On blur it clears, and the display
   * falls back to the canonical rendering of the value. There is no effect
   * syncing the two, which would both re-introduce the echo problem and risk a
   * self-triggering loop.
   *
   * It accepts the formats a receipt actually prints, via parseRupiah, so
   * pasting "25.000" works.
   */
  import { parseRupiah, rupiahDigits } from '../lib/format'

  let {
    value,
    onchange,
    label,
  }: {
    value: number
    onchange: (next: number) => void
    label?: string
  } = $props()

  /** Null means "not mid-edit", so show the prop instead. */
  let editing = $state<string | null>(null)

  const display = $derived(editing ?? rupiahDigits(value))

  function handleInput(event: Event) {
    editing = (event.currentTarget as HTMLInputElement).value
    const parsed = parseRupiah(editing)
    // Unparseable text is left alone rather than pushed upward as a zero. The
    // field simply stops contributing until it reads as a number again.
    if (parsed !== null) onchange(parsed)
  }

  function handleBlur() {
    const parsed = editing === null ? null : parseRupiah(editing)
    if (parsed !== null && parsed !== value) onchange(parsed)
    // Drop the edit buffer, so the field snaps back to a canonical rendering
    // and a half-typed or nonsense value does not sit there looking accepted.
    editing = null
  }
</script>

<label>
  {#if label}<span class="label">{label}</span>{/if}
  <input
    class="num"
    type="text"
    inputmode="numeric"
    autocomplete="off"
    value={display}
    oninput={handleInput}
    onblur={handleBlur}
  />
</label>

<style>
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .label {
    font-size: var(--text-xs);
    color: var(--label-2);
  }

  input {
    text-align: right;
    min-width: 0;
  }
</style>
