---
name: xlayer-liquidation-sentinel
description: >
  Cross-Protocol Liquidation Sentinel for X Layer (OKX zkEVM). Monitors unified 
  liquidation risk across Aave V3 lending and Hyperliquid perpetuals simultaneously. 
  Simulates price shocks, detects cascading liquidation scenarios, and alerts before 
  positions become liquidatable. Uses onchainOS as the primary data source for all 
  Aave V3 and wallet data. Use when user asks about liquidation risk, health factor, 
  margin safety, "what if ETH drops 20%", portfolio risk, cross-protocol exposure, 
  or liquidation protection on X Layer.
---

# X Layer Liquidation Sentinel

## What This Does

This skill is a **cross-protocol risk radar** — something no existing plugin covers.

**The Problem:** Your Aave position looks safe at HF=1.8. But you also have a 10x 
long on Hyperliquid. If ETH drops 15%, your perp gets liquidated first, the 
collateral loss hits your Aave collateral, and now your Aave position is 
liquidatable too. **Two protocols, one death spiral.**

**What This Skill Does:**
1. Reads Aave V3 health factor + per-asset positions (onchainOS PRIMARY)
2. Reads Hyperliquid perp positions + leverage (Hyperliquid API)
3. **Simulates price shocks** across both protocols simultaneously
4. Detects **cascading liquidation** scenarios
5. Alerts with **time-to-liquidation** estimates

## How Cross-Protocol Liquidation Works

**Scenario — The Death Spiral:**
- Aave: Supply $10K ETH, Borrow $5K USDC (HF = 1.8)
- Hyperliquid: 10x Long ETH, $20K notional
- ETH drops 12%:
  - Hyperliquid: Long loses $2.4K → margin call → **liquidated**
  - Aave: Collateral now $8.8K, Debt still $5K → HF drops to 1.58
  - ETH drops 5% more:
    - Aave: Collateral $8.36K, Debt $5K → HF = 1.39 → **liquidatable**

**This skill detects that cascade before it happens.**

## Data Sources

| Source | Role | Data |
|--------|------|------|
| **onchainOS** | **PRIMARY** | Aave V3 health factor, per-asset positions, collateral values |
| **onchainOS** | **PRIMARY** | Wallet balances, token prices |
| **Hyperliquid API** | Supplemental | Perp positions, leverage, margin, unrealized PnL |

## Tools

### 1. `check_liquidation_risk`

Unified risk assessment combining Aave + Hyperliquid exposure.

**Triggers:**
- "check my liquidation risk"
- "am I safe from liquidation"
- "portfolio risk assessment"
- "health factor check"
- "margin safety"
- "cross-protocol risk"

**Parameters:**
- `address` (string): Wallet address to analyze

**Output:**
```json
{
  "overallRisk": "HIGH",
  "aave": {
    "healthFactor": 1.58,
    "totalCollateralUsd": 8800,
    "totalDebtUsd": 5000,
    "riskLevel": "MODERATE",
    "largestCollateral": "ETH",
    "largestDebt": "USDC"
  },
  "hyperliquid": {
    "positionCount": 1,
    "totalNotional": 20000,
    "maxLeverage": 10,
    "marginUsed": 2000,
    "unrealizedPnl": -2400
  },
  "cascadeRisk": "CRITICAL",
  "recommendations": [
    "Reduce Hyperliquid leverage from 10x to 5x",
    "Add $2000 collateral to Aave",
    "Consider partial perp close before ETH drops further"
  ]
}
```

### 2. `simulate_price_shock`

"If ETH drops X%, what happens to my portfolio?"

**Triggers:**
- "what if ETH drops 20%"
- "simulate BTC crash"
- "price shock analysis"
- "stress test my positions"
- "worst case scenario"

**Parameters:**
- `address` (string): Wallet address
- `shocks` (object): Price shocks per asset, e.g. `{ "ETH": -0.20, "BTC": -0.15 }`

**Output:**
```json
{
  "before": {
    "aaveHealthFactor": 1.8,
    "hyperliquidMargin": 2000,
    "portfolioValue": 15000
  },
  "after": {
    "aaveHealthFactor": 1.12,
    "aaveRisk": "CRITICAL",
    "hyperliquidLiquidated": true,
    "portfolioValue": 8900,
    "totalLoss": 6100
  },
  "sequence": [
    "T+0: ETH drops 20% — Hyperliquid long loses $4000",
    "T+0: Hyperliquid margin exhausted — POSITION LIQUIDATED",
    "T+0: Aave ETH collateral drops from $10K to $8K",
    "T+0: Aave health factor: 1.8 → 1.12 (CRITICAL)",
    "T+1h: If ETH drops 5% more → Aave liquidation"
  ],
  "recommendation": "CLOSE OR HEDGE HYPERLIQUID POSITION IMMEDIATELY"
}
```

### 3. `get_time_to_liquidation`

Estimates how long until liquidation at current price velocity.

**Triggers:**
- "how long until I get liquidated"
- "time to liquidation"
- "countdown to liquidation"
- "liquidation clock"

**Parameters:**
- `address` (string): Wallet address
- `asset` (string): Asset to track (ETH, BTC, etc.)

**Output:**
```json
{
  "asset": "ETH",
  "currentPrice": 3200,
  "liquidationPrice": {
    "aave": 2880,
    "hyperliquid": 3040
  },
  "priceDistance": {
    "aave": "-10.0%",
    "hyperliquid": "-5.0%"
  },
  "timeEstimate": {
    "atCurrentVelocity": "4.2 hours",
    "at2xVelocity": "2.1 hours",
    "at0.5xVelocity": "8.4 hours"
  },
  "velocity24h": "-2.4% per hour",
  "alert": "Hyperliquid liquidation imminent — 5% price drop needed"
}
```

## Principles

1. **onchainOS-first**: All Aave and wallet data flows through onchainOS CLI
2. **Risk-first output**: Always lead with the worst-case scenario
3. **Cascade detection**: Analyze cross-protocol contagion, not siloed risk
4. **Actionable alerts**: Every risk assessment includes specific recommendations
5. **Time-sensitive**: Include time-to-liquidation estimates where possible
6. **Never auto-execute**: Only analyze and alert — user decides action

## Risk Levels

| Overall Risk | Aave HF | HL Leverage | Meaning |
|-------------|---------|-------------|---------|
| SAFE | > 2.0 | < 5x | Comfortable buffer |
| MODERATE | 1.5-2.0 | 5-10x | Monitor closely |
| HIGH | 1.2-1.5 | 10-15x | Action recommended |
| CRITICAL | 1.0-1.2 | > 15x | Liquidation imminent |
| LIQUIDATABLE | < 1.0 | — | Already liquidatable |

## X Layer Context

- **Chain ID**: 196
- **Native Token**: OKB
- **Aave V3**: Active on X Layer
- **Hyperliquid**: Perp exchange with cross-margin

## Example Conversation Flows

**User:** "Check my liquidation risk"
→ `check_liquidation_risk` with user's address
→ Show unified risk + cascade analysis
→ Suggest `simulate_price_shock` for stress testing

**User:** "What if ETH crashes 25%?"
→ `simulate_price_shock` with ETH: -0.25
→ Show before/after + liquidation sequence
→ Recommend hedging or deleveraging

**User:** "How long do I have?"
→ `get_time_to_liquidation` for ETH
→ Show countdown + velocity analysis
→ Set alert thresholds
