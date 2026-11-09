import { describe, expect, it } from "vitest";
import { backtest, positionSize } from "@/lib/backtest";
import type { Candle } from "@/lib/market.functions";

function walk(n: number, seed = 7): Candle[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let px = 100;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const o = px;
    px = Math.max(1, px + (rnd() - 0.48) * 2);
    const hi = Math.max(o, px) + rnd();
    const lo = Math.min(o, px) - rnd();
    out.push({ time: 1700000000 + i * 3600, open: o, high: hi, low: lo, close: px, volume: 1000 + rnd() * 500 });
  }
  return out;
}

describe("position size", () => {
  it("risks exactly the chosen % of the account at the stop", () => {
    const s = positionSize(10_000, 1, 100, 95)!;
    expect(s.riskAmount).toBe(100);
    expect(s.units).toBe(20);
    expect(s.notional).toBe(2000);
  });
  it("refuses a zero-distance stop", () => {
    expect(positionSize(10_000, 1, 100, 100)).toBeNull();
  });
});

describe("walk-forward track record", () => {
  const cs = walk(400);
  const res = backtest(cs);

  it("every trade loses at most 1R (stop is the worst case)", () => {
    for (const t of res.trades) expect(t.r).toBeGreaterThanOrEqual(-1.0001 - 1e-9);
  });

  it("never looks ahead: future candles don't change earlier trades", () => {
    const extended = [...cs, ...walk(60, 99).map((c, i) => ({ ...c, time: cs[cs.length - 1].time + (i + 1) * 3600 }))];
    const later = backtest(extended);
    const closedEarly = res.trades;
    expect(later.trades.slice(0, closedEarly.length).map((t) => t.time)).toEqual(closedEarly.map((t) => t.time));
  });

  it("summary stats agree with the trade list", () => {
    const sum = res.trades.reduce((a, t) => a + t.r, 0);
    expect(res.totalR).toBeCloseTo(sum, 9);
    expect(res.trades.length).toBeLessThanOrEqual(res.signals);
  });
});
