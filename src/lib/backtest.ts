import type { Candle } from "./market.functions";
import { analyze, type Grade, type TradePlan } from "./analysis";

/**
 * Walk-forward "track record" of the signal engine on the loaded history.
 *
 * At each test bar the engine only sees candles up to and including that bar
 * (no look-ahead). An ACTIVE SETUP is taken; WAIT / NO TRADE are skipped.
 * One trade at a time. Rules mirror the trade ticket:
 *  - Market entries fill at the next bar's open; limit entries must be touched
 *    within `fillBars` bars or the order is cancelled.
 *  - Stop = -1R. Exit style decides how profit is taken (see EXIT_STYLES).
 *  - When one bar touches both stop and a target, the stop is assumed first
 *    (conservative).
 *  - Open trades are closed at market after `maxHold` bars.
 * `costPct` (round-trip fees + spread, % of price) is converted to R per trade
 * and reported separately as `avgNetR` / `totalNetR`.
 */
export type BtTrade = {
  time: number;
  direction: "LONG" | "SHORT";
  entry: number;
  stop: number;
  r: number;
  /** Round-trip cost of this trade expressed in R. */
  costR: number;
  outcome: "stop" | "tp1-be" | "tp2" | "target" | "time";
  bars: number;
};

export type BtResult = {
  trades: BtTrade[];
  signals: number;
  unfilled: number;
  winRate: number;
  avgR: number;
  totalR: number;
  avgNetR: number;
  totalNetR: number;
  profitFactor: number | null;
  maxDrawdownR: number;
  testedBars: number;
};

export type ExitStyle = "split" | "target1" | "r1" | "r05" | "r03";
export type SetupFilter = "all" | "gradeA" | "rr2";

export const EXIT_STYLES: { id: ExitStyle; label: string; short: string }[] = [
  { id: "split", label: "Half at target 1, rest at target 2", short: "Standard" },
  { id: "target1", label: "Everything at target 1", short: "Target 1" },
  { id: "r1", label: "Everything at 1× the risk", short: "1R" },
  { id: "r05", label: "Everything at ½× the risk", short: "½R" },
  { id: "r03", label: "Everything at ⅓× the risk", short: "⅓R" },
];

export const SETUP_FILTERS: { id: SetupFilter; label: string; hint: string }[] = [
  { id: "all", label: "All setups", hint: "Every active setup the engine flags." },
  { id: "gradeA", label: "A-grade only", hint: "Only setups graded A or A+." },
  { id: "rr2", label: "Big target only", hint: "Only setups whose first target is at least 2× the risk." },
];

const FIXED_R: Partial<Record<ExitStyle, number>> = { r1: 1, r05: 0.5, r03: 1 / 3 };

export type BtOptions = {
  window?: number;
  warmup?: number;
  step?: number;
  fillBars?: number;
  maxHold?: number;
  exit?: ExitStyle;
  filter?: SetupFilter;
  /** Round-trip trading cost as % of price (fees + spread). Default 0.05%. */
  costPct?: number;
};

type Sig = { plan: TradePlan; grade: Grade } | null;
type PlanAt = (i: number) => Sig;

function makePlanAt(cs: Candle[], window: number): PlanAt {
  const cache = new Map<number, Sig>();
  return (i) => {
    if (cache.has(i)) return cache.get(i)!;
    let s: Sig = null;
    try {
      const a = analyze(cs.slice(Math.max(0, i + 1 - window), i + 1), null);
      s = { plan: a.plan, grade: a.grade };
    } catch {
      s = null;
    }
    cache.set(i, s);
    return s;
  };
}

export function passesFilter(s: { plan: TradePlan; grade: Grade }, f: SetupFilter): boolean {
  if (f === "gradeA") return s.grade === "A" || s.grade === "A+";
  if (f === "rr2") return s.plan.rr[0] >= 2;
  return true;
}

function run(cs: Candle[], planAt: PlanAt, opts: BtOptions): BtResult {
  const warmup = opts.warmup ?? 120;
  const step = opts.step ?? 2;
  const fillBars = opts.fillBars ?? 8;
  const maxHold = opts.maxHold ?? 60;
  const exit = opts.exit ?? "split";
  const filter = opts.filter ?? "all";
  const costPct = opts.costPct ?? 0.05;
  const trades: BtTrade[] = [];
  let signals = 0;
  let unfilled = 0;
  let testedBars = 0;
  // Last closed bar is cs.length - 2 (the final bar may still be forming).
  const lastSignalBar = cs.length - 3;
  let i = warmup;
  while (i <= lastSignalBar) {
    testedBars++;
    const s = planAt(i);
    if (!s || s.plan.status !== "ACTIVE SETUP" || !passesFilter(s, filter)) {
      i += step;
      continue;
    }
    const p = s.plan;
    signals++;
    const long = p.direction === "LONG";
    if (!(Math.abs(p.entry - p.stop) > 0)) {
      i += step;
      continue;
    }
    let fillIdx = -1;
    let entry = p.entry;
    if (p.entryType === "Market") {
      fillIdx = i + 1;
      entry = cs[i + 1].open;
    } else {
      for (let j = i + 1; j <= Math.min(cs.length - 1, i + fillBars); j++) {
        if (long ? cs[j].low <= p.entry : cs[j].high >= p.entry) {
          fillIdx = j;
          entry = long ? Math.min(p.entry, cs[j].open) : Math.max(p.entry, cs[j].open);
          break;
        }
      }
    }
    if (fillIdx < 0) {
      unfilled++;
      i += step;
      continue;
    }
    const R = Math.abs(entry - p.stop);
    if (!(R > 0) || (long ? entry <= p.stop : entry >= p.stop)) {
      i = fillIdx + 1;
      continue;
    }
    const rOf = (px: number) => (long ? px - entry : entry - px) / R;
    const fixed = FIXED_R[exit];
    const target = fixed != null ? entry + (long ? 1 : -1) * fixed * R : p.tp1;
    let stop = p.stop;
    let banked = 0;
    let half = false;
    let outcome: BtTrade["outcome"] | null = null;
    let r = 0;
    let exitIdx = fillIdx;
    for (let j = fillIdx; j < cs.length; j++) {
      const b = cs[j];
      exitIdx = j;
      if (long ? b.low <= stop : b.high >= stop) {
        r = half ? banked + 0.5 * rOf(stop) : rOf(stop);
        outcome = half ? "tp1-be" : "stop";
        break;
      }
      if (exit === "split") {
        if (!half && (long ? b.high >= p.tp1 : b.low <= p.tp1)) {
          half = true;
          banked = 0.5 * rOf(p.tp1);
          stop = entry;
        }
        if (half && (long ? b.high >= p.tp2 : b.low <= p.tp2)) {
          r = banked + 0.5 * rOf(p.tp2);
          outcome = "tp2";
          break;
        }
      } else if (long ? b.high >= target : b.low <= target) {
        r = rOf(target);
        outcome = "target";
        break;
      }
      if (j - fillIdx >= maxHold) {
        r = half ? banked + 0.5 * rOf(b.close) : rOf(b.close);
        outcome = "time";
        break;
      }
    }
    if (!outcome) break; // still open at the end of the data; not counted
    const costR = (entry * costPct) / 100 / R;
    trades.push({ time: cs[i].time, direction: p.direction, entry, stop: p.stop, r, costR, outcome, bars: exitIdx - fillIdx + 1 });
    i = exitIdx + 1;
  }
  return summarise(trades, signals, unfilled, testedBars);
}

function summarise(trades: BtTrade[], signals: number, unfilled: number, testedBars: number): BtResult {
  const wins = trades.filter((t) => t.r > 0.02);
  const gross = trades.reduce((s, t) => s + Math.max(0, t.r), 0);
  const loss = trades.reduce((s, t) => s + Math.max(0, -t.r), 0);
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const t of trades) {
    eq += t.r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const totalNetR = trades.reduce((s, t) => s + t.r - t.costR, 0);
  const n = trades.length;
  return {
    trades,
    signals,
    unfilled,
    winRate: n ? wins.length / n : 0,
    avgR: n ? eq / n : 0,
    totalR: eq,
    avgNetR: n ? totalNetR / n : 0,
    totalNetR,
    profitFactor: loss > 0 ? gross / loss : gross > 0 ? null : 0,
    maxDrawdownR: dd,
    testedBars,
  };
}

export function backtest(cs: Candle[], opts: BtOptions = {}): BtResult {
  return run(cs, makePlanAt(cs, opts.window ?? 220), opts);
}

export type BtCell = Omit<BtResult, "trades"> & { n: number };
export type BtMatrix = Record<SetupFilter, Record<ExitStyle, BtCell>>;

/**
 * Every setup filter × exit style on the same history. The engine is run once
 * per bar and shared across all combinations, so this costs about the same as
 * a single backtest.
 */
export function backtestMatrix(cs: Candle[], opts: BtOptions = {}): { standard: BtResult; matrix: BtMatrix } {
  const planAt = makePlanAt(cs, opts.window ?? 220);
  const matrix = {} as BtMatrix;
  let standard: BtResult | null = null;
  for (const f of SETUP_FILTERS) {
    matrix[f.id] = {} as Record<ExitStyle, BtCell>;
    for (const e of EXIT_STYLES) {
      const res = run(cs, planAt, { ...opts, filter: f.id, exit: e.id });
      if (f.id === "all" && e.id === "split") standard = res;
      const { trades, ...rest } = res;
      matrix[f.id][e.id] = { ...rest, n: trades.length };
    }
  }
  return { standard: standard!, matrix };
}

/**
 * Win rate needed just to break even for a given reward:risk, before costs.
 * A ⅓R target needs 75% wins merely to break even — high win rates are mostly
 * a function of where profit is taken, not of skill.
 */
export function breakEvenWinRate(rewardR: number, riskR = 1): number {
  return riskR / (riskR + rewardR);
}

/** Position size so that a stop-out loses exactly `riskPct`% of `account`. */
export function positionSize(account: number, riskPct: number, entry: number, stop: number) {
  const perUnit = Math.abs(entry - stop);
  if (!(account > 0) || !(riskPct > 0) || !(perUnit > 0)) return null;
  const riskAmount = (account * riskPct) / 100;
  const units = riskAmount / perUnit;
  return { riskAmount, units, notional: units * entry, leverage: (units * entry) / account };
}
