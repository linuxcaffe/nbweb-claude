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
def append_to_note(selector: str, content: str) -> dict:
    """Append content to the end of a note's body (e.g. a fenced ```claude
    codeblock, a timedot entry, or prose). Write-gated the same as every
    other note edit -- _can_write() runs before this can touch anything, so
    this only succeeds where the asking user could already write by hand."""
    r = _client.put('/api/note', json={'selector': selector, 'append': content})
    r.raise_for_status()
    return r.json()


if __name__ == '__main__':
    mcp.run()
