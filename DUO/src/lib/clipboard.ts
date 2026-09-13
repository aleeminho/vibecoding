/**
 * Copy to the clipboard.
 *
 * `navigator.clipboard` needs a secure context, which the app has in production
 * and on localhost — but not when it is opened over plain HTTP on a LAN address
 * from a phone, which is exactly how it gets tested during development. The
 * textarea fallback exists for that case, not for old browsers.
 *
 * This file used to hold a WhatsApp message builder as well. That was deleted:
 * a wall of numbers in a proportional font is unreadable and uncheckable in a
 * group chat, and it has been replaced by a document (routes/Nota.svelte) that
 * people can actually read and that carries the arithmetic with it.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the fallback rather than failing the tap
  }

  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
