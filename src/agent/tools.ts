/**
 * Agent Tool Definitions — The AI-facing interface.
 *
 * Each tool has a name, description, JSON Schema parameters, and a handler.
 * Compatible with A2A protocol and OpenAI function calling.
 */

import * as sentinel from "../services/sentinel";

export interface ToolDef {
  name: string;
  description: string;
  category: string;
  parameters: Record<string, any>;
  handler: (params: any) => Promise<any>;
}

export const tools: ToolDef[] = [
  {
    name: "check_liquidation_risk",
    description:
      "Unified cross-protocol liquidation risk assessment. Combines Aave V3 health factor, per-asset positions, and Hyperliquid perp exposure into a single risk score. Detects cascade scenarios where one protocol liquidation triggers another. Uses onchainOS as the primary data source for Aave and wallet data.",
    category: "risk",
    parameters: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Wallet address to analyze (0x...)",
        },
      },
      required: ["address"],
    },
    handler: async (params: any) => {
      const report = await sentinel.checkLiquidationRisk(params.address);
      return {
        ...report,
        analyzedAt: new Date().toISOString(),
        dataSource: "onchainOS (Aave + Wallet) + Hyperliquid API (Perps)",
      };
    },
  },

  {
    name: "simulate_price_shock",
    description:
      "Simulates the impact of price shocks on a wallet's cross-protocol positions. Models cascading liquidations: if Hyperliquid perp is liquidated, how does that affect Aave collateral? Returns before/after state, liquidation sequence, and specific recommendations. Uses onchainOS for Aave data, Hyperliquid API for perp data.",
    category: "risk",
    parameters: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Wallet address to analyze",
        },
        shocks: {
          type: "object",
          description: "Price shocks per asset (e.g. { 'ETH': -0.20, 'BTC': -0.15 })",
          additionalProperties: { type: "number" },
        },
      },
      required: ["address", "shocks"],
    },
    handler: async (params: any) => {
      const simulation = await sentinel.simulatePriceShock(params.address, params.shocks);
      return {
        ...simulation,
        simulatedAt: new Date().toISOString(),
        dataSource: "onchainOS (Aave) + Hyperliquid API (Perps)",
      };
    },
  },

  {
    name: "get_time_to_liquidation",
    description:
      "Estimates time until liquidation based on current price, liquidation thresholds, and recent price velocity. Calculates for both Aave and Hyperliquid positions. Includes velocity scenarios (current, 2x, 0.5x) to show range of outcomes. Uses onchainOS for price data.",
    category: "risk",
    parameters: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "Wallet address",
        },
        asset: {
          type: "string",
          description: "Asset to track (ETH, BTC, SOL, etc.)",
        },
      },
      required: ["address", "asset"],
    },
    handler: async (params: any) => {
      const estimate = await sentinel.getTimeToLiquidation(params.address, params.asset);
      return {
        ...estimate,
        estimatedAt: new Date().toISOString(),
        dataSource: "onchainOS (Prices) + Hyperliquid API (Positions)",
      };
    },
  },
];

export function getTool(name: string): ToolDef | undefined {
  return tools.find((t) => t.name === name);
}

export function getToolsByCategory(category: string): ToolDef[] {
  return tools.filter((t) => t.category === category);
}
