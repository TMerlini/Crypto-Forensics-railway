// Etherscan V2 multichain API client.
// Docs: https://docs.etherscan.io/etherscan-v2
// Handles: rate limiting, paginated fetches, exponential backoff on transient errors.
//
// Routing model
// -------------
// Etherscan V2 (api.etherscan.io/v2/api) advertises one-key-for-all-chains, but
// the FREE tier of V2 only works for Ethereum mainnet + Sepolia. Hitting V2 for
// any other chain on a free key returns:
//   "Free API access is not supported for this chain. Please upgrade your api
//    plan for full chain coverage."
// To stay free-tier-friendly we keep V2 for mainnet/Sepolia and fall back to
// each chain's native explorer (basescan.org, arbiscan.io, polygonscan.com, …)
// for everything else. Users sign up for a free key on the relevant explorer
// and paste it into the same form field — the client routes automatically.

const V2_BASE = "https://api.etherscan.io/v2/api";

// chainId → { url, envKey, name, explorerHost }
//   url           — V1 single-chain endpoint (free tier works)
//   envKey        — env var name to look up if no key is supplied per-request
//   name          — human-readable name for error messages
//   explorerHost  — where the user signs up for an API key
//   v2Capable     — true means V2 multichain works on the free tier (just ETH +
//                   Sepolia today); else we always use the V1 url
export const EXPLORERS = {
  1:        { url: V2_BASE, envKey: "ETHERSCAN_API_KEY",            name: "Ethereum",   explorerHost: "etherscan.io",           v2Capable: true  },
  11155111: { url: V2_BASE, envKey: "ETHERSCAN_API_KEY",            name: "Sepolia",    explorerHost: "etherscan.io",           v2Capable: true  },
  8453:     { url: "https://api.basescan.org/api",                 envKey: "BASESCAN_API_KEY",        name: "Base",       explorerHost: "basescan.org",           v2Capable: false },
  42161:    { url: "https://api.arbiscan.io/api",                  envKey: "ARBISCAN_API_KEY",        name: "Arbitrum",   explorerHost: "arbiscan.io",            v2Capable: false },
  10:       { url: "https://api-optimistic.etherscan.io/api",      envKey: "OPTIMISTIC_ETHERSCAN_API_KEY", name: "Optimism", explorerHost: "optimistic.etherscan.io", v2Capable: false },
  137:      { url: "https://api.polygonscan.com/api",              envKey: "POLYGONSCAN_API_KEY",     name: "Polygon",    explorerHost: "polygonscan.com",        v2Capable: false },
  56:       { url: "https://api.bscscan.com/api",                  envKey: "BSCSCAN_API_KEY",         name: "BSC",        explorerHost: "bscscan.com",            v2Capable: false },
};

export function resolveExplorer(chainId) {
  return EXPLORERS[Number(chainId)] ?? EXPLORERS[1];
}

// Pick the right API key for a chain: explicit override → per-chain env var
// → fallback ETHERSCAN_API_KEY. Returns null if nothing is configured.
export function resolveApiKey(chainId, override) {
  if (override && String(override).trim()) return String(override).trim();
  const ex = resolveExplorer(chainId);
  if (ex.envKey && process.env[ex.envKey]) return process.env[ex.envKey];
  if (process.env.ETHERSCAN_API_KEY) return process.env.ETHERSCAN_API_KEY;
  return null;
}

// Etherscan lists are capped at 10k rows per query. We page using startblock
// cursors: ask for the first 10k sorted ascending, then fetch the next 10k
// starting from (last returned blockNumber + 1), and so on.
const PAGE_LIMIT = 10_000;

// Hard ceiling on rows we'll keep per (address, endpoint). Whale wallets can
// emit hundreds of thousands of transfers and a single fetch easily chews
// hundreds of MB. 30k is enough to capture the usual scammer-address footprint
// (mempool sweepers rarely exceed a few thousand events) and prevents one
// busy node from OOM-ing the whole trace. Tunable via env: ETHERSCAN_MAX_ROWS.
const MAX_ROWS_PER_ENDPOINT = Number(process.env.ETHERSCAN_MAX_ROWS ?? 30_000);

export class RateLimiter {
  constructor(rps) {
    this.intervalMs = 1000 / rps;
    this.nextAllowedAt = 0;
  }
  async acquire() {
    const now = Date.now();
    const wait = Math.max(0, this.nextAllowedAt - now);
    this.nextAllowedAt = Math.max(now, this.nextAllowedAt) + this.intervalMs;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

export class Etherscan {
  constructor({ apiKey, chainId, rps = 4, baseUrl = null }) {
    if (!apiKey) throw new Error("API key is required");
    const explorer = resolveExplorer(chainId);
    this.apiKey = apiKey;
    this.chainId = String(chainId);
    // Allow callers to force a custom URL (handy for self-hosted forks).
    this.baseUrl = baseUrl ?? explorer.url;
    this.useV2ChainId = !baseUrl && explorer.v2Capable;
    this.explorerName = explorer.name;
    this.limiter = new RateLimiter(rps);
  }

  async _call(params, { retries = 5 } = {}) {
    const url = new URL(this.baseUrl);
    if (this.useV2ChainId) url.searchParams.set("chainid", this.chainId);
    url.searchParams.set("apikey", this.apiKey);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }

    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await this.limiter.acquire();
      try {
        const res = await fetch(url, { headers: { accept: "application/json" } });
        if (!res.ok) {
          // 429 = rate limited, 5xx = server issue — both retryable
          if (res.status === 429 || res.status >= 500) {
            lastErr = new Error(`HTTP ${res.status}`);
            await sleep(backoffMs(attempt));
            continue;
          }
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }
        const json = await res.json();
        // Etherscan returns { status, message, result }. status="0" with
        // message="No transactions found" is a valid empty result — NOT an error.
        if (json.status === "1") return json.result;
        if (json.status === "0") {
          const msg = String(json.message || "").toLowerCase();
          if (msg.includes("no transactions") || msg.includes("no records")) return [];
          if (msg.includes("rate limit") || msg.includes("max rate") || msg.includes("max calls")) {
            lastErr = new Error(`rate-limited: ${json.message}`);
            await sleep(backoffMs(attempt));
            continue;
          }
          // Pro-only chain on V2 free tier — the most common chain misconfig.
          // Translate the cryptic upstream message into an actionable one.
          if (msg.includes("not supported for this chain") || msg.includes("upgrade your api plan")) {
            const ex = resolveExplorer(this.chainId);
            throw new Error(
              `${this.explorerName} requires a chain-specific API key. ` +
              `Sign up at https://${ex.explorerHost}/apis (free) and paste that key into the form ` +
              `(or set ${ex.envKey} in the server env). The default Etherscan key only works on Ethereum + Sepolia.`,
            );
          }
          // Other status=0 — surface as error
          throw new Error(`Etherscan: ${json.message} | ${JSON.stringify(json.result)}`);
        }
        return json.result ?? [];
      } catch (err) {
        lastErr = err;
        if (attempt < retries) await sleep(backoffMs(attempt));
      }
    }
    throw lastErr ?? new Error("Etherscan call failed");
  }

  // Paginate by block cursor — reliable past the 10k-row flat cap.
  async _paginate(baseParams) {
    const all = [];
    let startblock = 0;
    const seen = new Set();
    while (true) {
      const batch = await this._call({
        ...baseParams,
        startblock,
        endblock: 99999999,
        page: 1,
        offset: PAGE_LIMIT,
        sort: "asc",
      });
      if (!Array.isArray(batch) || batch.length === 0) break;

      for (const row of batch) {
        // hash+logIndex is unique; fall back to hash+from+to+value for native txs
        const key = `${row.hash}:${row.logIndex ?? ""}:${row.from ?? ""}:${row.to ?? ""}:${row.value ?? ""}:${row.tokenID ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(row);
        if (all.length >= MAX_ROWS_PER_ENDPOINT) {
          // Whale wallet — bail out before we eat all available heap.
          return all;
        }
      }

      if (batch.length < PAGE_LIMIT) break;
      // Advance cursor to the next block after the last row in this batch.
      const lastBlock = Number(batch[batch.length - 1].blockNumber);
      if (!Number.isFinite(lastBlock) || lastBlock + 1 <= startblock) break;
      startblock = lastBlock + 1;
    }
    return all;
  }

  nativeTxs(address) {
    return this._paginate({ module: "account", action: "txlist", address });
  }
  internalTxs(address) {
    return this._paginate({ module: "account", action: "txlistinternal", address });
  }
  erc20Txs(address) {
    return this._paginate({ module: "account", action: "tokentx", address });
  }
  erc721Txs(address) {
    return this._paginate({ module: "account", action: "tokennfttx", address });
  }
  erc1155Txs(address) {
    return this._paginate({ module: "account", action: "token1155tx", address });
  }

  async isContract(address) {
    const code = await this._call({ module: "proxy", action: "eth_getCode", address, tag: "latest" });
    return typeof code === "string" && code !== "0x" && code.length > 2;
  }

  async nativeBalance(address) {
    const wei = await this._call({ module: "account", action: "balance", address, tag: "latest" });
    return BigInt(wei ?? "0");
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function backoffMs(attempt) {
  return Math.min(30_000, 500 * Math.pow(2, attempt)) + Math.random() * 250;
}
