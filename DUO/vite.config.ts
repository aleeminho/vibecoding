import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  /**
   * GitHub Pages serves this app from a subpath — `aleeminho.github.io/
   * vibecoding/` — so every asset URL in the build has to carry that prefix.
   * Without it the HTML loads and then every script, stylesheet and icon 404s,
   * which looks like a blank page rather than like a path problem.
   *
   * Applied to the BUILD only. In dev the server would mount under the same
   * prefix, so the app would move to localhost:5173/vibecoding/ and the LAN URL
   * bookmarked on the phone would quietly stop working. The prefix is a fact
   * about where Pages puts the files, not about the app.
   */
  base: command === 'build' ? '/vibecoding/' : '/',
  plugins: [svelte()],
}))
