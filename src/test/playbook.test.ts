import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/analysis";
import type { Candle } from "@/lib/market.functions";

function series(fn: (i: number) => number, n = 400, noise = 0.004): Candle[] {
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31), s / 2 ** 31 - 0.5);
  const out: Candle[] = [];
  let prev = fn(0);
  for (let i = 0; i < n; i++) {
    const c = fn(i) * (1 + rnd() * noise);
    const hi = Math.max(prev, c) * (1 + Math.abs(rnd()) * noise);
    const lo = Math.min(prev, c) * (1 - Math.abs(rnd()) * noise);
    out.push({ time: 1700000000 + i * 86400, open: prev, high: hi, low: lo, close: c, volume: 1000 });
    prev = c;
  }
  return out;
}

describe("price-action playbook", () => {
  it("reads a steady uptrend as advancing and a downtrend as declining", () => {
    const up = analyze(series((i) => 100 + i * 0.4 + Math.sin(i / 6) * 2), null).playbook;
    expect(up.stage.name).toBe("Advancing");
    const dn = analyze(series((i) => 300 - i * 0.4 + Math.sin(i / 6) * 2), null).playbook;
    expect(dn.stage.name).toBe("Declining");
  });

  it("returns complete, finite setups", () => {
    const pb = analyze(series((i) => 100 + Math.sin(i / 15) * 10), null).playbook;
    for (const s of [pb.maee, pb.mbee]) {
      expect(["TRIGGERED", "ARMED", "ABSENT"]).toContain(s.status);
      if (s.entry != null) expect(Number.isFinite(s.entry) && Number.isFinite(s.stop!)).toBe(true);
    }
    expect(["Ride the trend", "Hybrid", "Capture the swing"]).toContain(pb.management.mode);
    expect(Number.isFinite(pb.exhaustion.pct)).toBe(true);
  });
});
