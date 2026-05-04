# Sweeper Forensics & Rescue

A self-contained toolkit for two closely-related problems:

1. **Forensics** — you got hacked. Trace where the money went, who the victims are, and what CEX the attacker used.
2. **Rescue** — a compromised wallet still has assets on it that a sweeper bot is watching. Build an atomic Flashbots bundle that funds gas from a burner and sweeps to a clean wallet in the same block, bypassing the public mempool entirely.

Runs as a CLI or as a local web UI. Viem under the hood, zero other runtime dependencies.

```
forensics/
├── src/
│   ├── tracer.mjs       # forensic BFS tracer (importable)
│   ├── trace.mjs        # CLI entry for tracer
│   ├── report.mjs       # JSON/CSV/Markdown writers + analyzer
│   ├── etherscan.mjs    # Etherscan V2 client
│   ├── labels.mjs       # known-origin lookup
│   ├── rescue.mjs       # bundle composer + submitter
│   ├── builders.mjs     # multi-builder submission layer
│   ├── server.mjs       # local HTTP + SSE server
│   └── env.mjs          # .env loader
├── web/                 # single-page UI (vanilla HTML/CSS/JS)
├── labels.json          # 100+ known CEX / bridge / mixer addresses
├── RECOVERY.md          # field guide for rescuing compromised wallets
├── .env.example
└── out/                 # generated reports (gitignored)
```

---

## Quick start (web UI)

```bash
cd forensics
npm install            # pulls viem
cp .env.example .env   # paste your Etherscan key
npm run ui             # → http://127.0.0.1:4337
```

The UI has four tabs:

- **Trace** — enter an address, start a crawl, watch live progress, see the report inline
- **Rescue** — build and submit a Flashbots bundle (compose → simulate → ship)
- **History** — past traces on disk
- **Playbook** — the `RECOVERY.md` guide, rendered inline

Everything binds to `127.0.0.1` by default — private keys entered in the Rescue tab stay on your machine.

---

## Hosted deployment (Railway / Render / Fly)

The same Node server runs unmodified on any platform that speaks the standard
`PORT` env convention. When `PORT` is set the server automatically:

- Binds to `0.0.0.0` instead of `127.0.0.1`
- Disables disk writes (the platform FS is ephemeral; reports stream straight
  to the browser)
- Returns an empty History tab

> **Set `AUTH_PASSWORD`.** Without it your URL is open to the internet and
> anyone can burn your Etherscan API quota. With it, browsers show a native
> login prompt before serving any page.
>
> **Heads up about Rescue.** The Rescue tab handles private keys. On a hosted
> deployment those keys leave your laptop, traverse TLS to the host, and only
> there sign + submit to builders. The tool itself doesn't log them, but the
> threat model is no longer "loopback only". If you only want a public Trace
> tool, that's fine — just don't use the Rescue tab on the hosted instance.

### Required env vars on any host

| Var | Purpose |
|---|---|
| `AUTH_PASSWORD` | Shared password for HTTP Basic auth. **Required.** |
| `AUTH_USER` | Username (defaults to `admin`). Optional. |
| `ETHERSCAN_API_KEY` | Ethereum mainnet + Sepolia. Optional default; users can paste their own in the UI. |
| `CHAIN_ID` | Default chain shown in UI (`1` = mainnet). |

#### Multichain coverage with one Etherscan key

Etherscan V2 (`api.etherscan.io/v2/api`) is the unified API for ~60 EVM chains.
The legacy V1 endpoints (`api.basescan.org`, `api.arbiscan.io`,
`api.bscscan.com`, …) were retired on **May 31, 2025**. There are no separate
per-chain keys anymore — every chain runs through the same V2 endpoint with a
`chainid` query parameter.

Authoritative list:
[Etherscan V2 supported chains](https://docs.etherscan.io/etherscan-v2/getting-started/supported-chains).

**Free tier** (just sign up at [etherscan.io/myapikey](https://etherscan.io/myapikey)):
Ethereum (1), Sepolia (11155111), Polygon (137), Arbitrum (42161), Linea
(59144), Gnosis (100), Blast (81457), Mantle (5000), Celo (42220), Unichain
(130), Sonic (146), Berachain (80094), and ~30 more.

**Etherscan Lite or Pro required** ([etherscan.io/apis](https://etherscan.io/apis)):
Base (8453, 84532), Optimism (10, 11155420), BSC (56, 97), Avalanche (43114,
43113). Hitting these on a free key returns:

> Free API access is not supported for this chain. Please upgrade your api
> plan for full chain coverage.

The Lite plan (priced at 25% of the previous lowest paid tier) is the cheapest
path; the same `ETHERSCAN_API_KEY` then works for every chain.

The UI marks paid-tier chains in the dropdown and shows a confirm box before
starting a trace on one — no API calls are wasted on free keys hitting Base.

**Rate limiting.** Free tier is about **3 calls/sec** (see [Etherscan APIs](https://etherscan.io/apis)). This repo defaults to **2.5 req/s** via `RATE_LIMIT_RPS` and the Trace form — staying under that avoids long stalls when Etherscan returns `Max calls per sec rate limit reached`. **Adaptive rate limiting** (on by default; toggle in the Trace form or set `ETHERSCAN_ADAPTIVE_RPS=false` to disable) widens spacing after throttling and creeps back toward your target RPS when responses succeed. While one address paginates heavily, the UI and CLI log **etherscan-page** lines so progress does not look frozen below `MAX_ADDRESSES`. If another tool shares the same key, lower to `2` or `1`. Paid Lite/Pro tiers allow higher throughput.

The **Reports** tab lists curated **`reports/*.html` and `reports/*.md`** analyses from the repo (open in a new tab), shows a compact snapshot of the latest trace from this browser session, and can **download a filled `trace-search-report.canvas.tsx`** for Cursor Canvas beside the chat. A template lives in `canvases/trace-search-report.canvas.tsx`.

### Railway

1. Push this repo to GitHub.
2. New Project → Deploy from GitHub Repo → pick this one. Railway auto-detects
   Node and reads `railway.json`.
3. In the project Variables tab, add `AUTH_PASSWORD` and (optionally)
   `ETHERSCAN_API_KEY`.
4. Hit the generated `*.up.railway.app` URL, log in with `admin` + your
   password.

### Render

1. Push this repo to GitHub.
2. New → Blueprint → point at the repo. Render reads `render.yaml`.
3. Set `AUTH_PASSWORD` and `ETHERSCAN_API_KEY` in the dashboard (they're marked
   `sync: false`).
4. Open the generated URL, log in.

### Fly.io

```bash
fly launch --no-deploy        # accepts fly.toml as-is
fly secrets set AUTH_PASSWORD=hunter2 ETHERSCAN_API_KEY=YOUR_KEY
fly deploy
```

### Why not Vercel?

Tried it; doesn't fit. The server is stateful (in-memory job tracking, SSE
streams), traces can run for many minutes, and rescue submission watches
inclusion across 100 blocks (~20 min). Vercel's 60–300s function timeout cuts
both off. Railway/Render/Fly run it as a regular long-lived Node process with
no surgery needed.

---

## Quick start (CLI)

If you'd rather run traces headless:

```bash
cd forensics
npm install
cp .env.example .env   # pre-filled with 0x541b...ef2f, depth 5, direction "both"
npm run trace
```

Outputs land in `forensics/out/`:

| File | Purpose |
|---|---|
| `trace-<short>-<dir>.report.md` | Human-readable summary (read first) |
| `trace-<short>-<dir>.json` | Full graph + analysis |
| `trace-<short>-<dir>.inflows-to-target.csv` | File with exchanges / IC3 / police |
| `trace-<short>-<dir>.outflows-from-target.csv` | Where the money went |
| `trace-<short>-<dir>.edges.csv` / `.nodes.csv` | Full graph as spreadsheet-friendly CSVs |
| `trace-<short>-<dir>.checkpoint.json` | Resume state. Re-run to continue, delete to restart. |

---

## What the tracer does

Starting from a target address, BFS-walks the funding graph backwards (or cash-out graph forwards, or both):

1. For each address: fetch every incoming/outgoing native ETH, internal ETH, ERC-20, ERC-721, and ERC-1155 transfer from Etherscan, paginated past the 10k-row cap.
2. Record each sender/recipient as a new node, each transfer as an edge.
3. If an address is a known CEX / bridge / mixer — or just any contract — mark it terminal and stop recursing. Otherwise, Binance's hot wallet would pull millions of unrelated users into the graph.
4. Repeat until depth limit or address cap is reached.

The analyzer then computes:

- **Total received** per asset — for a sweeper, this is stolen-funds total
- **Total sent** per asset — cash-out volumes
- **Likely-victim inflows** (excluding known CEX senders) — what the attacker drained from users
- **Gas-seed trail** — the recursive backward chain from the *first* inflow (almost always the attacker's seed tx)
- **Cash-out trail** — the recursive forward chain from the *biggest* outflow (where the money went)
- **Cash-out endpoints** — CEX/bridge/mixer addresses the attacker deposited into, with totals by asset
- **Top ETH funders / recipients** — ranked address lists

---

## What the rescue tool does

The threat model is "attacker has your private key but not the rest of your crypto setup." A sweeper bot monitors compromised wallets and front-runs any incoming gas to instantly drain it — so the usual "just send ETH and move your tokens" approach cannot work.

The tool builds an **atomic Flashbots bundle**:

1. **Funder tx** — a fresh burner sends exactly the gas budget to the compromised wallet
2. **Asset txs** — the compromised wallet transfers each asset (ETH, ERC-20, ERC-721, ERC-1155, or arbitrary contract calls) to a brand new recipient

Because the bundle is submitted via **private orderflow** (POSTed directly to block builders), the sweeper bot never sees the gas arrive in the public mempool. Both transactions are included together or neither is included.

### Submission coverage

The bundle is submitted to all major Ethereum builders in parallel, across N blocks (default 100):

| Builder | Role |
|---|---|
| Flashbots Relay | ~30–40% share |
| beaverbuild | ~30–40% share |
| Titan Builder | ~15–25% share |
| rsync-builder, builder0x69, BuilderNet, Payload, Loki | combined few % |

Combined coverage ~95% of mainnet blocks. Inclusion from any one builder is sufficient.

### Supported action types

- **Send all ETH** — drains remaining ETH balance (minus gas budget) to recipient
- **ERC-20 transfer** — by contract + amount, or "max" for full balance
- **ERC-721 transfer** — by contract + tokenId (works for ENS: see `RECOVERY.md` for contract addresses)
- **ERC-1155 transfer** — by contract + tokenId + amount
- **Custom call** — arbitrary `to` + calldata + value, for anything else (multi-step ENS resolver updates, contract withdrawals, etc.)

### Safety

Every rescue has three buttons:

1. **Compose** — builds and signs the bundle locally, shows you exactly what it will do. Nothing leaves your machine yet.
2. **Simulate** — runs the bundle against the live chain state via Flashbots `eth_callBundle`. Free. Tells you if any tx would revert before you pay gas.
3. **Submit** — actually ships to builders. This is where real value moves.

The server binds to `127.0.0.1` and keys are never logged or sent anywhere except to your RPC URL and builder endpoints.

See `RECOVERY.md` (also rendered as the Playbook tab) for the full field guide.

---

## Known-origin labels

`labels.json` ships with ~100 hand-curated CEX / bridge / mixer addresses across Binance, Coinbase, Kraken, OKX, Bybit, KuCoin, Bitfinex, Gate.io, Crypto.com, Gemini, MEXC, and the major bridges + Tornado Cash / Railgun. Expand as needed — community lists at:

- https://github.com/etherscan-labels
- https://github.com/brianleect/etherscan-labels

---

## Limitations

- **USD valuation** is deliberately absent. Historical per-block prices need another data source and current-price estimates are misleading when the trace spans months.
- **Labels are a static list**. If the gas-seed trail ends at an unlabelled wallet that behaves like a CEX (high tx count, many small withdrawals), add it to `labels.json` and re-run.
- **Mixer trails dead-end by design**. If the attacker funded the bot via Tornado Cash, on-chain forensics won't reach further without external chainalysis data.
- **Single chain per run**. Set `CHAIN_ID` in `.env` or pick from the UI dropdown.
- **Rescue assumes single compromised EOA**. Multi-sig recovery, smart wallet recovery (Safe modules), and social-recovery wallets need different strategies not covered here.

---

## If you've been hacked — sequence

1. **Stop using the compromised device.** Move to a clean one.
2. **If the wallet still has value**: run the Rescue tab. Do not manually send anything — you will lose the race.
3. **Trace the attacker**: run the Trace tab. Attach the report + CSVs to every exchange / police report.
4. **Identify the leak vector.** Most common: seed stored in cloud, malicious extension, clipboard malware, bad permit signature, phishing. If you can't identify it, a new wallet on the same device will get drained too.
5. **Rotate everything crypto-adjacent**: seed phrases (new hardware wallet, new seed generated offline), exchange API keys, email passwords + MFA, anything else.

---

## License

MIT — see [LICENSE](./LICENSE). Use it, fork it, help someone else not get rekt. No warranty; you are responsible for what you sign.
