# Apex Trader Insight

you need to build a professional level live trading chart reader(stocks, commodities, forex, cryptos... everything). It need to analyze and read the chart deeply like a 30+ year professional, it should be more accurate and precise and it need to show perfect entry and real-time exit level, stop loss and take profit and perfect reason for those entry and exit. it need to read the chart using advanced methods

## Analysis engine

The confluence engine lives in `src/lib/` (`indicators.ts` · `analysis.ts` · `smc.ts`) and runs deterministically on the client:

- **Indicators** — EMA 20/50/200, RSI + StochRSI, MACD, ADX/DMI, CCI, ATR (with 200-bar percentile volatility regime), Bollinger + Keltner (TTM squeeze), Supertrend, Ichimoku cloud, rolling VWAP with ±1σ/±2σ bands, OBV, MFI, linear-regression slope/R², Kaufman efficiency ratio, volume profile (POC / VAH / VAL).
- **Structure** — swing pivots, HH/HL classification, BOS vs CHoCH, push-count exhaustion gauge, trendline projection, Fibonacci retracements/extensions, premium/discount location in the dealing range.
- **Smart money** — fair value gaps + inversions, order blocks + breakers, supply/demand zones (with freshness and impulse-ATR scoring), liquidity sweeps, equal-highs/lows liquidity pools (Wyckoff spring/upthrust recognition), order-flow delta/CVD.
- **Confluence engine** — regime-aware factor weighting (trend tactics discounted in ranges and vice versa), conflict-penalised calibrated confidence, A+→D setup grading, higher-timeframe alignment gate.
- **Price-action playbook** (`playbook.ts`) — Wyckoff/Weinstein 4-stage market structure, strong/healthy/weak trend by pullback depth, overstretch from the 50 MA, candle reading by close location + relative size, classic reversal triggers, MAEE reversal and MBEE breakout checklists (power move, rejection, significance, buildup tightness, 20 MA catch-up, traffic), pre-breakout entry, S/R wear-out and triangle pressure, hidden strength/weakness, ATR exhaustion, trending vs mean-reverting test, HTF-based ride/hybrid/swing management, volatility cycle.
- **Trade plan** — market vs pullback vs deep-limit entries (value confluence: EMA20/VWAP/POC/order block/golden pocket), structure-anchored ATR-buffered stops, targets from opposing levels and liquidity pools with a minimum-R rigour gate (sub-1.3R → NO TRADE), Chandelier 3×ATR live trailing exit, breakeven/swing-trail rules, time stop, and 1%-risk position sizing.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://peak-point-trading.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/1efa220e-1445-4fd9-aa20-89e17ee6e887).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
