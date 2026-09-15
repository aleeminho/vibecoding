/**
 * Pin the app to phone width while developing on a desktop. Dev only.
 *
 * The problem: Chrome on Windows refuses to make a window narrower than about
 * 500 CSS pixels, and `--window-size=460` does not override it. The screenshot
 * comes out 460 wide of a 500-wide page, so the right-hand 40 pixels are
 * CROPPED rather than reflowed. Everything flush to the right edge looks
 * chopped, which reads exactly like a horizontal overflow bug.
 *
 * That misdiagnosis has already happened once in this project, and it nearly
 * happened a second time. A frame is cheaper than the lesson.
 *
 * The frame goes on #app rather than on a wrapper element for two reasons:
 *
 *   1. The chrome — nav bar, tab bar — lives in App.svelte, OUTSIDE any route
 *      component. A wrapper inside a route would constrain the content and
 *      leave the chrome at viewport width, so the preview would lie about the
 *      layout it exists to check.
 *   2. `position: sticky` keeps working, because the scrolling ancestor is
 *      still the document. A fixed-width wrapper with its own scroll would
 *      change how the sticky bars behave and stop being a faithful preview.
 *
 * It applies between 420px and the desktop breakpoint. Below 420px the frame
 * would do nothing anyway, but without a query it would still draw its hairline
 * outline along the real screen edge; at 1100px and up the app has a real
 * desktop layout — rail and two-pane screens — and a phone frame there would
 * hide the very thing the wide screen is for.
 */

const ID = 'duo-dev-frame'

export function applyPhoneFrame(): void {
  // Idempotent: App mounts once today, but a second call should not stack
  // stylesheets.
  if (document.getElementById(ID)) return

  const style = document.createElement('style')
  style.id = ID
  style.textContent = `
    @media (min-width: 420px) and (max-width: 1099.98px) {
      #app {
        max-width: 390px;
        margin: 0 auto;
        box-shadow: 0 0 0 1px rgba(20, 22, 28, 0.16);
      }
    }
  `
  document.head.appendChild(style)
}
