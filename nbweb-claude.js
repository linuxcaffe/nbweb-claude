// NbWeb-claude — Claude Code integration for nb-web
// Two markets: (1) stumped-user badge+modal Q&A, (2) Claude Code developer
// agent orchestration (#agent todo -> project-file graduation, live tui
// console, notebook-as-dashboard). Full design:
// claude:nbweb-claude — Plugin Design v2 (two-market rewrite, 2026-07-09)
// @name     NbWeb Claude
// @version  0.1.0
// @type     ecosystem
// @homepage
(() => {

    NbWeb.registerModule('claude', {
        label: 'Claude',
    });

    // ── Rung 1: modal Q&A ────────────────────────────────────────────────────
    // Reuses dialog.js's .nb-dlg-* CSS classes for visual consistency, own
    // panel id (not #nb-action-panel -- that's NbDialog's own, kept separate).
    // claude -p shell-out via /api/claude/ask, tech-gated server-side to
    // match today's real single-user-auth reality (see app.py's own comment
    // on that route). Real tool access via mcp_server.py (nb-web's own REST
    // API, scoped-token authenticated) plus a live nav/view context snapshot
    // (below) -- both inherited automatically, no new access-control code.
    //
    // Rolling-chat layout, 2026-07-10: scrollable message history (newest at
    // bottom, resizable), input pinned below it -- replaces the original
    // single overwrite-in-place response div, which grew unbounded off the
    // page and forced scrolling back to the top to ask a follow-up. Each
    // modal instance also now threads a real --resume <session_id> between
    // turns (server already generates one per call; previously never sent
    // to the client) -- a "rolling chat" that didn't actually remember the
    // previous turn would just look like a chat, not be one.

    function _panel() { return document.getElementById('nbweb-claude-modal'); }
    function _close()  { _panel()?.remove(); }

    // Live nav/view snapshot, built fresh at ask-time (not open-time) so it
    // reflects whatever the user was doing right up to hitting Ask. Purely
    // informational -- the server folds this into --append-system-prompt,
    // never into an access decision. Every accessor here is already public;
    // no new kernel plumbing needed.
    // Cap on how much of the focused note's own body rides along in every
    // ask -- generous for a typical human-written note, bounded so one huge
    // note can't blow up every question asked from it. A tool call
    // (get_note) is still available for anything past this cut.
    const _NOTE_TEXT_CAP = 4000;

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

    function _open() {
        _panel()?.remove(); // toggle-close if already open, same as NbDialog's own pattern

        const toolbar = document.getElementById('nb-preview-toolbar');
        if (!toolbar) return;
        const selector = NbMain.activeSelector();
        let sessionId = null; // per-modal-instance -- fresh conversation each time the badge reopens it

        const panel = document.createElement('div');
        panel.id = 'nbweb-claude-modal';
        panel.style.cssText = 'border-bottom:1px solid var(--border);flex-shrink:0';

        const header = document.createElement('div');
        header.className = 'nb-dlg-header';
        const title = document.createElement('span');
        title.style.cssText = 'padding:7px 13px;font-size:13px;color:var(--text-muted);align-self:center';
        title.textContent = '💬 Ask Claude';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'nb-dlg-close';
        closeBtn.textContent = '✕';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.addEventListener('click', _close);
        header.append(title, closeBtn);

        const body = document.createElement('div');
        body.className = 'nb-dlg-body';

        const messages = document.createElement('div');
        messages.id = 'nbweb-claude-messages';
        messages.style.cssText = 'display:flex;flex-direction:column;gap:8px;max-height:260px;min-height:60px;overflow-y:auto;resize:vertical;padding:2px 2px 2px 0';

        const inputRow = document.createElement('div');
        inputRow.style.cssText = 'display:flex;flex-direction:column;gap:6px';

        const input = document.createElement('textarea');
        input.id = 'nbweb-claude-question';
        input.placeholder = 'Ask a question about this note…';
        input.rows = 2;
        input.style.cssText = 'width:100%;resize:vertical;font-family:inherit;font-size:13px;padding:6px;box-sizing:border-box;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px';

        const askBtn = document.createElement('button');
        askBtn.id = 'nbweb-claude-ask-btn';
        askBtn.className = 'nb-tool-btn nb-btn-primary';
        askBtn.textContent = 'Ask';
        askBtn.style.cssText = 'align-self:flex-start';

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
                    if (d.session_id) sessionId = d.session_id;
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

        inputRow.append(input, askBtn);
        body.append(messages, inputRow);
        panel.append(header, body);
        toolbar.insertAdjacentElement('afterend', panel);
        input.focus();
    }

    // Delegated click listener -- no kernel hook needed for this part. The
    // badge itself is re-created by the kernel on every note render
    // (_injectClaudeBadge, main.js), but delegation checks at click time,
    // not listener-attach time, so it works regardless of when/how often
    // the badge element gets replaced.
    document.addEventListener('click', e => {
        if (e.target.closest('#nb-claude-badge')) _open();
    });

})();
