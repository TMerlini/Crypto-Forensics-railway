# rzleffendi.eth (`0x756566f5…`) — cluster review

**Date:** May 4, 2026
**Status:** False positive — strike from the BankrBot/Grok cluster
**Subject:** `0x756566f5c097091830e5b95cc112fd33295749eb` (ENS: `rzleffendi.eth`)
**Tooling:** Etherscan V2 free tier (via MCP), public web sources

---

## TL;DR

The address `0x756566f5…` was the second wallet listed in the [BankrBot/Grok heist report](./bankrbot-grok-heist-2026-05-04.md) as a "co-funded cluster wallet." Same protocol as the [xdath.eth review](./xdath-eth-analysis-2026-05-04.md) was applied here — and **`rzleffendi.eth` also fails all four cluster-inclusion rules**:

- **1 yr 4 mo old** (first tx Jan 7, 2024), **3,791 mainnet txs**, multichain footprint.
- **Originally funded by `0xaa364c1a348f9517009207a1601e0a73c1cd530b`** (high-nonce funder, not the laundering hub).
- **Profile: professional cross-chain trader / arbitrageur** — heavy use of CoW Protocol, LiFi, Wormhole, Polygon zkEVM bridge, Squid, Jumper, Socket. rsETH ping-pong yield strategy.
- **No DRB exposure, no BankrBot interaction, no Base-side fraud activity** in the visible sample.
- The laundering hub `0xee16…7ac3` does **not** appear in any sampled tx in either direction.

There is **one notable touchpoint** that needs to be called out and explained: a direct deposit from MEXC 16 (`0x9642b23e…`, the same exchange wallet that funded the laundering hub's chain) on April 24, 2026. This is best read as a normal CEX user withdrawing their own funds; it does not implicate `rzleffendi.eth` in the BankrBot incident, but it does reinforce that **MEXC is the keystone exchange** for the broader investigation.

---

## Why it ended up in the prior cluster

Same reason as `xdath.eth`: it appeared on the laundering hub's outbound counterparty list on Etherscan, and the prior report used that as a proxy for "wallets the hub funded." That heuristic doesn't survive contact with active mainnet traders.

---

## Evidence

### Wallet shape

| Metric | Value | What burners look like |
| --- | --- | --- |
| Age | 1 yr 4 mo (first tx Jan 7, 2024) | < 30 days |
| Total mainnet txs | 3,791 | < 50 |
| Chains active | Eth, Polygon, Arbitrum, Linea, Gnosis, BSC, Celo (≥ 7) | Single chain |
| Latest activity | ~6 hours before this review | Quiet after cash-out |

### Funding source

Etherscan's "Funded By" (the very first inbound):

```
0xaa364c1A348f9517009207a1601E0a73C1Cd530b  →  2 yrs 117 days ago (Jan 7, 2024)
tx: 0xe54870dedd83407fc0b365324fa06707e4ac1cded17cd57eb9b758b8d62a7a6f
```

`0xaa364c1A…` does not carry a public Etherscan label, but its high tx-count behaviour (nonce 91054 at the time of funding `rzleffendi.eth`) is consistent with a small CEX hot wallet, market maker, or OTC desk. Either way, it is **not** the laundering hub.

Recent funding pattern (within the last ~10 days):

| Source | Etherscan label | Reading |
| --- | --- | --- |
| `0x9642b23e…` | **MEXC 16** | Direct CEX withdrawal — 0.2238 ETH on Apr 24, 2026 |
| `0x56eddb7a…` | **Bitfinex 19** | USDT transfer ~$99.50 |
| `0xdfaa75323fb7…` | high-nonce CEX-style | USDT transfer ~$396 |
| `0x935d2e470284…` | high-nonce CEX-style | Multiple USDT transfers |
| `0xa9ac43f5…` | (separate from xdath) | (no recent activity) |

The hub `0xee16…7ac3` does **not** appear in either the 50 oldest or 30 newest mainnet transactions sampled, nor in the 50 most recent ERC-20 transactions. It is also **not** the "Funded By" address.

### Native balances (free-tier chains)

| Chain | ChainID | Balance | USD (~) |
| --- | --- | --- | --- |
| Ethereum | 1 | 0.000863 ETH | $2.84 |
| Polygon | 137 | 6.368 MATIC | $2.86 |
| Arbitrum One | 42161 | ~0.0000020 ETH | $0.006 |
| Linea | 59144 | 0.0000272 ETH | $0.082 |
| Gnosis | 100 | 0.0140 xDAI | $0.014 |

### Protocol footprint (professional cross-chain trading)

| Surface | Evidence |
| --- | --- |
| **CoW Protocol** | `0x9008d19f58aabd9ed0d60971565aa8510560ab41` — solver-settled rsETH ↔ WETH trades (`MoooZ1089603480()` and similar) |
| **LiFi Diamond** | `0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae` — `swapTokensSingleV3NativeToERC20()` and other LiFi calls |
| **Jumper Exchange** | `0x89c6340b1a1f4b25d36cd8b063d49045caf3f818` — many `0x0193b9fc` cross-chain executes via "jumper.exchange" integrator string |
| **Wormhole TokenBridge** | `0x3ee18b2214aff97000d974cf647e7c347e8fa585` — UST + token bridging out |
| **Polygon zkEVM Bridge** | `0x2a3dd3eb832af982ec71669e178424b10dca2ede` — `bridgeAsset()` + `claimAsset()` round-trips |
| **Squid Router** | `0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad` — `execute(payload, signatures)` cross-chain swaps |
| **Allbridge / Layerzero** | `0xbbbd1bbb…`, `0x051f1d88…` — token unlock / bridge calls in early activity |
| **Socket / Bungee** | `0x35d4d9bc79b0a543934b1769304b90d752691cad` — `sendBatch()` cross-chain rsETH delivery |
| **Universal Router** | `0x4c82d1fbfe28c977cbb58d8c7ff8fcf9f70a2cca` — Uniswap-style swap routing |
| **Hakka Finance ragequit** | `0xde02313f8bf17f31380c63e41cdecee98bc2b16d` — `ragequit(address[] tokens, uint256 share)` DAO exits |
| **Aura Finance** | `sendFrom()` LayerZero OFT bridging of AURA token |

### Tokens held / traded

USDT, USDC, WETH, **rsETH** (Kelp DAO LST), POL (Polygon Ecosystem Token, bridged), SKY (Sky / MakerDAO governance), AURA (Aura Finance), HAKKA (Hakka Finance), DYSN (Dyson Sphere), BHSc$ (BlackHoleSwap LP), Sphynx (Sphynx Labs), UST (Wormhole-bridged).

The rsETH activity is particularly diagnostic: dozens of "receive 0.5 rsETH from Socket → send to Jumper" cycles within minutes of each other. That's an automated yield/arb strategy, not a launderer.

**No DRB. No BankrBot tokens. No Base-side fraud tokens in any sample taken.**

---

## The MEXC connection — what it does and doesn't mean

On April 24, 2026, MEXC 16 (`0x9642b23ed1e01df1092b92641051881a322f5d4e`) sent 0.2238 ETH to `rzleffendi.eth` directly. This is the same MEXC hot wallet that, several layers earlier, funded the wallet that became the laundering hub `0xee16…7ac3`.

Three readings:

1. **Most likely:** `rzleffendi.eth` is a customer of MEXC who withdrew their own funds. MEXC has millions of users; co-occurrence with another MEXC customer (the hub operator) is statistically unremarkable.
2. **Less likely:** `rzleffendi.eth` and the hub are operated by the same entity. This is implausible because a launderer running a parallel 3,791-tx active trading wallet from the same KYC origin would be unusually careless and create an obvious paper trail.
3. **Plausible but unverifiable from free-tier data:** the hub-as-a-service hypothesis means `rzleffendi.eth` could in principle be a customer of the laundering service (separate from being a MEXC customer) — but there is no on-chain evidence of payments between them.

What this **does** mean for the investigation: MEXC's KYC records will contain the identities of *both* parties (the hub operator and `rzleffendi.eth`). The subpoena should ask MEXC to name every account that has withdrawn to either address, and any common metadata (IP, device, deposit funding source) across them. That's a data point worth collecting even if `rzleffendi.eth` itself isn't part of the BankrBot incident.

---

## What to update in the prior report

The original BankrBot writeup's "Cluster wallets" table contained two entries: `xdath.eth` (already struck) and `rzleffendi.eth` (now also struck). With both removed, the table is empty.

Recommended updates to `reports/bankrbot-grok-heist-2026-05-04.{md,html}`:

1. Strike the `rzleffendi.eth` row from the "Cluster wallets" table; keep the existing footnote and add this review as a second source.
2. **Remove Recommended Action #5** entirely. It pointed at cross-referencing the now-struck wallets on Base + BSC. Replace it with a tighter action: "Map the hub `0xee16…7ac3`'s outflow set across all free-tier chains and apply the 4-rule cluster-inclusion test to each recipient before tagging anyone as an accomplice."
3. Update the "Geographical pattern" row to reflect that the Indonesian-handle theory was based on two now-struck wallets and a single attacker EOA (`ilhamrafli.base.eth`). The attacker handle stands; the cluster theory does not.

---

## What's left of the original heist attribution

After this second false positive, the BankrBot/Grok findings boil down to:

| Layer | Status |
|---|---|
| Attacker EOA `0xE8E476bdd…` (`ilhamrafli.base.eth`) on Base | Solid |
| DRB token `0x98871E3C…` as the stolen asset | Solid |
| 5-hop mainnet gas chain | Solid |
| Laundering hub `0xee16…7ac3` (multichain, MEXC-funded) | Solid |
| Hub is a laundering *service* with a customer book | Strengthened — both struck wallets are MEXC users, suggesting the hub operator is a separate MEXC user running a service |
| MEXC 16 as KYC'd origin | Solid — now even more important |
| Recurring Binance 14 touchpoint | Solid |
| Indonesian-handle geographic theory | Removed — too soft a signal |
| Cluster of co-funded accomplice wallets | **Empty** — both candidates were false positives |

The investigation is now leaner and stronger. **The MEXC subpoena is the single highest-leverage move.**

---

## Caveats

- **Free tier blind spot.** Etherscan V2 free does not cover Base, Optimism, BSC, or Avalanche. There could be Base-side activity tying this wallet to BankrBot that we cannot see. A paid Lite plan would close this gap.
- **Sample, not full pull.** We sampled the 50 oldest mainnet txs, the 30 newest mainnet txs, and the 50 most recent ERC-20 txs out of 3,791 total. A direct hub→wallet tx could exist in the middle and not have shown up. Even so, one stale dust transfer would not change the verdict given the wallet's age, CEX funding, and arb-trader profile.
- **`0xaa364c1a…` not identified.** The first-inbound funder doesn't carry an Etherscan label. It could be a small CEX (Bitget, MEXC, Bitfinex), a market maker, or an OTC. Knowing exactly which would tighten the picture but isn't needed to clear the wallet.

---

## Source links

- [Etherscan: rzleffendi.eth](https://etherscan.io/address/0x756566f5c097091830e5b95cc112fd33295749eb)
- [Etherscan: laundering hub](https://etherscan.io/address/0xee160757793c9d1721170c42ad363794a4347ac3)
- [Etherscan: MEXC 16](https://etherscan.io/address/0x9642b23ed1e01df1092b92641051881a322f5d4e)
- [Etherscan: original funder 0xaa364c1A…](https://etherscan.io/address/0xaa364c1a348f9517009207a1601e0a73c1cd530b)
- [Prior false-positive review — xdath.eth](./xdath-eth-analysis-2026-05-04.md)
- [Prior report — BankrBot/Grok heist](./bankrbot-grok-heist-2026-05-04.md)
- [Etherscan V2 — supported chains and free/paid tiering](https://docs.etherscan.io/etherscan-v2/getting-started/supported-chains)
