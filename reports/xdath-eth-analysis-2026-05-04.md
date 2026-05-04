# xdath.eth (`0x19745f6d…`) — cluster review

**Date:** May 4, 2026
**Status:** False positive — strike from the BankrBot/Grok cluster
**Subject:** `0x19745f6d7a0ec2585c9a00245da657a9895a9f27` (ENS: `xdath.eth`)
**Tooling:** Etherscan V2 free tier (via MCP), public web sources

---

## TL;DR

The address `0x19745f6d…` was listed in the [BankrBot/Grok heist report](./bankrbot-grok-heist-2026-05-04.md) as a "co-funded cluster wallet (Indonesian handle)." A focused review of the wallet's free-tier-visible history shows that **this attribution is wrong**:

- **3 years 212 days old**, **527 mainnet txs**, active across at least **5 EVM chains**.
- **Originally funded by `0xC6D7CbA2…c9c92b0C2`** in October 2022 — *not* by the laundering hub `0xee16…7ac3`.
- **Recently funded by OKX Hot Wallet 3** and trades through OKX's DEX router. Profile of a KYC'd CEX user.
- **No DRB exposure, no BankrBot interaction, no Base-side activity** in the visible sample.
- DeFi footprint covers Aave V3, zkSync, Uniswap, 1inch, OpenSea Seaport, Curve (Usual.money), Layer3 staking, NFT mints, Ethscriptions inscriptions.

The wallet's *only* tie to the laundering hub is a single co-occurrence on the hub's Etherscan counterparty page. That signal alone is not enough to add a wallet to the cluster, and the rest of the data refutes it.

---

## Why it ended up in the prior cluster

The BankrBot writeup used the laundering hub's outbound counterparty page as a proxy for "wallets the hub funded." That works for single-purpose Base-side burners (the hub creates them, sends the gas, they receive stolen DRB, they cash out). It does **not** work for any preexisting mainnet wallet that happens to share a transaction with the hub for unrelated reasons (small swap, dust, wrong-send, OTC).

`xdath.eth` is the second category.

---

## Evidence

### Wallet shape

| Metric | Value | What burners look like |
| --- | --- | --- |
| Age | 3 yrs 212 days (first tx Oct 2022) | < 30 days |
| Total mainnet txs | 527 | < 50 |
| Chains active | Eth, Polygon, Arbitrum, Linea, Gnosis, BSC, Taiko (≥ 7) | Single chain |
| Latest activity | ~2 hours before this review | Quiet after cash-out |

### Funding source

Etherscan's "Funded By" (the very first inbound) for `xdath.eth`:

```
0xC6D7CbA263bc5AFb0Ecc97820D8c6c6c9C92b0C2  →  3 yrs 212 days ago
tx: 0xa662365078f1e4458621c1443842e409c60e4201ce082429343944a817b5cba6
```

Recent inbound funding (within hours of this review):

```
OKX: Hot Wallet 3 (0xa9ac43f5b5e38155a288d1a01d2cbc4478e14573)
→ 4.56M wei (~0.0046 ETH)
```

On-chain swaps recently route through `OKX: Dex Router 3` (`0x6088d94c…`).

The laundering hub `0xee16…7ac3` does **not** appear in either the 50 oldest or 30 newest mainnet transactions sampled, nor in the 50 most recent ERC-20 transactions. It is also **not** the "Funded By" address.

### Native balances (free-tier chains)

| Chain | ChainID | Balance | USD (~) |
| --- | --- | --- | --- |
| Ethereum | 1 | 0.00000640 ETH | $0.02 |
| Polygon | 137 | 0.667 MATIC | $0.30 |
| Arbitrum One | 42161 | 0.0000861 ETH | $0.26 |
| Linea | 59144 | 0.0000786 ETH | $0.24 |
| Gnosis | 100 | 0.00905 xDAI | $0.009 |

Multichain dust is the hallmark of a long-running personal wallet.

### Protocol footprint (legitimate DeFi)

| Surface | Evidence |
| --- | --- |
| Aave V3 | `depositETH(onBehalfOf)` to `0xabea9132…` (WETH gateway), 2022 + 2023 |
| zkSync | `requestL2Transaction(...)` to `0x32400084…` (zkSync L1 contract), 2023 |
| Uniswap | Universal Router swaps via `0x3fc91a3a…`, 2023 |
| 1inch | Aggregator V6 (`0x111111125…`) `swap()` calls, 2026 |
| OpenSea Seaport | `fulfillAvailableAdvancedOrders`, `matchAdvancedOrders`, recurring 2025–2026 |
| Curve / Usual.money | LP in USD0/USD0++ pool with `remove_liquidity` exits |
| Layer3 | L3 staking with `getReward()` claims |
| Ethscriptions / "ESC-20 tom" | Self-tx inscription mints, 2023 |
| NFT mints | `publicMint`, `mintPublic`, `mintSigned`, multiple collections |
| Hypersnap (SNAP) | High-frequency `0x17ca7810` claim attempts (points farming) |

### Tokens held / traded

USDT, USDC, WETH, SAND (The Sandbox), L3 (Layer3), Anoma (XAN), bUSD0/USD0/USD0++, Hypersnap (SNAP), Unisato (uSATO), GENECORE (GENE), AI Coin (AIC), Espresso (ESP).

Plus dozens of unsolicited spam tokens — Trump Doge, Pikachu, Bad Dad, Bit Doge, Royal Doge, Brave Bear, Good Dog, Trump Mask, Royal Dog, Trump Shib, Trump Wars, Trump Rekt, Little Dog, Trump Dog. These are airdrop scams targeting any active mainnet wallet; their presence is **not** indicative of fraud-ring participation.

**No DRB, no BankrBot tokens, no Base-side LPs in any sample taken.**

---

## What to update in the prior report

Strike `0x19745f6d…` (xdath.eth) from the "Cluster wallets" table in `reports/bankrbot-grok-heist-2026-05-04.{md,html}` and add a footnote citing this review.

The other wallets in that table should be re-checked against the rules below. Wallets that predate the BankrBot incident, or that were originally funded by a CEX rather than the hub, are likely also false positives.

### Rules for cluster inclusion (going forward)

A wallet should be added to the cluster only if **at least two** of the following are true:

1. The hub's transfer to it is its **first inbound tx** (the hub created the wallet).
2. Wallet is **< 30 days old** at the time of the hub interaction.
3. Wallet has **touched the same Base-side fraud token** (DRB or successor).
4. Wallet **pushes value back** to the hub or to a known burner.

`xdath.eth` satisfies none of these.

---

## Caveats

- **Free tier blind spot.** Etherscan V2 free does not cover Base, Optimism, BSC, or Avalanche. There could be Base-side activity tying this wallet to the BankrBot incident that we cannot see. The Etherscan MCP follows the same tier, so it would not help. A paid Lite plan ($X/mo) would close this gap.
- **Sample, not full pull.** We sampled the 50 oldest, 30 newest, and 50 most recent ERC-20 transactions out of 527 total mainnet txs. A direct hub→wallet tx could exist in the middle and not have shown up. Even so, one stale dust transfer would not change the verdict given the wallet's age, CEX funding, and DeFi profile.
- **Private name tags unread.** Etherscan's address page didn't surface any private name tags or warning labels for this wallet.

---

## Source links

- [Etherscan: xdath.eth](https://etherscan.io/address/0x19745f6d7a0ec2585c9a00245da657a9895a9f27)
- [Etherscan: laundering hub](https://etherscan.io/address/0xee160757793c9d1721170c42ad363794a4347ac3)
- [Prior report — BankrBot/Grok heist](./bankrbot-grok-heist-2026-05-04.md)
- [Etherscan V2 — supported chains and free/paid tiering](https://docs.etherscan.io/etherscan-v2/getting-started/supported-chains)
