/**
 * Viem Client — Fallback for direct RPC calls.
 * PRIMARY data source is onchainOS CLI.
 */

import { createPublicClient, http, type PublicClient, type Chain } from "viem";

const xLayerChain = {
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.XLAYER_RPC_URL || "https://xlayer.drpc.org"] },
    public: { http: [process.env.XLAYER_RPC_URL || "https://xlayer.drpc.org"] },
  },
} as Chain;

export function getPublicClient(): PublicClient {
  return createPublicClient({
    chain: xLayerChain,
    transport: http(),
  });
}
