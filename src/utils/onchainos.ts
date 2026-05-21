/**
 * onchainOS CLI Wrapper — PRIMARY data source for X Layer Liquidation Sentinel.
 *
 * All Aave V3, wallet, and price data flows through onchainOS CLI commands.
 * No direct RPC contract calls.
 */

import { execSync } from "child_process";

const CLI_TIMEOUT_MS = 30000;

interface OnchainOSResult {
  success: boolean;
  data?: any;
  error?: string;
}

function runCommand(command: string): OnchainOSResult {
  try {
    const output = execSync(`onchainos ${command} --json`, {
      timeout: CLI_TIMEOUT_MS,
      encoding: "utf-8",
      env: {
        ...process.env,
        OKX_API_KEY: process.env.OKX_API_KEY || "",
        OKX_SECRET_KEY: process.env.OKX_SECRET_KEY || "",
        OKX_PASSPHRASE: process.env.OKX_PASSPHRASE || "",
      },
    });
    const parsed = JSON.parse(output);
    return { success: true, data: parsed };
  } catch (err: any) {
    try {
      const errorOutput = err.stdout || err.stderr || err.message;
      const parsed = JSON.parse(errorOutput);
      return { success: false, error: parsed.message || parsed.error || errorOutput };
    } catch {
      return { success: false, error: err.message || "onchainOS CLI command failed" };
    }
  }
}

// ── Aave V3 Data ──

export async function getAaveAccountHealth(address: string): Promise<any> {
  const result = runCommand(`defi positions --address ${address} --chains xlayer`);
  if (!result.success) {
    throw new Error(`Failed to fetch Aave positions: ${result.error}`);
  }
  return result.data;
}

export async function getAaveReserveDetail(investmentId: string): Promise<any> {
  const result = runCommand(`defi detail --investment-id ${investmentId}`);
  if (!result.success) {
    throw new Error(`Failed to fetch reserve detail: ${result.error}`);
  }
  return result.data;
}

// ── Price Data ──

export async function getTokenPrice(tokenAddress: string): Promise<any> {
  const result = runCommand(`market price --address ${tokenAddress.toLowerCase()} --chain xlayer`);
  if (!result.success) {
    throw new Error(`Failed to fetch price: ${result.error}`);
  }
  return result.data;
}

export async function getTokenPriceHistory(tokenAddress: string, period: string = "24h"): Promise<any> {
  const result = runCommand(`market kline --address ${tokenAddress.toLowerCase()} --chain xlayer --period ${period}`);
  if (!result.success) {
    throw new Error(`Failed to fetch price history: ${result.error}`);
  }
  return result.data;
}

// ── Wallet Data ──

export async function getWalletBalances(address: string): Promise<any> {
  const result = runCommand(`portfolio all-balances --address ${address} --chains xlayer`);
  if (!result.success) {
    throw new Error(`Failed to fetch balances: ${result.error}`);
  }
  return result.data;
}

// ── Token Search ──

export async function searchToken(query: string): Promise<any[]> {
  const result = runCommand(`token search --query "${query}" --chains xlayer`);
  if (!result.success) {
    throw new Error(`Failed to search token: ${result.error}`);
  }
  return result.data?.data || [];
}
