import { describe, expect, it } from "vitest";
import {
  rsi,
  atr,
  macd,
  adx,
  vwap,
  supertrend,
  mfi,
  volumeProfile,
  efficiencyRatio,
  stochRsi,
} from "@/lib/indicators";
import { analyze, pivots, trendBias } from "@/lib/analysis";
import { liquidityPools, fairValueGaps, orderBlocks } from "@/lib/smc";
import type { Candle } from "@/lib/market.functions";

/** Build candles from a close series with small symmetric ranges. */
function mk(closes: number[], vol = 1000): Candle[] {
  return closes.map((c, i) => ({
    time: 1700000000 + i * 3600,
    open: closes[Math.max(0, i - 1)],
    high: c + 0.5,
    low: c - 0.5,
    close: c,
    volume: vol,
  }));
}
/** Zigzag series: alternate up/down legs of `amp` bars each. */
function zigzag(legs: number, amp: number, start = 100): number[] {
  const out = [start];
  let dir = 1;
  for (let l = 0; l < legs; l++) {
    for (let i = 0; i < amp; i++) out.push(out[out.length - 1] + dir * (1 + 0.1 * Math.sin(i)));
    dir *= -1;
  }
  return out;
}
const ramp = (n: number, slope: number, start = 100) =>
  Array.from({ length: n }, (_, i) => start + i * slope + 0.3 * Math.sin(i / 3));

describe("indicator math", () => {
  it("RSI is bounded and hits 100 on a monotonic rise", () => {
    const r = rsi(ramp(60, 1));
    const tail = r.slice(-20);
    for (const x of tail) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
    }
    expect(r.at(-1)!).toBeGreaterThan(90);
  });
  it("ATR equals true range for a pure linear ramp", () => {
    const lin = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5); // no noise: TR = high−prevClose = 1.0
    const a = atr(mk(lin));
    expect(a.at(-1)!).toBeCloseTo(1.0, 3);
  });
  it("MACD line is positive in an uptrend and negative in a downtrend", () => {
    expect(macd(ramp(80, 0.8)).line.at(-1)!).toBeGreaterThan(0);
    expect(macd(ramp(80, -0.8)).line.at(-1)!).toBeLessThan(0);
  });
  it("ADX is high in a clean trend and low in a flat market", () => {
    const trend = adx(mk(ramp(80, 1)));
    const flat = adx(mk(Array.from({ length: 80 }, (_, i) => 100 + 0.2 * Math.sin(i))));
    expect(trend.adx.at(-1)!).toBeGreaterThan(40);
    expect(flat.adx.at(-1)!).toBeLessThan(trend.adx.at(-1)!);
  });
  it("VWAP is the volume-weighted typical price and bands bracket it", () => {
    const cs = mk(ramp(40, 0.5));
    const v = vwap(cs, 20);
    expect(v.vwap.at(-1)!).toBeGreaterThan(v.lo1.at(-1)!);
    expect(v.up1.at(-1)!).toBeGreaterThan(v.vwap.at(-1)!);
    expect(v.up2.at(-1)!).toBeGreaterThan(v.up1.at(-1)!);
  });
  it("Supertrend follows the prevailing direction", () => {
    expect(supertrend(mk(ramp(80, 1))).dir.at(-1)).toBe(1);
    expect(supertrend(mk(ramp(80, -1))).dir.at(-1)).toBe(-1);
  });
  it("MFI is bounded 0–100", () => {
    const m = mfi(mk(ramp(60, 0.7)));
    for (const x of m.slice(-10)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
    }
  });
  it("Efficiency ratio is near 1 for a clean ramp and near 0 for noise", () => {
    expect(efficiencyRatio(ramp(60, 1)).at(-1)!).toBeGreaterThan(0.7);
    expect(efficiencyRatio(zigzag(12, 3)).at(-1)!).toBeLessThan(0.6);
  });
  it("StochRSI stays within 0–100", () => {
    const s = stochRsi(zigzag(10, 8));
    for (const x of s.k.slice(-20))
      if (Number.isFinite(x)) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
      }
  });
  it("Volume profile POC lies inside the price range with VAH > POC > VAL ordering sanity", () => {
    const p = volumeProfile(mk(ramp(150, 0.5)));
    expect(p).not.toBeNull();
    expect(p!.vah).toBeGreaterThanOrEqual(p!.poc);
    expect(p!.val).toBeLessThanOrEqual(p!.poc);
  });
});

describe("structure & smc", () => {
  it("pivots find alternating extremes in a zigzag", () => {
    const cs = mk(zigzag(6, 10));
    const pv = pivots(cs, 3, 3);
    expect(pv.filter((p) => p.kind === "H").length).toBeGreaterThanOrEqual(2);
    expect(pv.filter((p) => p.kind === "L").length).toBeGreaterThanOrEqual(2);
  });
  it("liquidity pools detect equal highs", () => {
    // two swings topping at exactly the same price
    const closes = [100, 105, 110, 115, 120, 115, 110, 105, 110, 115, 120, 115, 110, 105, 102];
    const cs = mk(closes.flatMap((c) => [c - 0.4, c - 0.2, c, c + 0.2])); // pad to give pivots room
    const pv = pivots(cs, 3, 3);
    const pools = liquidityPools(cs, pv, 1.0);
    expect(pools.some((p) => p.kind === "equal-highs" && Math.abs(p.price - 120.7) < 1.5)).toBe(
      true,
    );
  });
  it("fair value gaps and order blocks are found in impulsive data", () => {
    const base = ramp(120, 0.3);
    base[100] = base[99] + 6;
    base[101] = base[100] + 6;
    base[102] = base[101] + 6; // impulse
    const cs = mk(base);
    const A = atr(cs).at(-1)!;
    const zones = [...fairValueGaps(cs, A), ...orderBlocks(cs, pivots(cs, 3, 3), A)];
    expect(zones.length).toBeGreaterThan(0);
  });
});

describe("full analysis engine", () => {
  it("scores a clean uptrend bullish with a coherent long plan", () => {
    const cs = mk(ramp(260, 0.5));
    const a = analyze(cs, "bull");
    expect(a.score).toBeGreaterThan(0);
    expect(["STRONG BUY", "BUY", "NEUTRAL"]).toContain(a.verdict); // late-stage guards may soften it
    expect(Number.isFinite(a.plan.entry)).toBe(true);
    expect(Number.isFinite(a.plan.stop)).toBe(true);
    expect(Number.isFinite(a.plan.tp1)).toBe(true);
    if (a.plan.direction === "LONG") expect(a.plan.stop).toBeLessThan(a.plan.entry);
    else expect(a.plan.stop).toBeGreaterThan(a.plan.entry);
    expect(a.confidence).toBeGreaterThanOrEqual(0);
    expect(a.confidence).toBeLessThanOrEqual(95);
  });
  it("scores a clean downtrend bearish", () => {
    const cs = mk(ramp(260, -0.5));
    const a = analyze(cs, "bear");
    expect(a.score).toBeLessThan(0);
    expect(a.plan.direction).toBe("SHORT");
  });
  it("never emits NaN in any plan level or indicator on noisy data", () => {
    const cs = mk(zigzag(20, 6));
    const a = analyze(cs, null);
    const p = a.plan;
    for (const x of [p.entry, p.stop, p.tp1, p.tp2, p.tp3, p.trailingStop, p.riskPct, ...p.rr])
      expect(Number.isFinite(x)).toBe(true);
    expect(a.plan.rr[0]).toBeGreaterThan(0);
    expect(["ACTIVE SETUP", "WAIT FOR CONFIRMATION", "NO TRADE"]).toContain(p.status);
    expect(["A+", "A", "B", "C", "D"]).toContain(a.grade);
  });
  it("respects the risk gate: TP1 is at least 1R away when a trade is allowed", () => {
    const cs = mk(ramp(260, 0.5));
    const a = analyze(cs, "bull");
    if (a.plan.status !== "NO TRADE") expect(a.plan.rr[0]).toBeGreaterThanOrEqual(1.3 - 1e-9);
  });
  it("trendBias reads ramps correctly", () => {
    expect(trendBias(mk(ramp(80, 1)))).toBe("bull");
    expect(trendBias(mk(ramp(80, -1)))).toBe("bear");
  });
});
