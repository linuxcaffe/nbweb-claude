// NbWeb-claude — Claude Code integration for nb-web
// Two markets: (1) stumped-user badge+modal Q&A, (2) Claude Code developer
// agent orchestration (#agent todo -> project-file graduation, live tui
// console, notebook-as-dashboard). Full design:
// claude:nbweb-claude — Plugin Design v2 (two-market rewrite, 2026-07-09)
// @name     NbWeb Claude
// @version  0.2.0
// @type     ecosystem
// @homepage
(() => {

    // ── Rung 1: claude_ask barblock ─────────────────────────────────────────
    // 2026-07-10: moved out of a fixed panel inserted after the preview
    // toolbar (permanently pushed the note body down, wasn't collapsible --
    // a long conversation had nowhere to go but block the page). Now a
    // regular FM-block-doubling codeblock (same mechanism claude_code
    // already uses): `claude_ask: <session_id>` in frontmatter renders the
    // same chat UI in the collapsible FM strip instead. One HTML builder +
    // one wire function backs three call sites -- the codeblock renderer
    // (existing claude_ask: FM key), the badge's fresh-start case (no FM
    // key yet), and re-focusing an already-open block -- not three
    // separate implementations of the same chat UI.
    //
    // Session continuity: the session id is now written back into the
    // note's own claude_ask: FM field server-side (_update_note_ai_stats,
    // app.py), the same checkpoint that already logs tokens/status --  not
    // a separate write. That's what lets the badge "read existing" instead
    // of always starting fresh; previously session_id only ever lived in a
    // browser-tab JS variable, gone on reload.
    //
    // Scope note: only the session id persists, not the rendered message
    // transcript -- reopening after a reload shows an empty history with
    // real --resume continuity server-side, not a replayed conversation.
    // Full transcript persistence is a possible future step, not this one.
    //
    // Gate note: unlike claude/claude_code (raw PTY, anyone with note-read
    // access could otherwise watch), /api/claude/ask is already hard-gated
    // server-side to tech-level users (app.py's own level check) -- no
    // per-block read/write gate parsing needed here, that would be
    // redundant with an auth check that already exists.

    const _NOTE_TEXT_CAP = 4000; // see _buildContext below

    function _esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }

    // Live nav/view snapshot, built fresh at ask-time (not open-time) so it
    // reflects whatever the user was doing right up to hitting Ask. Purely
    // informational -- the server folds this into --append-system-prompt,
    // never into an access decision. Every accessor here is already public;
    // no new kernel plumbing needed. noteText capped so one huge note can't
    // blow up every question asked from it -- a tool call (get_note) is
    // still available for anything past this cut.
    function _buildContext() {
        const note = NbMain.activeNote?.();
        return {
            notebook:    NbNav.notebook,
            folder:      NbNav.folder,
            activeCmd:   NbNav.activeCmd,
            sortMode:    NbMain.getSortMode(),
            searchQuery: NbNav.searchQuery,
            tagsQuery:   NbNav.tagsQuery,
            noteType:    note?.type || '',
            noteHelp:    note?.meta?.help || '',
            noteText:    (note?.body || '').slice(0, _NOTE_TEXT_CAP),
        };
    }

    // Status -> color, matching main.js's own _CLAUDE_STATUS_COLOR mapping
    // for the list-row bar exactly (duplicated, not shared -- each file
    // owns its own rendering, this is three lines). 'initiated' and
    // anything a human types by hand stay grey deliberately -- richer
    // colors need a real agent lifecycle behind them, not just a word in
    // frontmatter (see .rules/agent.md's status vocabulary note).
    const _STATUS_COLOR = {
        working: 'var(--orange, #e07b39)',
        waiting: 'var(--red, #ef4444)',
        done:    'var(--green, #4ade80)',
    };

    function _askBlockHtml(sessionId) {
        // No nb-collapsed hardcoded here -- same convention claude_code
        // follows: the FM-block eager-render loop (main.js) decides
        // initial collapse state from localStorage; the badge's
        // fresh-start path explicitly wants it open regardless.
        //
        // Header doubles as the session's control panel -- status dot,
        // context%, account, cost-so-far, permissions, end-session -- all
        // always visible whether the block is collapsed or not, since
        // that's exactly when a glanceable answer to "what's going on
        // here" matters most. 2026-07-11: moved the permission checkboxes
        // out of the body into a popup here, per djp's "too many options
        // for one bar" -- a button that reveals them beats them
        // permanently occupying body space for a choice made once in a
        // while.
        return `<div class="nb-claude-ask-block" data-session-id="${_esc(sessionId || '')}">
            <div class="nb-claude-ask-header">
                <span class="nb-claude-ask-toggle" title="Click to expand/collapse"></span>
                <span class="nb-claude-ask-title" title="Click to expand/collapse">💬 Ask Claude</span>
                <span class="nb-claude-ask-status-dot" data-status=""></span>
                <span class="nb-claude-ask-context"></span>
                <span class="nb-claude-ask-account"></span>
                <span class="nb-claude-ask-cost"></span>
                <span class="nb-claude-ask-ratelimit" hidden title=""></span>
                <button class="nb-claude-ask-perm-btn" title="Configure terminal permissions">⚙</button>
                <button class="nb-claude-ask-end-btn" title="End session">⏹</button>
            </div>
            <div class="nb-claude-ask-perm-popup" hidden>
                <div class="nb-claude-ask-perm-popup-label">If a terminal opens, allow:</div>
                <label><input type="checkbox" data-perm="edit" checked> Edit</label>
                <label><input type="checkbox" data-perm="commit" checked> Commit</label>
                <label><input type="checkbox" data-perm="push"> Push</label>
                <div class="nb-claude-ask-ratelimit-detail"></div>
            </div>
            <div class="nb-claude-ask-goal-banner" hidden>
                <span class="nb-claude-ask-goal-preview"></span>
                <button class="nb-claude-ask-goal-run nb-tool-btn nb-btn-primary">🎯 Run Goal</button>
            </div>
            <div class="nb-claude-ask-body">
                <div class="nb-claude-ask-messages"></div>
                <div class="nb-claude-ask-inputrow">
                    <textarea class="nb-claude-ask-question" placeholder="Ask a question about this note…" rows="2"></textarea>
                    <button class="nb-claude-ask-btn nb-tool-btn nb-btn-primary">Ask</button>
                </div>
            </div>
        </div>`;
    }

    // Matches main.js's own _buildFmBlocks key convention exactly
    // (`nb-fm:${bCls}:${bId}`, bId empty since this block sets no
    // data-cmd/data-query/data-period) -- that's the localStorage key a
    // full note reload's _buildFmBlocks checks to decide initial collapse
    // state. The badge's fresh-start path bypasses _buildFmBlocks entirely
    // (nothing in FM yet to trigger it), so it has to record this itself --
    // otherwise the very next reload (e.g. the one reload_note triggers
    // after Claude writes to the note) rebuilds the block collapsed by
    // default, since nothing was ever recorded as "the user opened this."
    const _ASK_FM_KEY = 'nb-fm:nb-claude-ask-block:';

    function _wireAskBlock(block) {
        if (block.dataset.askWired) return;
        block.dataset.askWired = '1';

        const toggle    = block.querySelector('.nb-claude-ask-toggle');
        const title     = block.querySelector('.nb-claude-ask-title');
        const statusDot = block.querySelector('.nb-claude-ask-status-dot');
        const contextEl = block.querySelector('.nb-claude-ask-context');
        const accountEl = block.querySelector('.nb-claude-ask-account');
        const costEl    = block.querySelector('.nb-claude-ask-cost');
        const rlEl      = block.querySelector('.nb-claude-ask-ratelimit');
        const rlDetail  = block.querySelector('.nb-claude-ask-ratelimit-detail');
        const permBtn   = block.querySelector('.nb-claude-ask-perm-btn');
        const endBtn    = block.querySelector('.nb-claude-ask-end-btn');
        const permPopup = block.querySelector('.nb-claude-ask-perm-popup');
        const permBoxes = [...permPopup.querySelectorAll('input[type=checkbox]')];
        const messages  = block.querySelector('.nb-claude-ask-messages');
        const input     = block.querySelector('.nb-claude-ask-question');
        const askBtn    = block.querySelector('.nb-claude-ask-btn');
        const selector  = NbMain.activeSelector();
        let sessionId   = block.dataset.sessionId || null;

        // Header reflects the note's own current FM state -- called on
        // wire (reading NbMain.activeNote()?.meta, the only source
        // available at that point), and again after every successful ask
        // using the fields the /api/claude/ask response now carries
        // directly (claude_status/claude_context/claude_account), since
        // those are read fresh from disk server-side right after this
        // exact call's writes land -- activeNote()'s cached meta would
        // otherwise show last-reload's values until a full note reload,
        // which a plain conversational turn never triggers (d.reload only
        // fires when Claude wrote to the note body). Cost is always
        // queried fresh from the ledger (session-cost), never cached --
        // same "ledger is truth" principle as everywhere else concerning
        // tokens.
        function _refreshHeader(fields) {
            const src = fields || NbMain.activeNote?.()?.meta || {};
            const status = src.claude_status || '';
            statusDot.style.background = _STATUS_COLOR[status] || 'var(--text-dim, #888)';
            statusDot.title = status ? `status: ${status}` : '';
            const ctx = src.claude_context;
            contextEl.textContent = ctx != null && ctx !== '' ? `${ctx}%` : '';
            const acct = src.claude_account;
            accountEl.textContent = acct || '';
            accountEl.title = acct ? `accounting to ${acct}` : 'no claude_account: set -- see .rules/mcp-tools.md cascade';
            fetch(`/api/claude/session-cost?selector=${encodeURIComponent(selector)}`)
                .then(r => r.json())
                .then(d => { costEl.textContent = d.cost ? `$${d.cost.toFixed(2)}` : ''; })
                .catch(() => {});
        }
        _refreshHeader();

        // Rate-limit info is free once the backend is watching the
        // stream anyway (a rate_limit_event type flows past right after
        // system/init on every real call) -- but it's account-wide,
        // ephemeral state, not note FM, so unlike _refreshHeader there's
        // nothing to show on initial wire; it only populates after the
        // first real ask in this browser session. Quiet by default: the
        // header badge only appears once something isn't plain
        // "allowed" (matches djp's "too many options for one bar" call
        // that already moved permissions into a popup) -- full detail
        // for every known limit type always available in that same
        // popup regardless of whether anything's actually constrained.
        function _refreshRateLimits(rateLimits) {
            if (!rateLimits || !rateLimits.length) return;
            const constrained = rateLimits.filter(rl => rl.status && rl.status !== 'allowed');
            rlEl.hidden = constrained.length === 0;
            if (constrained.length) {
                rlEl.textContent = '⚠ rate-limited';
                rlEl.title = constrained.map(rl => `${rl.rateLimitType}: ${rl.status}`).join(', ');
            }
            rlDetail.innerHTML = rateLimits.map(rl => {
                const resets = rl.resetsAt
                    ? new Date(rl.resetsAt * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})
                    : '?';
                return `<div>${_esc(rl.rateLimitType || 'limit')}: ${_esc(rl.status || '?')} · resets ${resets}</div>`;
            }).join('');
        }

        // Initialize from the note's own current claude_permissions: FM
        // value if set -- "remembered on session," not re-asked on every
        // reload. Falls back to each checkbox's own HTML-default (edit +
        // commit checked, push not) when the note has never had a scope
        // set at all, rather than leaving every box unchecked.
        const savedPerms = (NbMain.activeNote?.()?.meta?.claude_permissions || '').split(',').map(s => s.trim()).filter(Boolean);
        if (savedPerms.length) {
            for (const box of permBoxes) box.checked = savedPerms.includes(box.dataset.perm);
        }

        async function _savePermissions() {
            const permissions = permBoxes.filter(b => b.checked).map(b => b.dataset.perm);
            try {
                await fetch('/api/claude/set-permissions', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({selector, permissions}),
                });
            } catch (e) { /* best-effort -- next launch just resolves whatever last landed */ }
        }
        for (const box of permBoxes) box.addEventListener('change', _savePermissions);

        // Popup toggle, dismiss-on-outside-click -- same pattern as the
        // rest of nb-web's own dropdown menus.
        permBtn.addEventListener('click', e => {
            e.stopPropagation();
            const willShow = permPopup.hidden;
            permPopup.hidden = !willShow;
            if (willShow) {
                setTimeout(() => document.addEventListener('click', function dismiss(ev) {
                    if (!permPopup.contains(ev.target) && ev.target !== permBtn) {
                        permPopup.hidden = true;
                        document.removeEventListener('click', dismiss, true);
                    }
                }, true), 0);
            }
        });
        permPopup.addEventListener('click', e => e.stopPropagation());

        endBtn.addEventListener('click', async e => {
            e.stopPropagation();
            endBtn.disabled = true;
            try {
                await fetch('/api/claude/end-session', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({selector}),
                });
                if (selector) NbMain.openNote(selector, false);
            } catch (e) { /* best-effort */ }
            finally { endBtn.disabled = false; }
        });

        // Only the toggle/title trigger collapse -- gear/end buttons and
        // the popup already stopPropagation their own clicks, but being
        // explicit about what the header's own click target list is
        // avoids ever accidentally wiring a future header addition to
        // toggle collapse by default.
        for (const el of [toggle, title]) {
            el.addEventListener('click', () => {
                const nowCollapsed = block.classList.toggle('nb-collapsed');
                nowCollapsed ? localStorage.removeItem(_ASK_FM_KEY) : localStorage.setItem(_ASK_FM_KEY, '1');
            });
        }

        function _scrollToBottom() {
            messages.scrollTop = messages.scrollHeight;
        }

        function _addMessage(who, text) {
            const row = document.createElement('div');
            row.style.cssText = 'font-size:13px;line-height:1.5';
            const label = document.createElement('div');
            label.style.cssText = who === 'you'
                ? 'font-weight:600;color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.03em'
                : 'font-weight:600;color:var(--accent,#3a7bd5);font-size:11px;text-transform:uppercase;letter-spacing:.03em';
            label.textContent = who === 'you' ? 'You' : 'Claude';
            const body_ = document.createElement('div');
            body_.style.cssText = 'white-space:pre-wrap';
            body_.textContent = text;
            row.append(label, body_);
            messages.appendChild(row);
            _scrollToBottom();
            return body_;
        }

        function _addSpinner() {
            const row = document.createElement('div');
            row.style.cssText = 'font-size:13px;color:var(--text-muted)';
            row.innerHTML = '<span class="nb-spin">⟳</span> Thinking…';
            messages.appendChild(row);
            _scrollToBottom();
            return row;
        }

        // Live over /ws/claude-ask instead of a single blocking POST --
        // the backend (_stream_claude_ask, app.py) pushes assistant text,
        // tool calls, and rate-limit updates as they happen, ending with
        // one 'done' event shaped exactly like the old POST response, so
        // _refreshHeader/_refreshRateLimits/reload logic is unchanged,
        // just triggered from a different transport. A tool call starts a
        // fresh reply bubble (liveRow = null) rather than appending into
        // the prior one, since a new burst of text after a tool result is
        // a new thought, not a continuation of the last sentence.
        //
        // _sendQuestion is the shared engine -- both the textarea's Ask
        // button and the Run Goal banner (below) funnel through this one
        // function, the only difference being what string they hand it
        // ("your typed question" vs. an assembled "/goal <condition> or
        // stop after N turns").
        function _sendQuestion(question) {
            if (!question) return;
            askBtn.disabled = true;
            _addMessage('you', question);
            const spinnerRow = _addSpinner();
            let spinnerGone = false;
            function _clearSpinner() {
                if (!spinnerGone) { spinnerRow.remove(); spinnerGone = true; }
            }
            let liveRow = null;

            let ws;
            try {
                const proto = location.protocol === 'https:' ? 'wss' : 'ws';
                ws = new WebSocket(`${proto}://${location.host}/ws/claude-ask`);
            } catch (e) {
                _clearSpinner();
                const errBody = _addMessage('claude', 'Error: ' + e);
                errBody.style.color = 'var(--red)';
                askBtn.disabled = false;
                return;
            }

            ws.addEventListener('open', () => {
                ws.send(JSON.stringify({
                    selector, question, context: _buildContext(),
                    resume: sessionId || undefined,
                }));
            });

            ws.addEventListener('message', ev => {
                let evt;
                try { evt = JSON.parse(ev.data); } catch { return; }
                _clearSpinner();
                if (evt.kind === 'text') {
                    if (!liveRow) liveRow = _addMessage('claude', '');
                    liveRow.textContent = evt.text;
                    _scrollToBottom();
                } else if (evt.kind === 'tool_use') {
                    liveRow = null;
                    const row = document.createElement('div');
                    row.style.cssText = 'font-size:12px;color:var(--text-dim);font-style:italic';
                    row.textContent = `🔧 ${evt.name}${evt.summary ? ': ' + evt.summary : ''}`;
                    messages.appendChild(row);
                    _scrollToBottom();
                } else if (evt.kind === 'rate_limit') {
                    _refreshRateLimits(evt.rate_limits);
                } else if (evt.kind === 'error') {
                    const errBody = _addMessage('claude', 'Error: ' + evt.message);
                    errBody.style.color = 'var(--red)';
                } else if (evt.kind === 'done') {
                    const d = evt.response;
                    // Always set from d.answer, even if liveRow already
                    // shows the same text from the last 'text' event --
                    // the "stopped early" (circuit breaker/timeout/scope)
                    // case appends a message that was never streamed as
                    // its own text event, only assembled after the loop
                    // ended server-side.
                    if (!liveRow) liveRow = _addMessage('claude', '');
                    liveRow.textContent = d.answer;
                    if (d.session_id) {
                        sessionId = d.session_id;
                        block.dataset.sessionId = d.session_id;
                    }
                    _refreshHeader(d);
                    _refreshRateLimits(d.rate_limits);
                    if (d.reload && selector) NbMain.openNote(selector, false);
                }
            });

            ws.addEventListener('close', () => {
                _clearSpinner();
                askBtn.disabled = false;
                input.focus();
            });

            ws.addEventListener('error', () => {
                _clearSpinner();
                const errBody = _addMessage('claude', 'Error: connection failed');
                errBody.style.color = 'var(--red)';
            });
        }

        function _ask() {
            const question = input.value.trim();
            if (!question) return;
            input.value = '';
            _sendQuestion(question);
        }
        askBtn.addEventListener('click', _ask);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _ask(); }
        });

        // Run Goal -- reads whatever set_goal_fields most recently wrote
        // to this note's FM and launches it for real over the same
        // websocket _sendQuestion already drives. claude_goal_bound: is
        // never stored pre-joined into the condition (see the MCP tool's
        // own docstring) -- assembled into the literal "or stop after N
        // turns" clause only here, at the moment of actually launching,
        // matching exactly what a manual /goal call would look like.
        const goalBanner  = block.querySelector('.nb-claude-ask-goal-banner');
        const goalPreview = block.querySelector('.nb-claude-ask-goal-preview');
        const goalRunBtn  = block.querySelector('.nb-claude-ask-goal-run');

        function _refreshGoalBanner() {
            const meta = NbMain.activeNote?.()?.meta || {};
            const goal = (meta.claude_goal || '').trim();
            if (!goal) { goalBanner.hidden = true; return; }
            const bound = meta.claude_goal_bound;
            const scope = meta.claude_goal_scope;
            let preview = goal.length > 140 ? goal.slice(0, 137) + '...' : goal;
            if (bound) preview += ` (≤${bound} turns)`;
            if (scope) preview += ` [scope: ${scope}]`;
            goalPreview.textContent = preview;
            goalBanner.hidden = false;
        }
        _refreshGoalBanner();

        goalRunBtn.addEventListener('click', () => {
            const meta = NbMain.activeNote?.()?.meta || {};
            const goal = (meta.claude_goal || '').trim();
            if (!goal) return;
            const bound = meta.claude_goal_bound;
            let question = `/goal ${goal}`;
            if (bound) question += ` or stop after ${bound} turns`;
            _sendQuestion(question);
        });
    }

    // Badge click: reuse the existing rendered block if claude_ask: FM
    // already put one in the FM strip, otherwise insert a fresh one -- the
    // session id genuinely isn't known until a call completes (see
    // api_claude_ask), though tokens:/status: now get a baseline write the
    // moment the ask starts (_ensure_note_ai_stats_baseline), before this
    // block's own FM key exists. Either way, force it open and focused --
    // tapping the badge is an explicit "I want to use this now," not just
    // a peek -- and record that preference in localStorage so a reload
    // (e.g. the one reload_note triggers right after) doesn't rebuild it
    // collapsed by default.
    function _openOrFocusAskBlock() {
        const wrap = document.getElementById('nb-fm-blocks');
        if (!wrap) return;

        let block = wrap.querySelector('.nb-claude-ask-block');
        if (!block) {
            const tmp = document.createElement('div');
            tmp.innerHTML = _askBlockHtml(null);
            block = tmp.firstElementChild;
            wrap.insertBefore(block, wrap.firstChild);
            wrap.hidden = false;
        }
        block.classList.remove('nb-collapsed');
        localStorage.setItem(_ASK_FM_KEY, '1');
        _wireAskBlock(block);
        block.scrollIntoView({behavior: 'smooth', block: 'nearest'});
        block.querySelector('.nb-claude-ask-question')?.focus();
    }

    NbWeb.registerModule('claude', {
        label: 'Claude',
        codeblockRenderers: [
            {
                lang: 'claude_ask',
                html: text => _askBlockHtml((text || '').trim()),
                render: async container => {
                    const blocks = [...container.querySelectorAll('.nb-claude-ask-block:not([data-ask-wired])')];
                    for (const block of blocks) _wireAskBlock(block);
                },
            },
        ],
    });

    // Delegated click listener -- no kernel hook needed for this part. The
    // badge itself is re-created by the kernel on every note render
    // (_injectClaudeBadge, main.js), but delegation checks at click time,
    // not listener-attach time, so it works regardless of when/how often
    // the badge element gets replaced.
    document.addEventListener('click', e => {
        if (e.target.closest('#nb-claude-badge')) _openOrFocusAskBlock();
    });

})();
