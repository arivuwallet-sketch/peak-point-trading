import type { Playbook, PlaybookSetup } from "@/lib/playbook";
import { fmtPrice } from "@/lib/analysis";
import { cn } from "@/lib/utils";

const tone = (b: string) => (b === "bull" ? "text-bull" : b === "bear" ? "text-bear" : "text-muted-foreground");

function StatusPill({ s }: { s: PlaybookSetup["status"] }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wider",
        s === "TRIGGERED"
          ? "border-primary/50 bg-primary/15 text-primary"
          : s === "ARMED"
            ? "border-border bg-secondary text-foreground"
            : "border-border text-muted-foreground",
      )}
    >
      {s}
    </span>
  );
}

function SetupCard({ s }: { s: PlaybookSetup }) {
  const passed = s.checks.filter((c) => c.pass).length;
  return (
    <section className="rounded-md border border-border bg-card/60 p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="eyebrow">{s.name}</div>
        <StatusPill s={s.status} />
      </div>
      <div className="mb-3 flex items-baseline gap-2">
        <span className={cn("serif text-2xl", s.direction === "LONG" ? "text-bull" : s.direction === "SHORT" ? "text-bear" : "text-muted-foreground")}>
          {s.direction ?? "—"}
        </span>
        {s.checks.length > 0 && (
          <span className="font-mono text-xs text-muted-foreground">
            {passed}/{s.checks.length} checks
          </span>
        )}
      </div>
      {s.entry != null && s.stop != null && s.target != null && (
        <div className="mb-3 grid grid-cols-4 gap-2 font-mono text-xs">
          {[
            ["Entry", fmtPrice(s.entry), "text-primary"],
            ["Stop", fmtPrice(s.stop), "text-bear"],
            ["Target", fmtPrice(s.target), "text-bull"],
            ["R", s.rr != null ? `${s.rr.toFixed(1)}R` : "—", "text-foreground"],
          ].map(([k, v, c]) => (
            <div key={k}>
              <div className="eyebrow">{k}</div>
              <div className={cn("mt-0.5 tabular-nums", c)}>{v}</div>
            </div>
          ))}
        </div>
      )}
      <ul className="space-y-1.5">
        {s.checks.map((c) => (
          <li key={c.label} className="flex gap-2 text-[13px] leading-snug">
            <span className={cn("mt-0.5 font-mono text-xs", c.pass ? "text-bull" : "text-muted-foreground")}>
              {c.pass ? "✓" : "○"}
            </span>
            <span>
              <span className="font-semibold">{c.label}</span>
              <span className="text-muted-foreground"> — {c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-border pt-3 text-[13px] text-foreground/90">{s.note}</p>
    </section>
  );
}

export function PlaybookPanel({ pb }: { pb: Playbook }) {
  const tiles: { k: string; v: string; c?: string }[] = [
    { k: "Market stage", v: pb.stage.name, c: tone(pb.stage.bias) },
    { k: "Trend quality", v: pb.trend.type === "None" ? "No trend" : `${pb.trend.type}${pb.trend.retrace != null ? ` · ${(pb.trend.retrace * 100).toFixed(0)}% pullback` : ""}` },
    { k: "Distance from 50 MA", v: `${pb.stretch.atr >= 0 ? "+" : ""}${pb.stretch.atr.toFixed(1)} ATR`, c: pb.stretch.overstretched ? "text-bear" : undefined },
    { k: "Last candle", v: `${pb.candle.control} · ${pb.candle.relSize.toFixed(1)}×`, c: pb.candle.control === "Buyers" ? "text-bull" : pb.candle.control === "Sellers" ? "text-bear" : undefined },
    { k: "Entry trigger", v: pb.trigger ? pb.trigger.name : "None", c: pb.trigger ? tone(pb.trigger.bias) : undefined },
    { k: "Range used", v: `${pb.exhaustion.pct.toFixed(0)}%`, c: pb.exhaustion.pct >= 100 ? "text-bear" : undefined },
    { k: "Character", v: pb.behaviour.kind },
    { k: "Manage as", v: pb.management.mode, c: "text-primary" },
  ];
  const notes: { k: string; v: string }[] = [
    { k: "Market stage", v: pb.stage.detail },
    { k: "Trend quality", v: pb.trend.tactic },
    { k: "Stretch", v: pb.stretch.detail },
    { k: "Candle reading", v: pb.candle.detail },
    ...pb.srHealth.map((v) => ({ k: "Support & resistance", v })),
    { k: "Strength / weakness", v: pb.hidden.detail },
    { k: "Exhaustion", v: pb.exhaustion.detail },
    { k: "Market character", v: pb.behaviour.detail },
    { k: "Trade management", v: pb.management.detail },
    { k: "Volatility cycle", v: pb.volCycle },
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.k} className="bg-card p-3">
            <div className="eyebrow">{t.k}</div>
            <div className={cn("mt-1 font-mono text-sm", t.c)}>{t.v}</div>
          </div>
        ))}
      </div>
      {pb.preBreakout && (
        <div className="rounded-md border border-primary/40 bg-primary/10 p-3 text-[13px]">
          <span className="font-semibold text-primary">Pre-breakout entry · </span>
          {pb.preBreakout}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <SetupCard s={pb.maee} />
        <SetupCard s={pb.mbee} />
      </div>
      <section>
        <div className="eyebrow mb-2 border-b border-border pb-2">The read, step by step</div>
        <ul className="space-y-2.5">
          {notes.map((x, i) => (
            <li key={i} className="grid gap-1 text-[13px] sm:grid-cols-[170px_1fr] sm:gap-4">
              <span className="font-semibold">{x.k}</span>
              <span className="text-foreground/85">{x.v}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
