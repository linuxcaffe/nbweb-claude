- Project: https://github.com/linuxcaffe/nbweb-claude
- Issues:  https://github.com/linuxcaffe/nbweb-claude/issues

# NbWeb-claude

Claude Code integration for [nb-web](https://github.com/linuxcaffe/nb-web) —
context-aware AI help without re-narrating your setup, and a real,
supervised way to hand a todo to an agent and watch it work, for two
different audiences at once.

---

## TL;DR

- **Stumped-user help** — a `claude:` badge on any note opens a chat panel,
  scoped to your own access level, using context nb-web already has on disk
  (config chains, docs, checks) instead of asking you to explain your setup
  first.
- **Todo-driven agent work** — write a todo the way you normally would, ask
  the panel to draft a testable completion condition from it, review what
  it proposes, then launch it for real. The launched run streams live
  (assistant text, tool calls, as they happen), is capped by an external
  turn/cost circuit breaker regardless of what its own condition says, and
  can be constrained to a declared set of files it's allowed to touch.
- **100% opt-in, zero-AI-or-full-AI, no database.** Session transcripts are
  already files on disk — same bet nb-web makes everywhere else.
- Presumes a working, authenticated local `claude` CLI. This is a front-end
  onto that, not a new credential store.
- `mcp_server.py` requires `pip install mcp httpx` on the nb-web host.

Full design history: `claude:nbweb-claude — Plugin Design v2 (two-market
rewrite, 2026-07-09)` and its addenda, in the author's own `nb` notebook.

---

## What it does

**The badge and the chat panel.** `claude:` is a cascading frontmatter key
(note overrides notebook, notebook overrides off) that controls whether the
badge shows at all, and which model answers. Tapping it opens the
`claude_ask` panel — a chat surface that lives in the note's own FM strip,
not a modal that blocks the page. It doubles as the session's control
panel: a status dot and context-fill percentage, the ledger-resolved
account this session's cost rolls up to, cost-so-far pulled live from the
accounting ledger, a rate-limit indicator (quiet unless something's
actually constrained), a permissions gear (scoped edit/commit/push
checkboxes for any terminal it opens), and an explicit End Session button.

**Turning a todo into a supervised, bounded piece of agent work.** Ask the
panel something like *"can you draft a testable goal from this todo?"* and
it can write a real completion condition onto the note's own frontmatter —
not just say it in chat — using `claude_goal:` (the condition),
`claude_goal_bound:` (a turn count), and `claude_goal_scope:` (which files
the work must stay within). You review what it proposed, edit it if you
want, then hit **Run Goal**, which assembles the real `/goal <condition> or
stop after N turns` command and launches it through the same live-streaming
path. From there:

- **The circuit breaker** kills the run if it crosses a turn or token
  threshold, regardless of whatever bound its own condition states — the
  condition text is a hint the model may or may not honor, this is the
  actual enforcement.
- **The scope guardrail** checks every file a tool call touches against the
  declared scope and kills the run the moment something falls outside it,
  before the write ever lands on disk.
- **A stopped-early run** (circuit breaker, scope violation, or timeout) is
  still logged to the ledger and still marked on the note (`claude_status:
  waiting`) — never a silent, unaccounted-for gap.
- **A live terminal**, when one's opened via `claude_code:`, runs inside a
  named `tmux` session keyed to the Claude session id, so navigating away
  and back re-attaches to the same still-running process instead of
  killing it.

**Everywhere, the session gets real context, not a cold start.** The
subprocess's working directory resolves to the actual code repository a
todo concerns (via `claude_account:` looked up against nb-web's own repo
registry), not just the notes notebook the todo happens to live in — which
also means the repo's own `CLAUDE.md` gets a chance to auto-load. Dev-tier
sessions also get a curated excerpt of nb-web's own todo-tag conventions
(`#agent`, `#discuss`, and so on) injected, so a session knows a
`#discuss`-tagged todo means "stop and clarify," not "go implement it."

---

## How it works, superficially

- **No stored Anthropic credential.** Every call shells out to the host's
  own already-authenticated `claude` CLI (`claude -p ... --resume ...`).
  This plugin is a front-end onto that, not a second auth system.
- **Streaming, not one blocking call.** The backend runs `claude` with
  `--output-format stream-json`, reading one JSON event per line as the CLI
  works — the same event stream that lets the circuit breaker and scope
  guardrail see (and act on) tool calls as they happen, that surfaces
  account-wide rate-limit state for free, and that the chat panel renders
  live over a websocket instead of showing a spinner until everything's
  done.
- **MCP for tool access, not shell access.** A small MCP server
  (`mcp_server.py`, stdio transport) wraps a handful of nb-web's own REST
  endpoints — `list_notes`, `get_note`, `search_backlinks`,
  `get_notebook_config`, `list_templates`, `create_note`, `toggle_todo`,
  `set_annotation`, `reload_note`, plus `append_to_note` and
  `set_goal_fields` for dev-tier sessions only. Every tool is a couple of
  lines of HTTP against an endpoint that's already access-checked on the
  nb-web side (`_can_access`, guest-invisible filtering, level gating) —
  this process adds no new enforcement of its own, it's just another
  caller of an already-enforced API, authenticated via a short-lived,
  single-request-scoped token minted per question.
- **`--strict-mcp-config` on every dev-tier call**, so a session only ever
  has the tools this server explicitly hands it — no native shell/file
  tools smuggled in alongside.
- **The ledger is the only source of truth for token/cost totals**
  (`claude:accounting/agent_sessions.md`, one entry per call) — a note's
  own `claude_context:` is a cheap current-snapshot, never a second
  bookkeeping system tracking the same fact.

---

## Status

Both tracks from the original two-market design are substantially built
and verified against a real running server, not just unit-tested in
isolation — the chat panel, the MCP toolset, the ledger, the goal-drafting
pipeline, the circuit breaker and scope guardrail, and the live streaming
UX have all been exercised end to end against real notes and real `claude`
sessions.

**Known, load-bearing limitation, not a bug:** every call shells out to the
*host machine's* own authenticated `claude` CLI, so every click uses the
same one Anthropic account regardless of who's asking. Correct for today's
single-user reality — doesn't yet generalize to a second real user.
Per-user Claude auth is deliberately deferred, not solved here.

Still open, not yet built: an "Interrupt" control distinct from the
existing hard-kill End Session button (a soft stop that leaves a session
resumable, matching Claude Code's own Ctrl+C semantics); a module-checkout
UI for constraining agent work by picking from known files rather than
writing a free-text scope pattern; verified auto-mode classifier behavior
(the permission mode itself works, but its safety classifier has never
been observed actually blocking anything in practice). Full detail and
reasoning trail in the design docs and session notes in the author's own
`nb` notebook (`claude:` notebook, search for `nbweb-claude`).
