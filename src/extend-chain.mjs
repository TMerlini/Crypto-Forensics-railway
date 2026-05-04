// On-demand chain extension. Given the last address in a gas-seed or cash-out
// chain, walk further (backwards or forwards) using live Etherscan calls so
// users can drill past the BFS depth/MAX_ADDRESSES caps without re-running the
// whole trace.
//
// Returns hops in the same shape as report.mjs's gasSeedChain / cashOutChain,
// so the UI can splice the result in directly.

import { Etherscan } from "./etherscan.mjs";
import { labelOf, isOrigin } from "./labels.mjs";
import { formatUnits } from "./report.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";

export async function extendChain({
  apiKey,
  chainId,
  startAddress,
  direction,           // "backward" (gas-seed) | "forward" (cash-out)
  hops = 5,
  rps = 4,
  startHop = 0,        // numbering offset so appended hops continue from the original chain
  onProgress = () => {},
}) {
  if (!apiKey) throw new Error("apiKey required");
  if (!/^0x[0-9a-f]{40}$/i.test(startAddress ?? "")) throw new Error("invalid startAddress");
  if (direction !== "backward" && direction !== "forward") throw new Error("direction must be 'backward' or 'forward'");

  const client = new Etherscan({ apiKey, chainId, rps });
  const chain = [];
  const seen = new Set();
  let current = startAddress.toLowerCase();
  let hopOffset = 0;

  while (current && current !== ZERO && !seen.has(current) && hopOffset < hops) {
    seen.add(current);
    const labelEntry = labelOf(current);
    const labelStr = labelEntry ? `${labelEntry.category}:${labelEntry.name}` : null;
    const hopNumber = startHop + hopOffset;

    onProgress({ type: "hop-start", hop: hopNumber, address: current, label: labelStr });

    let isContract = false;
    try { isContract = await client.isContract(current); } catch {}

    const entry = {
      hop: hopNumber,
      address: current,
      label: labelStr,
      depth: null,
      isContract,
      firstInflow: null,
      biggestOutflow: null,
      terminated: null,
    };

    // Terminal: known origin (CEX / bridge / mixer). The whole point of the
    // gas-seed trail is to find one of these — once we do, we're done.
    if (labelEntry && isOrigin(current)) {
      entry.terminated = `origin:${labelEntry.category}`;
      chain.push(entry);
      break;
    }

    // Terminal: any contract (skip the first hop because that may be the
    // user's starting address which can legitimately be a contract).
    if (hopOffset > 0 && isContract) {
      entry.terminated = "contract";
      chain.push(entry);
      break;
    }

    let txs;
    try {
      txs = await fetchAllTxs(client, current);
    } catch (err) {
      entry.terminated = `fetch-error: ${err.message}`;
      chain.push(entry);
      break;
    }

    if (direction === "backward") {
      // Earliest non-self inflow. Mirrors buildAncestryChain in report.mjs.
      const inflows = txs
        .filter((t) => t.to === current && t.from !== current && t.from !== ZERO)
        .sort((a, b) => a.ts - b.ts);
      const next = inflows[0];
      if (!next) {
        entry.terminated = "no-inflows";
        chain.push(entry);
        break;
      }
      entry.firstInflow = serializeEdge(next);
      chain.push(entry);
      current = next.from;
    } else {
      // Biggest outflow, native-preferred. Mirrors buildCashoutChain.
      const outflows = txs
        .filter((t) => t.from === current && t.to !== current && t.to !== ZERO)
        .sort((a, b) => {
          if (a.kind === b.kind) return BigInt(b.amount) > BigInt(a.amount) ? 1 : -1;
          if (a.kind === "native") return -1;
          if (b.kind === "native") return 1;
          return BigInt(b.amount) > BigInt(a.amount) ? 1 : -1;
        });
      const next = outflows[0];
      if (!next) {
        entry.terminated = "no-outflows";
        chain.push(entry);
        break;
      }
      entry.biggestOutflow = serializeEdge(next);
      chain.push(entry);
      current = next.to;
    }

    hopOffset++;
  }

  return chain;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// Fetch every transfer kind for a single address, normalised to the same edge
// shape the rest of the codebase uses. Sequential to keep the heap calm.
async function fetchAllTxs(client, address) {
  const all = [];
  const endpoints = [
    ["native", () => client.nativeTxs(address)],
    ["internal", () => client.internalTxs(address)],
    ["erc20", () => client.erc20Txs(address)],
    ["erc721", () => client.erc721Txs(address)],
    ["erc1155", () => client.erc1155Txs(address)],
  ];
  for (const [kind, fetchFn] of endpoints) {
    let rows;
    try { rows = await fetchFn(); } catch { continue; }
    for (const tx of rows) {
      if ((kind === "native" || kind === "internal") && tx.isError === "1") continue;
      const amount = pickAmount(tx, kind);
      if (amount === "0" && kind !== "erc721" && kind !== "erc1155") continue;
      all.push({
        from: (tx.from ?? "").toLowerCase(),
        to: (tx.to ?? "").toLowerCase(),
        hash: tx.hash,
        ts: Number(tx.timeStamp),
        amount,
        symbol: tx.tokenSymbol || (kind === "native" ? "ETH" : kind === "internal" ? "ETH (internal)" : "?"),
        decimals: Number(tx.tokenDecimal ?? (kind === "native" || kind === "internal" ? 18 : 0)),
        asset: tx.contractAddress ? tx.contractAddress.toLowerCase() : "ETH",
        kind,
      });
    }
  }
  return all;
}

function pickAmount(tx, kind) {
  if (kind === "erc721") return "1";
  if (kind === "erc1155") return tx.tokenValue ?? tx.value ?? "1";
  return tx.value ?? "0";
}

function serializeEdge(e) {
  return {
    from: e.from,
    to: e.to,
    hash: e.hash,
    time: new Date(e.ts * 1000).toISOString(),
    asset: e.symbol,
    amount: formatUnits(BigInt(e.amount), e.decimals ?? 18),
    kind: e.kind,
  };
}
