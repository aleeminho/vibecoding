import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? withSlashes(process.env.BASE_PATH) : '/',
  plugins: [svelte()],
}))

/**
 * There are two places this app is published, and they serve it from different
 * paths, so the prefix cannot be a constant:
 *
 *   GitHub Pages    aleeminho.github.io/vibecoding/   ->  BASE_PATH=vibecoding
 *   cPanel hosting  the domain root or a subfolder    ->  (unset, gives "/")
 *
 * Getting it wrong does not fail the build. The HTML loads and then every
 * script, stylesheet and icon 404s, which reads as a blank page rather than as
 * a path problem — so the Pages workflow sets it explicitly instead of relying
 * on a default.
 *
 * BASE_PATH is a BARE SEGMENT, without slashes, and that is not a style choice.
 * Git Bash on Windows rewrites an argument that starts with `/` into a Windows
 * path, so `BASE_PATH=/vibecoding/ bun run build` produces assets at
 * `/Program Files/Git/vibecoding/...` — a build that looks like it worked and
 * is broken in every browser. A bare word is not a path, so it survives.
 *
 * Deliberately OFF in dev. With it applied the dev server would mount under the
 * prefix, moving the app to localhost:5173/vibecoding/ and quietly breaking the
 * LAN URL bookmarked on the phone. The prefix is a fact about where the files
 * are served from, not about the app.
 */
function withSlashes(segment: string | undefined): string {
  const trimmed = segment?.replace(/^\/+|\/+$/g, '') ?? ''

  // Strip slashes is not enough on its own. Git Bash turns `/vibecoding/` into
  // `C:/Program Files/Git/vibecoding` BEFORE vite ever sees it, so the damage
  // is a whole Windows path and there are no leading slashes left to strip.
  // That value builds happily and deploys a site whose every asset 404s, so it
  // is rejected here instead of being passed through.
  if (trimmed && !/^[A-Za-z0-9._~-]+$/.test(trimmed)) {
    throw new Error(
      `BASE_PATH="${segment}" is not a plain path segment.\n` +
        `  Expected something like "vibecoding" — no slashes, no colons, no spaces.\n` +
        `  On Git Bash for Windows a leading slash gets rewritten into a Windows\n` +
        `  path before vite reads it, which produces a build that looks fine and\n` +
        `  serves nothing. Run it as: BASE_PATH=vibecoding bun run build`,
    )
  }

  return trimmed ? `/${trimmed}/` : '/'
}
