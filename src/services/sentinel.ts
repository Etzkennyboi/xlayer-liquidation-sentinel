/**
 * Cross-Protocol Liquidation Sentinel
 *
 * Core differentiator: monitors unified liquidation risk across Aave V3 + Hyperliquid.
 * Detects cascading liquidations where one protocol's liquidation triggers another.
 *
 * No existing plugin covers cross-protocol cascade analysis.
 */

import * as onchainOS from "../utils/onchainos";

// ── Types ──

interface AavePosition {
  asset: string;
  supplied: number;
  suppliedUsd: number;
  borrowed: number;
  borrowedUsd: number;
  supplyApy: number;
  borrowApy: number;
  usedAsCollateral: boolean;
  liquidationThreshold: number;
  ltv: number;
}

interface HyperliquidPosition {
  coin: string;
  size: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  marginUsed: number;
  unrealizedPnl: number;
  liquidationPrice: number;
  isLong: boolean;
}

interface LiquidationReport {
  overallRisk: "SAFE" | "MODERATE" | "HIGH" | "CRITICAL" | "LIQUIDATABLE";
  aave: {
    healthFactor: number;
    totalCollateralUsd: number;
    totalDebtUsd: number;
    riskLevel: string;
    largestCollateral: string;
    largestDebt: string;
    positions: AavePosition[];
  } | null;
  hyperliquid: {
    positionCount: number;
    totalNotional: number;
    maxLeverage: number;
    marginUsed: number;
    unrealizedPnl: number;
    positions: HyperliquidPosition[];
  } | null;
  cascadeRisk: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  recommendations: string[];
}

// ── Hyperliquid API ──

interface HLPosition {
  coin: string;
  szi: string;           // Size (signed, negative = short)
  entryPx: string;         // Entry price
  markPx: string;         // Mark price
  leverage: { value: string; type: string };
  marginUsed: string;
  unrealizedPnl: string;
  liquidationPx: string | null;
}

async function fetchHyperliquidPositions(address: string): Promise<HyperliquidPosition[]> {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "clearinghouseState", user: address }),
  });

  if (!res.ok) throw new Error(`Hyperliquid API error: ${res.status}`);

  const data: any = await res.json();
  const positions: HLPosition[] = data.assetPositions?.map((ap: any) => ap.position) || [];

  return positions.map((p) => {
    const size = parseFloat(p.szi);
    const entryPrice = parseFloat(p.entryPx);
    const markPrice = parseFloat(p.markPx);
    const leverage = parseFloat(p.leverage?.value || "1");
    const marginUsed = parseFloat(p.marginUsed);
    const unrealizedPnl = parseFloat(p.unrealizedPnl);
    const liqPrice = p.liquidationPx ? parseFloat(p.liquidationPx) : 0;

    return {
      coin: p.coin,
      size: Math.abs(size),
      entryPrice,
      markPrice,
      leverage,
      marginUsed,
      unrealizedPnl,
      liquidationPrice: liqPrice,
      isLong: size > 0,
    };
  });
}

async function fetchHyperliquidMarginSummary(address: string): Promise<any> {
  const res = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "clearinghouseState", user: address }),
  });

  if (!res.ok) throw new Error(`Hyperliquid API error: ${res.status}`);
  return res.json();
}

// ── Aave Position Parser ──

function parseAavePositions(raw: any): AavePosition[] {
  if (!raw?.data) return [];

  return raw.data.map((item: any) => {
    const underlying = item.underlyingToken || {};
    const decimals = underlying.decimals || 18;
    return {
      asset: (underlying.symbol || "UNKNOWN").toUpperCase(),
      supplied: parseFloat(item.supplyAmount || 0) / (10 ** decimals),
      suppliedUsd: parseFloat(item.supplyAmountUsd || 0),
      borrowed: parseFloat(item.borrowAmount || 0) / (10 ** decimals),
      borrowedUsd: parseFloat(item.borrowAmountUsd || 0),
      supplyApy: parseFloat(item.supplyApy || 0),
      borrowApy: parseFloat(item.borrowApy || 0),
      usedAsCollateral: item.collateral || false,
      liquidationThreshold: parseFloat(item.liquidationThreshold || 0.8),
      ltv: parseFloat(item.ltv || 0.75),
    };
  }).filter((p: AavePosition) => p.supplied > 0 || p.borrowed > 0);
}

function calculateHealthFactor(positions: AavePosition[]): number {
  let totalCollateral = 0;
  let totalCollateralAdjusted = 0;
  let totalDebt = 0;

  for (const p of positions) {
    if (p.usedAsCollateral) {
      totalCollateral += p.suppliedUsd;
      totalCollateralAdjusted += p.suppliedUsd * p.liquidationThreshold;
    }
    totalDebt += p.borrowedUsd;
  }

  if (totalDebt === 0) return Infinity;
  return totalCollateralAdjusted / totalDebt;
}

// ── Risk Classification ──

function classifyAaveRisk(healthFactor: number): string {
  if (healthFactor === Infinity) return "SAFE — No debt";
  if (healthFactor > 2.0) return "SAFE";
  if (healthFactor > 1.5) return "MODERATE";
  if (healthFactor > 1.2) return "HIGH";
  if (healthFactor > 1.0) return "CRITICAL";
  return "LIQUIDATABLE";
}

function classifyOverallRisk(
  aaveHF: number,
  maxLeverage: number,
  cascadeRisk: string
): LiquidationReport["overallRisk"] {
  if (aaveHF <= 1.0 || cascadeRisk === "CRITICAL") return "LIQUIDATABLE";
  if (aaveHF < 1.2 || maxLeverage > 15 || cascadeRisk === "HIGH") return "CRITICAL";
  if (aaveHF < 1.5 || maxLeverage > 10 || cascadeRisk === "MEDIUM") return "HIGH";
  if (aaveHF < 2.0 || maxLeverage > 5 || cascadeRisk === "LOW") return "MODERATE";
  return "SAFE";
}

function assessCascadeRisk(
  aavePositions: AavePosition[],
  hlPositions: HyperliquidPosition[]
): string {
  if (!aavePositions.length || !hlPositions.length) return "NONE";

  // Check if same asset is collateral in Aave and traded in Hyperliquid
  const aaveCollateralAssets = new Set(
    aavePositions.filter((p) => p.usedAsCollateral).map((p) => p.asset)
  );

  for (const hlPos of hlPositions) {
    const hlAsset = hlPos.coin;
    if (aaveCollateralAssets.has(hlAsset) || aaveCollateralAssets.has(`W${hlAsset}`)) {
      // Same asset exposure — cascade risk exists
      if (hlPos.leverage > 10) return "CRITICAL";
      if (hlPos.leverage > 5) return "HIGH";
      return "MEDIUM";
    }
  }

  // Different assets — lower cascade risk but still exists via correlation
  const maxHLLev = Math.max(...hlPositions.map((p) => p.leverage), 0);
  if (maxHLLev > 10) return "MEDIUM";
  if (maxHLLev > 5) return "LOW";
  return "NONE";
}

// ── Main Tool: Check Liquidation Risk ──

export async function checkLiquidationRisk(address: string): Promise<LiquidationReport> {
  // Fetch both protocols in parallel
  const [aaveRaw, hlPositions] = await Promise.all([
    onchainOS.getAaveAccountHealth(address).catch(() => null),
    fetchHyperliquidPositions(address).catch(() => []),
  ]);

  // Parse Aave data
  const aavePositions = aaveRaw ? parseAavePositions(aaveRaw) : [];
  const healthFactor = calculateHealthFactor(aavePositions);
  const totalCollateral = aavePositions.reduce((s, p) => s + (p.usedAsCollateral ? p.suppliedUsd : 0), 0);
  const totalDebt = aavePositions.reduce((s, p) => s + p.borrowedUsd, 0);

  // Find largest collateral and debt
  const largestCollateral = aavePositions
    .filter((p) => p.usedAsCollateral)
    .sort((a, b) => b.suppliedUsd - a.suppliedUsd)[0];
  const largestDebt = aavePositions.sort((a, b) => b.borrowedUsd - a.borrowedUsd)[0];

  // Parse Hyperliquid data
  const totalNotional = hlPositions.reduce((s, p) => s + p.size * p.markPrice, 0);
  const maxLeverage = hlPositions.length > 0 ? Math.max(...hlPositions.map((p) => p.leverage)) : 0;
  const marginUsed = hlPositions.reduce((s, p) => s + p.marginUsed, 0);
  const unrealizedPnl = hlPositions.reduce((s, p) => s + p.unrealizedPnl, 0);

  // Cascade risk assessment
  const cascadeRisk = assessCascadeRisk(aavePositions, hlPositions);

  // Overall risk
  const overallRisk = classifyOverallRisk(healthFactor, maxLeverage, cascadeRisk);

  // Generate recommendations
  const recommendations: string[] = [];

  if (overallRisk === "CRITICAL" || overallRisk === "LIQUIDATABLE") {
    recommendations.push("URGENT: Take immediate action to prevent liquidation");
  }

  if (healthFactor < 1.5) {
    const bufferNeeded = ((1.5 / healthFactor - 1) * 100).toFixed(1);
    recommendations.push(`Add ${bufferNeeded}% more collateral to Aave or repay ${(totalDebt * 0.2).toFixed(0)} USD debt`);
  }

  if (maxLeverage > 10) {
    recommendations.push(`Reduce Hyperliquid leverage from ${maxLeverage.toFixed(1)}x to max 5x`);
  } else if (maxLeverage > 5) {
    recommendations.push(`Consider reducing Hyperliquid leverage from ${maxLeverage.toFixed(1)}x to 3-5x`);
  }

  if (cascadeRisk === "CRITICAL" || cascadeRisk === "HIGH") {
    recommendations.push("CRITICAL: Same asset exposure across Aave + Hyperliquid — close or hedge perp position immediately");
  }

  if (unrealizedPnl < -1000) {
    recommendations.push(`Hyperliquid unrealized loss: ${Math.abs(unrealizedPnl).toFixed(0)} USD — consider stop-loss`);
  }

  if (recommendations.length === 0) {
    recommendations.push("Portfolio is well-managed. No immediate liquidation risk.");
  }

  return {
    overallRisk,
    aave: aavePositions.length > 0 ? {
      healthFactor,
      totalCollateralUsd: totalCollateral,
      totalDebtUsd: totalDebt,
      riskLevel: classifyAaveRisk(healthFactor),
      largestCollateral: largestCollateral?.asset || "None",
      largestDebt: largestDebt?.asset || "None",
      positions: aavePositions,
    } : null,
    hyperliquid: hlPositions.length > 0 ? {
      positionCount: hlPositions.length,
      totalNotional,
      maxLeverage,
      marginUsed,
      unrealizedPnl,
      positions: hlPositions,
    } : null,
    cascadeRisk: cascadeRisk as LiquidationReport["cascadeRisk"],
    recommendations,
  };
}

// ── Main Tool: Simulate Price Shock ──

export interface ShockSimulation {
  before: {
    aaveHealthFactor: number;
    hyperliquidMargin: number;
    portfolioValue: number;
  };
  after: {
    aaveHealthFactor: number;
    aaveRisk: string;
    hyperliquidLiquidated: boolean;
    portfolioValue: number;
    totalLoss: number;
  };
  sequence: string[];
  recommendation: string;
}

export async function simulatePriceShock(
  address: string,
  shocks: Record<string, number>
): Promise<ShockSimulation> {
  // Get current state
  const [aaveRaw, hlPositions] = await Promise.all([
    onchainOS.getAaveAccountHealth(address).catch(() => null),
    fetchHyperliquidPositions(address).catch(() => []),
  ]);

  const aavePositions = aaveRaw ? parseAavePositions(aaveRaw) : [];
  const currentHF = calculateHealthFactor(aavePositions);
  const currentCollateral = aavePositions.reduce((s, p) => s + (p.usedAsCollateral ? p.suppliedUsd : 0), 0);
  const currentDebt = aavePositions.reduce((s, p) => s + p.borrowedUsd, 0);
  const currentMargin = hlPositions.reduce((s, p) => s + p.marginUsed, 0);
  const currentPortfolio = currentCollateral + currentMargin;

  // Simulate shock
  let newCollateral = currentCollateral;
  let newMargin = currentMargin;
  let hlLiquidated = false;
  const sequence: string[] = [];

  for (const [asset, shock] of Object.entries(shocks)) {
    const assetUpper = asset.toUpperCase();

    // Aave collateral shock
    for (const pos of aavePositions) {
      if (pos.usedAsCollateral && (pos.asset === assetUpper || pos.asset === `W${assetUpper}`)) {
        const loss = pos.suppliedUsd * shock;
        newCollateral += loss;
        sequence.push(`${asset} drops ${(shock * 100).toFixed(1)}% — Aave ${asset} collateral loses ${Math.abs(loss).toFixed(0)} USD`);
      }
    }

    // Hyperliquid position shock
    for (const pos of hlPositions) {
      if (pos.coin === assetUpper) {
        const pnl = pos.size * pos.markPrice * shock * (pos.isLong ? 1 : -1);
        newMargin += pnl;
        sequence.push(`${asset} drops ${(shock * 100).toFixed(1)}% — Hyperliquid ${pos.isLong ? "long" : "short"} ${pos.coin} PnL: ${pnl.toFixed(0)} USD`);

        // Check liquidation
        if (newMargin <= 0 && !hlLiquidated) {
          hlLiquidated = true;
          sequence.push(`Hyperliquid margin exhausted — POSITION LIQUIDATED (${pos.coin})`);
          // Liquidation means total loss of margin for that position
          newMargin = Math.max(0, newMargin);
        }
      }
    }
  }

  // Recalculate Aave health factor
  const newHF = currentDebt > 0 ? (newCollateral * 0.85) / currentDebt : Infinity;
  const aaveRisk = classifyAaveRisk(newHF);

  const newPortfolio = newCollateral + newMargin;
  const totalLoss = currentPortfolio - newPortfolio;

  // Determine recommendation
  let recommendation = "";
  if (hlLiquidated && newHF < 1.5) {
    recommendation = "CATASTROPHIC: Hyperliquid liquidation cascaded into Aave risk. Immediate deleveraging required.";
  } else if (hlLiquidated) {
    recommendation = "CRITICAL: Hyperliquid position liquidated. Monitor Aave closely — cascade risk remains.";
  } else if (newHF < 1.2) {
    recommendation = "CRITICAL: Aave health factor near liquidation. Add collateral or repay debt immediately.";
  } else if (newHF < 1.5) {
    recommendation = "HIGH: Aave position at risk. Consider adding collateral or reducing debt.";
  } else if (totalLoss > currentPortfolio * 0.2) {
    recommendation = "WARNING: Significant portfolio loss. Review position sizing.";
  } else {
    recommendation = "Portfolio survives this shock. Maintain current risk management.";
  }

  return {
    before: {
      aaveHealthFactor: currentHF,
      hyperliquidMargin: currentMargin,
      portfolioValue: currentPortfolio,
    },
    after: {
      aaveHealthFactor: newHF,
      aaveRisk,
      hyperliquidLiquidated: hlLiquidated,
      portfolioValue: newPortfolio,
      totalLoss,
    },
    sequence,
    recommendation,
  };
}

// ── Main Tool: Time to Liquidation ──

export interface TimeEstimate {
  asset: string;
  currentPrice: number;
  liquidationPrice: {
    aave: number | null;
    hyperliquid: number | null;
  };
  priceDistance: {
    aave: string | null;
    hyperliquid: string | null;
  };
  timeEstimate: {
    atCurrentVelocity: string;
    at2xVelocity: string;
    at0_5xVelocity: string;
  };
  velocity24h: string;
  alert: string;
}

export async function getTimeToLiquidation(address: string, asset: string): Promise<TimeEstimate> {
  const assetUpper = asset.toUpperCase();

  // Fetch positions
  const [aaveRaw, hlPositions, priceData] = await Promise.all([
    onchainOS.getAaveAccountHealth(address).catch(() => null),
    fetchHyperliquidPositions(address).catch(() => []),
    onchainOS.getTokenPriceHistory(
      resolveTokenAddress(asset) || "",
      "24h"
    ).catch(() => null),
  ]);

  const aavePositions = aaveRaw ? parseAavePositions(aaveRaw) : [];
  const hlPos = hlPositions.find((p) => p.coin === assetUpper);

  // Current price
  const currentPrice = priceData?.data?.[0]?.close || hlPos?.markPrice || 0;

  // Aave liquidation price
  let aaveLiqPrice: number | null = null;
  const collateral = aavePositions.find(
    (p) => p.usedAsCollateral && (p.asset === assetUpper || p.asset === `W${assetUpper}`)
  );
  if (collateral && collateral.supplied > 0) {
    const totalDebt = aavePositions.reduce((s, p) => s + p.borrowedUsd, 0);
    const otherCollateral = aavePositions
      .filter((p) => p.usedAsCollateral && p.asset !== collateral.asset)
      .reduce((s, p) => s + p.suppliedUsd * p.liquidationThreshold, 0);

    // HF = 1.0 when: (otherCollateral + thisCollateral * threshold * priceRatio) / debt = 1
    // Solve for priceRatio: priceRatio = (debt - otherCollateral) / (thisCollateral * threshold)
    const needed = totalDebt - otherCollateral;
    if (needed > 0) {
      aaveLiqPrice = currentPrice * (needed / (collateral.suppliedUsd * collateral.liquidationThreshold));
    }
  }

  // Hyperliquid liquidation price
  const hlLiqPrice = hlPos?.liquidationPrice || null;

  // Calculate price distances
  const aaveDistance = aaveLiqPrice && currentPrice > 0
    ? `${((aaveLiqPrice / currentPrice - 1) * 100).toFixed(1)}%`
    : null;
  const hlDistance = hlLiqPrice && currentPrice > 0
    ? `${((hlLiqPrice / currentPrice - 1) * 100).toFixed(1)}%`
    : null;

  // Calculate price velocity from 24h data
  let velocity = 0;
  if (priceData?.data && priceData.data.length >= 2) {
    const first = priceData.data[0].open;
    const last = priceData.data[priceData.data.length - 1].close;
    const hours = priceData.data.length;
    velocity = hours > 0 ? ((last - first) / first) / hours : 0;
  }

  // Time estimates
  function formatTime(hours: number): string {
    if (hours < 0) return "Already liquidated";
    if (hours < 1) return `${(hours * 60).toFixed(0)} minutes`;
    if (hours < 24) return `${hours.toFixed(1)} hours`;
    return `${(hours / 24).toFixed(1)} days`;
  }

  const closestLiqPrice = Math.max(
    aaveLiqPrice || 0,
    hlLiqPrice || 0
  );

  const distance = closestLiqPrice > 0 && currentPrice > 0
    ? Math.abs(closestLiqPrice - currentPrice) / currentPrice
    : 0;

  const hoursToLiq = velocity !== 0 ? distance / Math.abs(velocity) : Infinity;

  const alert = hlLiqPrice && aaveLiqPrice
    ? `Hyperliquid liquidation closer (${hlDistance}) than Aave (${aaveDistance})`
    : hlLiqPrice
    ? `Hyperliquid liquidation at ${hlDistance} price drop`
    : aaveLiqPrice
    ? `Aave liquidation at ${aaveDistance} price drop`
    : "No liquidation threshold found — check positions";

  return {
    asset: assetUpper,
    currentPrice,
    liquidationPrice: {
      aave: aaveLiqPrice,
      hyperliquid: hlLiqPrice,
    },
    priceDistance: {
      aave: aaveDistance,
      hyperliquid: hlDistance,
    },
    timeEstimate: {
      atCurrentVelocity: formatTime(hoursToLiq),
      at2xVelocity: formatTime(hoursToLiq / 2),
      at0_5xVelocity: formatTime(hoursToLiq * 2),
    },
    velocity24h: `${(velocity * 100).toFixed(2)}% per hour`,
    alert,
  };
}

function resolveTokenAddress(symbol: string): string | null {
  const map: Record<string, string> = {
    ETH: "0x5a77f1443d16ee5761d310e38b62f77f726bc71c",
    WETH: "0x5a77f1443d16ee5761d310e38b62f77f726bc71c",
    USDC: "0x74b7f16337b8972027f6196a17a631ac6de26d22",
    USDT: "0x1E4a5963aBFD975d8c9021ce480b42188849D41d",
    WBTC: "0xEA034fb02eB1808C2cc3adbC15f447B93CbE08e1",
    DAI: "0xC5015b9d9161Dca7e18e32f6f25C4aD850731Fd4",
  };
  return map[symbol.toUpperCase()] || null;
}
