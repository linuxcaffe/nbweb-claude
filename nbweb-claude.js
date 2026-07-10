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

    function _askBlockHtml(sessionId) {
        // No nb-collapsed hardcoded here -- same convention claude_code
        // follows: the FM-block eager-render loop (main.js) decides
        // initial collapse state from localStorage; the badge's
        // fresh-start path explicitly wants it open regardless.
        return `<div class="nb-claude-ask-block" data-session-id="${_esc(sessionId || '')}">
            <div class="nb-claude-ask-header" title="Click to expand/collapse">
                <span class="nb-claude-ask-toggle"></span>💬 Ask Claude
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

    function _wireAskBlock(block) {
        if (block.dataset.askWired) return;
        block.dataset.askWired = '1';

        const header   = block.querySelector('.nb-claude-ask-header');
        const messages = block.querySelector('.nb-claude-ask-messages');
        const input    = block.querySelector('.nb-claude-ask-question');
        const askBtn   = block.querySelector('.nb-claude-ask-btn');
        const selector = NbMain.activeSelector();
        let sessionId  = block.dataset.sessionId || null;

        header.addEventListener('click', () => block.classList.toggle('nb-collapsed'));

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

        async function _ask() {
            const question = input.value.trim();
            if (!question) return;
            input.value = '';
            askBtn.disabled = true;
            _addMessage('you', question);
            const spinnerRow = _addSpinner();
            try {
                const r = await fetch('/api/claude/ask', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        selector, question, context: _buildContext(),
                        resume: sessionId || undefined,
                    }),
                });
                const d = await r.json();
                spinnerRow.remove();
                if (d.error) {
                    const errBody = _addMessage('claude', 'Error: ' + d.error);
                    errBody.style.color = 'var(--red)';
                } else {
                    _addMessage('claude', d.answer);
                    if (d.session_id) {
                        sessionId = d.session_id;
                        block.dataset.sessionId = d.session_id;
                    }
                    // Same refresh action the toolbar's reload button triggers --
                    // Claude called reload_note server-side after writing to this
                    // note, so pick that signal up and actually show the change.
                    if (d.reload && selector) NbMain.openNote(selector, false);
                }
            } catch (e) {
                spinnerRow.remove();
                const errBody = _addMessage('claude', 'Error: ' + e);
                errBody.style.color = 'var(--red)';
            } finally {
                askBtn.disabled = false;
                input.focus();
            }
        }
        askBtn.addEventListener('click', _ask);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _ask(); }
        });
    }

    // Badge click: reuse the existing rendered block if claude_ask: FM
    // already put one in the FM strip, otherwise insert a fresh one (no FM
    // entry exists yet -- that only gets written server-side after the
    // first successful ask, see _update_note_ai_stats in app.py). Either
    // way, force it open and focused -- tapping the badge is an explicit
    // "I want to use this now," not just a peek.
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
