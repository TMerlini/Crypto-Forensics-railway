// Etherscan V2 multichain API client.
// Docs: https://docs.etherscan.io/etherscan-v2
// Handles: rate limiting, paginated fetches, exponential backoff on transient errors.
//
// Routing model
// -------------
// As of May 2025, V1 chain-specific endpoints (api.basescan.org, api.arbiscan.io,
// api.bscscan.com, etc.) are deprecated. ALL chain data is served exclusively
// from the V2 multichain endpoint at https://api.etherscan.io/v2/api with a
// `chainid` query parameter. One Etherscan account → one API key → 60+ chains.
//
// Source: https://docs.etherscan.io/etherscan-v2/getting-started/supported-chains
//
// Free vs paid tier
// -----------------
// V2 multichain works on the free tier for ~50 chains (Ethereum, Sepolia,
// Polygon, Arbitrum, Linea, Gnosis, Mantle, Celo, Blast, Berachain, Sonic,
// Unichain, …) — see CHAINS below. A handful of high-volume chains are paid
// only: Base (8453), Base Sepolia (84532), Optimism (10, 11155420), BSC (56,
// 97), Avalanche (43114, 43113). Hitting these on a free key returns:
//   "Free API access is not supported for this chain. Please upgrade your api
//    plan for full chain coverage."
// Etherscan's "Lite" plan ($X/mo, 25% of the lowest paid tier) unlocks them
// all. We surface this in the UI / error messages so users know what to do.

const V2_BASE = "https://api.etherscan.io/v2/api";

// chainId → { name, freeTier }
//   name      — human-readable name for messages
//   freeTier  — true when V2 free key works, false when Etherscan Lite/Pro
//               is required. Source of truth: Etherscan supported-chains docs.
//
// We only enumerate chains the UI exposes (or might soon). Other chain ids
// fall back to "unknown" and we attempt the V2 call anyway — Etherscan will
// answer authoritatively.
export const CHAINS = {
  1:        { name: "Ethereum",       freeTier: true  },
  11155111: { name: "Sepolia",        freeTier: true  },
  137:      { name: "Polygon",        freeTier: true  },
  80002:    { name: "Polygon Amoy",   freeTier: true  },
  42161:    { name: "Arbitrum One",   freeTier: true  },
  421614:   { name: "Arbitrum Sepolia", freeTier: true },
  59144:    { name: "Linea",          freeTier: true  },
  100:      { name: "Gnosis",         freeTier: true  },
  81457:    { name: "Blast",          freeTier: true  },
  5000:     { name: "Mantle",         freeTier: true  },
  42220:    { name: "Celo",           freeTier: true  },
  130:      { name: "Unichain",       freeTier: true  },
  146:      { name: "Sonic",          freeTier: true  },
  80094:    { name: "Berachain",      freeTier: true  },

  // Paid tier only (Etherscan Lite or Pro).
  8453:     { name: "Base",           freeTier: false },
  84532:    { name: "Base Sepolia",   freeTier: false },
  10:       { name: "Optimism",       freeTier: false },
  11155420: { name: "Optimism Sepolia", freeTier: false },
  56:       { name: "BSC",            freeTier: false },
  97:       { name: "BSC Testnet",    freeTier: false },
  43114:    { name: "Avalanche",      freeTier: false },
  43113:    { name: "Avalanche Fuji", freeTier: false },
};

export function chainInfo(chainId) {
  return CHAINS[Number(chainId)] ?? { name: `chain ${chainId}`, freeTier: null };
}

// Single env var. The Etherscan V2 key is used for every chain — there are no
// per-chain free keys anymore (basescan.org/apis etc. all just redirect to
// etherscan.io now). For paid chains the same key works once you upgrade to
// Lite or Pro on your Etherscan account.
export function resolveApiKey(_chainId, override) {
  if (override && String(override).trim()) return String(override).trim();
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
    this.apiKey = apiKey;
    this.chainId = String(chainId);
    // Allow callers to force a custom URL (handy for self-hosted forks).
    this.baseUrl = baseUrl ?? V2_BASE;
    this.chain = chainInfo(chainId);
    this.limiter = new RateLimiter(rps);
  }

  async _call(params, { retries = 5 } = {}) {
    const url = new URL(this.baseUrl);
    url.searchParams.set("chainid", this.chainId);
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
          const resultStr = String(json.result ?? "").toLowerCase();
          if (msg.includes("no transactions") || msg.includes("no records")) return [];
          if (msg.includes("rate limit") || msg.includes("max rate") || msg.includes("max calls") ||
              resultStr.includes("max rate") || resultStr.includes("rate limit")) {
            lastErr = new Error(`rate-limited: ${json.message}`);
            await sleep(backoffMs(attempt));
            continue;
          }
          // Paid-only chain hit on a free key — the most common chain misconfig.
          // Translate the upstream message into something actionable.
          if (msg.includes("not supported for this chain") ||
              msg.includes("upgrade your api plan") ||
              resultStr.includes("not supported for this chain") ||
              resultStr.includes("upgrade your api plan")) {
            throw new Error(
              `${this.chain.name} (chainId ${this.chainId}) requires an Etherscan paid plan. ` +
              `The free V2 tier excludes Base, Optimism, BSC, and Avalanche. ` +
              `Upgrade to Etherscan Lite or Pro at https://etherscan.io/apis — your existing ` +
              `ETHERSCAN_API_KEY will then work on every chain. Free-tier alternatives: trace on ` +
              `Ethereum, Polygon, Arbitrum, Linea, Gnosis, Blast, or Mantle instead.`,
            );
          }
          // Invalid API key — point users at the right place.
          if (msg.includes("invalid api key") || resultStr.includes("invalid api key")) {
            throw new Error(
              `Etherscan rejected the API key. Generate a new one at https://etherscan.io/myapikey ` +
              `and set ETHERSCAN_API_KEY (or paste it into the form).`,
            );
          }
          // Other status=0 — surface as error with both fields so debugging
          // is possible without staring at NOTOK in the log.
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
