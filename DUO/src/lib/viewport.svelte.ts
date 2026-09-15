/**
 * The one breakpoint where the app stops being a phone column.
 *
 * The shell and the routes both need it — the rail appears, the tab bar goes,
 * and Tagihan opens its two panes — and they must agree, so it lives here
 * rather than as a magic number in three media queries.
 */
const query = '(min-width: 1100px)'

const media = typeof window === 'undefined' ? null : window.matchMedia(query)

export const desktop = $state({ current: media?.matches ?? false })

media?.addEventListener('change', (event) => {
  desktop.current = event.matches
})
