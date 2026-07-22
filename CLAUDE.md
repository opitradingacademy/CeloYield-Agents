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

## Current state (as of 2026-07-22)

**All 7 packages type-check clean** (`npx tsc --noEmit` in each).

**Hackathon runs through 2026-08-03 09:00 UTC** (not 07-20 as initially
noted — confirmed via `/hackathons/agentic-payments-defai` re-fetch on
2026-07-22). 12 days remaining when this entry was written.

**Pivoted from Sepolia demo to a live Celo MAINNET deployment** for the
Celo Builders hackathon `agentic-payments-defai` (submission slug
`CeloYield Agents`). Mainnet is a hard
rule of that hackathon — Sepolia activity does not count for the leaderboard.

**Production deployment (all 3 agents live, unattended):**

| Service | Platform | URL |
|---|---|---|
| signal-aggregator-agent | Vercel | https://celoyield-signal.vercel.app |
| risk-manager-agent | Vercel | https://celoyield-risk.vercel.app |
| yield-router-agent | Railway (Docker worker) | no public URL (background loop) |
| dashboard | Vercel | https://celoyield-dashboard.vercel.app |

Router runs with `NETWORK=mainnet X402_MODE=live YIELD_CYCLE_MS=180000
TRADE_AMOUNT_USDM=0.2 AUTO_APPROVE=true`. 3-minute cycle chosen deliberately
to conserve the small mainnet gas budget over the remaining hackathon days
— do not drop this back to a fast interval without checking the CELO balance
first (`shared/network.ts` mainnet wallet: see below).

**Real on-chain state on Celo mainnet:**
- Privy wallet `0x2254256D89F17789f112335D643F52d3B043dF7E` — funded with
  real CELO (sent from Binance) + ~0.72 USDC (swapped manually via the
  operator's personal Rabby wallet on app.mento.org/Ubeswap, since Mento's
  SDK has no CELO↔USDC pool — see gotchas).
- All 3 agents registered on ERC-8004 **mainnet** Identity Registry
  (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`):
  - `signal-aggregator-agent` → agent ID **9672**
  - `risk-manager-agent` → agent ID **9670**
  - `yield-router-agent` → agent ID **9671**
  - (agent ID 394 from earlier Sepolia registration does NOT count for this
    hackathon — mainnet-only rule)
- Celo Builders `attributionTag`: `celo_baf40ede1a50` (locked to first
  registered repo, `hexarenagamer/CeloYield-Agents` — later URL edits to
  `opitradingacademy/CeloYield-Agents` did not change it). Embedded as an
  ERC-8021 calldata suffix on every outbound tx in `shared/wallet.ts`
  (`withAttributionTag()`), applied centrally so no per-caller wiring needed.
- `X402_MODE=live`: x402 "payment" is now a real tiny native-CELO transfer
  (see `shared/x402-mock.ts` `settleReal`/`fetchWithPaymentReal`), tagged,
  settled and verified on-chain — not a header-based mock. Real transactions
  count toward the "Most x402 Payments" Dune leaderboard track.
- Gas cost in `decision.ts`'s profitability math is now a **live estimate**
  (`shared/pricing.ts` `estimateGasCostUsd()`: real `eth_gasPrice` × 400k gas
  units × live CELO/USD from CoinGecko), replacing a flat `$0.0005` guess
  that never reflected mainnet reality.

**x402 payments now flowing on mainnet (since 2026-07-22 17:30 UTC):**
27+ tagged native-CELO transfers from the router wallet to signal-agent
(`0x7318…578a`) and risk-agent (`0x5314…4548`), ~0.0136 CELO each, total
volume ~0.438 CELO (~$0.031 at $0.072/CELO). Each 180s cycle generates
1 signal payment ($0.001) + 1 risk payment ($0.002) → ~480 cycles/day × 12
days = ~5,760 x402 settlements expected before hackathon close. A
`fetchWithPaymentReal` robustness fix landed 2026-07-22 (parses
`maxAmountRequired` from facilitator's "exact" scheme when `price` is
absent) so the router degrades gracefully when a server is in the wrong
mode instead of crashing on `Cannot read properties of undefined`.

**Funds remaining (2026-07-22):**
Router wallet `0x2254256D89F17789f112335D643F52d3B043dF7E` holds ~209 CELO
(~$15 at $0.072/CELO) and **0 USDC / 0 USDm** — enough for thousands more
cycles at $0.003/each, but not enough to execute any meaningful Mento swap
(needs both sides seeded + deviation >$0.0059 gas to be profitable).
`TRADE_AMOUNT_USDM=0.2` is the configured per-trade size; tracks
`most-revenue-generated` will not credit swaps until deviation opens up
naturally or the operator manually seeds USDC + USDm and runs a one-off
swap from Rabby to demonstrate the path.

## Local dev servers (Sepolia / manual testing only)

| Port | Service | How to start |
|---|---|---|
| 3001 | signal-aggregator-agent | `cd signal-aggregator-agent && npm run dev` |
| 3002 | risk-manager-agent | `cd risk-manager-agent && npm run dev` |
| 3003 | dashboard | `cd dashboard && npm run dev` |
| (background) | yield-router-agent | `cd yield-router-agent && YIELD_CYCLE_MS=10000 MIN_PROFIT_MARGIN=0.0001 npm start` |

All 4 run on `npm install --legacy-peer-deps` from repo root. `.env` needs
`PRIVY_APP_ID` + `PRIVY_APP_SECRET` + `NETWORK=sepolia|mainnet`. **Next.js
does NOT read the monorepo root `.env`** — for local dev of the Next.js
sub-packages, pass env vars inline (`NETWORK=mainnet npm run dev -- -p 3001`)
rather than relying on the root `.env` being picked up.

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
- **Mento has NO pool involving native CELO at all on mainnet** — confirmed
  exhaustively by listing all 18 pools via `mento.pools.getPools()` (8 FPMM
  + 10 Virtual, all stablecoin-to-stablecoin). Any CELO→stablecoin swap
  needs a different DEX. Used Uniswap V3 on Celo mainnet instead: Factory
  `0xAfE208a311B21f13EF87E33A90049fC17A7acDEc`, QuoterV2
  `0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8`, SwapRouter02
  `0x5615CDAb10dc425a742d643d949a7F474C01abc4`. CELO/USDC exists at fee
  tiers 100/500/3000/10000 — the 3000 (0.3%) tier gave the best effective
  price in testing. Standard ERC20 approve + `exactInputSingle` flow (CELO
  behaves as a full ERC20 at `0x471EcE3750Da237f93B8E339c536989b8978a438`,
  no wrapping needed, unlike ETH/WETH on other chains).

### Upstash / activity log
- **Never hand-roll `.env` value extraction with grep/cut/sed for anything
  shipped elsewhere** (e.g. uploading to a Vercel/Railway env var via API).
  A `.env` line like `KEY="value" #comment` breaks naive
  `grep | cut -d= -f2- | sed 's/^"//;s/"$//'` pipelines in multiple subtle
  ways (quotes not stripped because a comment follows the closing quote,
  trailing `\r` on Windows, etc.) and produces a corrupted value that still
  "successfully" uploads (200 OK) but silently fails at request time
  (`Failed to parse URL` or `401`/`WRONGPASS` depending on which field got
  mangled). Always extract via `node --env-file=.env -e "..."` (Node's real
  dotenv-style parser) instead, and independently verify the extracted
  value authenticates against the target service before trusting an
  "upload succeeded" response.
- `shared/activity-log.ts` centralizes the activity feed on Upstash Redis
  (LPUSH/LTRIM/LRANGE via REST API against key `celoyield:activity`, capped
  at 200 entries) instead of the old per-instance local JSONL file, which
  never worked once the 3 agents moved to separate Vercel/Railway
  instances. Falls back to the local file when
  `UPSTASH_REDIS_REST_URL`/`TOKEN` aren't set (zero-setup local dev).
  `logActivity`/`readRecentActivity` are async — awaited in the two Next.js
  API routes (so the write lands before the serverless function freezes),
  fire-and-forget in `yield-router-agent` (long-lived process, errors
  already swallowed internally).

### Dashboard data bugs found 2026-07-13
- **Blockscout's `tokenbalance` API reports stale ERC-20 balances on Celo
  mainnet, not just Sepolia.** `dashboard/lib/state.ts` was reading USDC/USDm
  balances via `${BLOCKSCOUT_API}?module=account&action=tokenbalance&...`,
  which returned `0` for the router wallet even though a direct RPC
  `balanceOf()` call (viem `readContract` against `forno.celo.org`) returned
  `2076324` (2.076324 USDC) — confirmed real via the wallet's on-chain
  `tokentx` history showing the actual incoming transfer. Fixed by reading
  ERC-20 balances via direct RPC (`erc20Abi.balanceOf`) instead of
  Blockscout; native CELO balance via Blockscout's `action=balance` is
  accurate and was left as-is.
- **`AgentStatusCards`' calls/earned counters were a broken MVP placeholder,
  not wired to real data.** `signalCalls` counted `0xa9059cbb`/`0x095ea7b3`
  method signatures across the router wallet's last 8 transactions (mostly
  unrelated Uniswap approve/swap activity, not actually filtered by
  recipient), and `riskCalls` was hardcoded to `0` — always showed 0
  calls / $0 earned for both paid agents even while the router was paying
  them every cycle. Fixed by counting `signal-paid`/`risk-paid` events from
  the router's own activity log (`activityEvents`, same source
  `RouterStatsPanel` already used correctly) instead.
- **`totalEarned`/`totalPaidUsd` understated real spend by 8-17x (fixed
  2026-07-14).** `dashboard/lib/state.ts` computed these as
  `calls * feePerCall` (flat `$0.001`/`$0.002`), which is only correct for
  facilitator-mode USDC settlements (exact amounts). Live-mode self-settled
  native CELO transfers move a gas-derived amount (~0.014-0.028 CELO, i.e.
  ~$0.008-$0.017 at $0.6/CELO) that has nothing to do with the nominal fee,
  and once both payment modes were mixed in the same tx history (499 USDC +
  198 tagged-native txs found 2026-07-14) the flat multiplication silently
  hid most of the real value moved. Fixed by summing the actual amount per
  tx (`formatUnits(value, 6)` for USDC, `formatEther(value) * celoUsd` for
  native, using `shared/pricing.ts`'s now-exported `getCeloUsdPrice()`)
  instead of multiplying counts by a constant.

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
- **The official facilitator's API key env var is named `X402`** (not
  `FACILITATOR_API_KEY` — the code was briefly written against that name
  before settling on `X402` to match what was already set locally/on
  Vercel/Railway). Set in `.env` locally, and as `X402` on both Vercel
  projects (signal, risk) and Railway (router) — separate from `X402_MODE`
  (`mock`/`live`/`facilitator`), which is a different variable. See "Known
  gaps" below for why `facilitator` mode is still off despite the key being
  wired correctly (Celo's own relayer wallet is out of gas, not our bug).

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
- **Breaks across deployments.** `shared/.activity.jsonl` is a local file all
  3 agents wrote to when running on one machine. Now that they run on
  separate Vercel/Railway instances (no shared filesystem), the dashboard's
  live Activity Feed goes silent for anything happening in production — it
  only reflects processes writing to the same disk it reads from. The
  on-chain balance/tx panels are unaffected (they query Blockscout directly).
  Fixing the feed for the deployed version needs a centralized store
  (Postgres/Upstash), not yet done.

### Deployment (Vercel + Railway, 2026-07-13)
- **`shared/.agent-wallets.json` must be committed**, not gitignored. It only
  holds Privy `walletId` + public `address` per agent `externalId` (no
  private keys — Privy custody keeps those server-side). Without it in the
  deployed bundle, `wallet.ts` can't find the cached mapping and tries to
  `privy.wallets().create()` a NEW wallet with an `external_id` Privy already
  has — errors on Privy's side (`/api/v1/wallets` 500).
- **Next.js file tracing misses runtime `fs.readFileSync` reads.** Even with
  the file committed, Vercel's serverless bundle didn't include
  `shared/.agent-wallets.json` because it's read dynamically at runtime, not
  statically imported — Next.js's output file tracing only follows imports.
  Fix: `outputFileTracingIncludes` in each app's `next.config.js`, e.g.
  `{ "/api/apy": ["../shared/.agent-wallets.json"] }`.
- **Vercel monorepo root directory**: don't `vercel link` from inside a
  sub-package folder — it uploads only that folder (8 files), missing
  sibling `shared/`. Instead `vercel link` from the repo root (creates a
  Git-connected project), then `PATCH /v9/projects/{id}` with
  `rootDirectory: "signal-aggregator-agent"` via the API (no CLI subcommand
  for this). Also explicitly `PATCH` `framework: "nextjs"` — without it
  Vercel fails to find the Next.js `.next` output even after a clean build.
- **Vercel install command for npm workspaces**: default install runs only
  inside `rootDirectory`, missing hoisted root deps (`@privy-io/node`,
  `@celo/attribution-tags` live in root `node_modules`). Override
  `installCommand: "cd .. && npm install --legacy-peer-deps"` via the
  project API.
- **`opitradingacademys-projects.vercel.app`-suffixed deployment URLs have
  Vercel SSO/Deployment Protection on by default** (redirect to
  `vercel.com/sso-api`) — the x402 client can't follow that. Add a clean
  short alias instead (`POST /v10/projects/{id}/domains` with
  `{"name": "celoyield-signal.vercel.app"}`) and point `SIGNAL_AGENT_URL` /
  `RISK_AGENT_URL` at that, not the team-suffixed one.
- **Railway's default builder is Railpack, not Nixpacks**, and it always
  runs `npm ci` for the install phase regardless of a `buildCommand`
  override — `ServiceInstanceUpdateInput` has no `installCommand` field.
  `npm ci` fails hard on any lockfile drift (seen: `picomatch`/`yaml`
  version mismatches unrelated to anything we changed — looked like an
  npm-version-dependent resolution difference between local and Railway's
  builder). Setting `builder: "NIXPACKS"` + a custom `nixpacksPlan` didn't
  reliably take either. **What actually worked**: a plain root-level
  `Dockerfile.router` + `railway.json` with `"build": {"dockerfilePath":
  "Dockerfile.router"}`, and setting `dockerfilePath` on the service via the
  API (`serviceInstanceUpdate`). Full control, no builder auto-detection.
- **`nixpacksPlan` set via the API must be a JSON object, not a
  `JSON.stringify`'d string** — sending a string silently "succeeds" (the
  mutation returns `true`) but corrupts the service config
  (`Failed to parse your service config. Error: build.nixpacksPlan: Expected
  object, received string`), and the corrupted value could NOT be cleared by
  setting it to `null` via a follow-up mutation — had to delete the service
  (`serviceDelete`) and recreate it clean.
- **Railway "redeploy" reuses the previous deployment's exact commit/config
  snapshot** — it does NOT pick up a newer push. To deploy the latest commit
  on the linked branch, use the `serviceInstanceDeploy` mutation with
  `latestCommit: true`, not `deploymentRedeploy`.
- **Celo mainnet intrinsic gas floor is above 21000** for a plain native
  transfer post some L2-related overhead — Privy's broadcast rejects
  `gas: 21000` with `intrinsic gas too low: gas 21000, minimum needed
  21548`. Use `30000` for simple CELO sends.
- **Railway's GitHub connection can silently disconnect** without any
  visible error — "Redeploy" still succeeds and shows "Active", it just
  rebuilds whatever commit Railway last had cached (in our case, several
  commits behind `main`, for over 12 hours across ~10 redeploy attempts).
  Symptom: pushed code changes never take effect no matter how many times
  you redeploy. Diagnostic: check Settings → Details on the active
  deployment for its actual commit message/hash and compare against
  `git log` — if they don't match, the GitHub connection needs to be
  reconnected (Settings → Source), not just redeployed.
- **All 3 agents shared one Privy wallet** (`0x2254...3dF7E`) until
  2026-07-13 — `signal-aggregator-agent-v1` and `risk-manager-agent-v1`
  both resolved to the same walletId as `yield-router-agent-v1` in
  `shared/.agent-wallets.json`. Every "x402 payment" was a self-transfer
  (`from == to` on-chain), undermining the entire "3 agents pay each
  other" premise. Fixed by creating 2 dedicated wallets and remapping;
  router keeps the original wallet as sole payer. This also surfaced a
  payer-side nonce race: `fetchWithPaymentReal()` paid signal then risk
  back-to-back from the same wallet without waiting for the first tx to
  confirm, so the second `getTransactionCount()` call read a stale nonce
  and Privy's broadcaster rejected it with a bare `UNAUTHORIZED` (not a
  more diagnostic "nonce too low"). Fixed by awaiting
  `waitForTransactionReceipt()` before returning from
  `fetchWithPaymentReal()`.

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

## Celo Builders hackathon submission

- Hackathon: `agentic-payments-defai`, ends 2026-07-20 09:00 UTC.
- Project name: `CeloYield Agents`. Repo: `opitradingacademy/CeloYield-Agents`.
- Connected via `~/.claude/skills/celo-builders` — `attributionTag`:
  `celo_baf40ede1a50`. Tracks entered: `most-x402-payments` (best fit — raw
  count, cheap to rack up with small capital) and `most-revenue-generated`
  (volume-based, harder to compete on with a ~$30 budget).
- `erc8004Url` for submission: `https://8004scan.io/agents/celo/9671`
  (yield-router, the orchestrator).
- **Submission published** 2026-07-13 (`status: published`, still editable
  until deadline). `demoUrl` = the dashboard URL above. `socialLink` = X
  post at `x.com/hexarenagamer/status/2076657660254961932`.
- **Attribution tag confirmed**: `celo_baf40ede1a50` (matches on-chain
  volume already visible on the Dune leaderboard — do NOT rotate this,
  even if a different celobuilders.xyz login session mints a new-looking
  tag for what looks like the same submission; always cross-check the
  Dune leaderboard before trusting a tag value). Hardcoded in
  `shared/wallet.ts`.
- Still open: `videoUrl` (optional).

## Known gaps / next steps

- **RESOLVED 2026-07-14: official x402 facilitator relayer is now funded and
  settling for real.** The relayer wallet
  (`0x0d74D5Cefd2e7F24E623330ebE3d8D4cB45fFB48`) that was stuck at ~0.0177
  CELO (see prior blocker below, kept for history) now holds ~70 CELO and is
  actively confirming `transferWithAuthorization` settlements on-chain
  (verified directly via Blockscout, method `0xe3ee160e`, multiple
  confirmed txs seconds apart). `X402_MODE=facilitator` is live and working:
  counted 499 real USDC facilitator settlements to signal/risk wallets in
  the last 500 txs (`npx tsx shared/check-facilitator-settlements.ts`
  confirms these directly), mixed with 198 tagged native-CELO txs from
  whatever period ran in `live` mode before the switch. This should now be
  showing up in Dune's `x402_settlements` column for the "Most x402
  Payments" track — worth a spot-check next session.
  <details><summary>Prior blocker (resolved, kept for context)</summary>

  Blocked (infra, not us): official x402 facilitator's relayer wallet was
  out of gas. API key mystery from an earlier session was resolved —
  answer from the hackathon team: the key is self-service at x402.celo.org,
  connect a wallet (browser-extension only, MetaMask/Rabby — no
  WalletConnect option, so Privy's custodial router wallet can't connect
  directly; used the operator's personal Rabby wallet instead, which is fine
  because the key only authenticates the *project* against the facilitator —
  it is NOT cryptographically bound to whichever wallet actually pays, since
  each payment's EIP-3009 authorization is separately signed on-chain).
  `shared/x402-facilitator.ts` reads the key from `process.env.X402` (not
  `FACILITATOR_API_KEY` — renamed to match the env var name already used
  everywhere) and sends it as `X-API-Key` on both `/verify` and `/settle`.
  With the key wired, `/verify` returned `isValid:true` but `/settle` failed
  with `insufficient funds for gas * price + value` on the relayer's own
  wallet — reproduced identically 3x in a row, so it wasn't transient.
  </details>

- **Attribution tag verified clean (2026-07-14).** User saw a second tag
  `celo_d9e61ce2001a` alongside ours on the Dune leaderboard and asked to
  confirm nothing on our side is misconfigured. Verified three ways: (1)
  grepped the whole repo — only `celo_baf40ede1a50` exists, hardcoded once
  in `shared/wallet.ts:18`; (2) decoded the raw calldata of a real
  facilitator settlement tx — exactly 292 bytes, the standard
  `transferWithAuthorization` param length with zero extra bytes, so those
  txs carry no ERC-8021 suffix at all (ours or anyone else's), since the
  facilitator's relayer builds them, not our code; (3) reconnected via the
  `celo-builders` skill and called `GET /submissions/me` directly — exactly
  one submission on this account, `attributionTag: "celo_baf40ede1a50"`,
  matching the code. `celo_d9e61ce2001a` cannot originate from this repo,
  this account, or the facilitator settlement txs — most likely another
  team's tag getting cross-attributed on Dune's side, or a Dune indexing
  bug. Worth reporting to the Celo Builders team with this evidence if it
  persists.
- Activity Feed now centralized on Upstash Redis (see gotchas below) and
  confirmed working end-to-end in production.
- Dashboard deployed: https://celoyield-dashboard.vercel.app
- Add Moola + Ubeswap protocols to risk-scorer (Sepolia only has Mento;
  mainnet has 5+ protocols for richer demo).
- Add Telegram notification path (currently operator prompt is in console;
  moot in production anyway since `AUTO_APPROVE=true` there).
- Submission published (`https://celobuilders.xyz`, project "CeloYield
  Agents", tracks `most-x402-payments` + `most-revenue-generated`) — can
  still be edited until the hackathon deadline (2026-08-03 09:00 UTC).
- **Update submission before 03-ago**: post a fresh build-in-public summary
  pointing at the new on-chain payment volume (10+ txs visible on Blockscout
  from `0x2254…3dF7E` since 17:30 UTC) so the entry reflects more than
  the 13-jul Sepolia-era metrics.
- Router wallet USDC: swapped 20 CELO → 1.359559 USDC via Uniswap V3 (Mento
  has no CELO/USDC pool — see gotchas). Balance ~2.08 USDC, funds the
  facilitator mode once the API key issue above is resolved. Majority of
  the 232 CELO deposit (2026-07-13) stays as CELO for gas / router trading.

### Found 2026-07-22

- **`.env` duplicate key corruption** is silent — `X402_MODE=live` on line 39
  followed by `X402_MODE=x402_71968404ce...` on line 40 makes Node's
  `--env-file` parser silently take the last value, producing an invalid
  mode string `x402_71968404ce...` that no branch in `pay()` matches,
  so `fetchWithPayment()` (mock) is called instead. Production (Railway +
  Vercel) reads env vars from the dashboard and is unaffected; only the
  local `.env` is broken. Fix is `delete one of the duplicate lines` — but
  for safety, never name a variable `X402_MODE=x402_...` (easy to confuse
  with the `X402` facilitator-API-key env var). When updating env vars
  locally, always verify with
  `node --env-file=.env -e "console.log(process.env.X402_MODE)"` to
  catch this kind of paste-collision.
- **`fetchWithPaymentReal()` originally required `accept.price`** (the
  `celo-native` scheme) and crashed with `Cannot read properties of
  undefined (reading 'replace')` when the server was in `facilitator`
  mode (offers `scheme: "exact"`, `maxAmountRequired`, no `price`).
  Fixed 2026-07-22 to parse either `price` (live mode, USD) or
  `maxAmountRequired` (facilitator mode, USDC atomic units ÷ 1e6), and
  bail to the original 402 if neither is set. Same fix should be in
  any future client that consumes x402 402 bodies.
- **Railway deploys can stay QUEUED for hours** when the platform is
  under upstream GitHub webhook load. `serviceInstanceDeployV2` /
  `serviceInstanceRedeploy` returns `true` immediately even when the
  build never starts — the only signal is `statusUpdatedAt` flipping
  from `null` to a timestamp. Don't trust a successful redeploy API
  call as proof the new code is live; poll `service.deployments` every
  minute until `status: "SUCCESS"`.
- **Restart ≠ pick up new env var on Railway**: changing `X402_MODE`
  via `variableUpsert` doesn't make the running container reload its
  env. You need either a real `serviceInstanceRedeploy` (which queues
  a new build) or `deploymentRestart` on the current SUCCESS deployment
  — both write a fresh deployment row that also goes through the queue.
  No zero-downtime env swap exists in Railway's API.