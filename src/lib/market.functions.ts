import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d", "1wk"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

const YAHOO: Record<Timeframe, { interval: string; range: string; group?: number }> = {
  "1m": { interval: "1m", range: "2d" },
  "5m": { interval: "5m", range: "5d" },
  "15m": { interval: "15m", range: "1mo" },
  "1h": { interval: "60m", range: "3mo" },
  "4h": { interval: "60m", range: "6mo", group: 4 * 3600 },
  "1d": { interval: "1d", range: "2y" },
  "1wk": { interval: "1wk", range: "10y" },
};

function aggregate(candles: Candle[], seconds: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const bucket = Math.floor(c.time / seconds) * seconds;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      out.push({ ...c, time: bucket });
    }
  }
  return out;
}

export const getCandles = createServerFn({ method: "GET" })
  .inputValidator((d) =>
    z
      .object({
        symbol: z.string().regex(/^[A-Za-z0-9.=^\-]{1,24}$/),
        tf: z.enum(TIMEFRAMES),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const cfg = YAHOO[data.tf];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      data.symbol.toUpperCase(),
    )}?interval=${cfg.interval}&range=${cfg.range}&includePrePost=false`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`Market data unavailable for ${data.symbol} (${res.status})`);
    const json: any = await res.json();
    const r = json?.chart?.result?.[0];
    if (!r?.timestamp) throw new Error(`No data found for ${data.symbol}`);
    const q = r.indicators.quote[0];
    let candles: Candle[] = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
      if ([o, h, l, c].some((v) => v == null || Number.isNaN(v))) continue;
      candles.push({ time: r.timestamp[i], open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 });
    }
    if (cfg.group) candles = aggregate(candles, cfg.group);
    // de-dupe & sort
    const map = new Map<number, Candle>();
    for (const c of candles) map.set(c.time, c);
    candles = [...map.values()].sort((a, b) => a.time - b.time);
    return {
      symbol: r.meta.symbol as string,
      name: (r.meta.longName || r.meta.shortName || r.meta.symbol) as string,
      currency: (r.meta.currency ?? "") as string,
      type: (r.meta.instrumentType ?? "") as string,
      candles,
    };
  });
