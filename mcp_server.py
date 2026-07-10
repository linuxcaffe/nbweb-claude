#!/usr/bin/env python3
"""nbweb MCP server — thin translation layer over nb-web's own REST API.

Every tool here is a couple lines of HTTP against an endpoint that already
exists in app.py and is already access-checked (_can_access, effective_access,
guest-invisible filtering). This process adds zero new enforcement logic —
it's just another caller of the already-enforced API, authenticated as the
specific user who asked the question via a short-lived scoped token minted
by /api/claude/ask (NBWEB_MCP_TOKEN below), not the raw session cookie.

Full design: claude:nbweb-claude — Plugin Design v2 (two-market rewrite,
2026-07-09), "Market 1" section.
"""
import os
import sys

import httpx
from mcp.server.fastmcp import FastMCP

BASE  = os.environ.get('NBWEB_MCP_BASE', 'http://127.0.0.1:5001')
TOKEN = os.environ.get('NBWEB_MCP_TOKEN', '')
TIER  = os.environ.get('NBWEB_MCP_TIER', 'dev')  # 'dev' | 'haiku'

if not TOKEN:
    print('nbweb-claude MCP server: NBWEB_MCP_TOKEN not set, refusing to start', file=sys.stderr)
    sys.exit(1)

_client = httpx.Client(base_url=BASE, headers={'X-Nbweb-Mcp-Token': TOKEN}, timeout=15.0)

mcp = FastMCP('nbweb')


@mcp.tool()
def list_notes(notebook: str = 'home', folder: str = '', search: str = '', limit: int = 50) -> dict:
    """List notes visible to the current user. Filter by notebook, folder, or a search query.
    Returns {"notes": [...], "total": N}."""
    r = _client.get('/api/notes', params={'notebook': notebook, 'folder': folder, 'q': search, 'limit': limit})
    r.raise_for_status()
    return r.json()


@mcp.tool()
def get_note(selector: str) -> dict:
    """Fetch a single note's full content and metadata by selector, e.g. 'home:foo.md'."""
    r = _client.get('/api/note', params={'selector': selector})
    r.raise_for_status()
    return r.json()


@mcp.tool()
def search_backlinks(title: str, limit: int = 20) -> dict:
    """Find notes that wiki-link to the given note title."""
    r = _client.get('/api/nb/backlinks', params={'title': title, 'limit': limit})
    r.raise_for_status()
    return r.json()


@mcp.tool()
def get_notebook_config(notebook: str) -> dict:
    """Read a notebook's merged config (global + notebook-level FM defaults)."""
    r = _client.get('/api/nb/notebook-config', params={'notebook': notebook})
    r.raise_for_status()
    return r.json()


@mcp.tool()
def list_templates(notebook: str = '') -> dict:
    """List note-creation templates -- the same set the "Add note" dialog's
    template picker shows: that notebook's own local templates plus global
    ones (omit notebook to see global only). Check this before calling
    create_note for any note type that isn't a quick, contentless note --
    if a template matches, pass its 'path' as create_note's template_path
    instead of writing the note's shape from scratch. Excludes annotation
    and export templates, which aren't for note creation."""
    r = _client.get('/api/templates', params={'notebook': notebook})
    r.raise_for_status()
    templates = [t for t in r.json().get('templates', [])
                 if not t.get('template_type')
                 and (t.get('scope') == 'global'
                      or (notebook and t.get('notebook') == notebook))]
    return {'templates': templates}


@mcp.tool()
def create_note(notebook: str, title: str, type: str = 'note', folder: str = '',
                 content: str = '', tags: list[str] | None = None, template_path: str = '',
                 url: str = '') -> dict:
    """Create a new note -- the same POST /api/notes the "Add note" dialog
    itself uses, so this covers plain notes, bookmarks (type='bookmark',
    needs url), and todos (type='todo') the same way a human clicking
    through that dialog would. Call list_templates first and pass a
    matching template's path as template_path when one exists -- the
    template is the author's own intended shape for that note type, and
    hand-writing content from scratch when a template was available
    produces an inconsistent result."""
    r = _client.post('/api/notes', json={
        'notebook': notebook, 'title': title, 'type': type, 'folder': folder,
        'content': content, 'tags': tags or [], 'template_path': template_path, 'url': url,
    })
    r.raise_for_status()
    return r.json()


@mcp.tool()
def toggle_todo(selector: str, done: bool = True, task: int | None = None) -> dict:
    """Mark a todo done or open -- the same action the list's checkbox
    triggers. `task` selects one sub-task by number for a multi-task todo;
    omit it to toggle the whole todo."""
    r = _client.post('/api/todo', json={'selector': selector, 'done': done, 'task': task})
    r.raise_for_status()
    return r.json()


@mcp.tool()
def set_annotation(selector: str, content: str) -> dict:
    """Set a note's annotation sidecar -- the same action the annotation
    editor panel saves. Replaces any existing annotation on this note
    (not an append); pass an empty string to remove it."""
    r = _client.post('/api/note/annotate', params={'selector': selector}, json={'content': content})
    r.raise_for_status()
    return r.json()


if TIER != 'haiku':
    @mcp.tool()
    def append_to_note(selector: str, content: str) -> dict:
        """Append content to the end of a note's body (e.g. a fenced ```claude
        codeblock, a timedot entry, or prose). Write-gated the same as every
        other note edit -- _can_write() runs before this can touch anything, so
        this only succeeds where the asking user could already write by hand.
        Dev-tier only -- see .rules/mcp-tools.md: haiku-tier gets create_note/
        toggle_todo/set_annotation instead, all typed UI-equivalent actions,
        with no freeform content-writing tool available at all."""
        r = _client.put('/api/note', json={'selector': selector, 'append': content})
        r.raise_for_status()
        return r.json()


@mcp.tool()
def reload_note() -> dict:
    """Call this once, after append_to_note, so the note refreshes in the
    user's browser. Same general-purpose refresh a human triggers via the
    toolbar's reload button -- not a Claude-only mechanism, just a second
    caller of it."""
    r = _client.post('/api/claude/mark-reload')
    r.raise_for_status()
    return r.json()


if __name__ == '__main__':
    mcp.run()
