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

Full design: `claude:nbweb-claude — Plugin Design v2 (two-market rewrite,
2026-07-09)` in the author's own `nb` notebook.

---

## Status

**Proof of concept proven, 2026-07-09.** Market 1's foundational path works
end to end, verified with real accounts and a real Anthropic call, not just
designed:

- `claude:` FM cascade (note override → notebook config → off), rendered as
  a badge on the note toolbar — both cascade tiers confirmed live.
- Clicking the badge opens a Q&A modal; asking a real question shells out to
  a real `claude -p` call and returns a real, correctly-parsed response.

**Known, load-bearing limitation, not a bug:** the current design shells out
to the *host machine's* own authenticated `claude` CLI, so every click uses
the same one Anthropic account regardless of who's asking. Correct for
today's single-user reality (one person, one laptop, one already-authenticated
CLI) — but this does not yet generalize to a second real user. Per-user auth
is the next real fork, deliberately deferred rather than solved here.

Everything else in the design doc (Market 2's agent-orchestration track, the
MCP context-scoping wrapper, budget/cost tracking, multi-agent dashboard) is
designed but not yet built. See the full design:
`claude:nbweb-claude — Plugin Design v2 (two-market rewrite, 2026-07-09)`
in the author's own `nb` notebook.
