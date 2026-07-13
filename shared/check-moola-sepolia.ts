// Check if Moola Market (mainnet) is deployed on Celo Sepolia by probing bytecode.
import { createPublicClient, http, getAddress } from "viem";
import { celoSepolia } from "viem/chains";

const client = createPublicClient({
  chain: celoSepolia,
  transport: http("https://forno.celo-sepolia.celo-testnet.org/"),
});

async function main() {
  const probes = [
    { name: "mcUSD (Moola mainnet)", addr: "0x918146359264C492BD6934071c6Bd31C854EDBc3" },
    { name: "mCELO (Moola mainnet)", addr: "0x7D00cd74FF385c955EA3d79e47BF06bD7386387D" },
  ];
  for (const { name, addr } of probes) {
    const code = await client.getBytecode({ address: getAddress(addr) });
    console.log(
      `${name}: ${code && code !== "0x" ? "DEPLOYED (code length " + code.length + ")" : "NOT DEPLOYED on Sepolia"}`,
    );
  }
}
main();