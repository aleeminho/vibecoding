# vibecoding

Personal projects. Each lives in its own folder with its own README, its own
`.env.example`, and its own toolchain — this file is only a map.

| Folder | What it is | Stack |
|---|---|---|
| [`DUO/`](DUO/) | Split-bill PWA. Photograph a receipt, the model reads it, you assign each line to whoever ordered it, and it tracks who has paid you back. | Vite + Svelte 5, Supabase, Bun |

## Notes

- **Nothing here is deployed from this repository.** DUO's front end runs
  locally and is installed to a phone as a PWA; its one server-side piece is a
  Supabase Edge Function, deployed with the Supabase CLI.
- **No credentials are committed.** Every project reads its keys from a
  gitignored `.env.local`. The `.env.example` files in each project list the
  variables and where to get them, with empty values.
