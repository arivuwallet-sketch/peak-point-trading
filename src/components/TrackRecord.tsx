import type { BtResult } from "@/lib/backtest";
import { fmtPrice } from "@/lib/analysis";
import { cn } from "@/lib/utils";

type Props = { status: "idle" | "running" | "done" | "error"; result: BtResult | null; error?: string | undefined; tf: string };

export function TrackRecord({ status, result, error, tf }: Props) {
  if (status === "error") {
    return <p role="alert" className="text-sm text-bear">{error ?? "The test could not run."}</p>;
  }
  if (!result) {
    return (
      <p role="status" className="serif text-xl italic text-muted-foreground">
        Replaying this chart candle by candle…
      </p>
    );
  }
  const r = result;
  const n = r.trades.length;
  const verdict =
    n < 8
      ? { t: "Too few trades to judge", d: `Only ${n} completed setups on this history. Treat any number below as noise.`, c: "text-muted-foreground" }
      : r.avgR > 0.15 && (r.profitFactor ?? 2) > 1.2
        ? { t: "The engine has had an edge here", d: "On this market and timeframe, its setups made more than they lost. Past results don't guarantee future ones.", c: "text-bull" }
        : r.avgR < -0.1
          ? { t: "The engine has struggled here", d: "Its setups lost money on this history. Be extra selective, or try another timeframe.", c: "text-bear" }
          : { t: "Roughly break-even here", d: "No clear edge on this history. Take only the highest-grade setups.", c: "text-foreground" };

  const stats: [string, string, string?][] = [
    ["Trades", String(n)],
    ["Win rate", n ? `${(r.winRate * 100).toFixed(0)}%` : "—"],
    ["Avg per trade", n ? `${r.avgR >= 0 ? "+" : ""}${r.avgR.toFixed(2)}R` : "—", r.avgR >= 0 ? "text-bull" : "text-bear"],
    ["Total", n ? `${r.totalR >= 0 ? "+" : ""}${r.totalR.toFixed(1)}R` : "—", r.totalR >= 0 ? "text-bull" : "text-bear"],
    ["Profit factor", r.profitFactor == null ? "∞" : n ? r.profitFactor.toFixed(2) : "—"],
    ["Worst dip", n ? `−${r.maxDrawdownR.toFixed(1)}R` : "—", "text-bear"],
  ];

  // Equity curve
  let eq = 0;
  const pts = [0, ...r.trades.map((t) => (eq += t.r))];
  const lo = Math.min(0, ...pts);
  const hi = Math.max(0, ...pts);
  const span = hi - lo || 1;
  const W = 600;
  const H = 90;
  const path = pts.map((v, i) => `${i ? "L" : "M"}${((i / Math.max(1, pts.length - 1)) * W).toFixed(1)},${(H - ((v - lo) / span) * H).toFixed(1)}`).join(" ");
  const zeroY = H - ((0 - lo) / span) * H;

  return (
    <div className="flex flex-col gap-5" aria-busy={status === "running"}>
      <div className="border-l-2 border-primary pl-4">
        <div className={cn("serif text-2xl", verdict.c)}>{verdict.t}</div>
        <p className="mt-1 text-sm text-muted-foreground">{verdict.d}</p>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([k, v, c]) => (
          <div key={k} className="bg-card px-3 py-2.5">
            <dt className="eyebrow">{k}</dt>
            <dd className={cn("mt-1 font-mono text-lg tabular-nums", c)}>{v}</dd>
          </div>
        ))}
      </dl>

      {n > 1 && (
        <figure>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full" role="img" aria-label={`Running total of R across ${n} trades, ending at ${r.totalR.toFixed(1)}R`}>
            <line x1="0" x2={W} y1={zeroY} y2={zeroY} className="stroke-border" strokeDasharray="4 4" />
            <path d={path} fill="none" className={r.totalR >= 0 ? "stroke-bull" : "stroke-bear"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <figcaption className="mt-1 font-mono text-[10px] text-muted-foreground">Running total, in R (1R = the amount risked per trade)</figcaption>
        </figure>
      )}

      {n > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left font-mono text-xs">
            <caption className="sr-only">Most recent simulated trades</caption>
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2 font-normal">Signal (UTC)</th>
                <th className="font-normal">Side</th>
                <th className="font-normal">Entry</th>
                <th className="font-normal">Stop</th>
                <th className="font-normal">How it ended</th>
                <th className="text-right font-normal">Result</th>
              </tr>
            </thead>
            <tbody>
              {r.trades.slice(-8).reverse().map((t) => (
                <tr key={t.time} className="border-b border-border/60">
                  <td className="py-2">{new Date(t.time * 1000).toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td className={t.direction === "LONG" ? "text-bull" : "text-bear"}>{t.direction}</td>
                  <td className="tabular-nums">{fmtPrice(t.entry)}</td>
                  <td className="tabular-nums">{fmtPrice(t.stop)}</td>
                  <td className="text-muted-foreground">
                    {{ stop: "Stopped out", "tp1-be": "Target 1, rest at breakeven", tp2: "Target 2 hit", target: "Target hit", time: `Closed after ${t.bars} bars` }[t.outcome]}
                  </td>
                  <td className={cn("text-right tabular-nums", t.r >= 0 ? "text-bull" : "text-bear")}>
                    {t.r >= 0 ? "+" : ""}
                    {t.r.toFixed(2)}R
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        How this works: the engine replays the {tf} chart candle by candle, seeing only what was known at each point. It
        takes only "active setup" signals, one trade at a time — half off at target 1 with the stop moved to entry, the
        rest at target 2. If a candle touches both the stop and a target, the stop is counted. Fees, spread and the
        higher-timeframe check are left out, and the sample is short ({r.signals} signals, {r.unfilled} pullback orders
        never filled), so use it as a sanity check, not a promise.
      </p>
    </div>
  );
}
