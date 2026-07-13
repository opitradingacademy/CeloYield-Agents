# Celo Agentic Payments — Cooperative Yield Router

Hackathon: Celo Builders Agentic Payments / DeFAI track.

Three cooperative agents paying each other via x402 micropayments, registered
on ERC-8004, executing real Mento V3 FPMM swaps on Celo. Each agent has its
own Privy MPC wallet. The dashboard at `localhost:3003` shows everything in
real time.

## What's running right now

```
┌──────────────────────────────────────────────────────────────────────┐
│  yield-router-agent (orchestrator)                                    │
│  - every 10s: polls Mento V3, pays signal + risk via x402, evaluates  │
└──────────────────────────────────────────────────────────────────────┘
              │ x402 pay $0.001              │ x402 pay $0.002
              ▼                              ▼
       ┌─────────────────┐            ┌─────────────────┐
       │ signal-agent    │            │ risk-manager    │
       │ APY aggregator  │            │ protocol scorer │
       │ port 3001       │            │ port 3002       │
       └─────────────────┘            └─────────────────┘
              │                              │
              └──────────┬───────────────────┘
                         ▼
                ┌─────────────────┐
                │ Mento V3 FPMM   │  on-chain swap
                │ (real, Sepolia) │  signed by Privy MPC
                └─────────────────┘

                  ┌─────────────────┐
                  │ dashboard       │  Next.js, port 3003
                  │ live stats +    │  polls /api/state every 3s
                  │ activity feed   │
                  └─────────────────┘
```

**Real on-chain proof** (Sepolia):
- Wallet: `0x2254256D89F17789f112335D643F52d3B043dF7E` (~12 CELO, 18 USDC, 0.16 USDm)
- Multiple real USDC→USDm swaps executed via Privy signing
- All tx hashes link to https://celo-sepolia.blockscout.com
- `signal-aggregator-agent` registered on ERC-8004 as agent ID 394

## Stack

| Layer | Tech | Notes |
|---|---|---|
| Wallets | Privy MPC (`@privy-io/node@0.25.0`) | 50K free signatures/month |
| RPC | Tenderly gateway (`celo-sepolia.gateway.tenderly.co`) | Other public Sepolia RPCs are degraded as of 2026-07 |
| x402 | Mock mode (header-based) | Free; thirdweb/Daydreams upgrade path when revenue justifies |
| Identity | ERC-8004 Identity Registry | Real contract on Sepolia |
| Swap protocol | Mento V3 FPMM (direct pool proxy call) | The SDK's `buildSwapTransaction` is broken for V3; we call the pool directly |
| Dashboard | Next.js 15 + Tailwind 3.4 + viem 2.39 | Polls server-side aggregator every 3s |
| Inter-agent log | JSONL append-only (`shared/.activity.jsonl`) | Simple, atomic, no DB |

## Repo layout

```
celo-agentic-payments/
├── package.json                      # npm workspaces root
├── .env.example                      # template (copy to .env, fill in)
├── shared/
│   ├── wallet.ts                     # Privy wallet helper (sendTransactionLegacy for Sepolia)
│   ├── network.ts                    # RPC + token addresses (Sepolia + mainnet)
│   ├── pricing.ts                    # agent fee/gas constants
│   ├── x402-mock.ts                  # settleMock() server + fetchWithPayment() client
│   ├── activity-log.ts               # JSONL activity log (all 3 agents → dashboard)
│   ├── register-agent.ts             # ERC-8004 register helper
│   ├── register-both.ts              # bulk-register 3 agents
│   ├── recover-wallets.ts            # rebuild .agent-wallets.json if lost
│   ├── recon-sepolia-pools.ts        # list live Mento V3 pools
│   ├── recon-sepolia-apy.ts          # APY projection per pool
│   ├── check-moola-sepolia.ts        # verify Moola deployment
│   └── .agent-wallets.json           # external_id → walletId cache (DO NOT COMMIT)
├── oracle-agent/                     # legacy: x402 volatility API (kept for hackathon demo)
├── arbitrage-agent/                  # legacy: original Para-based arb bot (kept for reference)
├── yield-router-agent/               # MAIN: orchestrator that pays the other two
│   ├── src/
│   │   ├── index.ts                  # main loop (poll → signal-paid → risk-paid → decide → execute)
│   │   ├── apy-fetcher.ts            # Mento V3 quote fetcher with rolling history
│   │   ├── decision.ts               # evaluateMove: edge vs costs vs min margin
│   │   └── executor.ts              # FPMM V3 swap: 2 txs (transfer + swap)
│   └── package.json
├── signal-aggregator-agent/          # sells APY snapshots for $0.001/req
│   └── app/api/apy/route.ts          # Mento V3 FPMM pool walker
├── risk-manager-agent/               # sells risk scores for $0.002/req
│   ├── lib/risk-scorer.ts            # audit table + live TVL
│   └── app/api/assess/route.ts
└── dashboard/                        # Next.js live ops dashboard on port 3003
    ├── app/
    │   ├── page.tsx                  # main page (Hero + RouterStats + ActivityFeed + Agents + OnChainProof)
    │   ├── api/state/route.ts        # server-side aggregator
    │   └── api/swap/route.ts         # spawns yield-router-agent executor
    ├── components/
    │   ├── HeroSection.tsx           # title + architecture diagram + inline Run Swap button
    │   ├── RouterStatsPanel.tsx      # 8 live counters (Polls, signal-paid, risk-paid, Quotes, Skips, Swaps, Errors, Total $ paid)
    │   ├── ActivityFeed.tsx          # live event stream from .activity.jsonl
    │   ├── AgentStatusCards.tsx      # 3 cards with fee/call, calls, earned
    │   ├── OnChainProof.tsx          # wallet balance + recent txs + pool/risk snapshots
    │   └── SwapPanel.tsx             # Run Swap button (inline in Hero)
    └── lib/
        ├── state.ts                  # buildDashboardState()
        └── types.ts                  # DashboardState, ActivityEvent, etc.
```

## Running locally

```bash
# 1. Install (workspaces — once from root, NOT inside individual packages)
npm install --legacy-peer-deps

# 2. Set up env
cp .env.example .env
# Fill in:
#   PRIVY_APP_ID=...      (from https://dashboard.privy.io/)
#   PRIVY_APP_SECRET=...
#   NETWORK=sepolia

# 3. Start the 3 servers (each in its own shell, or with `&` for background)
#    Terminal 1:
cd signal-aggregator-agent && npm run dev    # port 3001

#    Terminal 2:
cd risk-manager-agent && npm run dev          # port 3002

#    Terminal 3:
cd dashboard && npm run dev                   # port 3003 (load this in browser)

#    Terminal 4:
cd yield-router-agent && \
  YIELD_CYCLE_MS=10000 \
  TRADE_AMOUNT_USDM=10 \
  MIN_PROFIT_MARGIN=0.0001 \
  npm start
```

The yield-router-agent needs the `.env` to load `PRIVY_APP_ID` and
`PRIVY_APP_SECRET`. The `npm start` script uses `tsx --env-file=../.env` to
pick them up automatically.

## Using the dashboard

Open `http://localhost:3003`. You'll see:

1. **Hero**: title + architecture diagram + "Run Swap" button (triggers a real
   on-chain swap)
2. **yield-router-agent · live stats**: 8 counters + a status line in Spanish
   ("Mirando el precio en Mento V3 FPMM…", "Pagando al signal-aggregator-agent…",
   etc.). Counts grow as the agent runs.
3. **Activity Feed** (full-width): live stream of events from all 3 agents, with
   tx hash links to Blockscout. Updates every 3s.
4. **Agents**: 3 cards (yield-router, signal-aggregator, risk-manager) with fee
   per call, calls received, total earned.
5. **On-Chain Proof**: wallet balances (CELO/USDC/USDm) + recent 6 txs with
   links to Blockscout + live pool + risk snapshots.

The "Run Swap" button triggers a real 1 USDC → USDm swap via the yield-router
executor (FPMM V3 pattern: ERC20.transfer() + pool.swap()). Result shows tx
hashes with Blockscout links.

## Tests / verification scripts

These live in `shared/` and can be run from the repo root:

```bash
# List all live Mento V3 FPMM pools on Sepolia with TVL and APY projection
npx tsx shared/recon-sepolia-pools.ts

# Check if Moola Market is deployed on Sepolia (it isn't — mainnet only)
npx tsx shared/check-moola-sepolia.ts

# Test Privy wallet creation + signing (creates a wallet, sends a self-transfer)
npx tsx shared/test-privy-signer.ts

# Bulk-register the 3 agents on ERC-8004 (needs PINATA_JWT or data: URIs)
npx tsx shared/register-both.ts
```

## Switching to mainnet

```bash
export NETWORK=mainnet
```

The RPC and token addresses swap automatically (`shared/network.ts`). But:

1. **Re-register ERC-8004** — mainnet has a different Identity Registry contract.
2. **Use EOA + KMS for signing** — Privy's MPC works on mainnet but costs
   $0.10/op after the free tier; for high-frequency mainnet use, a self-custody
   path (Turnkey or AWS KMS) is cheaper.
3. **Real x402 settlement** — switch `X402_MODE=thirdweb` and set the thirdweb
   credentials (costs $99+/mo + 0.3%/tx).
4. **Add real gas estimation** — `wallet.estimateGas()` before every tx; the
   $0.0005 constant in `shared/pricing.ts` is only valid for Sepolia.
5. **Add Moola + Ubeswap** — Sepolia only has Mento; mainnet has 5+ protocols.

## Contract addresses (Celo Sepolia, chainId 11142220)

| What | Address |
|---|---|
| ERC-8004 Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation Registry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| USDm (real, liquid) | `0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b` |
| USDC | `0x01C5C0122039549AD1493B8220cABEdD739BC44E` |
| Mento V3 FPMM USDC/USDm proxy | `0x7109E0A9B4623e90755b7e5c4e10F089E5Bf8bDb` |

Mainnet addresses are in `shared/network.ts`.

## Key gotchas (verified against real SDKs/RPCs)

- **Privy rejects EIP-1559 txs on Sepolia** due to stale forno RPC balance check.
  Use legacy tx format (`sendTransactionLegacy()` in `shared/wallet.ts`): pass
  all fields as hex strings (`chain_id`, `nonce`, `gas_limit`, `gas_price`).
- **All public Celo Sepolia RPCs are degraded in mid-2026.** Only Tenderly's
  gateway is reliable. Don't trust forno or publicnode for balance reads.
- **Mento SDK 3.2.8 `buildSwapTransaction` is broken for V3 FPMM on Sepolia.**
  It generates V2 Router calldata (`swapExactTokensForTokens`) but Sepolia
  pools are V3. Real swap pattern is 2 txs to the pool proxy directly:
  `ERC20.transfer(pool, amount)` then `pool.swap(amount0Out, amount1Out, to, 0x)`.
- **ERC-8004 register with data: URIs ≥2KB reverts with out-of-gas** even at
  gas_limit=2M. Use minimal SVG logos and terse descriptions.
- **Privy's npm workspace installs** need `npm install --legacy-peer-deps` —
  Privy declares `viem ^2.44.2` peer dep but the workspace is pinned to 2.39.0
  by thirdweb.
- **npm workspaces + Next.js sub-packages**: keep only the root `package-lock.json`,
  no per-package lockfile. Put Tailwind in root `dependencies` (not devDependencies)
  for hoisting.
- **Shared resource paths across workspaces**: walk up from `process.cwd()`
  looking for a `shared/` directory marker (not file — file may not exist yet).
- **Activity log noise**: don't log routine 402s from liveness pings — floods
  the feed.

## License

UNLICENSED — hackathon submission.