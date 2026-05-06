# Sweeper Forensics MCP

stdio-based [Model Context Protocol](https://modelcontextprotocol.io) server that proxies tools to your **Sweeper Forensics** HTTP API (`src/server.mjs`). Use it from **Cursor**, **Claude Desktop**, or any MCP host.

## HTTP JSON-RPC on the same origin

The main app also exposes **`POST /mcp`** (JSON-RPC 2.0, `Content-Type: application/json`). Use the same **HTTP Basic** credentials as the web UI when `AUTH_PASSWORD` is set. Tools: `trace_address`, `get_trace_runs`, `get_playbook`, `get_reports` (see **`GET /api/config`** → `integrations.mcp.httpJsonRpcUrl`). This readme documents the **stdio** bridge and its wider **`forensics_*`** tool surface.

Example:

```bash
curl -sS -u 'USER:PASS' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  https://YOUR_HOST/mcp
```

## stdio MCP vs hosted URL

**`https://your-app.up.railway.app`** serves the **web UI**, **REST + SSE** (`/api/trace`, etc.), and **`POST /mcp`**. For **stdio** MCP, your host (e.g. Cursor) runs `node mcp/src/server.mjs`, which speaks MCP on **stdin/stdout** and calls the app over **HTTP** using `SWEEPER_FORENSICS_URL`.

If a product only supports "paste an MCP server URL", point it at **`https://…/mcp`** with Basic auth when available; otherwise use command-based stdio MCP or custom REST tools. Integration shape: **`GET /api/config`** → `integrations.mcp`.

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

### HTTP `POST /mcp` (JSON-RPC)

| Tool | Maps to |
|------|---------|
| `trace_address` | `POST /api/trace` then buffers full `GET /api/trace/:id/stream` (SSE) into one text result |
| `get_trace_runs` | `GET /api/trace/runs` |
| `get_playbook` | `GET /api/playbook` |
| `get_reports` | `GET /api/reports` |

### stdio (`forensics_*`)

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
