// Single-file UI logic.
// Vanilla JS + fetch() + EventSource (SSE). No framework, no build step.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
$$(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === t.dataset.tab));
    if (t.dataset.tab === "history") loadHistory();
    if (t.dataset.tab === "playbook") loadPlaybook();
  }),
);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async () => {
  try {
    const cfg = await fetch("/api/config").then((r) => r.json());
    $("#chain-badge").textContent = `chain ${cfg.chainId} · ${cfg.builderCountMainnet} mainnet builders`;
    if (cfg.defaultScamAddress) $("[name=scamAddress]").value = cfg.defaultScamAddress;
    if (cfg.defaultDirection) $("[name=direction]").value = cfg.defaultDirection;
    if (cfg.defaultMaxDepth) $("[name=maxDepth]").value = cfg.defaultMaxDepth;
    if (cfg.defaultMaxAddresses) $("[name=maxAddresses]").value = cfg.defaultMaxAddresses;
  } catch (err) {
    $("#chain-badge").textContent = "offline";
  }
})();

// ---------------------------------------------------------------------------
// TRACE
// ---------------------------------------------------------------------------
let currentRunId = null;
let currentTraceTarget = null;
let traceEs = null;

$("#trace-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  body.maxDepth = Number(body.maxDepth);
  body.maxAddresses = Number(body.maxAddresses);
  body.rps = Number(body.rps);
  body.chainId = Number(body.chainId);
  body.stopAtOrigin = fd.get("stopAtOrigin") === "on";

  const res = await fetch("/api/trace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) { alert(json.error ?? "failed to start trace"); return; }

  currentRunId = json.runId;
  currentTraceTarget = String(body.scamAddress).toLowerCase();
  $("#trace-progress").classList.remove("hidden");
  $("#trace-report").classList.add("hidden");
  $("#trace-log").textContent = "";
  $("#trace-abort").disabled = false;

  if (traceEs) traceEs.close();
  traceEs = new EventSource(`/api/trace/${currentRunId}/stream`);
  traceEs.onmessage = (ev) => handleTraceEvent(JSON.parse(ev.data), body.maxAddresses);
  traceEs.onerror = () => { traceEs.close(); };
});

$("#trace-abort").addEventListener("click", async () => {
  if (!currentRunId) return;
  await fetch(`/api/trace/${currentRunId}/abort`, { method: "POST" });
});

function handleTraceEvent(ev, cap) {
  const log = $("#trace-log");
  if (ev.type === "expand") {
    $("#trace-count").textContent = ev.expanded;
    $("#trace-queue").textContent = ev.queueSize;
    $("#trace-fill").style.width = `${Math.min(100, (ev.expanded / cap) * 100)}%`;
    log.textContent += `[${ev.expanded}/${cap}] depth=${ev.depth} ${ev.address}${ev.label ? ` (${ev.label})` : ""}\n`;
    log.scrollTop = log.scrollHeight;
  } else if (ev.type === "expanded") {
    log.textContent = log.textContent.replace(/\n$/, "") + `  → ${ev.inflows} transfers\n`;
    log.scrollTop = log.scrollHeight;
  } else if (ev.type === "done") {
    $("#trace-txs").textContent = ev.txsFetched;
    log.textContent += `\n[done] nodes=${ev.nodes} edges=${ev.edges} txs=${ev.txsFetched}\n`;
  } else if (ev.type === "report-ready") {
    renderReport(ev.analysis, ev.runId);
    $("#trace-abort").disabled = true;
    if (traceEs) traceEs.close();
  } else if (ev.type === "error") {
    log.textContent += `\n[error] ${ev.error}\n`;
  } else if (ev.type === "aborted") {
    log.textContent += `\n[aborted]\n`;
    $("#trace-abort").disabled = true;
  } else if (ev.type === "cap-reached") {
    log.textContent += `\n[cap reached: ${ev.cap} addresses]\n`;
  }
}

function renderReport(a, runId) {
  const el = $("#trace-report");
  el.classList.remove("hidden");
  el.innerHTML = "";

  // Stats grid
  const stats = [
    ["Inflows", a.totals.inflowCount],
    ["Outflows", a.totals.outflowCount],
    ["Unique senders", a.totals.uniqueSendersToTarget],
    ["Unique recipients", a.totals.uniqueRecipientsFromTarget],
    ["Likely victims", a.totals.uniqueVictimAddresses],
    ["Nodes discovered", a.totals.nodesDiscovered],
    ["First inflow", a.totals.firstInflowAt ? formatDate(a.totals.firstInflowAt) : "—"],
    ["Last outflow", a.totals.lastOutflowAt ? formatDate(a.totals.lastOutflowAt) : "—"],
  ];
  const statGrid = document.createElement("div");
  statGrid.className = "stat-grid";
  statGrid.innerHTML = stats.map(([l, v]) => `<div class="stat"><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div>`).join("");
  el.appendChild(statGrid);

  // Visual graph (Mermaid). Inserted right after stats so it's the first thing
  // a human sees — text breakdowns below remain for copy/paste into reports.
  const target = currentTraceTarget;
  if (target) renderGraphCards(el, a, target);

  // Received (inflows by asset)
  if (a.inflowsByAsset?.length) {
    el.appendChild(card("Received by target (by asset)", assetTable(a.inflowsByAsset)));
  }
  // Sent (outflows by asset)
  if (a.outflowsByAsset?.length) {
    el.appendChild(card("Sent from target (by asset)", assetTable(a.outflowsByAsset)));
  }
  // Victim-only inflows
  if (a.victimInflowsByAsset?.length) {
    el.appendChild(card("Inflows from non-CEX senders (likely stolen)", assetTable(a.victimInflowsByAsset)));
  }
  // Gas-seed trail
  if (a.gasSeedChain?.length) {
    el.appendChild(card("Attacker's gas-seed trail (first inflow → backwards)", chainTree(a.gasSeedChain, "first")));
  }
  // Cash-out trail
  if (a.cashOutChain?.length) {
    el.appendChild(card("Cash-out trail (biggest outflow → forwards)", chainTree(a.cashOutChain, "biggest")));
  }
  // Cash-out endpoints
  if (a.cashOutEndpoints?.length) {
    el.appendChild(card("Cash-out endpoints (CEX / bridge / mixer)", endpointsList(a.cashOutEndpoints)));
  }
  // Top funders / recipients
  if (a.topEthFunders?.length) el.appendChild(card("Top ETH funders", addressList(a.topEthFunders, "eth")));
  if (a.topEthRecipients?.length) el.appendChild(card("Top ETH recipients", addressList(a.topEthRecipients, "eth")));

  // Downloads
  const dl = document.createElement("div");
  dl.className = "card";
  dl.innerHTML = `<h3>Files on disk</h3>
    <p>All files are written to <code>forensics/out/${runId}.*</code>:</p>
    <ul>
      <li><code>${runId}.report.md</code> — this report as markdown</li>
      <li><code>${runId}.json</code> — full graph as JSON</li>
      <li><code>${runId}.inflows-to-target.csv</code> — file THIS with exchanges / IC3</li>
      <li><code>${runId}.outflows-from-target.csv</code> — where the money went</li>
      <li><code>${runId}.edges.csv</code>, <code>${runId}.nodes.csv</code> — full graph as CSV</li>
    </ul>`;
  el.appendChild(dl);

  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function card(title, content) {
  const c = document.createElement("div");
  c.className = "card";
  c.innerHTML = `<h3>${title}</h3>`;
  if (typeof content === "string") c.innerHTML += content;
  else c.appendChild(content);
  return c;
}

function assetTable(assets) {
  const rows = assets.map((a) => `<tr>
    <td>${escapeHtml(a.symbol)}</td>
    <td class="num mono">${a.amountFormatted}</td>
    <td class="num">${a.count}</td>
    <td class="mono">${a.asset && a.asset !== "ETH" ? addrLink(a.asset, "token") : "—"}</td>
  </tr>`).join("");
  const t = document.createElement("table");
  t.innerHTML = `<thead><tr><th>Symbol</th><th style="text-align:right">Amount</th><th style="text-align:right">Transfers</th><th>Contract</th></tr></thead><tbody>${rows}</tbody>`;
  return t;
}

function chainTree(chain, mode) {
  const container = document.createElement("div");
  container.className = "chain";
  for (const h of chain) {
    const indent = "&nbsp;&nbsp;".repeat(h.hop * 2);
    const cat = h.label ? h.label.split(":")[0] : "";
    const line = document.createElement("div");
    line.innerHTML = `${indent}<span class="hop ${cat}">↳ hop ${h.hop}: ${addrLink(h.address)}${h.label ? ` <strong>${escapeHtml(h.label)}</strong>` : ""}${h.isContract ? ` <em>(contract)</em>` : ""}</span>`;
    container.appendChild(line);
    const edge = mode === "first" ? h.firstInflow : h.biggestOutflow;
    if (edge) {
      const sub = document.createElement("div");
      const other = mode === "first" ? edge.from : edge.to;
      const verb = mode === "first" ? "funded by" : "sent to";
      sub.innerHTML = `${indent}&nbsp;&nbsp;&nbsp;&nbsp;<span class="tx">• ${verb} ${addrLink(other)} · ${edge.amount} ${escapeHtml(edge.asset)} · ${formatDate(edge.time)} · ${txLink(edge.hash)}</span>`;
      container.appendChild(sub);
    }
  }
  return container;
}

function endpointsList(eps) {
  const c = document.createElement("div");
  c.innerHTML = eps.map((e) => `
    <div style="margin-bottom: 0.75rem;">
      <div><strong>${escapeHtml(e.category)}: ${escapeHtml(e.label ?? "?")}</strong> — ${addrLink(e.address)}</div>
      <ul>${Object.values(e.totals).map((t) => `<li>${t.amountFormatted} ${escapeHtml(t.symbol)}</li>`).join("")}</ul>
    </div>
  `).join("");
  return c;
}

function addressList(list, valueKey) {
  const rows = list.map((a, i) => `<tr>
    <td>${i + 1}</td>
    <td class="mono">${addrLink(a.address)}</td>
    <td class="num mono">${a[valueKey]}</td>
    <td>${escapeHtml(a.label ?? "")}</td>
  </tr>`).join("");
  const t = document.createElement("table");
  t.innerHTML = `<thead><tr><th>#</th><th>Address</th><th style="text-align:right">ETH</th><th>Label</th></tr></thead><tbody>${rows}</tbody>`;
  return t;
}

function addrLink(addr) {
  return `<a href="https://etherscan.io/address/${addr}" target="_blank" rel="noopener">${addr.slice(0, 6)}…${addr.slice(-4)}</a>`;
}

// ---------------------------------------------------------------------------
// GRAPH VIEW (Mermaid, lazy-loaded from CDN on first trace report)
// ---------------------------------------------------------------------------
let mermaidPromise = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")
      .then((mod) => {
        const mermaid = mod.default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          securityLevel: "loose",
          themeVariables: {
            // Match the app's dark palette so graphs feel native, not iframed.
            background: "#121723",
            primaryColor: "#1a2030",
            primaryTextColor: "#e8ecf5",
            primaryBorderColor: "#7ae1ff",
            lineColor: "#8892a6",
            secondaryColor: "#242b3d",
            tertiaryColor: "#0a0d14",
            mainBkg: "#1a2030",
            edgeLabelBackground: "#0a0d14",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          },
          flowchart: { htmlLabels: true, curve: "basis", useMaxWidth: true },
        });
        return mermaid;
      });
  }
  return mermaidPromise;
}

function renderGraphCards(el, a, target) {
  const card = document.createElement("div");
  card.className = "card graph-card";
  card.innerHTML = `<h3>Money flow graph</h3>
    <p class="hint" style="margin-top:-0.25rem">Top funders on the left, target in the middle, cash-out endpoints on the right. Click any node to open it on Etherscan.</p>
    <div class="graph-tabs">
      <button class="graph-tab active" data-graph="overview">Overview</button>
      <button class="graph-tab" data-graph="gasseed">Gas-seed trail</button>
      <button class="graph-tab" data-graph="cashout">Cash-out trail</button>
    </div>
    <div class="graph-pane" data-pane="overview"></div>
    <div class="graph-pane hidden" data-pane="gasseed"></div>
    <div class="graph-pane hidden" data-pane="cashout"></div>`;
  el.appendChild(card);

  const overviewPane = $("[data-pane=overview]", card);
  const gasseedPane = $("[data-pane=gasseed]", card);
  const cashoutPane = $("[data-pane=cashout]", card);

  $$(".graph-tab", card).forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".graph-tab", card).forEach((t) => t.classList.toggle("active", t === tab));
      $$(".graph-pane", card).forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== tab.dataset.graph));
    });
  });

  renderMermaid(overviewPane, buildOverviewMermaid(a, target), "ov");
  if (a.gasSeedChain?.length) {
    renderMermaid(gasseedPane, buildGasSeedMermaid(a.gasSeedChain, target), "gs");
  } else {
    gasseedPane.innerHTML = `<p class="hint">No gas-seed chain (target has no inflows).</p>`;
  }
  if (a.cashOutChain?.length) {
    renderMermaid(cashoutPane, buildCashOutMermaid(a.cashOutChain, target), "co");
  } else {
    cashoutPane.innerHTML = `<p class="hint">No cash-out chain (target has no outflows).</p>`;
  }
}

async function renderMermaid(container, source, idPrefix) {
  container.innerHTML = `<div class="graph-loading">Loading graph…</div>`;
  try {
    const mermaid = await loadMermaid();
    const id = `${idPrefix}-${Math.random().toString(36).slice(2, 9)}`;
    const { svg, bindFunctions } = await mermaid.render(id, source);
    container.innerHTML = svg;
    if (bindFunctions) bindFunctions(container);
  } catch (err) {
    container.innerHTML = `<p style="color: var(--danger)">Failed to render graph: ${escapeHtml(err.message ?? String(err))}</p>
      <details><summary>Mermaid source</summary><pre>${escapeHtml(source)}</pre></details>`;
  }
}

// Mermaid graph builders ------------------------------------------------------

function shortAddr(a) { return `${a.slice(0, 6)}…${a.slice(-4)}`; }

// Sanitises a label for use inside a quoted Mermaid node label (no quotes / no
// HTML-breaking chars that survive into the SVG).
function mmLabel(s) {
  return String(s ?? "")
    .replace(/[`"]/g, "'")
    .replace(/[<>]/g, "")
    .replace(/&/g, "&amp;");
}

// Pick a CSS class for a node based on label / category. Matches classDef
// declarations we emit at the bottom of every diagram.
function classForNode(node) {
  if (node?.isTarget) return "target";
  const cat = node?.category;
  if (cat === "cex") return "cex";
  if (cat === "bridge") return "bridge";
  if (cat === "mixer") return "mixer";
  if (node?.isContract) return "contract";
  return "eoa";
}

// Common preamble / postscript shared across all three diagrams.
function mermaidClassDefs() {
  return [
    "classDef target fill:#3a1418,stroke:#ff6b6b,stroke-width:2px,color:#ffd5d5",
    "classDef cex fill:#0d2d4f,stroke:#7ae1ff,color:#cfe9ff",
    "classDef bridge fill:#2a1a4f,stroke:#b08cff,color:#dccdff",
    "classDef mixer fill:#3a2410,stroke:#ffc857,color:#ffe5b0",
    "classDef contract fill:#1f2330,stroke:#566076,color:#aab2c5,stroke-dasharray:3 3",
    "classDef eoa fill:#1a2030,stroke:#3a4660,color:#e8ecf5",
  ];
}

function buildOverviewMermaid(a, target) {
  const lines = ["flowchart LR"];
  const idMap = new Map();   // lowercase addr → mermaid node id
  const addrFor = new Map(); // lowercase addr → original-case addr (for click-through URL)
  let nextId = 0;
  const idFor = (addr) => {
    const key = addr.toLowerCase();
    if (!idMap.has(key)) {
      idMap.set(key, `n${nextId++}`);
      addrFor.set(key, addr);
    }
    return idMap.get(key);
  };

  // Target node, always present.
  const targetId = idFor(target);
  lines.push(`  ${targetId}["TARGET<br/><tt>${shortAddr(target)}</tt>"]`);

  // Top funders on the left. Cap to 8 to keep graph readable.
  const funders = (a.topEthFunders ?? []).slice(0, 8);
  for (const f of funders) {
    const id = idFor(f.address);
    const label = f.label ? `${mmLabel(f.label)}<br/><tt>${shortAddr(f.address)}</tt>` : `<tt>${shortAddr(f.address)}</tt>`;
    lines.push(`  ${id}["${label}"]`);
    lines.push(`  ${id} -->|"${Number(f.eth).toFixed(3)} ETH"| ${targetId}`);
    lines.push(`  class ${id} ${classForNode(f)}`);
  }

  // Cash-out endpoints (CEX / bridge / mixer the target deposited into).
  const endpoints = a.cashOutEndpoints ?? [];
  for (const ep of endpoints) {
    const id = idFor(ep.address);
    lines.push(`  ${id}["${mmLabel(ep.label ?? "?")}<br/><i>${mmLabel(ep.category)}</i>"]`);
    // Edge label: ETH total if any, else first asset, else nothing.
    const totals = Object.values(ep.totals ?? {});
    const eth = totals.find((t) => t.symbol === "ETH" || t.symbol === "ETH (internal)");
    const display = eth
      ? `${Number(eth.amountFormatted).toFixed(3)} ETH`
      : (totals[0] ? `${totals[0].amountFormatted} ${mmLabel(totals[0].symbol)}` : "");
    if (display) lines.push(`  ${targetId} -->|"${display}"| ${id}`);
    else lines.push(`  ${targetId} --> ${id}`);
    lines.push(`  class ${id} ${classForNode(ep)}`);
  }

  // Top non-CEX recipients — anything the target sent ETH to that didn't
  // already show up as a labelled endpoint. Capped at 6 for readability.
  const labelledAddrs = new Set(endpoints.map((e) => e.address.toLowerCase()));
  const extraRecipients = (a.topEthRecipients ?? [])
    .filter((r) => !labelledAddrs.has(r.address.toLowerCase()))
    .slice(0, 6);
  for (const r of extraRecipients) {
    const id = idFor(r.address);
    const label = r.label ? `${mmLabel(r.label)}<br/><tt>${shortAddr(r.address)}</tt>` : `<tt>${shortAddr(r.address)}</tt>`;
    lines.push(`  ${id}["${label}"]`);
    lines.push(`  ${targetId} -->|"${Number(r.eth).toFixed(3)} ETH"| ${id}`);
    lines.push(`  class ${id} ${classForNode(r)}`);
  }

  lines.push(`  class ${targetId} target`);
  lines.push(...mermaidClassDefs());
  for (const [key, id] of idMap) {
    lines.push(`  click ${id} "https://etherscan.io/address/${addrFor.get(key)}" "Open on Etherscan" _blank`);
  }
  return lines.join("\n");
}

function buildGasSeedMermaid(chain, target) {
  // Reverse so the visual flow is funder→target (top-down feels natural for
  // "follow the money" reading).
  const lines = ["flowchart TD"];
  const ids = chain.map((_, i) => `g${i}`);

  for (let i = 0; i < chain.length; i++) {
    const hop = chain[i];
    const node = { ...hop, category: hop.label?.split(":")[0] ?? null, address: hop.address };
    const labelStr = hop.label ? mmLabel(hop.label) : (hop.isContract ? "contract" : "EOA");
    lines.push(`  ${ids[i]}["hop ${hop.hop}<br/><tt>${shortAddr(hop.address)}</tt><br/>${labelStr}"]`);
    lines.push(`  class ${ids[i]} ${classForNode(node)}`);
    if (hop.firstInflow) {
      const e = hop.firstInflow;
      const amt = `${e.amount} ${mmLabel(e.asset)}`;
      // The funder (e.from) is the next hop in the chain. If next chain entry
      // exists, edge goes from next→current ("funded by"). Otherwise emit a
      // pseudo node for the funder so the chain ends visibly.
      if (i + 1 < chain.length) {
        lines.push(`  ${ids[i + 1]} -->|"${amt}"| ${ids[i]}`);
      } else {
        const stubId = `gs_end`;
        lines.push(`  ${stubId}["<tt>${shortAddr(e.from)}</tt><br/><i>(beyond depth)</i>"]`);
        lines.push(`  class ${stubId} eoa`);
        lines.push(`  ${stubId} -->|"${amt}"| ${ids[i]}`);
      }
    }
  }

  // Add target indicator on hop 0
  if (chain.length) lines.push(`  class ${ids[0]} target`);
  lines.push(...mermaidClassDefs());
  // Click-through for every hop
  const addrIds = new Map();
  for (let i = 0; i < chain.length; i++) addrIds.set(ids[i], chain[i].address);
  lines.push(...[...addrIds.entries()].map(([id, a]) => `click ${id} "https://etherscan.io/address/${a}" "Open on Etherscan" _blank`));
  return lines.join("\n");
}

function buildCashOutMermaid(chain, target) {
  const lines = ["flowchart TD"];
  const ids = chain.map((_, i) => `c${i}`);

  for (let i = 0; i < chain.length; i++) {
    const hop = chain[i];
    const node = { ...hop, category: hop.label?.split(":")[0] ?? null };
    const labelStr = hop.label ? mmLabel(hop.label) : (hop.isContract ? "contract" : "EOA");
    lines.push(`  ${ids[i]}["hop ${hop.hop}<br/><tt>${shortAddr(hop.address)}</tt><br/>${labelStr}"]`);
    lines.push(`  class ${ids[i]} ${classForNode(node)}`);
    if (hop.biggestOutflow) {
      const e = hop.biggestOutflow;
      const amt = `${e.amount} ${mmLabel(e.asset)}`;
      if (i + 1 < chain.length) {
        lines.push(`  ${ids[i]} -->|"${amt}"| ${ids[i + 1]}`);
      } else {
        const stubId = `co_end`;
        lines.push(`  ${stubId}["<tt>${shortAddr(e.to)}</tt><br/><i>(beyond depth)</i>"]`);
        lines.push(`  class ${stubId} eoa`);
        lines.push(`  ${ids[i]} -->|"${amt}"| ${stubId}`);
      }
    }
  }
  if (chain.length) lines.push(`  class ${ids[0]} target`);
  lines.push(...mermaidClassDefs());
  const addrIds = new Map();
  for (let i = 0; i < chain.length; i++) addrIds.set(ids[i], chain[i].address);
  lines.push(...[...addrIds.entries()].map(([id, a]) => `click ${id} "https://etherscan.io/address/${a}" "Open on Etherscan" _blank`));
  return lines.join("\n");
}
function txLink(hash) {
  return `<a href="https://etherscan.io/tx/${hash}" target="_blank" rel="noopener">tx</a>`;
}
function formatDate(iso) { return iso.replace("T", " ").slice(0, 19); }
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------------------
// HISTORY
// ---------------------------------------------------------------------------
async function loadHistory() {
  const list = $("#history-list");
  list.textContent = "Loading…";
  const runs = await fetch("/api/trace/runs").then((r) => r.json()).catch(() => []);
  if (!runs.length) { list.textContent = "No past traces yet."; return; }
  list.innerHTML = runs.map((r) => `
    <div class="history-item">
      <div>
        <div class="mono">${r.target ?? r.id}</div>
        <div style="color: var(--muted); font-size: 0.8rem;">${r.id}</div>
      </div>
      <div>
        <a href="/api/trace/runs/${r.id}" target="_blank">JSON</a>
      </div>
    </div>
  `).join("");
}

// ---------------------------------------------------------------------------
// PLAYBOOK
// ---------------------------------------------------------------------------
async function loadPlaybook() {
  const el = $("#playbook-content");
  const { markdown } = await fetch("/api/playbook").then((r) => r.json());
  el.innerHTML = markdownToHtml(markdown);
}
function markdownToHtml(md) {
  // Tiny markdown renderer. Handles: #/##/###, code blocks, `inline`, **bold**,
  // links [x](y), lists, paragraphs. Nothing fancier — we control the source.
  const lines = md.split("\n");
  const out = [];
  let inCode = false, codeLang = "", codeBuf = [];
  let inList = false, listOrdered = false;

  const flushList = () => {
    if (inList) { out.push(listOrdered ? "</ol>" : "</ul>"); inList = false; }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (inCode) {
        out.push(`<pre><code class="lang-${codeLang}">${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        codeBuf = []; inCode = false;
      } else {
        flushList();
        inCode = true; codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    if (/^#{1,6}\s/.test(line)) {
      flushList();
      const m = line.match(/^(#{1,6})\s+(.*)$/);
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
      continue;
    }
    const ol = line.match(/^\s*(\d+)\.\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ol || ul) {
      const ordered = !!ol;
      if (!inList) { out.push(ordered ? "<ol>" : "<ul>"); inList = true; listOrdered = ordered; }
      out.push(`<li>${inline(ol ? ol[2] : ul[1])}</li>`);
      continue;
    }
    if (line.trim() === "") { flushList(); out.push(""); continue; }
    if (line.startsWith("> ")) { out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`); continue; }

    flushList();
    out.push(`<p>${inline(line)}</p>`);
  }
  flushList();
  return out.join("\n");

  function inline(s) {
    s = escapeHtml(s);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s;
  }
}

// ---------------------------------------------------------------------------
// RESCUE
// ---------------------------------------------------------------------------
const ACTION_TEMPLATES = {
  eth: `<div class="action-head">Send all ETH <button type="button" class="remove" title="remove">×</button></div>
        <p class="hint-inline">Sends the compromised wallet's full ETH balance to the recipient (minus gas).</p>`,
  erc20: `<div class="action-head">ERC-20 transfer <button type="button" class="remove" title="remove">×</button></div>
          <label>Token contract<input name="erc20_contract" placeholder="0x…" pattern="^0x[0-9a-fA-F]{40}$" required /></label>
          <label>Amount <span class="hint-inline">(use "max" to drain full balance)</span><input name="erc20_amount" placeholder="max" value="max" required /></label>`,
  erc721: `<div class="action-head">ERC-721 transfer (incl. ENS) <button type="button" class="remove" title="remove">×</button></div>
           <p class="hint-inline">For ENS .eth names (unwrapped): contract = <code>0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85</code> (BaseRegistrar). For wrapped: <code>0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401</code> (NameWrapper). tokenId = <code>uint256(keccak256(label))</code>.</p>
           <label>NFT contract<input name="erc721_contract" placeholder="0x…" pattern="^0x[0-9a-fA-F]{40}$" required /></label>
           <label>Token ID<input name="erc721_tokenId" placeholder="123 or 0x… for uint256" required /></label>`,
  erc1155: `<div class="action-head">ERC-1155 transfer <button type="button" class="remove" title="remove">×</button></div>
            <label>Contract<input name="erc1155_contract" placeholder="0x…" pattern="^0x[0-9a-fA-F]{40}$" required /></label>
            <label>Token ID<input name="erc1155_tokenId" required /></label>
            <label>Amount<input name="erc1155_amount" value="1" required /></label>`,
  custom: `<div class="action-head">Custom call <button type="button" class="remove" title="remove">×</button></div>
           <p class="hint-inline">Raw contract call from the compromised wallet. Use for multi-step flows (e.g. ENS resolver updates).</p>
           <label>To<input name="custom_to" placeholder="0x…" pattern="^0x[0-9a-fA-F]{40}$" required /></label>
           <label>Data (calldata, 0x-prefixed)<input name="custom_data" placeholder="0x…" required /></label>
           <label>Value (wei)<input name="custom_value" value="0" /></label>`,
};

$$("[data-add]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const type = btn.dataset.add;
    const card = document.createElement("div");
    card.className = "action-card";
    card.dataset.type = type;
    card.innerHTML = ACTION_TEMPLATES[type];
    card.querySelector(".remove").addEventListener("click", () => card.remove());
    $("#actions-list").appendChild(card);
  }),
);

let currentHandle = null;

$("#rescue-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = gatherRescueBody();
  const res = await fetch("/api/rescue/compose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) { renderRescueError(json.error); return; }
  currentHandle = json.handle;
  renderRescuePreview(json);
  $("#rescue-simulate").disabled = false;
  $("#rescue-submit").disabled = false;
});

$("#rescue-simulate").addEventListener("click", async () => {
  if (!currentHandle) return;
  const body = gatherRescueBody();
  const res = await fetch("/api/rescue/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: currentHandle, rpcUrl: body.rpcUrl }),
  });
  const json = await res.json();
  renderSimulation(json);
});

$("#rescue-submit").addEventListener("click", async () => {
  if (!currentHandle) return;
  const body = gatherRescueBody();
  if (!confirm("Submit the bundle to block builders? This signs nothing new — the bundle is already signed — but it ships real value. Continue?")) return;

  $("#rescue-submit").disabled = true;
  const out = $("#rescue-output");
  const submitCard = document.createElement("div");
  submitCard.className = "card";
  submitCard.innerHTML = `<h3>Bundle submission</h3><div id="submit-status">Starting…</div><div class="submit-grid" id="submit-grid"></div>`;
  out.appendChild(submitCard);

  const payload = { handle: currentHandle, rpcUrl: body.rpcUrl, blocksAhead: Number(body.blocksAhead) || 100 };
  const controller = new AbortController();
  const res = await fetch("/api/rescue/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const cells = new Map();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const events = buf.split("\n\n");
    buf = events.pop();
    for (const e of events) {
      const line = e.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const ev = JSON.parse(line.slice(6));
      handleSubmitEvent(ev, cells);
    }
  }
});

function handleSubmitEvent(ev, cells) {
  const status = $("#submit-status");
  const grid = $("#submit-grid");
  if (ev.type === "start") {
    status.textContent = `Submitting to ${ev.builderCount} builders × ${ev.toBlock - ev.fromBlock + 1} blocks = ${ev.submissions} total submissions…`;
  } else if (ev.type === "submit-result") {
    const key = `${ev.builder}-${ev.targetBlock}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = document.createElement("div");
      cell.className = "submit-cell";
      grid.appendChild(cell);
      cells.set(key, cell);
    }
    cell.textContent = `${ev.builder} #${ev.targetBlock}`;
    cell.classList.toggle("ok", ev.ok);
    cell.classList.toggle("fail", !ev.ok);
    if (!ev.ok && ev.error) cell.title = ev.error;
  } else if (ev.type === "done") {
    if (ev.included) {
      status.innerHTML = `<strong style="color: var(--accent-2)">INCLUDED in block ${ev.includedBlock}</strong> — tx <a href="https://etherscan.io/tx/${ev.funderTxHash}" target="_blank">${ev.funderTxHash.slice(0, 10)}…</a>`;
    } else {
      status.innerHTML = `<strong style="color: var(--danger)">Not included in any of the target blocks.</strong> Re-submit with more blocks, or bump priority fee.`;
    }
  } else if (ev.type === "error") {
    status.innerHTML = `<strong style="color: var(--danger)">Error: ${escapeHtml(ev.error)}</strong>`;
  }
}

function gatherRescueBody() {
  const fd = new FormData($("#rescue-form"));
  const body = {
    chainId: Number(fd.get("chainId") ?? 1),
    rpcUrl: fd.get("rpcUrl"),
    compromisedKey: fd.get("compromisedKey"),
    funderKey: fd.get("funderKey"),
    recipient: fd.get("recipient"),
    priorityFeeGwei: Number(fd.get("priorityFeeGwei") ?? 3),
    maxFeePerGasGwei: fd.get("maxFeePerGasGwei") ? Number(fd.get("maxFeePerGasGwei")) : null,
    blocksAhead: Number(fd.get("blocksAhead") ?? 100),
    actions: [],
  };
  $$(".action-card").forEach((card) => {
    const type = card.dataset.type;
    if (type === "eth") body.actions.push({ type: "eth" });
    else if (type === "erc20") body.actions.push({
      type: "erc20",
      contract: card.querySelector('[name=erc20_contract]').value,
      amount: card.querySelector('[name=erc20_amount]').value,
    });
    else if (type === "erc721") body.actions.push({
      type: "erc721",
      contract: card.querySelector('[name=erc721_contract]').value,
      tokenId: card.querySelector('[name=erc721_tokenId]').value,
    });
    else if (type === "erc1155") body.actions.push({
      type: "erc1155",
      contract: card.querySelector('[name=erc1155_contract]').value,
      tokenId: card.querySelector('[name=erc1155_tokenId]').value,
      amount: card.querySelector('[name=erc1155_amount]').value,
    });
    else if (type === "custom") body.actions.push({
      type: "custom",
      to: card.querySelector('[name=custom_to]').value,
      data: card.querySelector('[name=custom_data]').value,
      value: card.querySelector('[name=custom_value]').value,
    });
  });
  return body;
}

function renderRescuePreview(res) {
  const out = $("#rescue-output");
  out.classList.remove("hidden");
  out.innerHTML = "";
  out.appendChild(card("Bundle composed", `
    <p>Bundle built and signed. <strong>Nothing has been submitted yet.</strong> Click "Simulate" to preview the outcome, or "Submit to builders" to ship it.</p>
    <h4>Addresses</h4>
    <table>
      <tr><td>Compromised</td><td class="mono">${addrLink(res.addresses.compromised)}</td></tr>
      <tr><td>Funder</td><td class="mono">${addrLink(res.addresses.funder)}</td></tr>
      <tr><td>Recipient</td><td class="mono">${addrLink(res.addresses.recipient)}</td></tr>
    </table>
    <h4>Fees</h4>
    <ul>
      <li>Base fee: ${weiToGwei(res.fees.baseFee)} gwei</li>
      <li>Max fee: ${weiToGwei(res.fees.maxFeePerGas)} gwei</li>
      <li>Priority: ${weiToGwei(res.fees.priorityFee)} gwei</li>
      <li>Funder sends: ${weiToEth(res.fees.fundingAmount)} ETH</li>
      <li>Compromised wallet ETH balance: ${weiToEth(res.fees.compromisedBalance)} ETH</li>
    </ul>
    <h4>Transactions in bundle (in order)</h4>
    <table>
      <thead><tr><th>#</th><th>Role</th><th>From</th><th>To</th><th>Value (wei)</th><th>Gas</th></tr></thead>
      <tbody>
        ${res.preview.map((p, i) => `<tr>
          <td>${i}</td>
          <td>${escapeHtml(p.role)}</td>
          <td class="mono">${p.from ? addrLink(p.from) : "—"}</td>
          <td class="mono">${p.to ? addrLink(p.to) : "—"}</td>
          <td class="mono num">${p.value ?? "0"}</td>
          <td class="num">${p.gas}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  `));
}

function renderSimulation(sim) {
  const out = $("#rescue-output");
  const card2 = document.createElement("div");
  card2.className = "card";
  if (sim.ok) {
    const r = sim.result ?? {};
    card2.innerHTML = `<h3 style="color: var(--accent-2)">Simulation OK</h3>
      <p>All transactions would execute successfully at the current tip block. Safe to submit.</p>
      <pre style="font-size: 0.75rem; overflow-x: auto">${escapeHtml(JSON.stringify(r, null, 2))}</pre>`;
  } else {
    card2.innerHTML = `<h3 style="color: var(--danger)">Simulation FAILED</h3>
      <p>${escapeHtml(sim.error ?? "unknown error")}</p>
      <p>Do <strong>not</strong> submit. Fix the actions / balances / contract addresses first.</p>`;
  }
  out.appendChild(card2);
}

function renderRescueError(msg) {
  const out = $("#rescue-output");
  out.classList.remove("hidden");
  out.innerHTML = "";
  out.appendChild(card("Compose failed", `<p style="color: var(--danger)">${escapeHtml(msg ?? "unknown error")}</p>`));
}

function weiToEth(wei) {
  const b = BigInt(wei);
  const whole = b / 10n ** 18n;
  const frac = (b % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
  return `${whole}.${frac}`;
}
function weiToGwei(wei) {
  const b = BigInt(wei);
  const whole = b / 10n ** 9n;
  const frac = (b % 10n ** 9n).toString().padStart(9, "0").slice(0, 3);
  return `${whole}.${frac}`;
}
