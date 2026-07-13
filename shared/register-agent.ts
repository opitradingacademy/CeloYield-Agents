import { createPublicClient, http, parseGwei, getAddress } from "viem";
import { celo, celoSepolia } from "viem/chains";
import { getNetwork } from "./network";
import { getAgentAccount } from "./wallet";

// Minimal ABI slice — only what registration needs.
const identityRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

interface AgentMetadata {
  name: string;
  description: string;
  image: string; // must be ipfs:// or data:
  services: { name: string; endpoint: string; version?: string }[];
  supportedTrust: string[];
}

// Builds spec-compliant ERC-8004 metadata. See celopedia ai-agents.md
// "Metadata Compliance" checklist — this function exists specifically
// to avoid the four common 8004scan validator warnings:
//   - type must be the versioned spec URI, not "Agent"
//   - services (not endpoints), each with name + endpoint (not url)
//   - agentURI must be content-addressed (ipfs:// or data:), not https://
function buildMetadata(meta: AgentMetadata) {
  if (!meta.image.startsWith("ipfs://") && !meta.image.startsWith("data:")) {
    throw new Error("image must be ipfs:// or data: — https:// is not content-addressed");
  }
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: meta.name,
    description: meta.description,
    image: meta.image,
    services: meta.services,
    supportedTrust: meta.supportedTrust,
  };
}

// Pins metadata to IPFS via Pinata and returns an ipfs:// URI.
// Falls back to data: URIs if Pinata is unavailable or the JWT lacks scopes.
//
// Chose Pinata over web3.storage/Storacha: Storacha's w3up-client needs an
// email-verified "space" set up interactively before it can upload anything.
// data: URIs are content-addressed per the ERC-8004 spec but bloat the
// on-chain agentURI. Fine for testnet, may hit gas limits on mainnet.
async function pinMetadata(metadata: unknown): Promise<string> {
  const jwt = process.env.PINATA_JWT;
  if (jwt) {
    try {
      const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ pinataContent: metadata }),
      });
      if (response.ok) {
        const { IpfsHash } = (await response.json()) as { IpfsHash: string };
        return `ipfs://${IpfsHash}`;
      }
      console.warn(`[pin] Pinata returned ${response.status}, falling back to data: URI`);
    } catch (e: any) {
      console.warn(`[pin] Pinata error: ${e?.message ?? e}, falling back to data: URI`);
    }
  }
  // Fallback: inline base64 data URI.
  const json = JSON.stringify(metadata);
  return `data:application/json;base64,${Buffer.from(json).toString("base64")}`;
}

// Read ABI from a JSON-encoded calldata string and dispatch via the agent's
// Privy wallet using the legacy (type-0) tx format. This bypasses Privy's
// forno RPC balance check, which is stale on Celo Sepolia and otherwise
// rejects these txs with "insufficient funds" even when the wallet is funded.
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export async function registerAgent(
  meta: AgentMetadata,
  wallet: Awaited<ReturnType<typeof getAgentAccount>>,
  opts: { nonceOffset?: number } = {},
): Promise<{ txHash: `0x${string}`; agentURI: string }> {
  const network = getNetwork();
  const metadata = buildMetadata(meta);
  const agentURI = await pinMetadata(metadata);
  if (!agentURI.startsWith("ipfs://") && !agentURI.startsWith("data:")) {
    throw new Error("Pinning did not return a content-addressed URI");
  }

  const publicClient = createPublicClient({
    chain: network.chainId === celo.id ? celo : celoSepolia,
    transport: http(network.rpcUrl),
  });

  const calldata = encodeRegisterCall(agentURI);
  const nonce = await publicClient.getTransactionCount({
    address: wallet.account!.address,
  });

  const txHash = await wallet.sendTransactionLegacy({
    to: network.identityRegistry as `0x${string}`,
    data: calldata,
    value: 0n,
    gas: 2_000_000n,
    gasPrice: parseGwei("5"),
    nonce: BigInt(nonce) + BigInt(opts.nonceOffset ?? 0),
  });

  console.log(`Registered "${meta.name}", tx: ${txHash}`);
  console.log(`  agentURI: ${agentURI.slice(0, 80)}${agentURI.length > 80 ? "..." : ""}`);
  return { txHash, agentURI };
}

// Encodes `register(string agentURI)` for the ERC-8004 Identity Registry.
function encodeRegisterCall(agentURI: string): `0x${string}` {
  // Function selector for register(string) is keccak256("register(string)")[0..4].
  // viem's encodeFunctionData does this for us:
  //   register(string) -> 0x4420e486
  const { encodeFunctionData } = require("viem") as typeof import("viem");
  return encodeFunctionData({
    abi: identityRegistryAbi,
    functionName: "register",
    args: [agentURI],
  });
}