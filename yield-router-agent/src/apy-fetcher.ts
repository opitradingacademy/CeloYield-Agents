// APY fetcher: reads live swap rates from Mento V3 FPMM pools on the current
// network. In Sepolia there's basically no swap volume so APY ≈ 0%; in mainnet
// this is where the real yields live.
//
// We track rates per pool over time. If a rate moves >threshold from "expected
// peg" we surface it as a candidate move.
import { Mento, ChainId } from "@mento-protocol/mento-sdk";
import { formatUnits, type Address } from "viem";
import { getNetwork } from "../../shared/network";

type PairKey = `${string}-${string}`;

export interface PairQuote {
  pair: PairKey;
  tokenIn: Address;
  tokenOut: Address;
  rate: number; // 1 tokenIn = rate tokenOut
  timestamp: number;
}

const HISTORY_WINDOW_MS = 15 * 60 * 1000; // 15 min
const history = new Map<PairKey, PairQuote[]>();

export class ApyFetcher {
  private mento: Mento | null = null;
  private network = getNetwork();

  async ensureMento(): Promise<Mento> {
    if (!this.mento) {
      const chainId =
        this.network.chainId === 42220 ? ChainId.CELO : ChainId.CELO_SEPOLIA;
      this.mento = await Mento.create(chainId);
    }
    return this.mento;
  }

  // Fetch live 1-unit-in → tokenOut rate for a pair, and append to in-memory
  // history. Returns the rate + a coarse APY proxy (mean abs deviation over the
  // window — small values = stable peg).
  async fetchQuote(tokenIn: Address, tokenOut: Address, decimalsIn: number, decimalsOut: number): Promise<PairQuote> {
    const mento = await this.ensureMento();
    const oneUnit = BigInt(10) ** BigInt(decimalsIn);
    const amountOut = await mento.quotes.getAmountOut(tokenIn, tokenOut, oneUnit);
    const rate = Number(formatUnits(amountOut, decimalsOut));
    const q: PairQuote = {
      pair: `${tokenIn}-${tokenOut}` as PairKey,
      tokenIn,
      tokenOut,
      rate,
      timestamp: Date.now(),
    };
    const list = history.get(q.pair) ?? [];
    list.push(q);
    const cutoff = Date.now() - HISTORY_WINDOW_MS;
    const pruned = list.filter((x) => x.timestamp >= cutoff);
    history.set(q.pair, pruned);
    return q;
  }

  // Returns the rolling mean absolute deviation of the rate for a pair, as a
  // fraction (e.g. 0.001 = 0.1% volatility over the window). Used to decide if
  // a peg is "stable enough" to act on.
  rollingVolatility(pair: PairKey): number {
    const samples = history.get(pair);
    if (!samples || samples.length < 2) return 0;
    const rates = samples.map((s) => s.rate);
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const variance = rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length;
    return Math.sqrt(variance) / mean;
  }

  lastQuote(pair: PairKey): PairQuote | undefined {
    const samples = history.get(pair);
    return samples && samples.length > 0 ? samples[samples.length - 1] : undefined;
  }
}