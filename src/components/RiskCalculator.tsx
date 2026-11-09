import { useEffect, useState } from "react";
import { positionSize } from "@/lib/backtest";
import { fmtPrice } from "@/lib/analysis";

const KEY = "chartsage:risk";

function fmtMoney(v: number, currency?: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(v);
  } catch {
    return v.toFixed(2);
  }
}
function fmtUnits(u: number) {
  return u >= 100 ? u.toFixed(0) : u >= 1 ? u.toFixed(2) : u.toPrecision(3);
}

export function RiskCalculator({ entry, stop, tp1, tp2, currency }: { entry: number; stop: number; tp1: number; tp2: number; currency?: string | undefined }) {
  const [account, setAccount] = useState("10000");
  const [risk, setRisk] = useState("1");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as { account?: string; risk?: string } | null;
      if (saved?.account) setAccount(saved.account);
      if (saved?.risk) setRisk(saved.risk);
    } catch {
      /* ignore bad saved values */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ account, risk }));
    } catch {
      /* storage unavailable */
    }
  }, [account, risk]);

  const acc = Number(account);
  const rp = Number(risk);
  const s = positionSize(acc, rp, entry, stop);
  const units = s?.units ?? 0;
  const gain = (px: number) => units * Math.abs(px - entry);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Account ({currency || "USD"})
          <input inputMode="decimal" value={account} onChange={(e) => setAccount(e.target.value.replace(/[^0-9.]/g, ""))} className="rounded-md border border-border bg-secondary px-2 py-1.5 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Risk per trade (%)
          <input inputMode="decimal" value={risk} onChange={(e) => setRisk(e.target.value.replace(/[^0-9.]/g, ""))} className="rounded-md border border-border bg-secondary px-2 py-1.5 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </label>
      </div>
      {rp > 3 && <p role="alert" className="text-xs text-bear">Above 3% per trade, a normal losing streak can cut the account deeply. Most pros risk 0.5–2%.</p>}
      {s ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-xs">
          <dt className="text-muted-foreground">Position size</dt>
          <dd className="text-right text-base tabular-nums">{fmtUnits(s.units)} units</dd>
          <dt className="text-muted-foreground">Position value</dt>
          <dd className="text-right tabular-nums">{fmtMoney(s.notional, currency)}{s.leverage > 1 ? ` · ${s.leverage.toFixed(1)}× leverage` : ""}</dd>
          <dt className="text-muted-foreground">Loss if stopped at {fmtPrice(stop)}</dt>
          <dd className="text-right tabular-nums text-bear">−{fmtMoney(s.riskAmount, currency)}</dd>
          <dt className="text-muted-foreground">Gain at target 1</dt>
          <dd className="text-right tabular-nums text-bull">+{fmtMoney(gain(tp1), currency)}</dd>
          <dt className="text-muted-foreground">Gain at target 2</dt>
          <dd className="text-right tabular-nums text-bull">+{fmtMoney(gain(tp2), currency)}</dd>
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">Enter an account size and a risk % above zero.</p>
      )}
    </div>
  );
}
