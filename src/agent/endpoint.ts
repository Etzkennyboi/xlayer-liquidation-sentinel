/**
 * Agent HTTP Endpoint — A2A-compatible agent server.
 *
 * Routes:
 *   GET  /health      — Health check
 *   GET  /agent.json  — Agent Card (A2A discovery)
 *   GET  /tools       — List all available tools
 *   POST /execute     — Execute a tool: { tool: string, params: object }
 */

import express from "express";
import { tools, getTool } from "./tools";

export function createServer() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      agent: "xlayer-liquidation-sentinel",
      version: "1.0.0",
      chain: "X Layer",
      chainId: 196,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/agent.json", (_req, res) => {
    res.json({
      name: "X Layer Liquidation Sentinel",
      description:
        "Monitors unified liquidation risk across Aave V3 lending and Hyperliquid perpetuals on X Layer. Simulates price shocks, detects cascading liquidation scenarios, and provides time-to-liquidation estimates. Uses onchainOS as the primary data source for all lending and wallet data.",
      version: "1.0.0",
      capabilities: [
        "liquidation_risk_check",
        "price_shock_simulation",
        "time_to_liquidation",
        "cascade_detection",
      ],
      protocols: ["Aave V3", "Hyperliquid"],
      chain: "X Layer",
      chainId: 196,
      interfaces: {
        tools: "/tools",
        execute: "/execute",
        health: "/health",
      },
      dataSource: "onchainOS",
    });
  });

  app.get("/tools", (_req, res) => {
    const toolList = tools.map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category,
      parameters: t.parameters,
    }));
    res.json({ tools: toolList, count: toolList.length });
  });

  app.post("/execute", async (req, res) => {
    const { tool: toolName, params } = req.body;

    if (!toolName) {
      return res.status(400).json({ error: "Missing 'tool' field" });
    }

    const tool = getTool(toolName);
    if (!tool) {
      return res.status(404).json({
        error: `Unknown tool: ${toolName}`,
        available: tools.map((t) => t.name),
      });
    }

    try {
      const startTime = Date.now();
      const result = await tool.handler(params || {});
      const durationMs = Date.now() - startTime;

      res.json({
        tool: toolName,
        result,
        meta: {
          durationMs,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      res.status(500).json({
        error: err.message || "Tool execution failed",
        tool: toolName,
      });
    }
  });

  return app;
}
