# DUO — split-bill PWA

Photograph a receipt, assign each item to the people who ordered it, and
send the group a nota they can read and pay from. Indonesian UI, one
operator per account, a handful of friends per bill. **Live at
<https://splitfair.xyz>.**

Everything lives in `DUO/`. **Read [`DUO/CLAUDE.md`](DUO/CLAUDE.md) before
touching anything** — it carries the deploy model (code ships itself, the
schema does not), the design constraints, and the traps that look like bugs
and are not.

Deploys run from `.github/workflows/` on a push to `main`.

**No credentials are committed.** DUO reads its keys from a gitignored
`.env.local`; `DUO/.env.example` lists the variables and where to get them.
