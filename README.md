# CeloYield Agents — Cooperative Yield Router

Hackathon: Celo Builders — Agentic Payments & DeFAI (`agentic-payments-defai`,
ends **2026-08-03 09:00 UTC**). Submission repo:
[opitradingacademy/CeloYield-Agents](https://github.com/opitradingacademy/CeloYield-Agents).

Three cooperative agents paying each other via **real x402 micropayments on
Celo mainnet**, registered on ERC-8004, evaluating whether to rebalance yield
across Mento V3 FPMM pools. Each agent has its **own** Privy MPC wallet (the
shared-wallet bug from 2026-07-13 caused self-transfers and was fixed).

Live and unattended as of 2026-07-22 ~18:00 UTC, generating ~22 cycles/day
× 2 paid endpoints = ~44 x402 settlement events/day on Celo mainnet:

| Service | URL |
|---|---|
| signal-aggregator-agent | https://celoyield-signal.vercel.app (charged $0.001/req) |
| risk-manager-agent | https://celoyield-risk.vercel.app (charged $0.002/req) |
| yield-router-agent | background worker on Railway (no public URL) |
| dashboard | https://celoyield-dashboard.vercel.app (live ops) |

## What's running right now

```
┌──────────────────────────────────────────────────────────────────────┐
│  yield-router-agent (Railway orchestrator, no public URL)            │
│  every 180s: polls Mento V3, pays signal + risk via x402, evaluates  │
│  X402_MODE=live — self-facilitated real CELO transfer, ERC-8021 tagged│
└──────────────────────────────────────────────────────────────────────┘
              │ x402 pay $0.001              │ x402 pay $0.002
              ▼                              ▼
       ┌─────────────────────┐      ┌─────────────────────┐
       │ signal-agent        │      │ risk-manager        │
       │ APY aggregator      │      │ protocol scorer     │
       │ Vercel, /api/apy    │      │ Vercel, /api/assess │
       │ wallet 0x7318…578a  │      │ wallet 0x5314…4548  │
       └─────────────────────┘      └─────────────────────┘
                          ▼
                ┌─────────────────┐
                │ Mento V3 FPMM   │  on-chain swap
                │ (real, mainnet) │  signed by Privy MPC
                │ USDm ↔ USDC    │
                └─────────────────┘
```

**Real on-chain proof** (Celo mainnet, chainId 42220):
- Router wallet (payer): `0x2254256D89F17789f112335D643F52d3B043dF7E`
  — 209 CELO at deploy, ~0.4 CELO already settled as x402 payments
- Signal-agent wallet: `0x7318805D1E79a5A08A26214dCB99C5F07dCD578a`
- Risk-agent wallet: `0x5314540B295596754BF5aEEd351C8d38dD884548`
- All 3 agents registered on ERC-8004 mainnet Identity Registry:
  `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
  - signal-aggregator-agent → agent ID **9672**
  - yield-router-agent → **9671**
  - risk-manager-agent → **9670**
- Celo Builders attribution tag `celo_baf40ede1a50` embedded as an ERC-8021
  suffix on every outbound tx (registration, x402 payments, future swaps)
- `X402_MODE=live` — x402 payments are real tagged native-CELO transfers,
  verified on-chain by the receiving server before serving the request (see
  `shared/x402-mock.ts`), not a mocked header. Older `facilitator` mode
  with the official `api.x402.celo.org` is supported but the live-mode path
  is what production runs on (see "Gotchas" below for the robustness fix)
- All tx hashes link to https://celo.blockscout.com
- x402 settlements counter (visible on Dune leaderboard):
  https://dune.com/celo/agentic-payments-defai-hackathon

## Stack

| Layer | Tech | Notes |
|---|---|---|
| Wallets | Privy MPC (`@privy-io/node@0.25.0`) | One wallet per agent (NOT shared — fixes 13-jul self-transfer bug) |
| RPC | Forno / Blockscout for mainnet | Tenderly only needed for Sepolia |
| x402 | Live mode: self-facilitated real CELO transfer | `X402_MODE=live` in `shared/x402-mock.ts` — tagged, on-chain, no paid facilitator |
| Identity | ERC-8004 Identity Registry (mainnet) | Real contract, registration done at deploy |
| Swap protocol | Mento V3 FPMM (direct pool proxy call) | The SDK's `buildSwapTransaction` is broken for V3; we call the pool directly |
| Dashboard | Next.js 15 + Tailwind 3.4 + viem 2.39 | Polls server-side aggregator every 3s |
| Inter-agent activity log | **Upstash Redis** (key `celoyield:activity`, capped at 200) | Replaced the per-instance local JSONL that broke across deployments |
| Deployments | Vercel (signal, risk, dashboard) + Railway (router, persistent worker) | See "Production deployment" below |

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
# Required for the router + Vercel deploys:
#   PRIVY_APP_ID=...
#   PRIVY_APP_SECRET=...
#   NETWORK=mainnet
# Optional but used in production:
#   UPSTASH_REDIS_REST_URL=https://...
#   UPSTASH_REDIS_REST_TOKEN=...
#   X402_MODE=live          (or 'facilitator' for the official x402.celo.org path)

# 3. Start the 3 servers (each in its own shell, or with `&` for background)
#    Terminal 1:
cd signal-aggregator-agent && NETWORK=mainnet npm run dev   # port 3001

#    Terminal 2:
cd risk-manager-agent && NETWORK=mainnet npm run dev         # port 3002

#    Terminal 3:
cd dashboard && NETWORK=mainnet npm run dev                  # port 3003

#    Terminal 4 (router runs FOREGROUND — control+C stops the cycle):
cd yield-router-agent && \
  YIELD_CYCLE_MS=10000 \
  TRADE_AMOUNT_USDM=10 \
  MIN_PROFIT_MARGIN=0.0001 \
  AUTO_APPROVE=false \
  npm start
```

The yield-router-agent needs the `.env` to load `PRIVY_APP_ID` and
`PRIVY_APP_SECRET`. The `npm start` script uses `tsx --env-file=../.env` to
pick them up automatically. **Next.js sub-packages do NOT read the monorepo
root `.env`** — pass env vars inline (`NETWORK=mainnet npm run dev -- -p 3001`)
for the three Next.js apps.

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

## Production deployment

The 3 agents run unattended, mainnet, no laptop required:

- **signal-aggregator-agent** and **risk-manager-agent** → Vercel (Next.js
  API routes, git-connected to `main`). Root Directory set per-project via
  the Vercel API (`rootDirectory`), install command overridden to
  `cd .. && npm install --legacy-peer-deps` (workspace deps are hoisted to
  the monorepo root, the default install only covers the sub-package).
- **yield-router-agent** → Railway, deployed from `Dockerfile.router` (a
  persistent worker — Vercel serverless functions can't run a `setInterval`
  loop). Config pinned in `railway.json`. Env: `NETWORK=mainnet
  X402_MODE=live YIELD_CYCLE_MS=180000 TRADE_AMOUNT_USDM=0.2
  AUTO_APPROVE=true`.

See `CLAUDE.md` → "Deployment (Vercel + Railway)" for the full list of
gotchas hit getting this working (Next.js file tracing, Railway's Railpack
builder defaulting to `npm ci`, Vercel Deployment Protection on team-suffixed
domains, etc.) — worth reading before touching the deploy config again.

## Contract addresses (Celo mainnet, chainId 42220)

| What | Address |
|---|---|
| ERC-8004 Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ERC-8004 Reputation Registry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| USDm | `0x765DE816845861e75A25fCA122bb6898B8B1282a` |
| USDC (native, 6 dec) | `0x01C5C0122039549AD1493B8220cABEdD739BC44E` |
| USDC.e (legacy 18 dec, used by x402 facilitator) | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` |
| CELO (ERC-20 view) | `0x471EcE3750Da237f93B8E339c536989b8978a438` |
| Uniswap V3 SwapRouter02 | `0x5615CDAb10dc425a742d643d949a7F474C01abc4` |
| Uniswap V3 QuoterV2 | `0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8` |
| Uniswap V3 Factory | `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc` |

Sepolia addresses (legacy demo, no longer used for the hackathon) are in
`shared/network.ts`.

## Key gotchas (verified against real SDKs/RPCs)

- **Privy rejects EIP-1559 txs on Sepolia** due to stale forno RPC balance check.
  Use legacy tx format (`sendTransactionLegacy()` in `shared/wallet.ts`): pass
  all fields as hex strings (`chain_id`, `nonce`, `gas_limit`, `gas_price`).
- **All public Celo Sepolia RPCs are degraded in mid-2026.** Only Tenderly's
  gateway is reliable. Don't trust forno or publicnode for balance reads. On
  **mainnet** this is not an issue — forno works fine and is used by default.
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
  for hoisting. Vercel sub-package installs need their `installCommand`
  overridden to `cd .. && npm install --legacy-peer-deps` so hoisted root deps
  are picked up.
- **Shared resource paths across workspaces**: walk up from `process.cwd()`
  looking for a `shared/` directory marker (not file — file may not exist yet).
- **`.env` duplicate keys are silent**: Node's `--env-file` parser takes
  the last value without warning. Never paste a value that starts with the
  same name as another var — `X402_MODE=x402_7196...` (intended as `X402=...`)
  silently wins over the legitimate `X402_MODE=live` line above. Always
  verify with `node --env-file=.env -e 'console.log(X)'` after pasting.
- **Don't hand-roll `.env` value extraction with grep/cut/sed** — Windows
  trailing `\r` and adjacent comments corrupt the value but upload still
  returns 200, leading to silent runtime auth failures. Use
  `node --env-file=.env -e ...` and verify the result authenticates.
- **Activity log is now centralized on Upstash Redis** (key
  `celoyield:activity`, LPUSH/LTRIM/LRANGE). Falls back to local JSONL only
  when env vars aren't set. Read by both signal-agent, risk-agent, and
  router-process from any deployment.
- **Activity log noise**: don't log routine 402s (liveness pings flood the feed).
- **`shared/.agent-wallets.json` must be committed**, not gitignored — no
  private keys in it (Privy custody), and without it the deployed agents try
  to recreate a wallet with an `external_id` Privy already has, which errors.
- **Next.js won't bundle files read via `fs` at runtime** unless told to —
  add `outputFileTracingIncludes` in `next.config.js` for any route that
  reads `shared/.agent-wallets.json` or similar.
- **Celo mainnet's intrinsic gas floor is above 21000** for a plain transfer;
  Privy rejects `gas: 21000` — use `30000`.
- **Mento has no CELO↔USDC pool** on mainnet (verified all 18 pools —
  every one is stablecoin-to-stablecoin). Converting CELO to trading capital
  needs an external DEX (Uniswap V3 with the addresses above, fee 0.3%
  gave the best effective price on CELO/USDC).
- **`fetchWithPaymentReal` parses either `accept.price` (celo-native) or
  `accept.maxAmountRequired` (facilitator 'exact' scheme)** — never both
  assumed. If neither is present, bounce the 402 untouched so the caller can
  decide.
- **Railway deploys can stay QUEUED for hours** during upstream GitHub
  webhook storms. `serviceInstanceRedeploy` returns `true` immediately
  even when the build never starts — poll `service.deployments` until
  `status: "SUCCESS"` and `statusUpdatedAt` non-null before trusting.
- **`variableUpsert` does NOT reload env on a running Railway container** —
  pair every env change with a `deploymentRestart` or `serviceInstanceRedeploy`.

## Status snapshot (last refresh: 2026-07-22)

- **x402 payments flowing on mainnet**: 27+ tagged native-CELO settlements
  from the router wallet since 17:30 UTC, mixed into signal-agent +
  risk-agent wallets. Cycle is every 180s, so ~22 cycles/day × 2 paid
  endpoints = ~44 x402 txs/day landing on-chain, all ERC-8021 tagged with
  `celo_baf40ede1a50`.
- **Hackathon deadline**: **2026-08-03 09:00 UTC** — ~11 days remaining
  when this entry was written. Track `most-x402-payments` total estimated to
  pass 11k settlements by close if the cycle keeps running.
- **Track `most-revenue-generated`** (`$3,000` prize pool) is dormant —
  requires operator-funded USDC + USDm liquidity in the router wallet, since
  Mento V3 FPMM doesn't execute swaps when deviation is below live gas cost.
- **Public dashboard**: https://celoyield-dashboard.vercel.app
  (live on-chain balances, recent txs, agent counters).

## License

UNLICENSED — hackathon submission.