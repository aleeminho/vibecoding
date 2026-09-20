# vibecoding — monorepo

One active project, `DUO/`, plus a few loose files at the root. No shared
code. **This repo is public.** It is also the machine's backup — see
"Machine memory" at the bottom.

| | |
|---|---|
| `DUO/` | Split-bill PWA, live at <https://splitfair.xyz> |
| `extract_bupot.py` | BPPU (Coretax tax-withholding) PDF field extractor, standalone |
| `main.py`, `test.CSV`, `test - Copy.CSV` | scratch and HWiNFO logs, kept as-is |

## Working on DUO

**Read `DUO/CLAUDE.md` first.** It carries the things that cost real time to
learn: the deploy model (code ships itself, the schema does not), the design
constraints, and the traps that look like bugs and are not.

Deploys run from `.github/workflows/` on a push to `main`.

## Machine memory (read this after a fresh Windows install)

This repo was tidied on 2026-09-20, right before Windows was reinstalled, to
be the one thing to clone afterwards. Three projects were deliberately
deleted at that time — `uno/` (Bun bill-splitter), `pajak-chatbot/` (Next.js
tax chatbot), `netlimiterlite/` (C++/WinDivert limiter). They are gone on
purpose; do not recreate them or look for them.

### Tools to reinstall

| what | command |
|---|---|
| Git | `winget install Git.Git` |
| GitHub CLI | `winget install GitHub.cli` |
| Node.js LTS | `winget install OpenJS.NodeJS.LTS` |
| Claude Code | `winget install Anthropic.ClaudeCode` |
| bun | `powershell -c "irm bun.sh/install.ps1 \| iex"` |
| opencode | `bun add -g opencode-ai@1.18.31` |
| 9router (local model router, serves localhost:20128) | `bun add -g 9router@0.5.75`, start with `bunx 9router` |

Then `gh auth login` and clone `https://github.com/aleeminho/vibecoding.git`.

opencode also needs `%USERPROFILE%\.config\opencode\opencode.jsonc` (holds
the ponytail plugin and the `9r` provider; no secrets in it):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@dietrichgebert/ponytail"],
  "provider": {
    "9r": {
      "name": "9router",
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://localhost:20128/v1" },
      "models": {
        "gemini/gemini-3.8-flash": { "name": "gemini 3.8 flash" },
        "guts/deepseek-v4-pro": { "name": "deepseek v4 pro" },
        "ds/deepseek-v4-flash": { "name": "deepseek v4 flash" }
      }
    }
  }
}
```

### Plugins and skills to reinstall

Claude Code had all three of these enabled, from these marketplaces:

```
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin marketplace add DietrichGebert/ponytail
claude plugin marketplace add pbakaus/impeccable
claude plugin install frontend-design@claude-plugins-official
claude plugin install ponytail@ponytail
claude plugin install impeccable@impeccable
```

`impeccable` lands in `~/.claude/skills/impeccable/`, which is also the copy
opencode reads. `ponytail` runs as an opencode plugin via the config above
and as a Claude plugin; neither needs a separate install.

### Secrets live outside the repo

- `~/.claude/settings.json` — `ANTHROPIC_AUTH_TOKEN` (the DeepSeek key) and
  the enabled-plugin list.
- `~/.local/share/opencode/auth.json` — opencode provider keys; re-add with
  `opencode auth login`.
- `DUO/.env.local` — Supabase keys; see `DUO/.env.example`.

None of these are committed, because this repo is public.
