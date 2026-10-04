import { useEffect, useRef } from "react";
import type { Candle } from "@/lib/market.functions";
import type { Analysis } from "@/lib/analysis";
import { decimals } from "@/lib/analysis";
import { chartTheme as T } from "@/lib/chart-theme";

export function PriceChart({ candles, analysis }: { candles: Candle[]; analysis: Analysis }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const LW = await import("lightweight-charts");
      if (disposed || !ref.current) return;
      const el = ref.current;
      const chart = LW.createChart(el, {
        width: el.clientWidth,
        height: el.clientHeight,
        localization: { locale: "en-US" },
        layout: { background: { color: T.bg }, textColor: T.text, fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
        grid: { vertLines: { color: T.grid }, horzLines: { color: T.grid } },
        crosshair: { mode: LW.CrosshairMode.Normal },
        rightPriceScale: { borderColor: T.grid },
        timeScale: { borderColor: T.grid, timeVisible: true, secondsVisible: false },
      });
      const prec = decimals(analysis.price);
      const pf = { type: "price" as const, precision: prec, minMove: 1 / 10 ** prec };
      const s = chart.addCandlestickSeries({
        upColor: T.up, downColor: T.down, wickUpColor: T.up, wickDownColor: T.down, borderVisible: false, priceFormat: pf,
      });
      s.setData(candles.map((c) => ({ time: c.time as any, open: c.open, high: c.high, low: c.low, close: c.close })));
      const line = (vals: number[], color: string, from: number) => {
        const l = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        l.setData(candles.slice(from).map((c, i) => ({ time: c.time as any, value: vals[i + from] })));
      };
      line(analysis.series.ema20, T.ema20, 20);
      line(analysis.series.ema50, T.ema50, 50);
      if (candles.length > 200) line(analysis.series.ema200, T.ema200, 200);

      for (const lv of analysis.levels)
        s.createPriceLine({ price: lv.price, color: T.level, lineWidth: 1, lineStyle: LW.LineStyle.Dotted, axisLabelVisible: false, title: lv.kind === "support" ? "S" : "R" });
      const p = analysis.plan;
      const pl = (price: number, color: string, title: string, style = LW.LineStyle.Solid) =>
        s.createPriceLine({ price, color, lineWidth: 2, lineStyle: style, axisLabelVisible: true, title });
      pl(p.entry, T.entry, "ENTRY");
      pl(p.stop, T.stop, "SL");
      pl(p.tp1, T.tp, "TP1", LW.LineStyle.Dashed);
      pl(p.tp2, T.tp, "TP2", LW.LineStyle.Dashed);
      pl(p.tp3, T.tp, "TP3", LW.LineStyle.Dashed);
      pl(p.trailingStop, T.trail, "TRAIL", LW.LineStyle.SparseDotted);

      const times = new Set(candles.map((c) => c.time));
      s.setMarkers(
        analysis.markers
          .filter((m) => times.has(m.time))
          .sort((a, b) => a.time - b.time)
          .map((m) => ({
            time: m.time as any,
            position: m.position,
            color: m.bias === "bull" ? T.up : m.bias === "bear" ? T.down : T.text,
            shape: m.bias === "bull" ? "arrowUp" : m.bias === "bear" ? "arrowDown" : "circle",
            text: m.text,
            size: m.bias === "neutral" ? 0.4 : 1,
          })),
      );
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 150), to: candles.length + 8 });
      const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }));
      ro.observe(el);
      cleanup = () => { ro.disconnect(); chart.remove(); };
    })();
    return () => { disposed = true; cleanup(); };
  }, [candles, analysis]);

  return <div ref={ref} className="h-full w-full" />;
}
