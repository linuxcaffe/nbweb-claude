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
    // No MCP wrapper yet, no context scoping by level -- plain claude -p
    // shell-out via /api/claude/ask, tech-gated server-side to match today's
    // real single-user-auth reality (see app.py's own comment on that route).

    function _panel() { return document.getElementById('nbweb-claude-modal'); }
    function _close()  { _panel()?.remove(); }

    function _open() {
        _panel()?.remove(); // toggle-close if already open, same as NbDialog's own pattern

        const toolbar = document.getElementById('nb-preview-toolbar');
        if (!toolbar) return;
        const selector = NbMain.activeSelector();

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

        const input = document.createElement('textarea');
        input.id = 'nbweb-claude-question';
        input.placeholder = 'Ask a question about this note…';
        input.rows = 3;
        input.style.cssText = 'width:100%;resize:vertical;font-family:inherit;font-size:13px;padding:6px;box-sizing:border-box;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px';

        const askBtn = document.createElement('button');
        askBtn.id = 'nbweb-claude-ask-btn';
        askBtn.className = 'nb-tool-btn nb-btn-primary';
        askBtn.textContent = 'Ask';
        askBtn.style.cssText = 'align-self:flex-start';

        const responseArea = document.createElement('div');
        responseArea.id = 'nbweb-claude-response';
        responseArea.style.cssText = 'white-space:pre-wrap;font-size:13px;line-height:1.5;padding-top:6px';

        async function _ask() {
            const question = input.value.trim();
            if (!question) return;
            askBtn.disabled = true;
            askBtn.textContent = 'Thinking…';
            responseArea.textContent = '';
            responseArea.style.color = '';
            try {
                const r = await fetch('/api/claude/ask', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({selector, question}),
                });
                const d = await r.json();
                if (d.error) {
                    responseArea.style.color = 'var(--red)';
                    responseArea.textContent = 'Error: ' + d.error;
                } else {
                    responseArea.textContent = d.answer;
                }
            } catch (e) {
                responseArea.style.color = 'var(--red)';
                responseArea.textContent = 'Error: ' + e;
            } finally {
                askBtn.disabled = false;
                askBtn.textContent = 'Ask';
            }
        }
        askBtn.addEventListener('click', _ask);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); _ask(); }
        });

        body.append(input, askBtn, responseArea);
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
