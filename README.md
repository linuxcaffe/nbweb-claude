- Project: https://github.com/linuxcaffe/nbweb-claude
- Issues:  https://github.com/linuxcaffe/nbweb-claude/issues

# NbWeb-claude

Claude Code integration for [nb-web](https://github.com/linuxcaffe/nb-web) —
context-aware AI help without re-narrating your setup, for two different
audiences at once.

---

## TL;DR

- **Stumped-user help** — a `claude:` badge on any note opens a read-only
  Q&A modal, scoped to your own access level, using context nb-web already
  has on disk (config chains, docs, checks) instead of asking you to explain
  your setup first.
- **Claude Code developer orchestration** — pick up a `#agent`-tagged todo
  and the note itself becomes the durable record: a live terminal console
  embedded in the note, prose appended around it as work happens, the
  notebook's own list view doubling as a multi-agent activity dashboard.
- **100% opt-in, zero-AI-or-full-AI, no database.** Session transcripts are
  already files on disk — same bet nb-web makes everywhere else.
- Presumes a working, authenticated local `claude` CLI. This is a front-end
  onto that, not a new credential store.
- `mcp_server.py` requires `pip install mcp httpx` on the nb-web host.

Full design: `claude:nbweb-claude — Plugin Design v2 (two-market rewrite,
2026-07-09)` in the author's own `nb` notebook.

---

## Status

**Market 1's full read path proven, 2026-07-09** — badge, modal, real
`claude -p` call, and now real MCP-backed tool access, all verified end to
end with real accounts:

- `claude:` FM cascade (note override → notebook config → off), rendered as
  a badge on the note toolbar — both cascade tiers confirmed live.
- Clicking the badge opens a Q&A modal; asking a real question shells out to
  a real `claude -p` call and returns a real, correctly-parsed response.
- `mcp_server.py` — a thin MCP server (stdio transport, Python `mcp` SDK)
  wrapping `/api/notes`, `/api/note`, `/api/nb/backlinks`,
  `/api/nb/notebook-config`. Zero new enforcement code: every tool call is
  just an HTTP request back to nb-web's own already-access-checked REST API.
  `/api/claude/ask` mints a short-lived, single-request-scoped token per
  question (`_mint_mcp_token`, nb-web's `app.py`) and hands it to the
  `claude -p` subprocess via `--mcp-config`; a `before_request` check
  resolves that token back to the real asking user, so the MCP server's own
  calls run under the *same* `_can_access`/`effective_access` gating as if
  it were that user's own browser session. Verified live: a real `claude -p`
  turn called `list_notes` over MCP and returned real, correctly-scoped note
  data pulled through the actual REST API — and a forged/expired token is
  rejected with 401 before it ever reaches a handler.

**Known, load-bearing limitation, not a bug:** the current design shells out
to the *host machine's* own authenticated `claude` CLI, so every click uses
the same one Anthropic account regardless of who's asking — the MCP wrapper
above scopes *data access* per user, not *which Anthropic account pays*.
Correct for today's single-user reality (one person, one laptop, one
already-authenticated CLI) — but this does not yet generalize to a second
real user. Per-user Claude auth is the next real fork, deliberately deferred
rather than solved here.

Still not built: Market 2's agent-orchestration track, budget/cost tracking,
the multi-agent dashboard. See the full design:
`claude:nbweb-claude — Plugin Design v2 (two-market rewrite, 2026-07-09)`
in the author's own `nb` notebook.
