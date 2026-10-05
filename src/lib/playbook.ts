/**
 * Price-action playbook — the discretionary chart-reading process codified:
 * market stage → area of value → entry trigger → exits (reversals, "MAEE"),
 * market stage → buildup → entry trigger → exits (breakouts, "MBEE"),
 * plus trend quality, stretch from the mean, hidden strength/weakness,
 * ATR exhaustion, market behaviour, volatility cycle and HTF trade management.
 */
import type { Candle } from "./market.functions";
import type { Bias, Factor, Level, Pivot } from "./analysis";

export type Check = { label: string; pass: boolean; detail: string };
export type PlaybookSetup = {
  name: string;
  direction: "LONG" | "SHORT" | null;
  status: "TRIGGERED" | "ARMED" | "ABSENT";
  checks: Check[];
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  note: string;
};
export type StageName = "Accumulation" | "Advancing" | "Distribution" | "Declining" | "Unclear";
export type Playbook = {
  stage: { name: StageName; bias: Bias; detail: string; rangeHi: number | null; rangeLo: number | null };
  trend: { type: "Strong" | "Healthy" | "Weak" | "None"; retrace: number | null; holding: string; tactic: string };
  stretch: { atr: number; overstretched: boolean; detail: string };
  candle: { control: "Buyers" | "Sellers" | "Balanced"; closeLoc: number; relSize: number; detail: string };
  trigger: { name: string; bias: "bull" | "bear"; barsAgo: number } | null;
  maee: PlaybookSetup;
  mbee: PlaybookSetup;
  preBreakout: string | null;
  srHealth: string[];
  hidden: { bias: Bias; detail: string };
  exhaustion: { pct: number; detail: string };
  behaviour: { kind: "Trending" | "Mean-reverting" | "Mixed"; edgeAtr: number; detail: string };
  management: { mode: "Ride the trend" | "Hybrid" | "Capture the swing"; detail: string };
  volCycle: string;
};

type Ctx = {
  cs: Candle[];
  atr: number[];
  e20: number[];
  e50: number[];
  e200: number[];
  highs: Pivot[];
  lows: Pivot[];
  supports: Level[];
  resist: Level[];
  htfBias: Bias | null;
  atrPct: number;
  fmt: (x: number) => string;
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/* ---------------- Candlestick triggers (classic definitions) ---------------- */
function detectTrigger(cs: Candle[], i: number, A: number): { name: string; bias: "bull" | "bear" } | null {
  if (i < 6) return null;
  const k = cs[i],
    p = cs[i - 1],
    pp = cs[i - 2];
  const rng = k.high - k.low || 1e-9;
  const body = Math.abs(k.close - k.open);
  const up = k.high - Math.max(k.open, k.close),
    lo = Math.min(k.open, k.close) - k.low;
  const afterDecline = cs[i - 1].close < cs[i - 6].close;
  const afterAdvance = cs[i - 1].close > cs[i - 6].close;
  const bodyP = Math.abs(p.close - p.open);
  const tol = 0.1 * A;

  if (afterDecline) {
    if (lo >= 2 * Math.max(body, rng * 0.05) && up <= rng * 0.15 && (k.close - k.low) / rng >= 0.75)
      return { name: "Hammer", bias: "bull" };
    if (p.close < p.open && k.close > k.open && k.close >= p.open && k.open <= p.close && body > bodyP)
      return { name: "Bullish engulfing", bias: "bull" };
    if (p.close < p.open && k.close > k.open && k.close > (p.open + p.close) / 2 && k.close < p.open && k.open <= p.close)
      return { name: "Piercing pattern", bias: "bull" };
    const pLo = Math.min(p.open, p.close) - p.low;
    if (pLo > (p.high - p.low) * 0.4 && Math.abs(k.low - p.low) <= tol && k.close > k.open && k.close > p.close)
      return { name: "Tweezer bottom", bias: "bull" };
    if (
      pp.close < pp.open &&
      p.high - p.low < (pp.high - pp.low) * 0.6 &&
      k.close > k.open &&
      k.close > pp.close + (pp.open - pp.close) * 0.5
    )
      return { name: "Morning star", bias: "bull" };
  }
  if (afterAdvance) {
    if (up >= 2 * Math.max(body, rng * 0.05) && lo <= rng * 0.15 && (k.high - k.close) / rng >= 0.75)
      return { name: "Shooting star", bias: "bear" };
    if (p.close > p.open && k.close < k.open && k.close <= p.open && k.open >= p.close && body > bodyP)
      return { name: "Bearish engulfing", bias: "bear" };
    if (p.close > p.open && k.close < k.open && k.close < (p.open + p.close) / 2 && k.close > p.open && k.open >= p.close)
      return { name: "Dark cloud cover", bias: "bear" };
    const pUp = p.high - Math.max(p.open, p.close);
    if (pUp > (p.high - p.low) * 0.4 && Math.abs(k.high - p.high) <= tol && k.close < k.open && k.close < p.close)
      return { name: "Tweezer top", bias: "bear" };
    if (
      pp.close > pp.open &&
      p.high - p.low < (pp.high - pp.low) * 0.6 &&
      k.close < k.open &&
      k.close < pp.close - (pp.close - pp.open) * 0.5
    )
      return { name: "Evening star", bias: "bear" };
  }
  return null;
}

export function priceActionPlaybook(ctx: Ctx): { playbook: Playbook; factors: Factor[] } {
  const { cs, atr, e20, e50, e200, highs, lows, supports, resist, htfBias, atrPct, fmt } = ctx;
  const n = cs.length - 1;
  const price = cs[n].close;
  const A = atr[n] || price * 0.01;
  const factors: Factor[] = [];
  const G = "Price action playbook";
  const add = (label: string, detail: string, bias: Bias, weight: number) =>
    factors.push({ group: G, label, detail, bias, weight });

  /* ---------- 1. Market stage (accumulation / advancing / distribution / declining) ---------- */
  const longMa = cs.length >= 220 ? e200 : e50;
  const maName = cs.length >= 220 ? "200" : "50";
  const slope = (longMa[n] - longMa[Math.max(0, n - 20)]) / A; // ATR per 20 bars
  const win = 40;
  const winHi = Math.max(...cs.slice(-win).map((x) => x.high));
  const winLo = Math.min(...cs.slice(-win).map((x) => x.low));
  let crosses = 0;
  for (let i = n - win + 1; i <= n; i++)
    if (i > 0 && Math.sign(cs[i].close - longMa[i]) !== Math.sign(cs[i - 1].close - longMa[i - 1])) crosses++;
  const L = Math.min(n, 160);
  const prior = (cs[n - win].close - cs[n - L].close) / A;
  const [h1, h2] = highs.slice(-2),
    [l1, l2] = lows.slice(-2);
  const hhhl = !!(h1 && h2 && l1 && l2 && h2.price > h1.price && l2.price > l1.price);
  const lhll = !!(h1 && h2 && l1 && l2 && h2.price < h1.price && l2.price < l1.price);
  const flat = Math.abs(slope) < 0.6;
  const rangey = flat && (crosses >= 2 || (winHi - winLo) / A < 9);

  let stage: Playbook["stage"];
  if (!rangey && price > longMa[n] && slope > 0.3 && hhhl)
    stage = {
      name: "Advancing",
      bias: "bull",
      detail: `Higher highs and lows, price above a rising ${maName} MA (slope +${slope.toFixed(2)} ATR/20 bars). Stage 2 — look only for buying opportunities at areas of value or on breakouts.`,
      rangeHi: null,
      rangeLo: null,
    };
  else if (!rangey && price < longMa[n] && slope < -0.3 && lhll)
    stage = {
      name: "Declining",
      bias: "bear",
      detail: `Lower highs and lows, price below a falling ${maName} MA (slope ${slope.toFixed(2)} ATR/20 bars). Stage 4 — look only for shorting opportunities at areas of value or on breakdowns.`,
      rangeHi: null,
      rangeLo: null,
    };
  else if (rangey && prior < -3)
    stage = {
      name: "Accumulation",
      bias: "neutral",
      detail: `Range ${fmt(winLo)}–${fmt(winHi)} after a ${Math.abs(prior).toFixed(1)} ATR decline; the ${maName} MA is flattening and price whips around it (${crosses} crosses in ${win} bars). Smart money may be accumulating — buy near range lows or on a breakout above ${fmt(winHi)}; a break below ${fmt(winLo)} resumes the downtrend.`,
      rangeHi: winHi,
      rangeLo: winLo,
    };
  else if (rangey && prior > 3)
    stage = {
      name: "Distribution",
      bias: "neutral",
      detail: `Range ${fmt(winLo)}–${fmt(winHi)} after a ${prior.toFixed(1)} ATR advance; the ${maName} MA is flattening and price whips around it (${crosses} crosses in ${win} bars). Smart money may be distributing — sell near range highs or on a breakdown below ${fmt(winLo)}.`,
      rangeHi: winHi,
      rangeLo: winLo,
    };
  else if (price > longMa[n] && slope > 0 && hhhl)
    stage = { name: "Advancing", bias: "bull", detail: `Early/loose uptrend above the ${maName} MA — buy pullbacks only.`, rangeHi: null, rangeLo: null };
  else if (price < longMa[n] && slope < 0 && lhll)
    stage = { name: "Declining", bias: "bear", detail: `Early/loose downtrend below the ${maName} MA — sell rallies only.`, rangeHi: null, rangeLo: null };
  else
    stage = {
      name: "Unclear",
      bias: "neutral",
      detail: "Market structure is not obvious. A professional stays out — there are always cleaner charts. Don't force a read.",
      rangeHi: null,
      rangeLo: null,
    };
  add(
    `Market stage: ${stage.name}`,
    stage.detail,
    stage.bias,
    stage.name === "Advancing" || stage.name === "Declining" ? 1.5 : 0,
  );

  /* ---------- 2. Trend quality: strong / healthy / weak from pullback depth ---------- */
  let trend: Playbook["trend"] = { type: "None", retrace: null, holding: "—", tactic: "No trend to classify." };
  const up = stage.bias === "bull" || (stage.name !== "Declining" && hhhl);
  const down = stage.bias === "bear" || (stage.name !== "Advancing" && lhll);
  if ((up || down) && highs.length && lows.length) {
    const ext = up ? highs[highs.length - 1] : lows[lows.length - 1];
    const legStart = (up ? lows : highs).filter((p) => p.i < ext.i).pop();
    if (legStart) {
      const leg = Math.abs(ext.price - legStart.price);
      const since = cs.slice(ext.i + 1);
      const deepest = since.length ? (up ? Math.min(...since.map((x) => x.low)) : Math.max(...since.map((x) => x.high))) : ext.price;
      // Also consider the retrace that formed the prior pivot (the last completed pullback)
      const prevPull = (up ? lows : highs).filter((p) => p.i > legStart.i && p.i < ext.i).pop();
      const retrace = leg > 0 ? Math.abs(ext.price - deepest) / leg : 0;
      const ref = since.length ? retrace : prevPull ? Math.abs(ext.price - prevPull.price) / leg : 0;
      const di = since.length ? ext.i + 1 + since.findIndex((x) => (up ? x.low : x.high) === deepest) : ext.i;
      const near = (ma: number[]) => Math.abs((up ? cs[di].low : cs[di].high) - ma[di]) < 0.6 * A;
      const holding = near(e20) ? "20 MA" : near(e50) ? "50 MA" : cs.length >= 220 && near(e200) ? "200 MA" : "no MA";
      const type: Playbook["trend"]["type"] = ref <= 0.382 ? "Strong" : ref <= 0.55 ? "Healthy" : "Weak";
      const tactic =
        type === "Strong"
          ? "Pullbacks are shallow (≤38%) and hold the 20 MA — hard to catch; trade breakouts or the pre-breakout entry."
          : type === "Healthy"
            ? "Pullbacks are obvious (≤50%) toward the 50 MA — time entries on a bounce near the 50 MA / previous breakout level."
            : "Pullbacks are deep (≥62%) toward the 200 MA — never buy breakouts here; only enter at the 200 MA or major support.";
      trend = { type, retrace: ref, holding, tactic };
      add(
        `${type} ${up ? "uptrend" : "downtrend"}`,
        `Current pullback ${(ref * 100).toFixed(0)}% of the last leg, reacting at ${holding}. ${tactic}`,
        up ? "bull" : "bear",
        type === "Strong" ? 1.25 : type === "Healthy" ? 1 : 0.25,
      );
    }
  }

  /* ---------- 3. Overstretched from the mean ---------- */
  const stretchAtr = (price - e50[n]) / A;
  const overstretched = (up && stretchAtr > 3) || (down && stretchAtr < -3);
  const stretch = {
    atr: stretchAtr,
    overstretched,
    detail: overstretched
      ? `Price is ${Math.abs(stretchAtr).toFixed(1)} ATR from the 50 MA — overstretched. Don't chase with the trend: the stop would need to sit beyond the 50 MA (poor R) or get shaken out on the reversion. Wait for a pullback toward ${fmt(e50[n])}.`
      : `Price is ${Math.abs(stretchAtr).toFixed(1)} ATR from the 50 MA — within normal distance of the mean.`,
  };
  if (overstretched) add("Overstretched — don't chase", stretch.detail, "neutral", 0);

  /* ---------- 4. Reading the last candle without memorising patterns ---------- */
  const k = cs[n];
  const rng = k.high - k.low || 1e-9;
  const closeLoc = (k.close - k.low) / rng;
  const prevAvg = avg(cs.slice(-11, -1).map((x) => x.high - x.low)) || rng;
  const relSize = rng / prevAvg;
  const control: Playbook["candle"]["control"] = closeLoc >= 0.66 ? "Buyers" : closeLoc <= 0.34 ? "Sellers" : "Balanced";
  const candle = {
    control,
    closeLoc,
    relSize,
    detail: `Closed at ${(closeLoc * 100).toFixed(0)}% of its range → ${control === "Balanced" ? "nobody" : control.toLowerCase()} in control. Size ${relSize.toFixed(1)}× the prior 10 candles → ${relSize >= 2 ? "real conviction behind the move" : relSize >= 1.3 ? "some conviction" : "no special conviction"}.`,
  };
  if (control !== "Balanced")
    add("Who's in control (last candle)", candle.detail, control === "Buyers" ? "bull" : "bear", relSize >= 2 ? 1 : 0.4);

  /* ---------- 5. Entry trigger (last 2 candles) ---------- */
  let trigger: Playbook["trigger"] = null;
  for (let b = 0; b < 2 && !trigger; b++) {
    const t = detectTrigger(cs, n - b, A);
    if (t) trigger = { ...t, barsAgo: b };
  }

  /* ---------- 6. S/R health: frequent re-tests weaken; triangles hint at the break ---------- */
  const srHealth: string[] = [];
  const recent = cs.slice(-50);
  const tests = (lv: number, isSup: boolean) =>
    recent.filter((x) => (isSup ? Math.abs(x.low - lv) < 0.3 * A : Math.abs(x.high - lv) < 0.3 * A)).length;
  const ns = supports[0],
    nr = resist[0];
  if (ns) {
    const t = tests(ns.price, true);
    srHealth.push(
      t >= 4
        ? `Support ${fmt(ns.price)} re-tested ${t}× in 50 bars — buy orders are being used up; more likely to break than hold.`
        : `Support ${fmt(ns.price)} tested ${t}× recently — still has resting demand.`,
    );
    if (t >= 4) add("Support being worn out", srHealth[srHealth.length - 1], "bear", 0.75);
  }
  if (nr) {
    const t = tests(nr.price, false);
    srHealth.push(
      t >= 4
        ? `Resistance ${fmt(nr.price)} re-tested ${t}× in 50 bars — sell orders are being absorbed; more likely to break than hold.`
        : `Resistance ${fmt(nr.price)} tested ${t}× recently — still has resting supply.`,
    );
    if (t >= 4) add("Resistance being worn out", srHealth[srHealth.length - 1], "bull", 0.75);
  }
  const lastLows = lows.slice(-3),
    lastHighs = highs.slice(-3);
  if (
    nr &&
    lastLows.length === 3 &&
    lastLows[1].price > lastLows[0].price &&
    lastLows[2].price > lastLows[1].price &&
    lastHighs.some((h) => Math.abs(h.price - nr.price) < 0.6 * A)
  ) {
    const d = `Higher lows (${lastLows.map((l) => fmt(l.price)).join(" → ")}) pressing into resistance ${fmt(nr.price)} — ascending-triangle pressure: buyers pay up even at resistance. Sign of strength.`;
    srHealth.push(d);
    add("Higher lows into resistance", d, "bull", 1);
  }
  if (
    ns &&
    lastHighs.length === 3 &&
    lastHighs[1].price < lastHighs[0].price &&
    lastHighs[2].price < lastHighs[1].price &&
    lastLows.some((l) => Math.abs(l.price - ns.price) < 0.6 * A)
  ) {
    const d = `Lower highs (${lastHighs.map((h) => fmt(h.price)).join(" → ")}) pressing into support ${fmt(ns.price)} — descending-triangle pressure: sellers accept lower prices even at support. Sign of weakness.`;
    srHealth.push(d);
    add("Lower highs into support", d, "bear", 1);
  }

  /* ---------- 7. MAEE — reversal at an area of value ---------- */
  const wantLong = stage.name === "Advancing" || stage.name === "Accumulation" || (stage.name !== "Declining" && stage.name !== "Distribution" && price > e50[n]);
  const wantShort = stage.name === "Declining" || stage.name === "Distribution" || (!wantLong && price < e50[n]);
  const maeeDir: "LONG" | "SHORT" | null = trigger
    ? trigger.bias === "bull" && wantLong
      ? "LONG"
      : trigger.bias === "bear" && wantShort
        ? "SHORT"
        : null
    : stage.name === "Unclear"
      ? null
      : wantLong
        ? "LONG"
        : wantShort
          ? "SHORT"
          : null;
  const maee: PlaybookSetup = {
    name: "MAEE · reversal at value",
    direction: maeeDir,
    status: "ABSENT",
    checks: [],
    entry: null,
    stop: null,
    target: null,
    rr: null,
    note: "",
  };
  if (maeeDir) {
    const lg = maeeDir === "LONG";
    const recentExt = lg ? Math.min(...cs.slice(-3).map((x) => x.low)) : Math.max(...cs.slice(-3).map((x) => x.high));
    const aov: { name: string; price: number; touches: number }[] = [];
    const lvl = lg ? ns : nr;
    if (lvl && Math.abs(recentExt - lvl.price) < A) aov.push({ name: `${lg ? "support" : "resistance"} ${fmt(lvl.price)}`, price: lvl.price, touches: lvl.touches });
    const maPick = trend.type === "Strong" ? { m: e20, nm: "20 MA" } : trend.type === "Weak" && cs.length >= 220 ? { m: e200, nm: "200 MA" } : { m: e50, nm: "50 MA" };
    if (Math.abs(recentExt - maPick.m[n]) < 0.6 * A) aov.push({ name: `the ${maPick.nm} ${fmt(maPick.m[n])}`, price: maPick.m[n], touches: 0 });
    if (stage.rangeLo != null && lg && Math.abs(recentExt - stage.rangeLo) < A) aov.push({ name: `range low ${fmt(stage.rangeLo)}`, price: stage.rangeLo, touches: 2 });
    if (stage.rangeHi != null && !lg && Math.abs(recentExt - stage.rangeHi) < A) aov.push({ name: `range high ${fmt(stage.rangeHi)}`, price: stage.rangeHi, touches: 2 });
    const atValue = aov.length > 0;
    const trig = trigger && (trigger.bias === "bull") === lg ? trigger : null;

    // Bonus 1: power move into the area (big-bodied candles, little pullback) = liquidity gap
    const pre = cs.slice(n - (trig ? trig.barsAgo : 0) - 6, n - (trig ? trig.barsAgo : 0));
    const dirBars = pre.filter((x) => (lg ? x.close < x.open : x.close > x.open));
    const powerMove = dirBars.length >= 4 && avg(dirBars.map((x) => Math.abs(x.close - x.open))) > 0.7 * A;
    // Bonus 2: strong rejection (range ≥ 1.5 ATR, close near the extreme)
    const tk = trig ? cs[n - trig.barsAgo] : k;
    const tr = tk.high - tk.low || 1e-9;
    const strongRej = tr >= 1.5 * A && (lg ? (tk.close - tk.low) / tr >= 0.7 : (tk.high - tk.close) / tr >= 0.7);
    // Bonus 3: significant area — multi-touch level or 300-bar extreme
    const ext300 = lg ? Math.min(...cs.slice(-300).map((x) => x.low)) : Math.max(...cs.slice(-300).map((x) => x.high));
    const significant = aov.some((a) => a.touches >= 3) || Math.abs(recentExt - ext300) < A;

    const areaEdge = atValue ? (lg ? Math.min(...aov.map((a) => a.price), recentExt) : Math.max(...aov.map((a) => a.price), recentExt)) : recentExt;
    const entry = price;
    const stop = areaEdge - (lg ? 1 : -1) * A;
    const swingTgt = (lg ? highs : lows).filter((p) => (lg ? p.price > entry : p.price < entry)).slice(-3);
    const target = swingTgt.length
      ? lg
        ? Math.min(...swingTgt.map((p) => p.price))
        : Math.max(...swingTgt.map((p) => p.price))
      : entry + (lg ? 2 : -2) * Math.abs(entry - stop);
    const rr = Math.abs(target - entry) / Math.max(1e-9, Math.abs(entry - stop));

    maee.checks = [
      { label: "Market structure", pass: stage.name !== "Unclear", detail: `${stage.name} stage → ${lg ? "buyers' market" : "sellers' market"}.` },
      { label: "Area of value", pass: atValue, detail: atValue ? `Price is reacting at ${aov.map((a) => a.name).join(" + ")}.` : `Not at an area of value yet — wait for ${lg ? "support / the MA below" : "resistance / the MA above"}.` },
      { label: "Entry trigger", pass: !!trig, detail: trig ? `${trig.name} ${trig.barsAgo === 0 ? "on the last candle" : "one candle ago"}.` : `No ${lg ? "bullish" : "bearish"} reversal candle yet (hammer, engulfing, piercing, tweezer, star).` },
      { label: "Power move into value", pass: powerMove, detail: powerMove ? "Big-bodied candles drove into the area with little pullback — a liquidity gap that tends to snap back hard, and the opposite swing is far away (better R)." : "Approach was gradual — weaker snap-back expected." },
      { label: "Strong rejection", pass: strongRej, detail: strongRej ? `Trigger candle range ${(tr / A).toFixed(1)} ATR closing near the ${lg ? "high" : "low"} — decisive rejection.` : "Trigger range under 1.5 ATR or close not at the extreme — weak rejection." },
      { label: "Significant area", pass: significant, detail: significant ? "Multi-touch level or a 300-bar extreme — attracts both breakout and reversal traders, so failed breakouts fuel the reversal." : "Minor level — less fuel for the reversal." },
      { label: "Reward ≥ 1.5R", pass: rr >= 1.5, detail: `Stop 1 ATR beyond the area at ${fmt(stop)}, target nearest swing ${lg ? "high" : "low"} ${fmt(target)} → ${rr.toFixed(1)}R.` },
    ];
    maee.entry = entry;
    maee.stop = stop;
    maee.target = target;
    maee.rr = rr;
    maee.status = stage.name !== "Unclear" && atValue && trig && rr >= 1.2 ? "TRIGGERED" : stage.name !== "Unclear" && atValue ? "ARMED" : "ABSENT";
    const bonus = [powerMove, strongRej, significant].filter(Boolean).length;
    maee.note =
      maee.status === "TRIGGERED"
        ? `${lg ? "Long" : "Short"} reversal is live: structure + value + trigger aligned with ${bonus}/3 quality boosters. Stop 1 ATR beyond the area (not just beyond it — that's where stop hunts happen).`
        : maee.status === "ARMED"
          ? `Price is at value — wait for a ${lg ? "bullish" : "bearish"} reversal candle before entering. No trigger, no trade.`
          : "No reversal setup — price is not at an area of value in the direction of structure.";
    if (maee.status === "TRIGGERED") add(`MAEE ${lg ? "long" : "short"} triggered`, maee.note, lg ? "bull" : "bear", 2 + 0.3 * bonus);
    else if (maee.status === "ARMED") add(`MAEE ${lg ? "long" : "short"} armed`, maee.note, lg ? "bull" : "bear", 0.5);
  } else {
    maee.note =
      stage.name === "Unclear"
        ? "Structure unclear — no reversal trade."
        : trigger
          ? `${trigger.name} printed, but it fights the ${stage.name.toLowerCase()} structure — ignored. Candles are never traded in isolation.`
          : "No reversal setup.";
  }

  /* ---------- 8. MBEE — breakout from a buildup ---------- */
  let box: { hi: number; lo: number; len: number } | null = null;
  for (let len = 20; len >= 5; len--) {
    const seg = cs.slice(n - len, n); // excludes the current bar so a breakout candle can be detected
    const hi = Math.max(...seg.map((x) => x.high)),
      lo = Math.min(...seg.map((x) => x.low));
    if (hi - lo <= 2.2 * A) {
      box = { hi, lo, len };
      break;
    }
  }
  const mbee: PlaybookSetup = {
    name: "MBEE · breakout from buildup",
    direction: null,
    status: "ABSENT",
    checks: [],
    entry: null,
    stop: null,
    target: null,
    rr: null,
    note: "No tight buildup (narrow-range consolidation) in the last 20 candles.",
  };
  let preBreakout: string | null = null;
  if (box) {
    const res = resist.find((r) => r.price >= box!.hi - 0.6 * A);
    const sup = supports.find((s) => s.price <= box!.lo + 0.6 * A);
    const nearRes = (res && Math.abs(res.price - box.hi) < A) || Math.abs(box.hi - winHi) < 0.5 * A;
    const nearSup = (sup && Math.abs(sup.price - box.lo) < A) || Math.abs(box.lo - winLo) < 0.5 * A;
    const lg = stage.bias === "bull" || stage.name === "Accumulation" ? true : stage.bias === "bear" || stage.name === "Distribution" ? false : nearRes && !nearSup ? true : nearSup && !nearRes ? false : price >= e50[n];
    const seg = cs.slice(n - box.len, n);
    const tight = (box.hi - box.lo) / A;
    const segLows = seg.map((x) => x.low),
      segHighs = seg.map((x) => x.high);
    const third = Math.max(1, Math.floor(seg.length / 3));
    const risingLows = Math.min(...segLows.slice(-third)) > Math.min(...segLows.slice(0, third));
    const fallingHighs = Math.max(...segHighs.slice(-third)) < Math.max(...segHighs.slice(0, third));
    const maCaught = lg ? Math.abs(e20[n] - box.lo) < 0.6 * A || (e20[n] > box.lo && e20[n] < box.hi) : Math.abs(e20[n] - box.hi) < 0.6 * A || (e20[n] < box.hi && e20[n] > box.lo);
    const entry = lg ? box.hi + 0.1 * A : box.lo - 0.1 * A;
    const stop = lg ? box.lo - A : box.hi + A;
    const risk = Math.abs(entry - stop);
    const traffic = (lg ? resist : supports).find((l) => (lg ? l.price > entry + 0.2 * A : l.price < entry - 0.2 * A));
    const trafficR = traffic ? Math.abs(traffic.price - entry) / risk : Infinity;
    const target = traffic && trafficR >= 1 ? traffic.price : entry + (lg ? 3 : -3) * risk;
    const rr = Math.abs(target - entry) / risk;
    const broke = lg ? k.close > box.hi : k.close < box.lo;
    mbee.direction = lg ? "LONG" : "SHORT";
    mbee.checks = [
      { label: "Market structure", pass: stage.name !== "Unclear", detail: `${stage.name} stage → favour ${lg ? "upside" : "downside"} breaks.` },
      { label: "Buildup at the level", pass: lg ? !!nearRes : !!nearSup, detail: `${box.len}-candle buildup ${fmt(box.lo)}–${fmt(box.hi)} ${lg ? (nearRes ? "pressing into resistance" : "not at resistance") : nearSup ? "sitting on support" : "not at support"}.` },
      { label: "Tight buildup", pass: tight <= 1.6, detail: `Buildup height ${tight.toFixed(2)} ATR — ${tight <= 1.6 ? "tight, energy stored" : "loose; its own highs/lows act as obstacles"}.` },
      { label: lg ? "Higher lows inside" : "Lower highs inside", pass: lg ? risingLows : fallingHighs, detail: lg ? (risingLows ? "Buyers paying up inside the box — strength." : "Flat lows.") : fallingHighs ? "Sellers accepting lower prices inside the box — weakness." : "Flat highs." },
      { label: "20 MA caught up", pass: maCaught, detail: maCaught ? `20 MA ${fmt(e20[n])} has reached the buildup — the prior move is digested and the stop is doubly protected.` : `20 MA ${fmt(e20[n])} hasn't caught up — buildup may need more time.` },
      { label: "No traffic ahead", pass: trafficR >= 1.5, detail: traffic ? `Next ${lg ? "resistance" : "support"} ${fmt(traffic.price)} is ${trafficR.toFixed(1)}R away${trafficR < 1.5 ? " — trading into traffic, poor R" : " — clear road"}.` : "No opposing level ahead — open road." },
    ];
    mbee.entry = entry;
    mbee.stop = stop;
    mbee.target = target;
    mbee.rr = rr;
    const core = (lg ? nearRes : nearSup) && trafficR >= 1 && stage.name !== "Unclear";
    mbee.status = core && broke ? "TRIGGERED" : core ? "ARMED" : "ABSENT";
    mbee.note =
      mbee.status === "TRIGGERED"
        ? `Breakout confirmed: close ${lg ? "above" : "below"} the buildup. Stop 1 ATR beyond the buildup at ${fmt(stop)}; trail it to ride a possible new trend.`
        : mbee.status === "ARMED"
          ? `Place a ${lg ? "buy" : "sell"} stop order at ${fmt(entry)}. If it isn't triggered, you're on the sidelines — trade what you see, not what you think.`
          : `Buildup present but ${stage.name === "Unclear" ? "structure is unclear" : trafficR < 1 ? "an opposing level sits right in the way" : "it isn't at a key level"} — skip.`;
    if (mbee.status === "TRIGGERED") add(`MBEE ${lg ? "breakout" : "breakdown"} triggered`, mbee.note, lg ? "bull" : "bear", 1.75);
    else if (mbee.status === "ARMED") add(`MBEE ${lg ? "breakout" : "breakdown"} armed`, mbee.note, lg ? "bull" : "bear", 0.5);

    // Pre-breakout: rejection of the buildup's edge — enter before the breakout
    if (mbee.status === "ARMED") {
      const edgeTest = lg ? k.low <= box.lo + 0.3 * A && closeLoc >= 0.6 : k.high >= box.hi - 0.3 * A && closeLoc <= 0.4;
      if (edgeTest) {
        preBreakout = `Price rejected the buildup ${lg ? "low" : "high"} (${fmt(lg ? box.lo : box.hi)}) on the last candle — pre-breakout entry available: ${lg ? "buy" : "sell"} next candle, stop 1 ATR beyond the buildup, trail to catch the breakout.`;
        add("Pre-breakout entry", preBreakout, lg ? "bull" : "bear", 0.75);
      }
    }
  }

  /* ---------- 9. Hidden strength / weakness: trending vs retracement candles ---------- */
  const legStats = (seg: Candle[]) => ({
    bull: avg(seg.filter((x) => x.close > x.open).map((x) => x.high - x.low)),
    bear: avg(seg.filter((x) => x.close < x.open).map((x) => x.high - x.low)),
  });
  const now = legStats(cs.slice(-15)),
    before = legStats(cs.slice(-45, -15));
  let hidden: Playbook["hidden"] = { bias: "neutral", detail: "Trending and retracement candles are in normal proportion." };
  if (up && now.bear > now.bull * 1.15 && now.bear > before.bear * 1.2) {
    hidden = { bias: "bear", detail: `Retracement (down) candles have grown to ${(now.bear / A).toFixed(2)} ATR vs ${(now.bull / A).toFixed(2)} ATR for trend candles — sellers gaining strength inside the uptrend. Hidden weakness; watch for a break of support.` };
    add("Hidden weakness", hidden.detail, "bear", 1);
  } else if (down && now.bull > now.bear * 1.15 && now.bull > before.bull * 1.2) {
    hidden = { bias: "bull", detail: `Retracement (up) candles have grown to ${(now.bull / A).toFixed(2)} ATR vs ${(now.bear / A).toFixed(2)} ATR for trend candles — buyers gaining strength inside the downtrend. Hidden strength; watch for a break of resistance.` };
    add("Hidden strength", hidden.detail, "bull", 1);
  } else if (up && now.bull > now.bear * 1.3)
    hidden = { bias: "bull", detail: "Trend candles clearly larger than retracement candles — healthy, uncontested uptrend." };
  else if (down && now.bear > now.bull * 1.3)
    hidden = { bias: "bear", detail: "Trend candles clearly larger than retracement candles — healthy, uncontested downtrend." };

  /* ---------- 10. ATR exhaustion (how much of the day's "fuel" is used) ---------- */
  const span = cs.length > 1 ? cs[n].time - cs[n - 1].time : 86400;
  let usedPct: number, exDetail: string;
  if (span < 86400) {
    const day = (t: number) => Math.floor(t / 86400);
    const days = new Map<number, { h: number; l: number }>();
    for (const x of cs) {
      const d = day(x.time),
        cur = days.get(d);
      if (cur) {
        cur.h = Math.max(cur.h, x.high);
        cur.l = Math.min(cur.l, x.low);
      } else days.set(d, { h: x.high, l: x.low });
    }
    const arr = [...days.values()];
    const today = arr[arr.length - 1];
    const adr = avg(arr.slice(-21, -1).map((d) => d.h - d.l)) || A;
    usedPct = ((today.h - today.l) / adr) * 100;
    exDetail = `Today's range ${fmt(today.h - today.l)} is ${usedPct.toFixed(0)}% of the 20-day average daily range ${fmt(adr)}.`;
    if (usedPct >= 100) {
      const atHigh = price > today.h - 0.25 * (today.h - today.l);
      const atLow = price < today.l + 0.25 * (today.h - today.l);
      exDetail += ` The day's fuel is spent — ${atHigh ? "chasing longs at the high is low-odds; reversal shorts at resistance are favoured" : atLow ? "chasing shorts at the low is low-odds; reversal longs at support are favoured" : "expect rotation rather than extension"}.`;
      if (atHigh) add("Daily range exhausted (at high)", exDetail, "bear", 0.75);
      if (atLow) add("Daily range exhausted (at low)", exDetail, "bull", 0.75);
    } else exDetail += ` ${(100 - usedPct).toFixed(0)}% of a typical day's movement is still available.`;
  } else {
    usedPct = (rng / A) * 100;
    exDetail = `Current candle range is ${usedPct.toFixed(0)}% of ATR.${usedPct >= 150 ? " Stretched well beyond a normal bar — expect a pause or reversal." : ""}`;
  }
  const exhaustion = { pct: usedPct, detail: exDetail };

  /* ---------- 11. Market behaviour test: trend-following vs mean-reverting ---------- */
  let pos = 0,
    entryPx = 0,
    eq = 0;
  const startB = Math.max(1, n - 300);
  for (let i = startB; i <= n; i++) {
    const p = cs[i - 1],
      x = cs[i];
    if (pos <= 0 && x.high > p.high) {
      if (pos < 0) eq += entryPx - p.high;
      pos = 1;
      entryPx = p.high;
    } else if (pos >= 0 && x.low < p.low) {
      if (pos > 0) eq += p.low - entryPx;
      pos = -1;
      entryPx = p.low;
    }
  }
  eq += pos > 0 ? price - entryPx : pos < 0 ? entryPx - price : 0;
  const edgeAtr = eq / A;
  const behaviour: Playbook["behaviour"] =
    edgeAtr > 3
      ? { kind: "Trending", edgeAtr, detail: `A previous-bar high/low breakout system made +${edgeAtr.toFixed(1)} ATR over the last 300 bars — this market trends on this timeframe. Prefer trailing stops to ride moves.` }
      : edgeAtr < -3
        ? { kind: "Mean-reverting", edgeAtr, detail: `A previous-bar high/low breakout system lost ${edgeAtr.toFixed(1)} ATR over the last 300 bars — this market mean-reverts on this timeframe. Prefer fixed targets (prior swing / prior bar extreme).` }
        : { kind: "Mixed", edgeAtr, detail: `Breakout-system result ${edgeAtr.toFixed(1)} ATR over 300 bars — no strong trending or mean-reverting character. Use the hybrid exit.` };

  /* ---------- 12. Trade management from the higher timeframe ---------- */
  const dirLong = (maee.direction ?? mbee.direction ?? (stage.bias === "bear" ? "SHORT" : "LONG")) === "LONG";
  const htfWith = htfBias === (dirLong ? "bull" : "bear");
  const htfAgainst = htfBias === (dirLong ? "bear" : "bull");
  const management: Playbook["management"] =
    htfWith && behaviour.kind !== "Mean-reverting"
      ? { mode: "Ride the trend", detail: "Higher timeframe trends your way and the market has trending character — hold for size: trail the stop under each swing (or close beyond the 20/50 MA) instead of fixed targets." }
      : htfAgainst || behaviour.kind === "Mean-reverting"
        ? { mode: "Capture the swing", detail: `${htfAgainst ? "Higher timeframe opposes the trade" : "Market is mean-reverting"} — take the whole position off before opposing pressure: at the nearest swing ${dirLong ? "high / resistance" : "low / support"}.` }
        : { mode: "Hybrid", detail: "Mixed context — bank no more than 50% at the first opposing level and trail the rest. If the level breaks you still ride the trend; if not, the banked half pays for it." };

  /* ---------- 13. Volatility cycle ---------- */
  const volCycle =
    atrPct <= 20
      ? `ATR in its ${atrPct.toFixed(0)}th percentile — the market is quiet, and quiet precedes big moves. Pros favour this: tight stops, bigger size for the same risk, 1:5+ potential if volatility expands your way. Look for buildups / pre-breakout entries.`
      : atrPct >= 80
        ? `ATR in its ${atrPct.toFixed(0)}th percentile — the market is loud, and loud tends to go quiet. Stops must be wider (poor R); cut size, and don't expect extension to continue.`
        : `ATR in its ${atrPct.toFixed(0)}th percentile — normal volatility.`;
  if (atrPct <= 20 && box) add("Volatility contraction", volCycle, "neutral", 0);

  return {
    playbook: { stage, trend, stretch, candle, trigger, maee, mbee, preBreakout, srHealth, hidden, exhaustion, behaviour, management, volCycle },
    factors,
  };
}
