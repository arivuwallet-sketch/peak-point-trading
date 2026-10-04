import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense, useMemo, useState } from "react";
import { getCandles, TIMEFRAMES, type Timeframe } from "@/lib/market.functions";
import { analyze, fmtPrice, trendBias, type Bias } from "@/lib/analysis";
import { cn } from "@/lib/utils";

const PriceChart = lazy(() => import("@/components/PriceChart").then((m) => ({ default: m.PriceChart })));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ChartSage — Live Pro Chart Reader for Stocks, Forex, Crypto & Commodities" },
      { name: "description", content: "Live confluence analysis: market structure, S/R, momentum, divergence, Fibonacci and multi-timeframe trend with entry, stop loss, take profit and trailing exit." },
      { property: "og:title", content: "ChartSage — Live Pro Chart Reader" },
      { property: "og:description", content: "Entries, stops, targets and real-time exits with the reasoning behind every level." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const MARKETS: { group: string; items: [string, string][] }[] = [
  { group: "Crypto", items: [["BTC-USD", "Bitcoin"], ["ETH-USD", "Ethereum"], ["SOL-USD", "Solana"], ["XRP-USD", "XRP"]] },
  { group: "Forex", items: [["EURUSD=X", "EUR/USD"], ["GBPUSD=X", "GBP/USD"], ["USDJPY=X", "USD/JPY"], ["USDINR=X", "USD/INR"]] },
  { group: "Commodities", items: [["GC=F", "Gold"], ["SI=F", "Silver"], ["CL=F", "Crude Oil"], ["NG=F", "Nat Gas"]] },
  { group: "Stocks", items: [["AAPL", "Apple"], ["NVDA", "Nvidia"], ["TSLA", "Tesla"], ["RELIANCE.NS", "Reliance"]] },
  { group: "Indices", items: [["^GSPC", "S&P 500"], ["^IXIC", "Nasdaq"], ["^NSEI", "Nifty 50"], ["^DJI", "Dow"]] },
];
const HTF: Record<Timeframe, Timeframe | null> = { "1m": "15m", "5m": "1h", "15m": "4h", "1h": "1d", "4h": "1d", "1d": "1wk", "1wk": null };

function Index() {
  const [symbol, setSymbol] = useState("BTC-USD");
  const [tf, setTf] = useState<Timeframe>("1h");
  const [custom, setCustom] = useState("");
  const fetchCandles = useServerFn(getCandles);
  const refresh = tf === "1m" || tf === "5m" ? 10_000 : 20_000;

  const main = useQuery({
    queryKey: ["candles", symbol, tf],
    queryFn: () => fetchCandles({ data: { symbol, tf } }),
    refetchInterval: refresh,
    retry: 1,
  });
  const htfTf = HTF[tf];
  const htf = useQuery({
    queryKey: ["candles", symbol, htfTf],
    queryFn: () => fetchCandles({ data: { symbol, tf: htfTf! } }),
    enabled: !!htfTf,
    refetchInterval: 120_000,
    retry: 1,
  });

  const analysis = useMemo(() => {
    if (!main.data || main.data.candles.length < 60) return null;
    const hb: Bias | null = htf.data ? trendBias(htf.data.candles) : null;
    return analyze(main.data.candles, hb);
  }, [main.data, htf.data]);

  const last = main.data?.candles.at(-1);
  const prev = main.data?.candles.at(-2);
  const chg = last && prev ? ((last.close - prev.close) / prev.close) * 100 : 0;

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold tracking-tight text-primary">ChartSage</span>
          <span className="font-mono text-xs text-muted-foreground">PRO CHART READER</span>
        </div>
        <form
          className="ml-auto flex gap-2"
          onSubmit={(e) => { e.preventDefault(); if (custom.trim()) setSymbol(custom.trim().toUpperCase()); }}
        >
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Any symbol: MSFT, TCS.NS, ADA-USD, AUDUSD=X"
            className="w-72 rounded-md border border-input bg-secondary px-3 py-1.5 font-mono text-sm outline-none focus:border-ring"
          />
          <button className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">Analyze</button>
        </form>
      </header>

      <div className="grid gap-3 p-3 lg:grid-cols-[200px_1fr_400px]">
        {/* Watchlist */}
        <aside className="panel h-fit p-2">
          {MARKETS.map((g) => (
            <div key={g.group} className="mb-2">
              <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{g.group}</div>
              {g.items.map(([s, n]) => (
                <button
                  key={s}
                  onClick={() => setSymbol(s)}
                  className={cn("flex w-full justify-between rounded px-2 py-1 text-left text-sm hover:bg-accent", symbol === s && "bg-accent text-primary")}
                >
                  <span>{n}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{s}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* Chart */}
        <main className="flex min-w-0 flex-col gap-3">
          <div className="panel flex flex-wrap items-center gap-4 px-4 py-3">
            <div>
              <div className="text-lg font-bold">{main.data?.name ?? symbol}</div>
              <div className="font-mono text-xs text-muted-foreground">{symbol} · {main.data?.currency} {main.data?.type}</div>
            </div>
            {last && (
              <div className="font-mono">
                <div className="text-2xl font-semibold">{fmtPrice(last.close)}</div>
                <div className={cn("text-xs", chg >= 0 ? "text-bull" : "text-bear")}>{chg >= 0 ? "+" : ""}{chg.toFixed(3)}% last bar</div>
              </div>
            )}
            <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <span className="live-dot h-2 w-2 rounded-full bg-bull" /> LIVE · {refresh / 1000}s
            </div>
            <div className="ml-auto flex gap-1">
              {TIMEFRAMES.map((t) => (
                <button key={t} onClick={() => setTf(t)} className={cn("rounded px-2.5 py-1 font-mono text-xs", tf === t ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground")}>{t}</button>
              ))}
            </div>
          </div>
          <div className="panel h-[620px] overflow-hidden">
            {main.isError ? (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-bear">{(main.error as Error).message}. Check the symbol and try again.</div>
            ) : !analysis || !main.data ? (
              <div className="flex h-full items-center justify-center font-mono text-sm text-muted-foreground">{main.isLoading ? "Loading market data…" : "Not enough history to analyze."}</div>
            ) : (
              <Suspense fallback={null}><PriceChart candles={main.data.candles} analysis={analysis} /></Suspense>
            )}
          </div>
          {analysis && (
            <div className="panel grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-4">
              {[
                ["RSI 14", analysis.indicators.rsi.toFixed(1)],
                ["ADX 14", analysis.indicators.adx.toFixed(1)],
                ["ATR 14", fmtPrice(analysis.atr)],
                ["Regime", analysis.regime],
                ["EMA 20", fmtPrice(analysis.indicators.ema20)],
                ["EMA 50", fmtPrice(analysis.indicators.ema50)],
                ["EMA 200", fmtPrice(analysis.indicators.ema200)],
                ["Structure", analysis.structure],
              ].map(([k, v]) => (
                <div key={k} className="bg-card p-3">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{k}</div>
                  <div className="font-mono text-sm">{v}</div>
                </div>
              ))}
            </div>
          )}
        </main>

        {/* Analysis */}
        <section className="flex flex-col gap-3">
          {analysis ? <AnalysisPanel a={analysis} htf={htfTf} /> : <div className="panel p-4 text-sm text-muted-foreground">Analysis appears once data loads.</div>}
        </section>
      </div>
      <footer className="px-4 pb-6 text-center text-xs text-muted-foreground">
        Educational analysis, not financial advice. No method is 100% accurate — always size positions so a stop-out is affordable. Data may be delayed by the exchange.
      </footer>
    </div>
  );
}

function AnalysisPanel({ a, htf }: { a: ReturnType<typeof analyze>; htf: Timeframe | null }) {
  const p = a.plan;
  const bull = p.direction === "LONG";
  const tone = a.verdict.includes("BUY") ? "text-bull" : a.verdict.includes("SELL") ? "text-bear" : "text-primary";
  const groups = [...new Set(a.factors.map((f) => f.group))];
  return (
    <>
      <div className="panel p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Verdict</div>
            <div className={cn("text-3xl font-bold", tone)}>{a.verdict}</div>
          </div>
          <div className="text-right font-mono">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Confluence</div>
            <div className="text-xl">{a.score > 0 ? "+" : ""}{a.score.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">{a.confidence}% agreement</div>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded bg-secondary">
          <div className={cn("h-full", a.score >= 0 ? "bg-bull" : "bg-bear")} style={{ width: `${Math.min(100, a.confidence)}%` }} />
        </div>
      </div>

      <div className="panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className={cn("rounded px-2 py-0.5 font-mono text-xs font-semibold", bull ? "bg-bull text-primary-foreground" : "bg-bear text-primary-foreground")}>{p.direction}</span>
          <span className={cn("font-mono text-xs", p.status === "ACTIVE SETUP" ? "text-bull" : "text-primary")}>{p.status}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 font-mono text-sm">
          <Lvl k={`Entry · ${p.entryType}`} v={fmtPrice(p.entry)} cls="text-primary" />
          <Lvl k="Stop loss" v={`${fmtPrice(p.stop)} (${p.riskPct.toFixed(2)}%)`} cls="text-bear" />
          <Lvl k={`TP1 · ${p.rr[0].toFixed(1)}R`} v={fmtPrice(p.tp1)} cls="text-bull" />
          <Lvl k={`TP2 · ${p.rr[1].toFixed(1)}R`} v={fmtPrice(p.tp2)} cls="text-bull" />
          <Lvl k={`TP3 · ${p.rr[2].toFixed(1)}R`} v={fmtPrice(p.tp3)} cls="text-bull" />
          <Lvl k="Live trailing exit" v={fmtPrice(p.trailingStop)} cls="text-info" />
        </div>
        <div className="mt-2 font-mono text-[11px] text-muted-foreground">Entry zone {fmtPrice(p.entryZone[0])} – {fmtPrice(p.entryZone[1])}</div>
      </div>

      <Block title="Why this entry">{p.entryReason.map((r, i) => <li key={i}>{r}</li>)}</Block>
      <Block title="Why this stop loss"><li>{p.stopReason}</li><li className="text-bear">{p.invalidation}</li></Block>
      <Block title="Take-profit logic">{p.tpReason.map((r, i) => <li key={i}>{r}</li>)}</Block>
      <Block title="Real-time exit rules">{p.exitRules.map((r, i) => <li key={i}>{r}</li>)}</Block>

      <div className="panel p-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Full chart reading {htf ? `· HTF ${htf}` : ""}</div>
        {groups.map((g) => (
          <div key={g} className="mb-3">
            <div className="mb-1 text-xs font-semibold text-primary">{g}</div>
            {a.factors.filter((f) => f.group === g).map((f, i) => (
              <div key={i} className="mb-1.5 flex gap-2 text-xs">
                <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", f.bias === "bull" ? "bg-bull" : f.bias === "bear" ? "bg-bear" : "bg-muted-foreground")} />
                <div><span className="font-semibold">{f.label}</span> <span className="text-muted-foreground">— {f.detail}</span></div>
              </div>
            ))}
          </div>
        ))}
        <div className="mt-2 text-xs font-semibold text-primary">Key levels</div>
        <div className="mt-1 grid grid-cols-2 gap-1 font-mono text-xs">
          {a.levels.sort((x, y) => y.price - x.price).map((l, i) => (
            <div key={i} className={l.kind === "support" ? "text-bull" : "text-bear"}>{l.kind === "support" ? "S" : "R"} {fmtPrice(l.price)} ×{l.touches}</div>
          ))}
        </div>
        <div className="mt-2 text-xs font-semibold text-primary">Fibonacci</div>
        <div className="mt-1 grid grid-cols-3 gap-1 font-mono text-xs text-muted-foreground">
          {a.fib.map((f) => <div key={f.level}>{f.level} · {fmtPrice(f.price)}</div>)}
        </div>
      </div>
    </>
  );
}

function Lvl({ k, v, cls }: { k: string; v: string; cls: string }) {
  return (
    <div className="rounded bg-secondary p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className={cls}>{v}</div>
    </div>
  );
}
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{title}</div>
      <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed">{children}</ul>
    </div>
  );
}
