import { describe, expect, it } from "vitest";
import { analyze, trendBias, fmtPrice } from "@/lib/analysis";
import type { Candle } from "@/lib/market.functions";

/** Realistic synthetic series: regime-switching GBM with volatility clustering and volume. */
function synth(n: number, seed = 42): Candle[] {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31), s / 2 ** 31 - 0.5);
  const out: Candle[] = [];
  let px = 50000, vol = 0.004, drift = 0.0008;
  for (let i = 0; i < n; i++) {
    if (i % 120 === 0) drift = [0.0012, -0.001, 0.0, 0.0006][Math.floor(rnd() * 4 + 0.5) % 4];
    vol = Math.min(0.02, Math.max(0.0015, vol * (1 + rnd() * 0.3)));
    const ret = drift + rnd() * 2 * vol;
    const o = px; px = px * (1 + ret);
    const hi = Math.max(o, px) * (1 + Math.abs(rnd()) * vol * 0.7);
    const lo = Math.min(o, px) * (1 - Math.abs(rnd()) * vol * 0.7);
    out.push({ time: 1700000000 + i * 3600, open: o, high: hi, low: lo, close: px, volume: 800 + Math.abs(ret) * 4e5 + rnd() * 300 });
  }
  return out;
}

describe("engine sanity on realistic synthetic data", () => {
  it("produces a complete, coherent analysis", () => {
    const cs = synth(500);
    const a = analyze(cs, trendBias(cs));
    console.log("=== ENGINE OUTPUT ===");
    console.log(`price ${fmtPrice(a.price)}  verdict ${a.verdict}  score ${a.score.toFixed(1)}  conf ${a.confidence}%  grade ${a.grade}`);
    console.log(`${a.regime} | ${a.volRegime} | ${a.structure} | location: ${a.premium.zone} (${a.premium.pct.toFixed(0)}%)`);
    console.log(`plan: ${a.plan.status} ${a.plan.direction} ${a.plan.entryType}`);
    console.log(`  entry ${fmtPrice(a.plan.entry)}  stop ${fmtPrice(a.plan.stop)}  trail ${fmtPrice(a.plan.trailingStop)}`);
    console.log(`  tp1 ${fmtPrice(a.plan.tp1)} (${a.plan.rr[0].toFixed(1)}R)  tp2 ${fmtPrice(a.plan.tp2)} (${a.plan.rr[1].toFixed(1)}R)  tp3 ${fmtPrice(a.plan.tp3)} (${a.plan.rr[2].toFixed(1)}R)`);
    console.log(`  deep ${a.plan.deepEntry == null ? "—" : fmtPrice(a.plan.deepEntry)}  pools ${a.pools.length}  zones ${a.zones.length}  factors ${a.factors.length}`);
    console.log("  groups:", [...new Set(a.factors.map((f) => f.group))].join(", "));
    for (const f of a.factors.slice(0, 6)) console.log(`   [${f.bias} ${f.weight.toFixed(2)}] ${f.label}`);
    expect(a.factors.length).toBeGreaterThan(12);
    for (const x of [a.plan.entry, a.plan.stop, a.plan.tp1, a.plan.tp2, a.plan.tp3, a.plan.trailingStop]) expect(Number.isFinite(x)).toBe(true);
  });
});
