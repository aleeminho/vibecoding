# vibecoding — monorepo

Three separate projects, no shared code. **This repo is public.**

| | |
|---|---|
| `DUO/` | Split-bill PWA, live at <https://splitfair.xyz> |
| `uno/` | — |
| `netlimiterlite/` | C++/WinDivert bandwidth limiter |

## Working on DUO

**Read `DUO/CLAUDE.md` first.** It carries the things that cost real time to
learn: the deploy model (code ships itself, the schema does not), the design
constraints, and the traps that look like bugs and are not.

Deploys for all three projects run from `.github/workflows/` on a push to `main`.
