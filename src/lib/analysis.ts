import type { Candle } from "./market.functions";

/* ---------------- Indicators ---------------- */
export function ema(v: number[], p: number): number[] {
  const k = 2 / (p + 1);
  const out: number[] = [];
  let prev = v[0];
  for (let i = 0; i < v.length; i++) {
    prev = i === 0 ? v[0] : v[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}
export function sma(v: number[], p: number): number[] {
  const out: number[] = [];
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= p) s -= v[i - p];
    out.push(i >= p - 1 ? s / p : NaN);
  }
  return out;
}
function wilder(v: number[], p: number): number[] {
  const out: number[] = [];
  let prev = NaN;
  for (let i = 0; i < v.length; i++) {
    if (i < p - 1) out.push(NaN);
    else if (i === p - 1) {
      prev = v.slice(0, p).reduce((a, b) => a + b, 0) / p;
      out.push(prev);
    } else {
      prev = (prev * (p - 1) + v[i]) / p;
      out.push(prev);
    }
  }
  return out;
}
export function rsi(c: number[], p = 14): number[] {
  const g: number[] = [0], l: number[] = [0];
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g.push(Math.max(d, 0));
    l.push(Math.max(-d, 0));
  }
  const ag = wilder(g, p), al = wilder(l, p);
  return ag.map((x, i) => (al[i] === 0 ? 100 : 100 - 100 / (1 + x / al[i])));
}
export function atr(cs: Candle[], p = 14): number[] {
  const tr = cs.map((c, i) =>
    i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - cs[i - 1].close), Math.abs(c.low - cs[i - 1].close)),
  );
  return wilder(tr, p);
}
export function macd(c: number[]) {
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const line = e12.map((x, i) => x - e26[i]);
  const signal = ema(line, 9);
  return { line, signal, hist: line.map((x, i) => x - signal[i]) };
}
export function bollinger(c: number[], p = 20, m = 2) {
  const mid = sma(c, p);
  const up: number[] = [], lo: number[] = [];
  for (let i = 0; i < c.length; i++) {
    if (i < p - 1) { up.push(NaN); lo.push(NaN); continue; }
    const s = c.slice(i - p + 1, i + 1);
    const sd = Math.sqrt(s.reduce((a, b) => a + (b - mid[i]) ** 2, 0) / p);
    up.push(mid[i] + m * sd);
    lo.push(mid[i] - m * sd);
  }
  return { mid, up, lo };
}
export function adx(cs: Candle[], p = 14) {
  const pdm = [0], ndm = [0], tr = [cs[0].high - cs[0].low];
  for (let i = 1; i < cs.length; i++) {
    const up = cs[i].high - cs[i - 1].high, dn = cs[i - 1].low - cs[i].low;
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(cs[i].high - cs[i].low, Math.abs(cs[i].high - cs[i - 1].close), Math.abs(cs[i].low - cs[i - 1].close)));
  }
  const str = wilder(tr, p), sp = wilder(pdm, p), sn = wilder(ndm, p);
  const pdi = sp.map((x, i) => (100 * x) / str[i]);
  const ndi = sn.map((x, i) => (100 * x) / str[i]);
  const dx = pdi.map((x, i) => (x + ndi[i] === 0 ? 0 : (100 * Math.abs(x - ndi[i])) / (x + ndi[i])));
  const firstValid = dx.findIndex((x) => !Number.isNaN(x));
  const adxTail = wilder(dx.slice(firstValid), p);
  const adxv = [...Array(firstValid).fill(NaN), ...adxTail];
  return { adx: adxv, pdi, ndi };
}

/* ---------------- Structure ---------------- */
export type Pivot = { i: number; time: number; price: number; kind: "H" | "L" };
export function pivots(cs: Candle[], left = 3, right = 3): Pivot[] {
  const out: Pivot[] = [];
  for (let i = left; i < cs.length - right; i++) {
    let isH = true, isL = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (cs[j].high >= cs[i].high) isH = false;
      if (cs[j].low <= cs[i].low) isL = false;
    }
    if (isH) out.push({ i, time: cs[i].time, price: cs[i].high, kind: "H" });
    if (isL) out.push({ i, time: cs[i].time, price: cs[i].low, kind: "L" });
  }
  return out;
}
export type Level = { price: number; touches: number; kind: "support" | "resistance" };
function clusterLevels(ps: Pivot[], tol: number, price: number): Level[] {
  const sorted = [...ps].sort((a, b) => a.price - b.price);
  const groups: { sum: number; n: number }[] = [];
  for (const p of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(p.price - g.sum / g.n) <= tol) { g.sum += p.price; g.n++; }
    else groups.push({ sum: p.price, n: 1 });
  }
  return groups.map((g) => {
    const lv = g.sum / g.n;
    return { price: lv, touches: g.n, kind: lv < price ? "support" : "resistance" } as Level;
  });
}

/* ---------------- Analysis ---------------- */
export type Bias = "bull" | "bear" | "neutral";
export type Factor = { group: string; label: string; detail: string; bias: Bias; weight: number };
export type TradePlan = {
  direction: "LONG" | "SHORT";
  status: "ACTIVE SETUP" | "WAIT FOR CONFIRMATION";
  entryType: "Market" | "Limit (pullback)";
  entry: number;
  entryZone: [number, number];
  stop: number;
  tp1: number; tp2: number; tp3: number;
  trailingStop: number;
  riskPct: number;
  rr: [number, number, number];
  entryReason: string[];
  stopReason: string;
  tpReason: string[];
  exitRules: string[];
  invalidation: string;
};
export type Analysis = {
  price: number;
  atr: number;
  score: number;
  confidence: number;
  verdict: "STRONG BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG SELL";
  regime: string;
  structure: string;
  factors: Factor[];
  levels: Level[];
  fib: { level: number; price: number }[];
  plan: TradePlan;
  indicators: { rsi: number; macdHist: number; adx: number; ema20: number; ema50: number; ema200: number; bbUp: number; bbLo: number };
  series: { ema20: number[]; ema50: number[]; ema200: number[] };
  markers: { time: number; position: "aboveBar" | "belowBar"; text: string; bias: Bias }[];
};

export function trendBias(cs: Candle[]): Bias {
  if (cs.length < 60) return "neutral";
  const c = cs.map((x) => x.close);
  const e20 = ema(c, 20), e50 = ema(c, 50);
  const n = c.length - 1;
  if (c[n] > e50[n] && e20[n] > e50[n]) return "bull";
  if (c[n] < e50[n] && e20[n] < e50[n]) return "bear";
  return "neutral";
}

export function analyze(cs: Candle[], htfBias: Bias | null): Analysis {
  const c = cs.map((x) => x.close);
  const n = cs.length - 1;
  const price = c[n];
  const e20 = ema(c, 20), e50 = ema(c, 50), e200 = ema(c, 200);
  const r = rsi(c), m = macd(c), a = atr(cs), bb = bollinger(c), dmi = adx(cs);
  const A = a[n] || price * 0.01;
  const factors: Factor[] = [];
  const markers: Analysis["markers"] = [];
  const add = (group: string, label: string, detail: string, bias: Bias, weight: number) =>
    factors.push({ group, label, detail, bias, weight });
  const fmt = (x: number) => fmtPrice(x);

  const adxNow = dmi.adx[n] ?? 0;
  const trending = adxNow >= 25;
  const tm = trending ? 1.25 : 0.8; // trend factors weigh more in trends

  // --- Trend
  if (cs.length >= 200) {
    add("Trend", "200 EMA filter", price > e200[n] ? `Price ${fmt(price)} trades above the 200 EMA (${fmt(e200[n])}) — long-term buyers in control.` : `Price ${fmt(price)} trades below the 200 EMA (${fmt(e200[n])}) — long-term sellers in control.`, price > e200[n] ? "bull" : "bear", 2 * tm);
  }
  const e50slope = (e50[n] - e50[Math.max(0, n - 10)]) / A;
  add("Trend", "EMA 20/50 alignment", e20[n] > e50[n] ? `Fast EMA above slow EMA; 50 EMA slope ${e50slope.toFixed(2)} ATR/10 bars.` : `Fast EMA below slow EMA; 50 EMA slope ${e50slope.toFixed(2)} ATR/10 bars.`, e20[n] > e50[n] ? "bull" : "bear", 1.5 * tm);
  add("Trend", "ADX trend strength", trending ? `ADX ${adxNow.toFixed(1)} ≥ 25: a directional trend is in force (+DI ${dmi.pdi[n].toFixed(1)} / −DI ${dmi.ndi[n].toFixed(1)}).` : `ADX ${adxNow.toFixed(1)} < 25: ranging/choppy market — mean-reversion behaviour more likely.`, trending ? (dmi.pdi[n] > dmi.ndi[n] ? "bull" : "bear") : "neutral", trending ? 1 : 0);

  // --- Structure
  const pv = pivots(cs, 3, 3);
  const highs = pv.filter((p) => p.kind === "H");
  const lows = pv.filter((p) => p.kind === "L");
  let structure = "Undefined";
  if (highs.length >= 2 && lows.length >= 2) {
    const [h1, h2] = highs.slice(-2), [l1, l2] = lows.slice(-2);
    const hh = h2.price > h1.price, hl = l2.price > l1.price;
    if (hh && hl) { structure = "Uptrend (HH + HL)"; add("Structure", "Market structure", `Higher high ${fmt(h2.price)} > ${fmt(h1.price)} and higher low ${fmt(l2.price)} > ${fmt(l1.price)}.`, "bull", 2); }
    else if (!hh && !hl) { structure = "Downtrend (LH + LL)"; add("Structure", "Market structure", `Lower high ${fmt(h2.price)} < ${fmt(h1.price)} and lower low ${fmt(l2.price)} < ${fmt(l1.price)}.`, "bear", 2); }
    else { structure = hh ? "Expanding (HH + LL)" : "Contracting (LH + HL)"; add("Structure", "Market structure", `Mixed swings — ${structure.toLowerCase()}; no clean directional structure.`, "neutral", 0); }
    const lastH = highs[highs.length - 1], lastL = lows[lows.length - 1];
    if (price > lastH.price) add("Structure", "Break of structure", `Close ${fmt(price)} broke above the last swing high ${fmt(lastH.price)} — bullish BOS.`, "bull", 1.5);
    else if (price < lastL.price) add("Structure", "Break of structure", `Close ${fmt(price)} broke below the last swing low ${fmt(lastL.price)} — bearish BOS.`, "bear", 1.5);
    for (const p of pv.slice(-12)) markers.push({ time: p.time, position: p.kind === "H" ? "aboveBar" : "belowBar", text: p.kind === "H" ? "SH" : "SL", bias: "neutral" });
  }

  // --- Levels
  const recentPv = pv.filter((p) => p.i > n - 300);
  const levels = clusterLevels(recentPv, A * 0.6, price)
    .filter((l) => l.touches >= 1)
    .sort((x, y) => Math.abs(x.price - price) - Math.abs(y.price - price));
  const supports = levels.filter((l) => l.price < price).sort((x, y) => y.price - x.price);
  const resist = levels.filter((l) => l.price > price).sort((x, y) => x.price - y.price);
  const ns = supports[0], nr = resist[0];
  if (ns && (price - ns.price) < A * 0.75) add("Levels", "At support", `Price is ${((price - ns.price) / A).toFixed(2)} ATR above support ${fmt(ns.price)} (${ns.touches} touch${ns.touches > 1 ? "es" : ""}).`, "bull", 1 + Math.min(ns.touches, 3) * 0.25);
  if (nr && (nr.price - price) < A * 0.75) add("Levels", "At resistance", `Price is ${((nr.price - price) / A).toFixed(2)} ATR below resistance ${fmt(nr.price)} (${nr.touches} touch${nr.touches > 1 ? "es" : ""}).`, "bear", 1 + Math.min(nr.touches, 3) * 0.25);

  // --- Momentum
  const R = r[n];
  if (R >= 70) add("Momentum", "RSI overbought", `RSI ${R.toFixed(1)} — stretched; chasing longs here carries poor risk.`, "bear", 1);
  else if (R <= 30) add("Momentum", "RSI oversold", `RSI ${R.toFixed(1)} — stretched; chasing shorts here carries poor risk.`, "bull", 1);
  else add("Momentum", "RSI regime", `RSI ${R.toFixed(1)} — ${R > 55 ? "bullish momentum zone" : R < 45 ? "bearish momentum zone" : "neutral zone"}.`, R > 55 ? "bull" : R < 45 ? "bear" : "neutral", R > 55 || R < 45 ? 1 : 0);
  const h = m.hist[n], hp = m.hist[n - 1];
  add("Momentum", "MACD histogram", `Histogram ${h > 0 ? "positive" : "negative"} and ${h > hp ? "rising" : "falling"} (${h.toExponential(2)}).`, h > 0 && h > hp ? "bull" : h < 0 && h < hp ? "bear" : "neutral", h > 0 === h > hp ? 1 : 0.3);
  if (m.line[n] > m.signal[n] && m.line[n - 1] <= m.signal[n - 1]) add("Momentum", "MACD cross", "Fresh bullish signal-line crossover on the last bar.", "bull", 1);
  if (m.line[n] < m.signal[n] && m.line[n - 1] >= m.signal[n - 1]) add("Momentum", "MACD cross", "Fresh bearish signal-line crossover on the last bar.", "bear", 1);

  // --- Divergence
  if (lows.length >= 2) {
    const [l1, l2] = lows.slice(-2);
    if (n - l2.i < 25 && l2.price < l1.price && r[l2.i] > r[l1.i]) add("Divergence", "Bullish RSI divergence", `Price made a lower low (${fmt(l2.price)}) while RSI made a higher low (${r[l2.i].toFixed(1)} vs ${r[l1.i].toFixed(1)}) — selling exhaustion.`, "bull", 1.5);
  }
  if (highs.length >= 2) {
    const [h1, h2] = highs.slice(-2);
    if (n - h2.i < 25 && h2.price > h1.price && r[h2.i] < r[h1.i]) add("Divergence", "Bearish RSI divergence", `Price made a higher high (${fmt(h2.price)}) while RSI made a lower high (${r[h2.i].toFixed(1)} vs ${r[h1.i].toFixed(1)}) — buying exhaustion.`, "bear", 1.5);
  }

  // --- Volatility
  if (price > bb.up[n]) add("Volatility", "Bollinger upper break", `Close above upper band (${fmt(bb.up[n])}) — ${trending ? "trend expansion" : "overextension, mean-reversion risk"}.`, trending ? "bull" : "bear", 0.75);
  else if (price < bb.lo[n]) add("Volatility", "Bollinger lower break", `Close below lower band (${fmt(bb.lo[n])}) — ${trending ? "trend expansion" : "overextension, mean-reversion risk"}.`, trending ? "bear" : "bull", 0.75);
  const bw = (bb.up[n] - bb.lo[n]) / bb.mid[n];
  const bwHist = bb.up.slice(-120).map((u, i) => (u - bb.lo.slice(-120)[i]) / bb.mid.slice(-120)[i]).filter((x) => !Number.isNaN(x));
  if (bwHist.length > 20 && bw <= Math.min(...bwHist) * 1.1) add("Volatility", "Bollinger squeeze", "Band width near its 120-bar low — volatility compression, expect an expansion move.", "neutral", 0);

  // --- Candles
  const k = cs[n], kp = cs[n - 1], kpp = cs[n - 2];
  const body = Math.abs(k.close - k.open), range = k.high - k.low || 1e-9;
  const upW = k.high - Math.max(k.close, k.open), loW = Math.min(k.close, k.open) - k.low;
  const atSup = ns && price - ns.price < A, atRes = nr && nr.price - price < A;
  const pat = (label: string, detail: string, bias: Bias, w: number) => {
    add("Price action", label, detail, bias, w);
    markers.push({ time: k.time, position: bias === "bull" ? "belowBar" : "aboveBar", text: label, bias });
  };
  if (k.close > k.open && kp.close < kp.open && k.close >= kp.open && k.open <= kp.close) pat("Bullish engulfing", `Last candle engulfed the prior bearish body${atSup ? " at support" : ""}.`, "bull", atSup ? 1.5 : 0.75);
  else if (k.close < k.open && kp.close > kp.open && k.close <= kp.open && k.open >= kp.close) pat("Bearish engulfing", `Last candle engulfed the prior bullish body${atRes ? " at resistance" : ""}.`, "bear", atRes ? 1.5 : 0.75);
  else if (loW > body * 2 && upW < body && loW / range > 0.55) pat("Hammer / pin bar", `Long lower wick rejection (${((loW / range) * 100).toFixed(0)}% of range)${atSup ? " at support" : ""}.`, "bull", atSup ? 1.25 : 0.5);
  else if (upW > body * 2 && loW < body && upW / range > 0.55) pat("Shooting star", `Long upper wick rejection (${((upW / range) * 100).toFixed(0)}% of range)${atRes ? " at resistance" : ""}.`, "bear", atRes ? 1.25 : 0.5);
  else if (kpp.close < kpp.open && Math.abs(kp.close - kp.open) < (kpp.open - kpp.close) * 0.4 && k.close > (kpp.open + kpp.close) / 2 && k.close > k.open) pat("Morning star", "Three-candle bullish reversal sequence.", "bull", 1.25);
  else if (kpp.close > kpp.open && Math.abs(kp.close - kp.open) < (kpp.close - kpp.open) * 0.4 && k.close < (kpp.open + kpp.close) / 2 && k.close < k.open) pat("Evening star", "Three-candle bearish reversal sequence.", "bear", 1.25);
  else if (body / range < 0.1) add("Price action", "Doji", "Indecision candle — wait for the next close for direction.", "neutral", 0);

  // --- Volume
  const vols = cs.map((x) => x.volume);
  const vAvg = sma(vols, 20)[n];
  if (vAvg > 0 && k.volume > vAvg * 1.5) add("Volume", "Volume surge", `Last bar volume ${(k.volume / vAvg).toFixed(1)}× its 20-bar average on a ${k.close > k.open ? "bullish" : "bearish"} candle — institutional participation.`, k.close > k.open ? "bull" : "bear", 1);

  // --- Higher timeframe
  if (htfBias) add("Multi-timeframe", "Higher-timeframe trend", htfBias === "neutral" ? "Higher timeframe is neutral — lower conviction." : `Higher timeframe trend is ${htfBias === "bull" ? "bullish" : "bearish"}; trading with it improves odds.`, htfBias, htfBias === "neutral" ? 0 : 2);

  // --- Fibonacci on last 100 bars
  const win = cs.slice(-100);
  const hiI = win.reduce((b, x, i) => (x.high > win[b].high ? i : b), 0);
  const loI = win.reduce((b, x, i) => (x.low < win[b].low ? i : b), 0);
  const swingHi = win[hiI].high, swingLo = win[loI].low;
  const upLeg = loI < hiI;
  const fib = [0.236, 0.382, 0.5, 0.618, 0.786].map((f) => ({ level: f, price: upLeg ? swingHi - (swingHi - swingLo) * f : swingLo + (swingHi - swingLo) * f }));
  const golden = fib.find((f) => f.level === 0.618)!, half = fib.find((f) => f.level === 0.5)!;
  const gzLo = Math.min(golden.price, half.price), gzHi = Math.max(golden.price, half.price);
  if (price >= gzLo - A * 0.2 && price <= gzHi + A * 0.2) add("Fibonacci", "Golden pocket", `Price sits in the 0.5–0.618 retracement (${fmt(gzLo)}–${fmt(gzHi)}) of the ${upLeg ? "up" : "down"}-leg.`, upLeg ? "bull" : "bear", 1);

  // --- Score
  const score = factors.reduce((s, f) => s + (f.bias === "bull" ? f.weight : f.bias === "bear" ? -f.weight : 0), 0);
  const total = factors.reduce((s, f) => s + f.weight, 0) || 1;
  const confidence = Math.round((Math.abs(score) / total) * 100);
  const verdict: Analysis["verdict"] = score >= 6 ? "STRONG BUY" : score >= 3 ? "BUY" : score <= -6 ? "STRONG SELL" : score <= -3 ? "SELL" : "NEUTRAL";
  const regime = trending ? `Trending (ADX ${adxNow.toFixed(0)})` : `Ranging (ADX ${adxNow.toFixed(0)})`;

  // --- Trade plan
  const long = score >= 0;
  const dir = long ? 1 : -1;
  const strong = Math.abs(score) >= 3 && confidence >= 35;
  const extended = long ? R >= 70 || price - e20[n] > 2 * A : R <= 30 || e20[n] - price > 2 * A;
  const zoneRef = long ? Math.max(ns?.price ?? -Infinity, e20[n]) : Math.min(nr?.price ?? Infinity, e20[n]);
  const pullback = extended || Math.abs(price - zoneRef) > 1.2 * A;
  const entry = pullback && Number.isFinite(zoneRef) && (long ? zoneRef < price : zoneRef > price) ? zoneRef + dir * 0.1 * A : price;
  const entryZone: [number, number] = [Math.min(entry, entry - dir * 0.3 * A), Math.max(entry, entry - dir * 0.3 * A)];

  const structStop = long
    ? Math.min(...lows.filter((l) => l.price < entry).slice(-1).map((l) => l.price), ns && ns.price < entry ? ns.price : Infinity)
    : Math.max(...highs.filter((l) => l.price > entry).slice(-1).map((l) => l.price), nr && nr.price > entry ? nr.price : -Infinity);
  let stop = Number.isFinite(structStop) ? structStop - dir * 0.5 * A : entry - dir * 1.5 * A;
  let stopReason = Number.isFinite(structStop)
    ? `Anchored to the protective swing ${long ? "low" : "high"} at ${fmt(structStop)} plus a 0.5 ATR buffer to avoid liquidity sweeps.`
    : "No protective swing nearby — volatility stop at 1.5 ATR.";
  const dist = Math.abs(entry - stop);
  if (dist < A) { stop = entry - dir * A; stopReason += " Widened to the 1 ATR minimum so normal noise doesn't stop the trade out."; }
  if (dist > 3 * A) { stop = entry - dir * 3 * A; stopReason += " Capped at 3 ATR to keep risk controlled — reduce position size accordingly."; }
  const risk = Math.abs(entry - stop);

  const targets = (long ? resist.map((l) => l.price).filter((p) => p > entry + risk) : supports.map((l) => l.price).filter((p) => p < entry - risk));
  const tp1 = targets[0] ?? entry + dir * 1.5 * risk;
  const tp2 = targets.find((p) => Math.abs(p - entry) >= 2.5 * risk) ?? entry + dir * 2.5 * risk;
  const ext = upLeg === long ? (long ? swingLo + (swingHi - swingLo) * 1.618 : swingHi - (swingHi - swingLo) * 1.618) : NaN;
  const tp3 = Number.isFinite(ext) && Math.abs(ext - entry) > Math.abs(tp2 - entry) ? ext : entry + dir * 4 * risk;
  const tpReason = [
    targets[0] ? `TP1 at the nearest opposing ${long ? "resistance" : "support"} level ${fmt(tp1)} — first liquidity pool; bank 50% and move stop to breakeven.` : `TP1 at 1.5R (${fmt(tp1)}) — no clean opposing level; secure partial profit.`,
    targets.find((p) => Math.abs(p - entry) >= 2.5 * risk) ? `TP2 at the next major level ${fmt(tp2)} — take another 30%.` : `TP2 at 2.5R (${fmt(tp2)}) measured objective — take another 30%.`,
    Number.isFinite(ext) && Math.abs(ext - entry) > Math.abs(tp2 - entry) ? `TP3 at the 1.618 Fibonacci extension ${fmt(tp3)} — runner, managed with the trailing stop.` : `TP3 at 4R (${fmt(tp3)}) — runner, managed with the trailing stop.`,
  ];

  // Chandelier trailing stop (real-time exit)
  const look = cs.slice(-22);
  const trailingStop = long ? Math.max(...look.map((x) => x.high)) - 3 * A : Math.min(...look.map((x) => x.low)) + 3 * A;

  const supporting = factors.filter((f) => f.bias === (long ? "bull" : "bear")).sort((x, y) => y.weight - x.weight);
  const entryReason = supporting.slice(0, 5).map((f) => `${f.label}: ${f.detail}`);
  if (pullback && entry !== price) entryReason.unshift(`Price is extended from value — wait for a pullback into ${fmt(entryZone[0])}–${fmt(entryZone[1])} (${long ? "support/20 EMA" : "resistance/20 EMA"}) rather than chasing.`);

  const plan: TradePlan = {
    direction: long ? "LONG" : "SHORT",
    status: strong ? "ACTIVE SETUP" : "WAIT FOR CONFIRMATION",
    entryType: entry === price ? "Market" : "Limit (pullback)",
    entry, entryZone, stop, tp1, tp2, tp3, trailingStop,
    riskPct: (risk / entry) * 100,
    rr: [Math.abs(tp1 - entry) / risk, Math.abs(tp2 - entry) / risk, Math.abs(tp3 - entry) / risk],
    entryReason,
    stopReason,
    tpReason,
    exitRules: [
      `Real-time trailing exit (Chandelier 3×ATR): ${fmt(trailingStop)} — exit any remaining position on a close ${long ? "below" : "above"} it.`,
      `After TP1, move stop to breakeven (${fmt(entry)}).`,
      `Exit early on a close ${long ? "below" : "above"} the 20 EMA (${fmt(e20[n])}) combined with a MACD histogram flip.`,
      `Exit early on an opposing engulfing/pin bar at a key level or a ${long ? "bearish" : "bullish"} RSI divergence.`,
    ],
    invalidation: `Setup invalid on a close ${long ? "below" : "above"} ${fmt(stop)}${!strong ? ", or if confluence score stays below ±3" : ""}.`,
  };

  return {
    price, atr: A, score, confidence, verdict, regime, structure, factors,
    levels: [...supports.slice(0, 4), ...resist.slice(0, 4)],
    fib, plan,
    indicators: { rsi: R, macdHist: h, adx: adxNow, ema20: e20[n], ema50: e50[n], ema200: e200[n], bbUp: bb.up[n], bbLo: bb.lo[n] },
    series: { ema20: e20, ema50: e50, ema200: e200 },
    markers,
  };
}

export function decimals(p: number) {
  const a = Math.abs(p);
  return a >= 1000 ? 2 : a >= 10 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : 8;
}
export function fmtPrice(p: number) {
  if (!Number.isFinite(p)) return "—";
  return p.toLocaleString("en-US", { minimumFractionDigits: decimals(p), maximumFractionDigits: decimals(p) });
}
