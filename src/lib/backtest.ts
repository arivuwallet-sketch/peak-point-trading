import type { Candle } from "./market.functions";
import { analyze } from "./analysis";

/**
 * Walk-forward "track record" of the signal engine on the loaded history.
 *
 * At each test bar the engine only sees candles up to and including that bar
 * (no look-ahead). An ACTIVE SETUP is taken; WAIT / NO TRADE are skipped.
 * One trade at a time. Rules mirror the trade ticket:
 *  - Market entries fill at the next bar's open; limit entries must be touched
 *    within `fillBars` bars or the order is cancelled.
 *  - Stop = -1R. TP1 banks half and moves the stop to breakeven; the rest runs
 *    to TP2 or breakeven.
 *  - When one bar touches both stop and a target, the stop is assumed first
 *    (conservative).
 *  - Open trades are closed at market after `maxHold` bars.
 * Costs (fees, spread, slippage) are not modelled.
 */
export type BtTrade = {
  time: number;
  direction: "LONG" | "SHORT";
  entry: number;
  stop: number;
  r: number;
  outcome: "stop" | "tp1-be" | "tp2" | "time";
  bars: number;
};

export type BtResult = {
  trades: BtTrade[];
  signals: number;
  unfilled: number;
  winRate: number;
  avgR: number;
  totalR: number;
  profitFactor: number | null;
  maxDrawdownR: number;
  testedBars: number;
};

export type BtOptions = { window?: number; warmup?: number; step?: number; fillBars?: number; maxHold?: number };

export function backtest(cs: Candle[], opts: BtOptions = {}): BtResult {
  const window = opts.window ?? 220;
  const warmup = opts.warmup ?? 120;
  const step = opts.step ?? 2;
  const fillBars = opts.fillBars ?? 8;
  const maxHold = opts.maxHold ?? 60;
  const trades: BtTrade[] = [];
  let signals = 0;
  let unfilled = 0;
  let testedBars = 0;
  // Last closed bar is cs.length - 2 (the final bar may still be forming).
  const lastSignalBar = cs.length - 3;
  let i = warmup;
  while (i <= lastSignalBar) {
    testedBars++;
    const slice = cs.slice(Math.max(0, i + 1 - window), i + 1);
    let p;
    try {
      p = analyze(slice, null).plan;
    } catch {
      i += step;
      continue;
    }
    if (p.status !== "ACTIVE SETUP") {
      i += step;
      continue;
    }
    signals++;
    const long = p.direction === "LONG";
    const risk = Math.abs(p.entry - p.stop);
    if (!(risk > 0)) {
      i += step;
      continue;
    }
    // Fill
    let fillIdx = -1;
    let entry = p.entry;
    if (p.entryType === "Market") {
      fillIdx = i + 1;
      entry = cs[i + 1].open;
    } else {
      for (let j = i + 1; j <= Math.min(cs.length - 1, i + fillBars); j++) {
        if (long ? cs[j].low <= p.entry : cs[j].high >= p.entry) {
          fillIdx = j;
          entry = long ? Math.min(p.entry, cs[j].open) : Math.max(p.entry, cs[j].open);
          break;
        }
      }
    }
    if (fillIdx < 0) {
      unfilled++;
      i += step;
      continue;
    }
    const R = Math.abs(entry - p.stop);
    if (!(R > 0) || (long ? entry <= p.stop : entry >= p.stop)) {
      i = fillIdx + 1;
      continue;
    }
    const rOf = (px: number) => ((long ? px - entry : entry - px) / R);
    let stop = p.stop;
    let banked = 0; // R already banked on the first half
    let half = false;
    let outcome: BtTrade["outcome"] | null = null;
    let r = 0;
    let exitIdx = fillIdx;
    for (let j = fillIdx; j < cs.length; j++) {
      const b = cs[j];
      exitIdx = j;
      const hitStop = long ? b.low <= stop : b.high >= stop;
      if (hitStop) {
        r = half ? banked + 0.5 * rOf(stop) : rOf(stop);
        outcome = half ? "tp1-be" : "stop";
        break;
      }
      if (!half && (long ? b.high >= p.tp1 : b.low <= p.tp1)) {
        half = true;
        banked = 0.5 * rOf(p.tp1);
        stop = entry;
      }
      if (half && (long ? b.high >= p.tp2 : b.low <= p.tp2)) {
        r = banked + 0.5 * rOf(p.tp2);
        outcome = "tp2";
        break;
      }
      if (j - fillIdx >= maxHold) {
        r = half ? banked + 0.5 * rOf(b.close) : rOf(b.close);
        outcome = "time";
        break;
      }
    }
    if (!outcome) break; // still open at the end of the data; not counted
    trades.push({ time: cs[i].time, direction: p.direction, entry, stop: p.stop, r, outcome, bars: exitIdx - fillIdx + 1 });
    i = exitIdx + 1;
  }

  const wins = trades.filter((t) => t.r > 0.05);
  const gross = trades.reduce((s, t) => s + Math.max(0, t.r), 0);
  const loss = trades.reduce((s, t) => s + Math.max(0, -t.r), 0);
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const t of trades) {
    eq += t.r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const totalR = eq;
  return {
    trades,
    signals,
    unfilled,
    winRate: trades.length ? wins.length / trades.length : 0,
    avgR: trades.length ? totalR / trades.length : 0,
    totalR,
    profitFactor: loss > 0 ? gross / loss : gross > 0 ? null : 0,
    maxDrawdownR: dd,
    testedBars,
  };
}

/** Position size so that a stop-out loses exactly `riskPct`% of `account`. */
export function positionSize(account: number, riskPct: number, entry: number, stop: number) {
  const perUnit = Math.abs(entry - stop);
  if (!(account > 0) || !(riskPct > 0) || !(perUnit > 0)) return null;
  const riskAmount = (account * riskPct) / 100;
  const units = riskAmount / perUnit;
  return { riskAmount, units, notional: units * entry, leverage: (units * entry) / account };
}
