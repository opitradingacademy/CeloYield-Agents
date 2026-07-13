type NetworkName = "sepolia" | "mainnet";

interface NetworkConfig {
  chainId: number;
  rpcUrl: string;
  identityRegistry: `0x${string}`;
  reputationRegistry: `0x${string}`;
  usdcAdapter: `0x${string}` | null;
  usdcToken: `0x${string}`;
  usdmToken: `0x${string}`;
  eurmToken: `0x${string}`;
}

// NOTE: token addresses differ between mainnet and Celo Sepolia — they are
// NOT the same contracts. Verified against celopedia's contracts.md
// "Testnet Tokens" table (Celo Sepolia) vs its mainnet token table.
//
// IMPORTANT correction found by querying the live Mento V3 FPMM pools on
// Sepolia directly: celopedia's documented Sepolia USDm address
// (0xEF4d...bC80) has no liquidity pool — it's a different, apparently
// legacy/inactive "cUSD"-symbol deployment. The address every active pool
// actually trades against (confirmed via mento.pools.getPools() +
// on-chain symbol() reads) is 0xdE9e...B00b, which also reads "USDm".
// Also: there is currently NO EURm pool on Sepolia at all (celopedia's
// EURm address exists on-chain with symbol "cEUR" but is not in any of
// the 18 live pools). BRLm and USDC both do have live pools, so the
// arbitrage pair uses USDm-USDC instead of USDm-EURm.
const NETWORKS: Record<NetworkName, NetworkConfig> = {
  sepolia: {
    chainId: 11142220,
    // As of 2026-07, the public Celo Sepolia RPCs are degraded:
    //   - forno.celo-sepolia.celo-testnet.org reports stale state (wallets
    //     that Blockscout shows as funded read as 0 CELO)
    //   - publicnode returns 404 on certain eth_getBalance calls
    //   - drpc.org returns wrong data
    //   - omniatech is down
    // Tenderly's public gateway is the only reliable one and doesn't need an
    // API key for reads/broadcasts. Override with CELO_SEPOLIA_RPC if needed.
    rpcUrl: process.env.CELO_SEPOLIA_RPC || "https://celo-sepolia.gateway.tenderly.co",
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    usdcAdapter: null, // TODO: confirm Sepolia adapter before demo
    usdcToken: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
    usdmToken: "0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b",
    eurmToken: "0x6B172e333e2978484261D7eCC3DE491E79764BbC", // no live pool on Sepolia, do not use for quotes
  },
  mainnet: {
    chainId: 42220,
    rpcUrl: process.env.CELO_MAINNET_RPC || "https://forno.celo.org",
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    usdcAdapter: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",
    usdcToken: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    usdmToken: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
    eurmToken: "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73",
  },
};

export function getNetwork(): NetworkConfig {
  const name = (process.env.NETWORK as NetworkName) || "sepolia";
  const config = NETWORKS[name];
  if (!config) {
    throw new Error(`Unknown NETWORK "${name}". Use "sepolia" or "mainnet".`);
  }
  return config;
}
