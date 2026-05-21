# X Layer Liquidation Sentinel

> Cross-Protocol Liquidation Sentinel for X Layer — monitors unified liquidation risk across Aave V3 lending and Hyperliquid perpetuals. Simulates price shocks and detects cascading liquidation scenarios.

## What It Does

This agent skill is a **cross-protocol risk radar** — something no existing plugin covers.

**The Problem:** Your Aave position looks safe at HF=1.8. But you also have a 10x long on Hyperliquid. If ETH drops 15%, your perp gets liquidated first, the collateral loss hits your Aave collateral, and now your Aave position is liquidatable too. **Two protocols, one death spiral.**

**What This Skill Does:**
1. Reads Aave V3 health factor + per-asset positions (onchainOS PRIMARY)
2. Reads Hyperliquid perp positions + leverage (Hyperliquid API)
3. **Simulates price shocks** across both protocols simultaneously
4. Detects **cascading liquidation** scenarios
5. Alerts with **time-to-liquidation** estimates

## Architecture

```
User Query → Agent Tools → onchainOS CLI (PRIMARY) → Aave V3 + Wallet Data
                                    ↓
                            Hyperliquid API (Supplemental) → Perp Positions
                                    ↓
                            Sentinel Engine → Cascade Detection → Risk Report
```

## Data Sources

| Source | Role | Data |
|--------|------|------|
| **onchainOS** | **PRIMARY** | Aave V3 health factor, per-asset positions, collateral values |
| **onchainOS** | **PRIMARY** | Wallet balances, token prices, price history |
| **Hyperliquid API** | Supplemental | Perp positions, leverage, margin, unrealized PnL |

## Tools

| Tool | Description |
|------|-------------|
| `check_liquidation_risk` | Unified risk: Aave + Hyperliquid + cascade detection |
| `simulate_price_shock` | "If ETH drops 20%, what happens?" with cascade sequence |
| `get_time_to_liquidation` | Countdown to liquidation with velocity analysis |

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your OKX API credentials

# 3. Install onchainOS CLI
curl -sSL https://raw.githubusercontent.com/okx/onchainos-skills/main/install.sh | sh

# 4. Run dev server
npm run dev

# Server starts at http://localhost:3000
# GET  /health      — Health check
# GET  /agent.json  — Agent Card
# GET  /tools       — List capabilities
# POST /execute     — Run a tool
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OKX_API_KEY` | Yes | OKX API key for onchainOS |
| `OKX_SECRET_KEY` | Yes | OKX secret key |
| `OKX_PASSPHRASE` | Yes | OKX passphrase |
| `PORT` | No | Server port (default: 3000) |
| `XLAYER_RPC_URL` | No | Custom RPC fallback |

## X Layer Context

- **Chain ID**: 196
- **Native Token**: OKB
- **Aave V3**: Active on X Layer
- **Hyperliquid**: Perp exchange with cross-margin

## Risk Levels

| Overall Risk | Aave HF | HL Leverage | Meaning |
|-------------|---------|-------------|---------|
| SAFE | > 2.0 | < 5x | Comfortable buffer |
| MODERATE | 1.5-2.0 | 5-10x | Monitor closely |
| HIGH | 1.2-1.5 | 10-15x | Action recommended |
| CRITICAL | 1.0-1.2 | > 15x | Liquidation imminent |
| LIQUIDATABLE | < 1.0 | — | Already liquidatable |

## License

MIT
