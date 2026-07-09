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

Early scaffold. No functional code yet — see the design doc for the full
plan and build order.
