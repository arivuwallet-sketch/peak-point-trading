import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { lazy, Suspense, useMemo, useState } from "react";
import { getCandles, TIMEFRAMES, type Timeframe } from "@/lib/market.functions";
import { analyze, fmtPrice, trendBias, type Bias } from "@/lib/analysis";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlaybookPanel } from "@/components/PlaybookPanel";

const PriceChart = lazy(() =>
  import("@/components/PriceChart").then((m) => ({ default: m.PriceChart })),
);

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ChartSage — Live Pro Chart Reader for Stocks, Forex, Crypto & Commodities" },
      {
        name: "description",
        content:
          "Live confluence analysis: market structure, S/R, momentum, divergence, Fibonacci and multi-timeframe trend with entry, stop loss, take profit and trailing exit.",
      },
      { property: "og:title", content: "ChartSage — Live Pro Chart Reader" },
      {
        property: "og:description",
        content:
          "Entries, stops, targets and real-time exits with the reasoning behind every level.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const MARKETS: { group: string; items: [string, string][] }[] = [
  {
    group: "Crypto",
    items: [
      ["BTC-USD", "Bitcoin"],
      ["ETH-USD", "Ethereum"],
      ["SOL-USD", "Solana"],
      ["XRP-USD", "XRP"],
    ],
  },
  {
    group: "Forex",
    items: [
      ["EURUSD=X", "EUR/USD"],
      ["GBPUSD=X", "GBP/USD"],
      ["USDJPY=X", "USD/JPY"],
      ["USDINR=X", "USD/INR"],
    ],
  },
  {
    group: "Commodities",
    items: [
      ["GC=F", "Gold"],
      ["SI=F", "Silver"],
      ["CL=F", "Crude Oil"],
      ["NG=F", "Nat Gas"],
    ],
  },
  {
    group: "Stocks",
    items: [
      ["AAPL", "Apple"],
      ["NVDA", "Nvidia"],
      ["TSLA", "Tesla"],
      ["RELIANCE.NS", "Reliance"],
    ],
  },
  {
    group: "Indices",
    items: [
      ["^GSPC", "S&P 500"],
      ["^IXIC", "Nasdaq"],
      ["^NSEI", "Nifty 50"],
      ["^DJI", "Dow"],
    ],
  },
];
const HTF: Record<Timeframe, Timeframe | null> = {
  "1m": "15m",
  "5m": "1h",
  "15m": "4h",
  "1h": "1d",
  "4h": "1d",
  "1d": "1wk",
  "1wk": null,
};

function Index() {
  const [symbol, setSymbol] = useState("BTC-USD");
  const [tf, setTf] = useState<Timeframe>("1h");
  const [custom, setCustom] = useState("");
  const [group, setGroup] = useState("Crypto");
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

  const groupItems = MARKETS.find((g) => g.group === group)?.items ?? [];
  const known = MARKETS.flatMap((g) => g.items).find(([s]) => s === symbol);

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
          <div className="flex items-baseline gap-2">
            <span className="serif text-3xl italic leading-none">ChartSage</span>
            <span className="h-1.5 w-1.5 translate-y-[-2px] rounded-full bg-primary" />
          </div>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {MARKETS.map((g) => (
              <button
                key={g.group}
                onClick={() => setGroup(g.group)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                  group === g.group
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {g.group}
              </button>
            ))}
          </nav>
          <form
            className="ml-auto flex items-center gap-2 rounded-full border border-input bg-secondary py-1 pl-4 pr-1 transition focus-within:border-ring"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) setSymbol(custom.trim().toUpperCase());
            }}
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Search any symbol — MSFT, TCS.NS, AUDUSD=X"
              className="w-64 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground/70"
            />
            <button className="rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground transition hover:brightness-105 active:scale-95">
              Read chart
            </button>
          </form>
        </div>
        {/* Instrument strip */}
        <div className="border-t border-border">
          <div className="mx-auto flex max-w-[1680px] gap-2 overflow-x-auto px-5 py-2">
            {groupItems.map(([s, n]) => (
              <button
                key={s}
                onClick={() => setSymbol(s)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition",
                  symbol === s
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                )}
              >
                <span className="font-semibold">{n}</span>
                <span className="font-mono text-[10px] opacity-70">{s}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1680px] gap-5 px-5 py-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <main className="flex min-w-0 flex-col gap-5">
          {/* Instrument header */}
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <div className="min-w-0">
              <div className="eyebrow mb-1">
                {main.data?.type ?? "Market"} · {symbol}
              </div>
              <h1 className="serif truncate text-5xl leading-none">
                {known?.[1] ?? main.data?.name ?? symbol}
              </h1>
            </div>
            {last && (
              <div className="flex items-end gap-3">
                <div className="font-mono text-4xl font-medium leading-none tabular-nums">
                  {fmtPrice(last.close)}
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 font-mono text-xs font-semibold",
                    chg >= 0 ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear",
                  )}
                >
                  {chg >= 0 ? "▲ +" : "▼ "}
                  {chg.toFixed(2)}%
                </span>
                <span className="pb-1 font-mono text-[10px] uppercase text-muted-foreground">
                  {main.data?.currency}
                </span>
              </div>
            )}
            <div className="ml-auto flex items-center gap-4">
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                <span className="live-dot h-1.5 w-1.5 rounded-full bg-bull" />
                Live · {refresh / 1000}s
              </div>
              <div className="flex rounded-lg border border-border p-0.5">
                {TIMEFRAMES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTf(t)}
                    className={cn(
                      "rounded-md px-3 py-1 font-mono text-xs transition",
                      tf === t
                        ? "bg-primary font-semibold text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="panel h-[600px] overflow-hidden">
            {main.isError ? (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-bear">
                {(main.error as Error).message}. Check the symbol and try again.
              </div>
            ) : !analysis || !main.data ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                <span className="serif text-2xl italic">
                  {main.isLoading ? "Reading the tape…" : "Not enough history to analyze."}
                </span>
              </div>
            ) : (
              <Suspense fallback={null}>
                <PriceChart candles={main.data.candles} analysis={analysis} />
              </Suspense>
            )}
          </div>

          {analysis && <Details a={analysis} htf={htfTf} />}
        </main>

        <aside className="flex flex-col gap-5 xl:sticky xl:top-[124px] xl:h-fit">
          {analysis ? (
            <TradeTicket a={analysis} />
          ) : (
            <div className="panel p-6 text-sm text-muted-foreground">
              The trade plan appears once data loads.
            </div>
          )}
        </aside>
      </div>
      <footer className="mx-auto max-w-[1680px] border-t border-border px-5 py-6 text-xs text-muted-foreground">
        Educational analysis, not financial advice. No method is 100% accurate — always size
        positions so a stop-out is affordable. Free data may be delayed by the exchange.
      </footer>
    </div>
  );
}

type A = ReturnType<typeof analyze>;

function TradeTicket({ a }: { a: A }) {
  const p = a.plan;
  const long = p.direction === "LONG";
  const tone = a.verdict.includes("BUY") ? "bull" : a.verdict.includes("SELL") ? "bear" : "neutral";
  const ladder = [
    { k: "TP3", v: p.tp3, r: p.rr[2], c: "text-bull" },
    { k: "TP2", v: p.tp2, r: p.rr[1], c: "text-bull" },
    { k: "TP1", v: p.tp1, r: p.rr[0], c: "text-bull" },
    { k: "Entry", v: p.entry, r: null, c: "text-primary", sub: p.entryType },
    ...(p.deepEntry != null
      ? [{ k: "Deep limit", v: p.deepEntry, r: null, c: "text-info", sub: "golden pocket / OB" }]
      : []),
    { k: "Trail", v: p.trailingStop, r: null, c: "text-info", sub: "live exit" },
    { k: "Stop", v: p.stop, r: null, c: "text-bear", sub: `${p.riskPct.toFixed(2)}% risk` },
  ].sort((x, y) => (long ? y.v - x.v : x.v - y.v));

  return (
    <>
      <div className="panel overflow-hidden">
        <div
          className={cn(
            "h-1",
            tone === "bull" ? "bg-bull" : tone === "bear" ? "bg-bear" : "bg-primary",
          )}
        />
        <div className="p-5">
          <div className="flex items-center justify-between">
            <span className="eyebrow">The verdict</span>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold",
                a.grade === "A+" || a.grade === "A"
                  ? "bg-primary text-primary-foreground"
                  : a.grade === "B"
                    ? "border border-primary/50 text-primary"
                    : "border border-border text-muted-foreground",
              )}
            >
              Grade {a.grade}
            </span>
          </div>
          <div
            className={cn(
              "serif mt-2 text-5xl leading-[0.95]",
              tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-foreground",
            )}
          >
            {a.verdict.charAt(0) + a.verdict.slice(1).toLowerCase()}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4">
            <Stat k="Confluence" v={`${a.score > 0 ? "+" : ""}${a.score.toFixed(1)}`} />
            <Stat k="Confidence" v={`${a.confidence}%`} />
            <Stat
              k="Status"
              v={p.status === "ACTIVE SETUP" ? "Active" : p.status === "NO TRADE" ? "No trade" : "Wait"}
              cls={
                p.status === "ACTIVE SETUP"
                  ? "text-bull"
                  : p.status === "NO TRADE"
                    ? "text-bear"
                    : "text-primary"
              }
            />
          </div>
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-700",
                a.score >= 0 ? "bg-bull" : "bg-bear",
              )}
              style={{ width: `${Math.min(100, a.confidence)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="panel p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="eyebrow">Trade ticket</span>
          <span
            className={cn(
              "rounded px-2 py-0.5 font-mono text-[11px] font-bold",
              long ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear",
            )}
          >
            {long ? "▲ LONG" : "▼ SHORT"}
          </span>
        </div>
        <ol className="relative">
          <span className="absolute bottom-3 left-[5px] top-3 w-px bg-border" />
          {ladder.map((l) => (
            <li key={l.k} className="relative flex items-center gap-3 py-2">
              <span className={cn("relative z-10 h-[11px] w-[11px] rounded-full border-2 border-card bg-current", l.c)} />
              <div className="flex-1">
                <div className="text-sm font-semibold">{l.k}</div>
                {(l.sub || l.r != null) && (
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {l.r != null ? `${l.r.toFixed(1)}R reward` : l.sub}
                  </div>
                )}
              </div>
              <div className={cn("font-mono text-base font-medium tabular-nums", l.c)}>
                {fmtPrice(l.v)}
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-3 rounded-md bg-secondary px-3 py-2 font-mono text-[11px] text-muted-foreground">
          Entry zone {fmtPrice(p.entryZone[0])} – {fmtPrice(p.entryZone[1])}
        </div>
      </div>

      <div className="panel p-5">
        <Tabs defaultValue="entry">
          <TabsList className="mb-3 grid h-auto w-full grid-cols-5 bg-secondary p-0.5">
            {[
              ["entry", "Entry"],
              ["stop", "Stop"],
              ["tp", "Targets"],
              ["exit", "Exit"],
              ["size", "Size"],
            ].map(([v, l]) => (
              <TabsTrigger key={v} value={v} className="px-1 py-1 text-xs">
                {l}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="entry"><Reasons items={p.entryReason} /></TabsContent>
          <TabsContent value="stop">
            <Reasons items={[p.stopReason]} />
            <p className="mt-3 border-l-2 border-bear pl-3 text-xs text-bear">{p.invalidation}</p>
          </TabsContent>
          <TabsContent value="tp"><Reasons items={p.tpReason} /></TabsContent>
          <TabsContent value="exit"><Reasons items={p.exitRules} /></TabsContent>
          <TabsContent value="size"><Reasons items={[p.sizingNote]} /></TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function Details({ a, htf }: { a: A; htf: Timeframe | null }) {
  const groups = [...new Set(a.factors.map((f) => f.group))];
  const ind: [string, string][] = [
    ["RSI 14", a.indicators.rsi.toFixed(1)],
    [
      "StochRSI",
      Number.isFinite(a.indicators.stochK)
        ? `${a.indicators.stochK.toFixed(0)} / ${a.indicators.stochD.toFixed(0)}`
        : "—",
    ],
    ["ADX 14", a.indicators.adx.toFixed(1)],
    ["CCI 20", Number.isFinite(a.indicators.cci) ? a.indicators.cci.toFixed(0) : "—"],
    [
      "MFI 14",
      a.indicators.mfi != null && Number.isFinite(a.indicators.mfi) ? a.indicators.mfi.toFixed(0) : "—",
    ],
    ["ATR 14", `${fmtPrice(a.atr)} · ${a.indicators.atrPct.toFixed(0)}%ile`],
    ["Regime", a.regime],
    ["Volatility", a.volRegime],
    [
      "Supertrend",
      `${a.indicators.supertrendDir === 1 ? "Up" : "Down"} · ${fmtPrice(a.indicators.supertrend)}`,
    ],
    ["VWAP", a.indicators.vwap != null ? fmtPrice(a.indicators.vwap) : "—"],
    ["Structure", a.structure],
    ["Location", `${a.premium.zone} · ${a.premium.pct.toFixed(0)}%`],
  ];
  return (
    <Tabs defaultValue="playbook" className="panel p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="serif text-3xl">
          The reading{htf && <span className="text-muted-foreground"> · HTF {htf}</span>}
        </h2>
        <TabsList className="bg-secondary p-0.5">
          <TabsTrigger value="playbook" className="text-xs">Playbook</TabsTrigger>
          <TabsTrigger value="reading" className="text-xs">Analysis</TabsTrigger>
          <TabsTrigger value="indicators" className="text-xs">Indicators</TabsTrigger>
          <TabsTrigger value="levels" className="text-xs">Levels</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="playbook">
        <PlaybookPanel pb={a.playbook} />
      </TabsContent>

      <TabsContent value="reading">
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
          {groups.map((g) => (
            <section key={g}>
              <div className="eyebrow mb-2 border-b border-border pb-2">{g}</div>
              <ul className="space-y-2.5">
                {a.factors
                  .filter((f) => f.group === g)
                  .map((f, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span
                        className={cn(
                          "mt-0.5 shrink-0 font-mono text-xs",
                          f.bias === "bull" ? "text-bull" : f.bias === "bear" ? "text-bear" : "text-muted-foreground",
                        )}
                      >
                        {f.bias === "bull" ? "▲" : f.bias === "bear" ? "▼" : "●"}
                      </span>
                      <div>
                        <span className="font-semibold">{f.label}</span>
                        <span className="text-muted-foreground"> — {f.detail}</span>
                      </div>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="indicators">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 lg:grid-cols-4">
          {ind.map(([k, v]) => (
            <div key={k} className="bg-card p-4">
              <div className="eyebrow">{k}</div>
              <div className="mt-1 font-mono text-base">{v}</div>
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="levels">
        <div className="grid gap-6 md:grid-cols-2">
          <LevelList
            title="Support & resistance"
            rows={[...a.levels]
              .sort((x, y) => y.price - x.price)
              .map((l) => ({
                k: l.kind === "support" ? "Support" : "Resistance",
                v: `${fmtPrice(l.price)}  ×${l.touches}`,
                c: l.kind === "support" ? "text-bull" : "text-bear",
              }))}
          />
          <LevelList
            title="Fibonacci retracement"
            rows={a.fib.map((f) => ({ k: String(f.level), v: fmtPrice(f.price), c: "text-foreground" }))}
          />
          {a.profile && (
            <LevelList
              title="Volume profile · 150 bars"
              rows={[
                { k: "Value area high", v: fmtPrice(a.profile.vah), c: "text-foreground" },
                { k: "Point of control", v: fmtPrice(a.profile.poc), c: "text-primary" },
                { k: "Value area low", v: fmtPrice(a.profile.val), c: "text-foreground" },
              ]}
            />
          )}
          {a.pools.length > 0 && (
            <LevelList
              title="Liquidity pools (resting stops)"
              rows={a.pools.map((pl) => ({
                k: pl.kind === "equal-highs" ? "Buy-side (BSL)" : "Sell-side (SSL)",
                v: `${fmtPrice(pl.price)}  ×${pl.touches}`,
                c: pl.kind === "equal-highs" ? "text-bull" : "text-bear",
              }))}
            />
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}

function LevelList({ title, rows }: { title: string; rows: { k: string; v: string; c: string }[] }) {
  return (
    <section>
      <div className="eyebrow mb-2 border-b border-border pb-2">{title}</div>
      <ul>
        {rows.map((r, i) => (
          <li key={i} className="flex justify-between border-b border-border/50 py-1.5 text-sm last:border-0">
            <span className="text-muted-foreground">{r.k}</span>
            <span className={cn("whitespace-pre font-mono tabular-nums", r.c)}>{r.v}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <div>
      <div className="eyebrow">{k}</div>
      <div className={cn("mt-0.5 font-mono text-lg font-medium", cls)}>{v}</div>
    </div>
  );
}

function Reasons({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((r, i) => (
        <li key={i} className="flex gap-3 text-[13px] leading-relaxed">
          <span className="font-mono text-[11px] text-primary">{String(i + 1).padStart(2, "0")}</span>
          <span className="text-foreground/90">{r}</span>
        </li>
      ))}
    </ol>
  );
}
