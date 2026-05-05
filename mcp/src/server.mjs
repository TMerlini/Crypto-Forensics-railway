#!/usr/bin/env node
/**
 * MCP server (stdio) → Sweeper Forensics HTTP API.
 *
 * Env:
 *   SWEEPER_FORENSICS_URL           Base URL (default http://127.0.0.1:4337)
 *   SWEEPER_FORENSICS_AUTH_USER     HTTP Basic user (optional)
 *   SWEEPER_FORENSICS_AUTH_PASSWORD HTTP Basic password (optional)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const DEFAULT_BASE = "http://127.0.0.1:4337";
const MAX_REPORT_CHARS = 450_000;

function baseUrl() {
  const u = process.env.SWEEPER_FORENSICS_URL?.trim() || DEFAULT_BASE;
  return u.replace(/\/+$/, "");
}

function authHeaders() {
  const user =
    process.env.SWEEPER_FORENSICS_AUTH_USER?.trim() ||
    process.env.SWEEPER_FORENSICS_USER?.trim() ||
    "";
  const pass =
    process.env.SWEEPER_FORENSICS_AUTH_PASSWORD?.trim() ||
    process.env.SWEEPER_FORENSICS_PASSWORD?.trim() ||
    "";
  if (!user && !pass) return {};
  const token = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
  return { Authorization: `Basic ${token}` };
}

async function apiJson(method, path, body = undefined) {
  const headers = {
    accept: "application/json",
    ...authHeaders(),
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
  };
  const r = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!r.ok) {
    const msg =
      typeof parsed === "object" && parsed?.error ? parsed.error : text.slice(0, 800);
    throw new Error(`${r.status}: ${msg}`);
  }
  return parsed;
}

async function apiText(path, accept = "*/*") {
  const r = await fetch(`${baseUrl()}${path}`, {
    headers: { accept, ...authHeaders() },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text.slice(0, 600)}`);
  return text;
}

/**
 * Reads SSE until report-ready / fatal error / close / timeout.
 */
async function waitForTraceAnalysis(runId, maxWaitSeconds) {
  const maxMs = Math.min(Math.max(maxWaitSeconds, 30), 3600) * 1000;
  const url = `${baseUrl()}/api/trace/${encodeURIComponent(runId)}/stream`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), maxMs);
  try {
    const r = await fetch(url, {
      headers: { accept: "text/event-stream", ...authHeaders() },
      signal: ac.signal,
    });
    if (!r.ok) throw new Error(`SSE HTTP ${r.status}`);
    const reader = r.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let carry = "";
    let analysis = null;
    let fatalError = null;
    let expanded = 0;
    let txsFetched = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const chunks = carry.split(/\r?\n/);
      carry = chunks.pop() ?? "";

      for (const line of chunks) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trimStart();
        if (!payload || payload === "[DONE]") continue;
        try {
          const ev = JSON.parse(payload);
          if (ev.type === "expand") expanded = ev.expanded ?? expanded;
          if (ev.type === "done") txsFetched = ev.txsFetched ?? txsFetched;
          if (ev.type === "report-ready") analysis = ev.analysis ?? null;
          if (ev.type === "error" && ev.fatal) fatalError = ev.error ?? "fatal error";
          if (ev.type === "close") {
            return {
              ok: !fatalError,
              fatalError,
              analysis,
              expanded,
              txsFetched,
              timedOut: false,
            };
          }
        } catch {
          /* ignore malformed SSE lines */
        }
      }
    }

    return {
      ok: !fatalError && !!analysis,
      fatalError,
      analysis,
      expanded,
      txsFetched,
      timedOut: !analysis && !fatalError,
    };
  } finally {
    clearTimeout(timer);
  }
}

function wrapJson(obj) {
  return {
    content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
  };
}

function wrapText(text) {
  return {
    content: [{ type: "text", text: String(text) }],
  };
}

function truncateReport(text, filename) {
  if (text.length <= MAX_REPORT_CHARS) return text;
  return `${text.slice(0, MAX_REPORT_CHARS)}\n\n… truncated (${filename}; ${text.length} chars total). Raise MAX_REPORT_CHARS in server.mjs if needed.`;
}

const server = new McpServer(
  {
    name: "sweeper-forensics",
    version: "1.0.0",
  },
  {
    instructions: [
      "Bridge to Sweeper Forensics (on-chain scam/sweeper tracer).",
      `Target API: ${baseUrl()}. Set SWEEPER_FORENSICS_URL and optional SWEEPER_FORENSICS_AUTH_* for Railway.`,
      "Long traces: use forensics_trace_address (start + wait) or forensics_wait_trace after forensics_start_trace.",
      "Disk history (GET /api/trace/runs) is empty when the server runs with DISABLE_DISK / hosted ephemeral FS.",
    ].join("\n"),
  },
);

server.registerTool(
  "forensics_get_config",
  {
    description: "GET /api/config — defaults, chain metadata (paid-tier flags), builder counts.",
    inputSchema: z.object({}),
  },
  async () => wrapJson(await apiJson("GET", "/api/config")),
);

server.registerTool(
  "forensics_start_trace",
  {
    description:
      "POST /api/trace — returns runId only. Poll with forensics_wait_trace or open SSE /api/trace/:id/stream in UI.",
    inputSchema: {
      scamAddress: z.string().describe("0x-prefixed 40 hex address"),
      chainId: z.number().int().optional(),
      direction: z.enum(["in", "out", "both"]).optional(),
      maxDepth: z.number().int().min(1).max(50).optional(),
      maxAddresses: z.number().int().min(1).max(50000).optional(),
      rps: z.number().min(0.5).max(30).optional(),
      adaptiveRps: z.boolean().optional(),
      stopAtOrigin: z.boolean().optional(),
      apiKey: z.string().optional(),
      acknowledgedPaidTier: z.boolean().optional(),
    },
  },
  async (params) => wrapJson(await apiJson("POST", "/api/trace", params)),
);

server.registerTool(
  "forensics_wait_trace",
  {
    description:
      "Subscribe to SSE until trace completes — returns analysis JSON (same shape as UI report-ready) or errors.",
    inputSchema: {
      runId: z.string().uuid(),
      maxWaitSeconds: z.number().int().min(30).max(3600).optional().describe("Default 900"),
    },
  },
  async ({ runId, maxWaitSeconds }) => {
    const result = await waitForTraceAnalysis(runId, maxWaitSeconds ?? 900);
    return wrapJson(result);
  },
);

server.registerTool(
  "forensics_trace_address",
  {
    description: "One-shot: start trace + wait for analysis (same as Trace tab completion). Long-running.",
    inputSchema: {
      scamAddress: z.string(),
      chainId: z.number().int().optional(),
      direction: z.enum(["in", "out", "both"]).optional(),
      maxDepth: z.number().int().min(1).max(50).optional(),
      maxAddresses: z.number().int().min(1).max(50000).optional(),
      rps: z.number().min(0.5).max(30).optional(),
      adaptiveRps: z.boolean().optional(),
      stopAtOrigin: z.boolean().optional(),
      apiKey: z.string().optional(),
      acknowledgedPaidTier: z.boolean().optional(),
      maxWaitSeconds: z.number().int().min(30).max(3600).optional(),
    },
  },
  async (params) => {
    const { maxWaitSeconds, ...body } = params;
    const started = await apiJson("POST", "/api/trace", body);
    const runId = started?.runId;
    if (!runId) throw new Error("No runId from server");
    const result = await waitForTraceAnalysis(runId, maxWaitSeconds ?? 900);
    return wrapJson({ runId, ...result });
  },
);

server.registerTool(
  "forensics_abort_trace",
  {
    description: "POST /api/trace/:runId/abort",
    inputSchema: { runId: z.string().uuid() },
  },
  async ({ runId }) => wrapJson(await apiJson("POST", `/api/trace/${runId}/abort`)),
);

server.registerTool(
  "forensics_list_disk_runs",
  {
    description:
      "GET /api/trace/runs — past runs from server out/ (empty on Railway / DISABLE_DISK).",
    inputSchema: z.object({}),
  },
  async () => {
    const data = await apiJson("GET", "/api/trace/runs");
    return wrapJson(Array.isArray(data) ? { runs: data } : data);
  },
);

server.registerTool(
  "forensics_get_disk_run_json",
  {
    description: "GET /api/trace/runs/:id — full JSON snapshot when disk history enabled.",
    inputSchema: { id: z.string().describe("Run id / file base from list_disk_runs") },
  },
  async ({ id }) => wrapJson(await apiJson("GET", `/api/trace/runs/${encodeURIComponent(id)}`)),
);

server.registerTool(
  "forensics_extend_chain",
  {
    description: "POST /api/trace/extend-chain — walk more hops on gas-seed or cash-out chain.",
    inputSchema: {
      startAddress: z.string(),
      direction: z.enum(["backward", "forward"]),
      chainId: z.number().int().optional(),
      hops: z.number().int().min(1).max(20).optional(),
      rps: z.number().min(0.5).max(30).optional(),
      adaptiveRps: z.boolean().optional(),
      startHop: z.number().int().min(0).max(1000).optional(),
      apiKey: z.string().optional(),
    },
  },
  async (body) => wrapJson(await apiJson("POST", "/api/trace/extend-chain", body)),
);

server.registerTool(
  "forensics_list_written_reports",
  {
    description: "GET /api/reports — curated HTML/MD library (slugDate, isLatest).",
    inputSchema: z.object({}),
  },
  async () => wrapJson(await apiJson("GET", "/api/reports")),
);

server.registerTool(
  "forensics_get_written_report",
  {
    description: "GET /api/reports/file/:name — basename only, .html or .md (truncated if huge).",
    inputSchema: {
      filename: z
        .string()
        .regex(/^[a-zA-Z0-9._-]+\.(html|md)$/i)
        .describe("e.g. rzleffendi-eth-analysis-2026-05-04.html"),
    },
  },
  async ({ filename }) => {
    const raw = await apiText(
      `/api/reports/file/${encodeURIComponent(filename)}`,
      "text/plain, text/html, text/markdown, */*",
    );
    return wrapText(truncateReport(raw, filename));
  },
);

server.registerTool(
  "forensics_get_playbook",
  {
    description: "GET /api/playbook — RECOVERY.md body as markdown string in JSON.",
    inputSchema: z.object({}),
  },
  async () => wrapJson(await apiJson("GET", "/api/playbook")),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[sweeper-forensics-mcp]", err);
  process.exit(1);
});
