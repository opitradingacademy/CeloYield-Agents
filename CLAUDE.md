# CLAUDE.md — celo-agentic-payments

Hackathon submission (Celo Builders Agentic Payments / DeFAI). Three
cooperative agents paying each other via x402, registered on ERC-8004,
executing real Mento V3 FPMM swaps on Celo. Full concept writeup in `IDEA.md`,
day-to-day status and how-to-run in `README.md` — this file is oriented at
picking the work back up in a fresh session.

## Structure

npm workspaces monorepo. Install once from repo root (`npm install
--legacy-peer-deps`), never inside a single package.

```
shared/                   network config + Privy wallet + ERC-8004 registration + x402 mock + activity log
oracle-agent/             legacy Next.js — kept for hackathon demo reference
arbitrage-agent/          legacy Node/TS — original Para-based bot, kept for reference
yield-router-agent/       MAIN: orchestrator (port 3000 logic, runs in foreground)
signal-aggregator-agent/  sells APY snapshots for $0.001/req (Next.js, port 3001)
risk-manager-agent/       sells risk scores for $0.002/req (Next.js, port 3002)
dashboard/                live ops dashboard (Next.js, port 3003)
```

## Current state (as of 2026-07-11)

**All 7 packages type-check clean** (`npx tsc --noEmit` in each).

**Real on-chain end-to-end verified on Celo Sepolia**:
- Privy wallet `0x2254256D89F17789f112335D643F52d3B043dF7E` is funded
  (12.27 CELO + 18 USDC + 0.16 USDm confirmed via Blockscout API)
- Multiple real USDC→USDm swaps executed via Privy signing. Example:
  `0xb8527d164708b7fda3c3b50f302df8ffd441f94d25cc4bf60cfd1dc26d36bc85`
- `signal-aggregator-agent` registered on ERC-8004 (agent ID 394).
  `risk-manager-agent` and `yield-router-agent` registration pending
  (data URI size limit issue — see gotchas).
- Dashboard at `localhost:3003` shows live events, counters, balances.
- Yield-router-agent runs in background with 10s cycle, pays signal +
  risk via x402 mock, logs every step to `shared/.activity.jsonl`.

## Active servers (as of last boot)

| Port | Service | How to start |
|---|---|---|
| 3001 | signal-aggregator-agent | `cd signal-aggregator-agent && npm run dev` |
| 3002 | risk-manager-agent | `cd risk-manager-agent && npm run dev` |
| 3003 | dashboard | `cd dashboard && npm run dev` |
| (background) | yield-router-agent | `cd yield-router-agent && YIELD_CYCLE_MS=10000 MIN_PROFIT_MARGIN=0.0001 npm start` |

All 4 run on `npm install --legacy-peer-deps` from repo root. `.env` needs
`PRIVY_APP_ID` + `PRIVY_APP_SECRET` + `NETWORK=sepolia`.

## Do NOT re-discover these (verified against real installed packages, not docs)

### Wallet / RPC
- **Privy's forno RPC balance check is stale on Celo Sepolia** — reports
  wallets as having 0 CELO even when Blockscout confirms funds. Fix:
  `sendTransactionLegacy()` in `shared/wallet.ts` uses legacy (type-0) tx
  format with all values as hex strings (`chain_id`, `nonce`, `gas_limit`,
  `gas_price` — NO `max_priority_fee_per_gas` because Privy requires min 1
  priority fee). EIP-1559 format always fails.
- **All public Celo Sepolia RPCs degraded mid-2026**: forno reports stale
  state, publicnode returns 404 on certain methods, drpc wrong data,
  omniatech down. Only **Tenderly gateway** (`celo-sepolia.gateway.tenderly.co`)
  is reliable, no API key needed for reads/broadcasts. Used by
  `shared/network.ts` default.
- **Blockscout API** (`celo-sepolia.blockscout.com/api?module=...`) is
  authoritative for balances/tx history when RPCs lie.
- **`@privy-io/node@0.25.0` peer dep is `viem ^2.44.2`** but root pinned to
  `2.39.0` (thirdweb constraint). Use `npm install --legacy-peer-deps`.
  `2.39.0 >= 2.24.1` (older Privy peer) so the conflict is dual-install
  detection, not actual incompatibility.

### Mento SDK
- **`@mento-protocol/mento-sdk@3.2.7` is a broken npm publish** (no `dist`).
  Use `3.2.8`.
- **Mento SDK 3.2.8 `buildSwapTransaction` is broken for V3 FPMM on Sepolia.**
  Generates V2 Router calldata (`swapExactTokensForTokens`) but Sepolia
  pools are V3 FPMM (proxy contracts). Real swap pattern is 2 txs directly
  to the pool proxy: `ERC20.transfer(pool, amountIn)` then
  `pool.swap(amount0Out, amount1Out, recipient, 0x)`. Implemented in
  `yield-router-agent/src/executor.ts`.
- `mento.quotes.getAmountOut(tokenInAddr, tokenOutAddr, amountInWei)` works
  correctly. `mento.pools.getPools()` returns all pools; filter by
  `poolType === "FPMM"` for V3.
- The real liquid USDm on Sepolia is `0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b`
  — NOT celopedia's address (which has no pool). USDC:
  `0x01C5C0122039549AD1493B8220cABEdD739BC44E`. EURm has NO pool on Sepolia.
- `viem` must be pinned to exactly `2.39.0` repo-wide — thirdweb hard-pins it
  and any mismatch causes duplicate nested copy with incompatible types.

### Workspace / Next.js
- npm workspaces + Next.js sub-packages: keep ONLY the root
  `package-lock.json`. Tailwind in root `dependencies` (not devDependencies)
  for hoisting via workspaces.
- Path resolution for shared resources: walk up from `process.cwd()`
  looking for a `shared/` directory marker (NOT a file — file may not
  exist yet). Implemented in `shared/wallet.ts` `findWalletMapPath()` and
  `shared/activity-log.ts` `resolveLogPath()`.

### x402
- `X402_MODE=mock` (default) is a header-based fake facilitator. Zero cost.
- `X402_MODE=thirdweb` = $99/mo + 0.3%/tx. Only switch deliberately.
- thirdweb's `wrapFetchWithPayment` needs a thirdweb `Wallet` not raw viem.

### ERC-8004 registration
- `register(string)` with `data:` URIs ≥2KB reverts with out-of-gas even at
  gas_limit=2M. Use minimal SVG (≤200 bytes) and terse descriptions.
- Privy "replacement transaction underpriced" errors: only register one at
  a time with 30-45s delays between each, or use nonce offsets.
- `external_id` is write-once, max 64 chars. Cache mapping in
  `shared/.agent-wallets.json` (recover via `shared/recover-wallets.ts`).

### Activity log
- Don't log routine 402s (liveness pings flood the feed). Filter at write time.
- JSONL format with `appendFileSync` (atomic). Read with `readFileSync` +
  line split — fine for hackathon scale.

## Contract addresses (Celo Sepolia, chainId 11142220)

| What | Address |
|---|---|
| ERC-8004 Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation Registry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| USDm (real, liquid) | `0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b` |
| USDC | `0x01C5C0122039549AD1493B8220cABEdD739BC44E` |
| Mento V3 FPMM USDC/USDm proxy | `0x7109E0A9B4623e90755b7e5c4e10F089E5Bf8bDb` |

Mainnet addresses are in `shared/network.ts`.

## Verifying the system end-to-end

```bash
# 1. List live Mento V3 pools on Sepolia with TVL/APY projection
npx tsx shared/recon-sepolia-pools.ts

# 2. Test Privy wallet (creates wallet, self-transfer on Sepolia)
npx tsx shared/test-privy-signer.ts

# 3. Curl the agents with x402 mock payment
curl -i http://localhost:3001/api/apy?asset=USDC                          # 402
curl -i -H "x-mock-payment: paid" http://localhost:3001/api/apy?asset=USDC  # 200
curl -i http://localhost:3002/api/assess?protocol=Mento\&asset=USDC        # 402
curl -i -H "x-mock-payment: paid" \
  "http://localhost:3002/api/assess?protocol=Mento&asset=USDC"            # 200

# 4. Dashboard
open http://localhost:3003

# 5. Verify on-chain via Blockscout API
curl "https://celo-sepolia.blockscout.com/api?module=account&action=balance&address=0x2254256D89F17789f112335D643F52d3B043dF7E"
```

## Engram

Project name: `celo-agentic-payments`. Key topic_keys:
- `celo-agentic-payments/architecture` — system design, agent topology, why 3 agents
- `celo-agentic-payments/sdk-gotchas` — Privy/Tenderly/Mento-specific pitfalls
- `celo-agentic-payments/hackathon-progress` — what was done, what remains

Session summary lives in engram with session_id
`pivot-para-to-privy-yield-router-complete-2026-07-11`.

## Known gaps / next steps

- Register risk-manager + yield-router on ERC-8004 (failed previously due to
  data URI gas limits). Use ipfs:// via Pinata (needs valid PINATA_JWT) or
  shorten metadata further.
- Add Moola + Ubeswap protocols to risk-scorer (Sepolia only has Mento;
  mainnet has 5+ protocols for richer demo).
- Add Telegram notification path (currently operator prompt is in console).
- Real gas estimation via `wallet.estimateGas()` before each swap
  (`$0.0005` constant in `shared/pricing.ts` is only valid for Sepolia).
- Mainnet deploy: $200 real capital, run for 30+ days, validate yields.