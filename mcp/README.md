# Sweeper Forensics MCP

stdio-based [Model Context Protocol](https://modelcontextprotocol.io) server that proxies tools to your **Sweeper Forensics** HTTP API (`src/server.mjs`). Use it from **Cursor**, **Claude Desktop**, or any MCP host.

## Important: this is not hosted on Railway

**`https://your-app.up.railway.app` is only REST + SSE** (`/api/trace`, etc.). There is **no** JSON-RPC MCP endpoint on that URL.

The MCP server is a **separate local process**: your host (e.g. Cursor) runs `node mcp/src/server.mjs`, which speaks MCP on **stdin/stdout** and calls the Railway app over **HTTP** using `SWEEPER_FORENSICS_URL`.

If another product only supports "paste an MCP server URL", you must either use **custom HTTP tools** that call the same REST routes, or use a host that supports **stdio/command-based** MCP. You can confirm integration shape with **`GET /api/config`** → `integrations.mcp`.

## Requirements

- Node **20+**
- Sweeper UI/API reachable at `SWEEPER_FORENSICS_URL` (local or Railway).

## Install (this repo)

```bash
cd mcp
npm install
```

Run manually:

```bash
node src/server.mjs
```

(Global installs are optional; most hosts spawn this via `command` + `args`.)

## Environment

| Variable | Purpose |
|---------|---------|
| `SWEEPER_FORENSICS_URL` | Base URL, default `http://127.0.0.1:4337` |
| `SWEEPER_FORENSICS_AUTH_USER` | HTTP Basic user when `AUTH_PASSWORD` is set on the API |
| `SWEEPER_FORENSICS_AUTH_PASSWORD` | HTTP Basic password |

## Cursor

In **Cursor Settings → MCP**, add a server (JSON shape depends on your Cursor version; common pattern):

```json
{
  "mcpServers": {
    "sweeper-forensics": {
      "command": "node",
      "args": ["FULL/PATH/TO/Web3Security/mcp/src/server.mjs"],
      "env": {
        "SWEEPER_FORENSICS_URL": "http://127.0.0.1:4337"
      }
    }
  }
}
```

For Railway (with Basic auth):

```json
"env": {
  "SWEEPER_FORENSICS_URL": "https://YOUR_SERVICE.up.railway.app",
  "SWEEPER_FORENSICS_AUTH_USER": "admin",
  "SWEEPER_FORENSICS_AUTH_PASSWORD": "YOUR_AUTH_PASSWORD"
}
```

Restart Cursor after edits.

## Tools exposed

| Tool | Maps to |
|------|---------|
| `forensics_get_config` | `GET /api/config` |
| `forensics_start_trace` | `POST /api/trace` |
| `forensics_wait_trace` | SSE `/api/trace/:id/stream` until done |
| `forensics_trace_address` | start + wait (one-shot trace) |
| `forensics_abort_trace` | `POST /api/trace/:id/abort` |
| `forensics_list_disk_runs` | `GET /api/trace/runs` |
| `forensics_get_disk_run_json` | `GET /api/trace/runs/:id` |
| `forensics_extend_chain` | `POST /api/trace/extend-chain` |
| `forensics_list_written_reports` | `GET /api/reports` |
| `forensics_get_written_report` | `GET /api/reports/file/:name` |
| `forensics_get_playbook` | `GET /api/playbook` |

Large HTML/Markdown reports are truncated server-side with a notice (see `MAX_REPORT_CHARS` in `src/server.mjs`).

## Publishing elsewhere

Copy the `mcp/` folder into another repo **or** publish `sweeper-forensics-mcp` to npm from this directory (`npm publish`, after removing `"private"` if added). Consumers point `command`/`args` at `node …/server.mjs` and set env.
