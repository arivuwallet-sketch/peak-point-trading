import type { Candle } from "./market.functions";
import {
  ema,
  rsi,
  stochRsi,
  macd,
  cci,
  atr,
  atrPercentile,
  bollinger,
  keltner,
  adx,
  efficiencyRatio,
  linReg,
  supertrend,
  ichimoku,
  vwap,
  obv,
  mfi,
  volumeProfile,
  diverged,
} from "./indicators";
import {
  fairValueGaps,
  orderBlocks,
  supplyDemand,
  liquiditySweeps,
  liquidityPools,
  dealingRange,
  orderFlow,
  inZone,
  type Zone,
  type Pool,
} from "./smc";

// Back-compat re-exports (older imports of indicator math from this module keep working).
export { ema, sma, rsi, atr, macd, bollinger, adx } from "./indicators";

/* ---------------- Structure ---------------- */
export type Pivot = { i: number; time: number; price: number; kind: "H" | "L" };
export function pivots(cs: Candle[], left = 3, right = 3): Pivot[] {
  const out: Pivot[] = [];
  for (let i = left; i < cs.length - right; i++) {
    let isH = true,
      isL = true;
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
    if (g && Math.abs(p.price - g.sum / g.n) <= tol) {
      g.sum += p.price;
      g.n++;
    } else groups.push({ sum: p.price, n: 1 });
  }
  return groups.map((g) => {
    const lv = g.sum / g.n;
    return { price: lv, touches: g.n, kind: lv < price ? "support" : "resistance" } as Level;
  });
}

/* ---------------- Types ---------------- */
export type Bias = "bull" | "bear" | "neutral";
export type Factor = { group: string; label: string; detail: string; bias: Bias; weight: number };
export type Grade = "A+" | "A" | "B" | "C" | "D";
export type TradePlan = {
  direction: "LONG" | "SHORT";
  status: "ACTIVE SETUP" | "WAIT FOR CONFIRMATION" | "NO TRADE";
  entryType: "Market" | "Limit (pullback)" | "Limit (deep pullback)";
  entry: number;
  entryZone: [number, number];
  deepEntry: number | null;
  stop: number;
  tp1: number;
  tp2: number;
  tp3: number;
  trailingStop: number;
  riskPct: number;
  rr: [number, number, number];
  entryReason: string[];
  stopReason: string;
  tpReason: string[];
  exitRules: string[];
  sizingNote: string;
  timeStop: string;
  invalidation: string;
};
export type Analysis = {
  price: number;
  atr: number;
  score: number;
  confidence: number;
  grade: Grade;
  verdict: "STRONG BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG SELL";
  regime: string;
  volRegime: string;
  structure: string;
  premium: {
    zone: "premium" | "discount" | "equilibrium";
    pct: number;
    hi: number;
    lo: number;
    eq: number;
  };
  profile: { poc: number; vah: number; val: number } | null;
  pools: Pool[];
  factors: Factor[];
  levels: Level[];
  fib: { level: number; price: number }[];
  plan: TradePlan;
  indicators: {
    rsi: number;
    stochK: number;
    stochD: number;
    macdHist: number;
    adx: number;
    cci: number;
    mfi: number | null;
    ema20: number;
    ema50: number;
    ema200: number;
    bbUp: number;
    bbLo: number;
    vwap: number | null;
    supertrend: number;
    supertrendDir: 1 | -1;
    tenkan: number;
    kijun: number;
    er: number;
    atrPct: number;
  };
  series: {
    ema20: number[];
    ema50: number[];
    ema200: number[];
    vwap: number[];
    supertrend: number[];
  };
  markers: { time: number; position: "aboveBar" | "belowBar"; text: string; bias: Bias }[];
  zones: Zone[];
};

export function trendBias(cs: Candle[]): Bias {
  if (cs.length < 60) return "neutral";
  const c = cs.map((x) => x.close);
  const e20 = ema(c, 20),
    e50 = ema(c, 50);
  const n = c.length - 1;
  if (c[n] > e50[n] && e20[n] > e50[n]) return "bull";
  if (c[n] < e50[n] && e20[n] < e50[n]) return "bear";
  return "neutral";
}

/* ---------------- Main engine ---------------- */
export function analyze(cs: Candle[], htfBias: Bias | null): Analysis {
  const c = cs.map((x) => x.close);
  const n = cs.length - 1;
  const price = c[n];

  // Indicator stack
  const e20 = ema(c, 20),
    e50 = ema(c, 50),
    e200 = ema(c, 200);
  const r = rsi(c),
    stoch = stochRsi(c),
    m = macd(c),
    cciV = cci(cs);
  const a = atr(cs),
    bb = bollinger(c),
    kc = keltner(cs),
    dmi = adx(cs);
  const er = efficiencyRatio(c),
    lr = linReg(c, 30),
    st = supertrend(cs),
    ichi = ichimoku(cs);
  const vw = vwap(cs),
    obvV = obv(cs),
    mfiV = mfi(cs);
  const A = a[n] || price * 0.01;
  const atrPct = atrPercentile(a);
  const hasVol = cs.slice(-50).filter((x) => x.volume > 0).length > 40;

  const factors: Factor[] = [];
  const markers: Analysis["markers"] = [];
  const add = (group: string, label: string, detail: string, bias: Bias, weight: number) =>
    factors.push({ group, label, detail, bias, weight });
  const fmt = (x: number) => fmtPrice(x);

  /* ----- Regime detection: ADX + efficiency ratio + regression quality ----- */
  const adxNow = dmi.adx[n] ?? 0;
  const erNow = Number.isFinite(er[n]) ? er[n] : 0;
  const trending = adxNow >= 22 && erNow >= 0.25;
  const strongTrend = adxNow >= 35;
  const tm = strongTrend ? 1.4 : trending ? 1.2 : 0.75; // trend factors weigh more in trends
  const rm = trending ? 0.7 : 1.2; // mean-reversion factors weigh more in ranges

  /* ----- Trend ----- */
  if (cs.length >= 200) {
    add(
      "Trend",
      "200 EMA filter",
      price > e200[n]
        ? `Price ${fmt(price)} trades above the 200 EMA (${fmt(e200[n])}) — long-term buyers in control.`
        : `Price ${fmt(price)} trades below the 200 EMA (${fmt(e200[n])}) — long-term sellers in control.`,
      price > e200[n] ? "bull" : "bear",
      2 * tm,
    );
    if (Math.abs(price - e200[n]) < 0.5 * A)
      add(
        "Trend",
        "200 EMA battleground",
        `Price is within 0.5 ATR of the 200 EMA (${fmt(e200[n])}) — institutional line in the sand; expect a fight, reduce conviction.`,
        "neutral",
        0,
      );
  }
  const e50slope = (e50[n] - e50[Math.max(0, n - 10)]) / A;
  add(
    "Trend",
    "EMA 20/50 alignment",
    e20[n] > e50[n]
      ? `Fast EMA above slow EMA; 50 EMA slope ${e50slope.toFixed(2)} ATR/10 bars.`
      : `Fast EMA below slow EMA; 50 EMA slope ${e50slope.toFixed(2)} ATR/10 bars.`,
    e20[n] > e50[n] ? "bull" : "bear",
    1.5 * tm,
  );
  add(
    "Trend",
    "ADX + efficiency regime",
    trending
      ? `ADX ${adxNow.toFixed(1)} and efficiency ratio ${erNow.toFixed(2)} confirm a directional trend (+DI ${dmi.pdi[n].toFixed(1)} / −DI ${dmi.ndi[n].toFixed(1)}). Trend-following tactics favoured.`
      : `ADX ${adxNow.toFixed(1)} with efficiency ratio ${erNow.toFixed(2)} — ranging/noisy tape. Mean-reversion tactics favoured; trend signals discounted.`,
    trending ? (dmi.pdi[n] > dmi.ndi[n] ? "bull" : "bear") : "neutral",
    trending ? 1.25 : 0,
  );
  add(
    "Trend",
    "Regression trend quality",
    `30-bar regression slope ${lr.slope >= 0 ? "+" : ""}${(lr.slope / A).toFixed(2)} ATR/bar with R² ${lr.r2.toFixed(2)} — ${lr.r2 > 0.5 ? "clean, persistent move" : lr.r2 > 0.25 ? "noisy but directional" : "no statistically meaningful trend"}.`,
    lr.r2 > 0.35 ? (lr.slope > 0 ? "bull" : "bear") : "neutral",
    lr.r2 > 0.35 ? 1.25 * tm : 0,
  );
  const stDir = st.dir[n] as 1 | -1;
  add(
    "Trend",
    "Supertrend",
    `Price ${stDir === 1 ? "above" : "below"} the supertrend line ${fmt(st.line[n])} — trailing trend state is ${stDir === 1 ? "up" : "down"}.`,
    stDir === 1 ? "bull" : "bear",
    1.25 * tm,
  );
  if (n >= 1 && st.dir[n] !== st.dir[n - 1])
    add(
      "Trend",
      "Supertrend flip",
      `Supertrend just flipped ${stDir === 1 ? "bullish" : "bearish"} on the last bar — early trend-change signal.`,
      stDir === 1 ? "bull" : "bear",
      1.5,
    );

  // Ichimoku
  const t = ichi.tenkan[n],
    kj = ichi.kijun[n],
    sa = ichi.spanA[n],
    sb = ichi.spanB[n];
  if (Number.isFinite(sa) && Number.isFinite(sb)) {
    const cloudTop = Math.max(sa, sb),
      cloudBot = Math.min(sa, sb);
    add(
      "Trend",
      "Ichimoku cloud",
      price > cloudTop
        ? `Price above the cloud (${fmt(cloudBot)}–${fmt(cloudTop)}) — full bullish posture.`
        : price < cloudBot
          ? `Price below the cloud (${fmt(cloudBot)}–${fmt(cloudTop)}) — full bearish posture.`
          : `Price inside the cloud (${fmt(cloudBot)}–${fmt(cloudTop)}) — transition zone, signals unreliable here.`,
      price > cloudTop ? "bull" : price < cloudBot ? "bear" : "neutral",
      price > cloudTop || price < cloudBot ? 1.25 * tm : 0,
    );
    if (
      Number.isFinite(t) &&
      Number.isFinite(kj) &&
      Number.isFinite(ichi.tenkan[n - 1]) &&
      Number.isFinite(ichi.kijun[n - 1])
    ) {
      if (t > kj && ichi.tenkan[n - 1] <= ichi.kijun[n - 1])
        add(
          "Momentum",
          "Tenkan/Kijun cross",
          "Fresh bullish TK cross — medium-term momentum turning up.",
          "bull",
          1,
        );
      if (t < kj && ichi.tenkan[n - 1] >= ichi.kijun[n - 1])
        add(
          "Momentum",
          "Tenkan/Kijun cross",
          "Fresh bearish TK cross — medium-term momentum turning down.",
          "bear",
          1,
        );
    }
  }

  /* ----- Structure: swings, BOS, CHoCH, trendlines, push count ----- */
  const pv = pivots(cs, 3, 3);
  const highs = pv.filter((p) => p.kind === "H");
  const lows = pv.filter((p) => p.kind === "L");
  let structure = "Undefined";
  let structDir: Bias = "neutral";
  if (highs.length >= 2 && lows.length >= 2) {
    const [h1, h2] = highs.slice(-2),
      [l1, l2] = lows.slice(-2);
    const hh = h2.price > h1.price,
      hl = l2.price > l1.price;
    if (hh && hl) {
      structure = "Uptrend (HH + HL)";
      structDir = "bull";
      add(
        "Structure",
        "Market structure",
        `Higher high ${fmt(h2.price)} > ${fmt(h1.price)} and higher low ${fmt(l2.price)} > ${fmt(l1.price)}.`,
        "bull",
        2,
      );
    } else if (!hh && !hl) {
      structure = "Downtrend (LH + LL)";
      structDir = "bear";
      add(
        "Structure",
        "Market structure",
        `Lower high ${fmt(h2.price)} < ${fmt(h1.price)} and lower low ${fmt(l2.price)} < ${fmt(l1.price)}.`,
        "bear",
        2,
      );
    } else {
      structure = hh ? "Expanding (HH + LL)" : "Contracting (LH + HL)";
      add(
        "Structure",
        "Market structure",
        `Mixed swings — ${structure.toLowerCase()}; no clean directional structure.`,
        "neutral",
        0,
      );
    }

    const lastH = highs[highs.length - 1],
      lastL = lows[lows.length - 1];
    if (price > lastH.price) {
      add(
        "Structure",
        "Break of structure",
        `Close ${fmt(price)} broke above the last swing high ${fmt(lastH.price)} — bullish BOS, continuation with the prevailing trend.`,
        "bull",
        1.5,
      );
      markers.push({ time: cs[n].time, position: "belowBar", text: "BOS", bias: "bull" });
    } else if (price < lastL.price) {
      add(
        "Structure",
        "Break of structure",
        `Close ${fmt(price)} broke below the last swing low ${fmt(lastL.price)} — bearish BOS, continuation with the prevailing trend.`,
        "bear",
        1.5,
      );
      markers.push({ time: cs[n].time, position: "aboveBar", text: "BOS", bias: "bear" });
    }
    // CHoCH: break AGAINST established structure — first sign of reversal
    if (structDir === "bull" && price < lastL.price && c[n - 1] >= lastL.price) {
      add(
        "Structure",
        "Change of character",
        "Uptrend's last higher low just broke — CHoCH bearish, the first objective sign of a trend reversal.",
        "bear",
        2,
      );
      markers.push({ time: cs[n].time, position: "aboveBar", text: "CHoCH", bias: "bear" });
    } else if (structDir === "bear" && price > lastH.price && c[n - 1] <= lastH.price) {
      add(
        "Structure",
        "Change of character",
        "Downtrend's last lower high just broke — CHoCH bullish, the first objective sign of a trend reversal.",
        "bull",
        2,
      );
      markers.push({ time: cs[n].time, position: "belowBar", text: "CHoCH", bias: "bull" });
    }

    // Push count: consecutive ascending highs / descending lows → exhaustion gauge
    let pushes = 1;
    for (let i = highs.length - 1; i > 0; i--) {
      if (highs[i].price > highs[i - 1].price) pushes++;
      else break;
    }
    let drops = 1;
    for (let i = lows.length - 1; i > 0; i--) {
      if (lows[i].price < lows[i - 1].price) drops++;
      else break;
    }
    if (structDir === "bull" && pushes >= 3)
      add(
        "Structure",
        "Late-stage trend",
        `${pushes} consecutive higher highs without a reset — ${pushes >= 4 ? "very " : ""}extended; reward-to-risk on fresh longs deteriorates.`,
        "bear",
        pushes >= 4 ? 1.25 : 0.75,
      );
    if (structDir === "bear" && drops >= 3)
      add(
        "Structure",
        "Late-stage trend",
        `${drops} consecutive lower lows without a reset — ${drops >= 4 ? "very " : ""}extended; reward-to-risk on fresh shorts deteriorates.`,
        "bull",
        drops >= 4 ? 1.25 : 0.75,
      );

    // Trendline from the last two structural swings
    if (structDir === "bull" && lows.length >= 2) {
      const [p1, p2] = lows.slice(-2);
      const slope = (p2.price - p1.price) / (p2.i - p1.i);
      const lineNow = p2.price + slope * (n - p2.i);
      if (slope > 0 && Math.abs(price - lineNow) < 0.5 * A && price >= lineNow)
        add(
          "Structure",
          "Bull trendline hold",
          `Price is holding the trendline through the last two swing lows (projected ${fmt(lineNow)}) — dynamic support.`,
          "bull",
          1,
        );
    } else if (structDir === "bear" && highs.length >= 2) {
      const [p1, p2] = highs.slice(-2);
      const slope = (p2.price - p1.price) / (p2.i - p1.i);
      const lineNow = p2.price + slope * (n - p2.i);
      if (slope < 0 && Math.abs(price - lineNow) < 0.5 * A && price <= lineNow)
        add(
          "Structure",
          "Bear trendline hold",
          `Price is capped by the trendline through the last two swing highs (projected ${fmt(lineNow)}) — dynamic resistance.`,
          "bear",
          1,
        );
    }

    for (const p of pv.slice(-12))
      markers.push({
        time: p.time,
        position: p.kind === "H" ? "aboveBar" : "belowBar",
        text: p.kind === "H" ? "SH" : "SL",
        bias: "neutral",
      });
  }

  /* ----- Levels ----- */
  const recentPv = pv.filter((p) => p.i > n - 300);
  const levels = clusterLevels(recentPv, A * 0.6, price)
    .filter((l) => l.touches >= 1)
    .sort((x, y) => Math.abs(x.price - price) - Math.abs(y.price - price));
  const supports = levels.filter((l) => l.price < price).sort((x, y) => y.price - x.price);
  const resist = levels.filter((l) => l.price > price).sort((x, y) => x.price - y.price);
  const ns = supports[0],
    nr = resist[0];
  if (ns && price - ns.price < A * 0.75)
    add(
      "Levels",
      "At support",
      `Price is ${((price - ns.price) / A).toFixed(2)} ATR above support ${fmt(ns.price)} (${ns.touches} touch${ns.touches > 1 ? "es" : ""}).`,
      "bull",
      (1 + Math.min(ns.touches, 3) * 0.25) * rm,
    );
  if (nr && nr.price - price < A * 0.75)
    add(
      "Levels",
      "At resistance",
      `Price is ${((nr.price - price) / A).toFixed(2)} ATR below resistance ${fmt(nr.price)} (${nr.touches} touch${nr.touches > 1 ? "es" : ""}).`,
      "bear",
      (1 + Math.min(nr.touches, 3) * 0.25) * rm,
    );

  /* ----- Liquidity pools (equal highs/lows) ----- */
  const pools = liquidityPools(cs, pv, A * 0.25).filter((p) => Math.abs(p.price - price) < 8 * A);
  const poolAbove = pools
    .filter((p) => p.kind === "equal-highs" && p.price > price)
    .sort((x, y) => x.price - y.price)[0];
  const poolBelow = pools
    .filter((p) => p.kind === "equal-lows" && p.price < price)
    .sort((x, y) => y.price - x.price)[0];
  if (poolAbove && poolAbove.price - price < 2 * A)
    add(
      "Liquidity",
      "Buy-side pool above",
      `Equal highs at ${fmt(poolAbove.price)} (${poolAbove.touches} touches) ${((poolAbove.price - price) / A).toFixed(1)} ATR overhead — a magnet for price and a natural target for longs.`,
      "bull",
      0.75,
    );
  if (poolBelow && price - poolBelow.price < 2 * A)
    add(
      "Liquidity",
      "Sell-side pool below",
      `Equal lows at ${fmt(poolBelow.price)} (${poolBelow.touches} touches) ${((price - poolBelow.price) / A).toFixed(1)} ATR below — resting stops may be raided before any real move up.`,
      "bear",
      0.75,
    );

  /* ----- Momentum ----- */
  const R = r[n];
  if (trending) {
    // In trends, RSI extremes mark continuation zones, not reversals
    if (structDir === "bull" && R >= 60)
      add(
        "Momentum",
        "RSI trend regime",
        `RSI ${R.toFixed(1)} holding the bull regime band (>60) inside an uptrend — momentum confirms continuation.`,
        "bull",
        1,
      );
    else if (structDir === "bear" && R <= 40)
      add(
        "Momentum",
        "RSI trend regime",
        `RSI ${R.toFixed(1)} holding the bear regime band (<40) inside a downtrend — momentum confirms continuation.`,
        "bear",
        1,
      );
    else if (structDir === "bull" && R <= 40)
      add(
        "Momentum",
        "RSI regime break",
        `RSI ${R.toFixed(1)} fell out of the bull regime band during an uptrend — momentum no longer supports the trend.`,
        "bear",
        1.25,
      );
    else if (structDir === "bear" && R >= 60)
      add(
        "Momentum",
        "RSI regime break",
        `RSI ${R.toFixed(1)} rose out of the bear regime band during a downtrend — momentum no longer supports the trend.`,
        "bull",
        1.25,
      );
    else
      add(
        "Momentum",
        "RSI",
        `RSI ${R.toFixed(1)} mid-band — no edge from momentum alone.`,
        "neutral",
        0,
      );
  } else {
    if (R >= 70)
      add(
        "Momentum",
        "RSI overbought",
        `RSI ${R.toFixed(1)} — stretched in a ranging market; mean reversion likely.`,
        "bear",
        1 * rm,
      );
    else if (R <= 30)
      add(
        "Momentum",
        "RSI oversold",
        `RSI ${R.toFixed(1)} — stretched in a ranging market; mean reversion likely.`,
        "bull",
        1 * rm,
      );
    else
      add(
        "Momentum",
        "RSI regime",
        `RSI ${R.toFixed(1)} — ${R > 55 ? "bullish momentum zone" : R < 45 ? "bearish momentum zone" : "neutral zone"}.`,
        R > 55 ? "bull" : R < 45 ? "bear" : "neutral",
        R > 55 || R < 45 ? 1 : 0,
      );
  }

  const sK = stoch.k[n],
    sD = stoch.d[n];
  if (Number.isFinite(sK) && Number.isFinite(sD)) {
    if (sK <= 20 && sK > sD && stoch.k[n - 1] <= stoch.d[n - 1])
      add(
        "Momentum",
        "StochRSI bullish cross",
        `StochRSI %K crossing up through %D in the oversold band (${sK.toFixed(0)}) — early momentum turn.`,
        "bull",
        0.75,
      );
    else if (sK >= 80 && sK < sD && stoch.k[n - 1] >= stoch.d[n - 1])
      add(
        "Momentum",
        "StochRSI bearish cross",
        `StochRSI %K crossing down through %D in the overbought band (${sK.toFixed(0)}) — early momentum turn.`,
        "bear",
        0.75,
      );
  }

  const h = m.hist[n],
    hp = m.hist[n - 1];
  add(
    "Momentum",
    "MACD histogram",
    `Histogram ${h > 0 ? "positive" : "negative"} and ${h > hp ? "rising" : "falling"} (${h.toExponential(2)}).`,
    h > 0 && h > hp ? "bull" : h < 0 && h < hp ? "bear" : "neutral",
    h > 0 === h > hp ? 1 : 0.3,
  );
  if (m.line[n] > m.signal[n] && m.line[n - 1] <= m.signal[n - 1])
    add(
      "Momentum",
      "MACD cross",
      "Fresh bullish signal-line crossover on the last bar.",
      "bull",
      1,
    );
  if (m.line[n] < m.signal[n] && m.line[n - 1] >= m.signal[n - 1])
    add(
      "Momentum",
      "MACD cross",
      "Fresh bearish signal-line crossover on the last bar.",
      "bear",
      1,
    );

  const cc = cciV[n];
  if (Number.isFinite(cc)) {
    if (cc > 100)
      add(
        "Momentum",
        "CCI thrust",
        `CCI ${cc.toFixed(0)} > +100 — upside cyclical thrust.`,
        "bull",
        0.5,
      );
    else if (cc < -100)
      add(
        "Momentum",
        "CCI thrust",
        `CCI ${cc.toFixed(0)} < −100 — downside cyclical thrust.`,
        "bear",
        0.5,
      );
  }

  /* ----- Divergences: RSI + OBV ----- */
  if (lows.length >= 2) {
    const [l1, l2] = lows.slice(-2);
    if (n - l2.i < 25 && diverged(l1, l2, r, "lows"))
      add(
        "Divergence",
        "Bullish RSI divergence",
        `Price made a lower low (${fmt(l2.price)}) while RSI made a higher low (${r[l2.i].toFixed(1)} vs ${r[l1.i].toFixed(1)}) — selling exhaustion.`,
        "bull",
        1.5,
      );
    if (hasVol && n - l2.i < 40 && diverged(l1, l2, obvV, "lows"))
      add(
        "Divergence",
        "Bullish OBV divergence",
        "Lower low in price with a higher low in on-balance volume — volume refuses to confirm the decline; accumulation signature.",
        "bull",
        1.25,
      );
  }
  if (highs.length >= 2) {
    const [h1, h2] = highs.slice(-2);
    if (n - h2.i < 25 && diverged(h1, h2, r, "highs"))
      add(
        "Divergence",
        "Bearish RSI divergence",
        `Price made a higher high (${fmt(h2.price)}) while RSI made a lower high (${r[h2.i].toFixed(1)} vs ${r[h1.i].toFixed(1)}) — buying exhaustion.`,
        "bear",
        1.5,
      );
    if (hasVol && n - h2.i < 40 && diverged(h1, h2, obvV, "highs"))
      add(
        "Divergence",
        "Bearish OBV divergence",
        "Higher high in price with a lower high in on-balance volume — volume refuses to confirm the rally; distribution signature.",
        "bear",
        1.25,
      );
  }

  /* ----- Volatility: Bollinger, Keltner squeeze, ATR regime ----- */
  if (price > bb.up[n])
    add(
      "Volatility",
      "Bollinger upper break",
      `Close above upper band (${fmt(bb.up[n])}) — ${trending ? "trend expansion" : "overextension, mean-reversion risk"}.`,
      trending ? "bull" : "bear",
      0.75,
    );
  else if (price < bb.lo[n])
    add(
      "Volatility",
      "Bollinger lower break",
      `Close below lower band (${fmt(bb.lo[n])}) — ${trending ? "trend expansion" : "overextension, mean-reversion risk"}.`,
      trending ? "bear" : "bull",
      0.75,
    );
  const bw = (bb.up[n] - bb.lo[n]) / bb.mid[n];
  const bwHist = bb.up
    .slice(-120)
    .map((u, i) => (u - bb.lo.slice(-120)[i]) / bb.mid.slice(-120)[i])
    .filter((x) => !Number.isNaN(x));
  const bbSqueeze = bwHist.length > 20 && bw <= Math.min(...bwHist) * 1.1;
  const ttSqueeze = Number.isFinite(kc.up[n]) && bb.up[n] < kc.up[n] && bb.lo[n] > kc.lo[n];
  if (ttSqueeze)
    add(
      "Volatility",
      "TTM squeeze",
      "Bollinger bands fully inside Keltner channels — volatility is coiled tight; the eventual break is typically violent. Direction is set by structure, not the squeeze.",
      "neutral",
      0,
    );
  else if (bbSqueeze)
    add(
      "Volatility",
      "Bollinger squeeze",
      "Band width near its 120-bar low — volatility compression, expect an expansion move.",
      "neutral",
      0,
    );
  if (atrPct >= 85)
    add(
      "Volatility",
      "High-volatility regime",
      `ATR is in the ${atrPct.toFixed(0)}th percentile of its 200-bar history — stops must be wider and position size smaller.`,
      "neutral",
      0,
    );
  else if (atrPct <= 15)
    add(
      "Volatility",
      "Low-volatility regime",
      `ATR is in the ${atrPct.toFixed(0)}th percentile of its 200-bar history — quiet tape that usually precedes expansion.`,
      "neutral",
      0,
    );

  /* ----- Price action ----- */
  const k = cs[n],
    kp = cs[n - 1],
    kpp = cs[n - 2];
  const body = Math.abs(k.close - k.open),
    range = k.high - k.low || 1e-9;
  const upW = k.high - Math.max(k.close, k.open),
    loW = Math.min(k.close, k.open) - k.low;
  const atSup = ns && price - ns.price < A,
    atRes = nr && nr.price - price < A;
  const pat = (label: string, detail: string, bias: Bias, w: number) => {
    add("Price action", label, detail, bias, w);
    markers.push({
      time: k.time,
      position: bias === "bull" ? "belowBar" : "aboveBar",
      text: label,
      bias,
    });
  };
  if (k.close > k.open && kp.close < kp.open && k.close >= kp.open && k.open <= kp.close)
    pat(
      "Bullish engulfing",
      `Last candle engulfed the prior bearish body${atSup ? " at support" : ""}.`,
      "bull",
      atSup ? 1.5 : 0.75,
    );
  else if (k.close < k.open && kp.close > kp.open && k.close <= kp.open && k.open >= kp.close)
    pat(
      "Bearish engulfing",
      `Last candle engulfed the prior bullish body${atRes ? " at resistance" : ""}.`,
      "bear",
      atRes ? 1.5 : 0.75,
    );
  else if (loW > body * 2 && upW < body && loW / range > 0.55)
    pat(
      "Hammer / pin bar",
      `Long lower wick rejection (${((loW / range) * 100).toFixed(0)}% of range)${atSup ? " at support" : ""}.`,
      "bull",
      atSup ? 1.25 : 0.5,
    );
  else if (upW > body * 2 && loW < body && upW / range > 0.55)
    pat(
      "Shooting star",
      `Long upper wick rejection (${((upW / range) * 100).toFixed(0)}% of range)${atRes ? " at resistance" : ""}.`,
      "bear",
      atRes ? 1.25 : 0.5,
    );
  else if (
    kpp.close < kpp.open &&
    Math.abs(kp.close - kp.open) < (kpp.open - kpp.close) * 0.4 &&
    k.close > (kpp.open + kpp.close) / 2 &&
    k.close > k.open
  )
    pat("Morning star", "Three-candle bullish reversal sequence.", "bull", 1.25);
  else if (
    kpp.close > kpp.open &&
    Math.abs(kp.close - kp.open) < (kpp.close - kpp.open) * 0.4 &&
    k.close < (kpp.open + kpp.close) / 2 &&
    k.close < k.open
  )
    pat("Evening star", "Three-candle bearish reversal sequence.", "bear", 1.25);
  else if (body / range < 0.1)
    add(
      "Price action",
      "Doji",
      "Indecision candle — wait for the next close for direction.",
      "neutral",
      0,
    );
  // Momentum bar: close in extreme 15% of a >1.5 ATR range = displacement
  const closeLoc = (k.close - k.low) / range;
  if (range > 1.5 * A && closeLoc > 0.85)
    add(
      "Price action",
      "Bullish displacement",
      `Candle range ${(range / A).toFixed(1)} ATR closing in the top 15% — aggressive initiative buying, the footprint of a program.`,
      "bull",
      1.25,
    );
  else if (range > 1.5 * A && closeLoc < 0.15)
    add(
      "Price action",
      "Bearish displacement",
      `Candle range ${(range / A).toFixed(1)} ATR closing in the bottom 15% — aggressive initiative selling.`,
      "bear",
      1.25,
    );

  /* ----- Volume & order flow ----- */
  const vols = cs.map((x) => x.volume);
  const vAvg = hasVol ? vols.slice(-20).reduce((s, x) => s + x, 0) / 20 : 0;
  if (hasVol && vAvg > 0 && k.volume > vAvg * 1.5)
    add(
      "Volume",
      "Volume surge",
      `Last bar volume ${(k.volume / vAvg).toFixed(1)}× its 20-bar average on a ${k.close > k.open ? "bullish" : "bearish"} candle — institutional participation.`,
      k.close > k.open ? "bull" : "bear",
      1,
    );
  if (hasVol) {
    const mfiNow = mfiV[n];
    if (Number.isFinite(mfiNow)) {
      if (mfiNow >= 80)
        add(
          "Volume",
          "MFI overbought",
          `Money Flow Index ${mfiNow.toFixed(0)} — volume-weighted buying is exhausted${trending ? "" : "; mean-reversion risk"}.`,
          "bear",
          0.75 * rm,
        );
      else if (mfiNow <= 20)
        add(
          "Volume",
          "MFI oversold",
          `Money Flow Index ${mfiNow.toFixed(0)} — volume-weighted selling is exhausted${trending ? "" : "; mean-reversion likely"}.`,
          "bull",
          0.75 * rm,
        );
    }
  }

  // VWAP
  const vwapNow = hasVol && Number.isFinite(vw.vwap[n]) ? vw.vwap[n] : null;
  if (vwapNow != null) {
    add(
      "Volume",
      "VWAP position",
      price > vwapNow
        ? `Price ${((price - vwapNow) / A).toFixed(2)} ATR above VWAP ${fmt(vwapNow)} — buyers own the session's average price.`
        : `Price ${((vwapNow - price) / A).toFixed(2)} ATR below VWAP ${fmt(vwapNow)} — sellers own the session's average price.`,
      price > vwapNow ? "bull" : "bear",
      1,
    );
    if (Number.isFinite(vw.up2[n]) && price > vw.up2[n])
      add(
        "Volume",
        "VWAP overextension",
        "Price beyond the +2σ VWAP band — statistically stretched; chasing has poor odds.",
        "bear",
        0.75 * rm,
      );
    if (Number.isFinite(vw.lo2[n]) && price < vw.lo2[n])
      add(
        "Volume",
        "VWAP overextension",
        "Price beyond the −2σ VWAP band — statistically stretched; chasing shorts has poor odds.",
        "bull",
        0.75 * rm,
      );
  }

  // Volume profile
  const profile = volumeProfile(cs.slice(-150));
  if (profile) {
    add(
      "Volume profile",
      "Point of control",
      price > profile.poc
        ? `Price above the POC ${fmt(profile.poc)} — trading above the fairest price of the last 150 bars; value is migrating up.`
        : `Price below the POC ${fmt(profile.poc)} — trading below the fairest price of the last 150 bars; value is migrating down.`,
      price > profile.poc ? "bull" : "bear",
      1,
    );
    if (price > profile.vah)
      add(
        "Volume profile",
        "Above value area",
        `Price above VAH ${fmt(profile.vah)} — breakout acceptance; expect a move toward the next high-volume node, not immediate re-entry.`,
        "bull",
        0.75 * tm,
      );
    else if (price < profile.val)
      add(
        "Volume profile",
        "Below value area",
        `Price below VAL ${fmt(profile.val)} — breakdown acceptance; bounces into value are selling opportunities.`,
        "bear",
        0.75 * tm,
      );
    else if (Math.abs(price - profile.poc) < 0.3 * A)
      add(
        "Volume profile",
        "At point of control",
        `Price sitting on the POC ${fmt(profile.poc)} — maximum two-sided trade; edge is low right at fair value.`,
        "neutral",
        0,
      );
  }

  /* ----- Multi-timeframe ----- */
  if (htfBias)
    add(
      "Multi-timeframe",
      "Higher-timeframe trend",
      htfBias === "neutral"
        ? "Higher timeframe is neutral — lower conviction."
        : `Higher timeframe trend is ${htfBias === "bull" ? "bullish" : "bearish"}; trading with it improves odds.`,
      htfBias,
      htfBias === "neutral" ? 0 : 2,
    );

  /* ----- Fibonacci & premium/discount ----- */
  const dr = dealingRange(cs, 100);
  const swingHi = dr.hi,
    swingLo = dr.lo,
    upLeg = dr.upLeg;
  const fib = [0.236, 0.382, 0.5, 0.618, 0.786].map((f) => ({
    level: f,
    price: upLeg ? swingHi - (swingHi - swingLo) * f : swingLo + (swingHi - swingLo) * f,
  }));
  const golden = fib.find((f) => f.level === 0.618)!,
    half = fib.find((f) => f.level === 0.5)!;
  const gzLo = Math.min(golden.price, half.price),
    gzHi = Math.max(golden.price, half.price);
  if (price >= gzLo - A * 0.2 && price <= gzHi + A * 0.2)
    add(
      "Fibonacci",
      "Golden pocket",
      `Price sits in the 0.5–0.618 retracement (${fmt(gzLo)}–${fmt(gzHi)}) of the ${upLeg ? "up" : "down"}-leg.`,
      upLeg ? "bull" : "bear",
      1,
    );
  const drPos = swingHi === swingLo ? 0.5 : (price - swingLo) / (swingHi - swingLo);
  const premium: Analysis["premium"] = {
    zone: drPos > 0.6 ? "premium" : drPos < 0.4 ? "discount" : "equilibrium",
    pct: drPos * 100,
    hi: swingHi,
    lo: swingLo,
    eq: dr.eq,
  };
  if (upLeg) {
    if (drPos > 0.75)
      add(
        "Smart money",
        "Premium location",
        `Price at ${premium.pct.toFixed(0)}% of the dealing range — buying premium in an up-leg means paying retail prices; wait for a discount pullback.`,
        "bear",
        0.75,
      );
    else if (drPos < 0.4)
      add(
        "Smart money",
        "Discount location",
        `Price at ${premium.pct.toFixed(0)}% of the dealing range — a discount entry inside an up-leg is where institutions accumulate.`,
        "bull",
        0.75,
      );
  } else {
    if (drPos < 0.25)
      add(
        "Smart money",
        "Discount location",
        `Price at ${premium.pct.toFixed(0)}% of the dealing range — shorting the low of the range means selling wholesale; wait for a premium bounce.`,
        "bull",
        0.75,
      );
    else if (drPos > 0.6)
      add(
        "Smart money",
        "Premium location",
        `Price at ${premium.pct.toFixed(0)}% of the dealing range — a premium entry inside a down-leg is where institutions distribute.`,
        "bear",
        0.75,
      );
  }

  /* ----- Smart money zones ----- */
  const fvgs = fairValueGaps(cs, A);
  const obs = orderBlocks(cs, pv, A);
  const sd = supplyDemand(cs, A);
  const zones: Zone[] = [...fvgs, ...obs, ...sd];
  const pad = A * 0.15;
  const zoneName: Record<Zone["kind"], string> = {
    FVG: "Fair value gap",
    IFVG: "Inverse FVG",
    OB: "Order block",
    BREAKER: "Breaker block",
    DEMAND: "Demand zone",
    SUPPLY: "Supply zone",
  };
  const zoneW: Record<Zone["kind"], number> = {
    FVG: 1,
    IFVG: 1.25,
    OB: 1.5,
    BREAKER: 1.5,
    DEMAND: 1.25,
    SUPPLY: 1.25,
  };
  const seen = new Set<string>();
  for (const z of [...zones].sort((x, y) => y.i - x.i)) {
    if (!inZone(price, z, pad) || seen.has(z.kind)) continue;
    seen.add(z.kind);
    const why =
      z.kind === "IFVG"
        ? `a ${z.bias === "bull" ? "bearish" : "bullish"} gap that price closed through, now flipped to ${z.bias === "bull" ? "support" : "resistance"}`
        : z.kind === "BREAKER"
          ? `a failed ${z.bias === "bull" ? "bearish" : "bullish"} order block, now acting as ${z.bias === "bull" ? "support" : "resistance"}`
          : z.kind === "OB"
            ? `the last opposite candle before a ${z.impulse.toFixed(1)}-ATR structure-breaking displacement — institutional ${z.bias === "bull" ? "buy" : "sell"} orders likely rest here`
            : z.kind === "FVG"
              ? `an unfilled ${z.bias === "bull" ? "bullish" : "bearish"} imbalance price tends to react from`
              : `a base before a ${z.impulse.toFixed(1)}-ATR ${z.bias === "bull" ? "rally" : "drop"} — unfilled ${z.bias === "bull" ? "buy" : "sell"} orders`;
    const freshBonus = z.fresh ? 1.2 : 0.85; // fresh zones react strongest
    add(
      "Smart money",
      `Inside ${z.fresh ? "fresh " : "tested "}${zoneName[z.kind]}`,
      `Price is in ${zoneName[z.kind].toLowerCase()} ${fmt(z.bottom)}–${fmt(z.top)}: ${why}.${z.fresh ? " Untested since formation — highest reaction probability." : " Already tested — expect a weaker reaction."}`,
      z.bias,
      zoneW[z.kind] * freshBonus,
    );
  }

  /* ----- Liquidity sweeps & Wyckoff springs/upthrusts ----- */
  const sweeps = liquiditySweeps(cs, pv);
  const lastSweep = sweeps[sweeps.length - 1];
  if (lastSweep && n - lastSweep.i <= 5) {
    const poolHit = pools.find((p) => Math.abs(p.price - lastSweep.level) <= A * 0.25);
    const wyckoff = poolHit
      ? lastSweep.bias === "bull"
        ? ` The sweep hit the equal-lows pool — a textbook Wyckoff spring: stops run, weak hands out, markup follows.`
        : ` The sweep hit the equal-highs pool — a textbook Wyckoff upthrust: breakout buyers trapped, markdown follows.`
      : "";
    add(
      "Liquidity",
      `${lastSweep.bias === "bull" ? "Sell-side" : "Buy-side"} liquidity sweep`,
      `${n - lastSweep.i === 0 ? "Last candle" : `${n - lastSweep.i} bars ago price`} wicked ${lastSweep.bias === "bull" ? "below" : "above"} the swing ${lastSweep.bias === "bull" ? "low" : "high"} ${fmt(lastSweep.level)} and closed back inside — stops were taken, a reversal ${lastSweep.bias === "bull" ? "up" : "down"} is favoured.${wyckoff}`,
      lastSweep.bias,
      poolHit ? 2 : 1.75,
    );
  }
  for (const s of sweeps.slice(-4))
    markers.push({
      time: s.time,
      position: s.bias === "bull" ? "belowBar" : "aboveBar",
      text: "Sweep",
      bias: s.bias,
    });

  const of = orderFlow(cs);
  if (of.available && n > 25) {
    const cvdChg = of.cvd[n] - of.cvd[n - 20];
    const pxChg = c[n] - c[n - 20];
    const d5 = of.delta.slice(-5).reduce((s, x) => s + x, 0);
    if (pxChg > 0 && cvdChg < 0)
      add(
        "Order flow",
        "CVD divergence",
        "Price rose over 20 bars while cumulative volume delta fell — rally lacks aggressive buyers (absorption).",
        "bear",
        1.25,
      );
    else if (pxChg < 0 && cvdChg > 0)
      add(
        "Order flow",
        "CVD divergence",
        "Price fell over 20 bars while cumulative volume delta rose — sellers are being absorbed.",
        "bull",
        1.25,
      );
    else
      add(
        "Order flow",
        "Delta confirmation",
        `Cumulative delta ${cvdChg > 0 ? "rising" : "falling"} with price; last 5 bars net ${d5 > 0 ? "buying" : "selling"} pressure.`,
        cvdChg > 0 ? "bull" : "bear",
        0.75,
      );
  }

  /* ----- Score, calibrated confidence, grade ----- */
  const score = factors.reduce(
    (s, f) => s + (f.bias === "bull" ? f.weight : f.bias === "bear" ? -f.weight : 0),
    0,
  );
  const bullMass = factors.reduce((s, f) => s + (f.bias === "bull" ? f.weight : 0), 0);
  const bearMass = factors.reduce((s, f) => s + (f.bias === "bear" ? f.weight : 0), 0);
  const majority = Math.max(bullMass, bearMass),
    minority = Math.min(bullMass, bearMass);
  // Saturating confidence with conflict penalty: heavy two-sided evidence is NOT conviction.
  const conflictPenalty = majority > 0 ? minority / majority : 1;
  const rawConf = (100 * Math.abs(score)) / (Math.abs(score) + 5);
  const confidence = Math.round(Math.min(95, rawConf * (1 - 0.6 * conflictPenalty)));
  const verdict: Analysis["verdict"] =
    score >= 6
      ? "STRONG BUY"
      : score >= 3
        ? "BUY"
        : score <= -6
          ? "STRONG SELL"
          : score <= -3
            ? "SELL"
            : "NEUTRAL";

  /* ----- Trade plan ----- */
  const long = score >= 0;
  const dir = long ? 1 : -1;
  const htfAligned = !htfBias || htfBias === "neutral" || htfBias === (long ? "bull" : "bear");
  const strong = Math.abs(score) >= 3 && confidence >= 40;

  // Entry: market if not extended, else pullback into value (EMA20 / VWAP / nearest level / POC)
  const extended = long ? R >= 70 || price - e20[n] > 2 * A : R <= 30 || e20[n] - price > 2 * A;
  const anchors = long
    ? [ns?.price, e20[n], vwapNow, profile?.poc].filter((x): x is number => x != null && x < price)
    : [nr?.price, e20[n], vwapNow, profile?.poc].filter((x): x is number => x != null && x > price);
  const zoneRef = anchors.length ? (long ? Math.max(...anchors) : Math.min(...anchors)) : NaN;
  const pullback = extended || (Number.isFinite(zoneRef) && Math.abs(price - zoneRef) > 1.2 * A);
  const canPullback = pullback && Number.isFinite(zoneRef);
  const entry = canPullback ? zoneRef + dir * 0.1 * A : price;
  const entryZone: [number, number] = [
    Math.min(entry, entry - dir * 0.3 * A),
    Math.max(entry, entry - dir * 0.3 * A),
  ];
  // Deep entry: golden pocket / strongest fresh opposing zone — the patient limit order
  const goldenMid = (gzLo + gzHi) / 2;
  const deepZone = [...zones]
    .filter(
      (z) =>
        z.bias === (long ? "bull" : "bear") && z.fresh && (long ? z.top < price : z.bottom > price),
    )
    .sort((x, y) => y.impulse - x.impulse)[0];
  const deepEntry = ((): number | null => {
    const cands: number[] = [];
    if (long ? goldenMid < price - 0.5 * A : goldenMid > price + 0.5 * A) cands.push(goldenMid);
    if (deepZone) cands.push((deepZone.top + deepZone.bottom) / 2);
    if (!cands.length) return null;
    return long ? Math.max(...cands) : Math.min(...cands);
  })();

  // Stop: structural swing ± buffer, clamped to [1, 3] ATR from entry
  const structStop = long
    ? Math.min(
        ...lows
          .filter((l) => l.price < entry)
          .slice(-1)
          .map((l) => l.price),
        ns && ns.price < entry ? ns.price : Infinity,
      )
    : Math.max(
        ...highs
          .filter((l) => l.price > entry)
          .slice(-1)
          .map((l) => l.price),
        nr && nr.price > entry ? nr.price : -Infinity,
      );
  let stop = Number.isFinite(structStop) ? structStop - dir * 0.5 * A : entry - dir * 1.5 * A;
  let stopReason = Number.isFinite(structStop)
    ? `Anchored to the protective swing ${long ? "low" : "high"} at ${fmt(structStop)} plus a 0.5 ATR buffer to avoid liquidity sweeps.`
    : "No protective swing nearby — volatility stop at 1.5 ATR.";
  const dist = Math.abs(entry - stop);
  if (dist < A) {
    stop = entry - dir * A;
    stopReason += " Widened to the 1 ATR minimum so normal noise doesn't stop the trade out.";
  }
  if (dist > 3 * A) {
    stop = entry - dir * 3 * A;
    stopReason += " Capped at 3 ATR to keep risk controlled — reduce position size accordingly.";
  }
  const risk = Math.abs(entry - stop);

  // Targets: opposing levels first, liquidity pools override when nearer and outside 1R, then measured objectives
  const opposing = (long ? resist.map((l) => l.price) : supports.map((l) => l.price)).filter((p) =>
    long ? p > entry : p < entry,
  );
  const poolTgt = long ? poolAbove?.price : poolBelow?.price;
  const levelTp1 = opposing
    .filter((p) => Math.abs(p - entry) >= risk)
    .sort((x, y) => Math.abs(x - entry) - Math.abs(y - entry))[0];
  const tp1Cands = [
    levelTp1,
    poolTgt && Math.abs(poolTgt - entry) >= risk ? poolTgt : undefined,
  ].filter((x): x is number => x != null);
  const tp1 = tp1Cands.length
    ? long
      ? Math.min(...tp1Cands)
      : Math.max(...tp1Cands)
    : entry + dir * 1.5 * risk;
  const tp2 =
    opposing
      .filter((p) => Math.abs(p - entry) >= 2.5 * risk)
      .sort((x, y) => Math.abs(x - entry) - Math.abs(y - entry))[0] ?? entry + dir * 2.5 * risk;
  const ext =
    upLeg === long
      ? long
        ? swingLo + (swingHi - swingLo) * 1.618
        : swingHi - (swingHi - swingLo) * 1.618
      : NaN;
  const tp3 =
    Number.isFinite(ext) && Math.abs(ext - entry) > Math.abs(tp2 - entry)
      ? ext
      : entry + dir * 4 * risk;
  const rr: [number, number, number] = [
    Math.abs(tp1 - entry) / risk,
    Math.abs(tp2 - entry) / risk,
    Math.abs(tp3 - entry) / risk,
  ];
  const tpReason = [
    levelTp1
      ? `TP1 at the nearest opposing ${long ? "resistance" : "support"} ${fmt(tp1)} — first liquidity pool; bank 50% and move stop to breakeven.`
      : poolTgt && tp1 === poolTgt
        ? `TP1 at the ${long ? "equal-highs" : "equal-lows"} liquidity pool ${fmt(tp1)} — resting stops are the magnet; bank 50% just in front of it.`
        : `TP1 at ${rr[0].toFixed(1)}R (${fmt(tp1)}) — no clean opposing level; secure partial profit.`,
    `TP2 at ${fmt(tp2)} (${rr[1].toFixed(1)}R) — ${Math.abs(tp2 - entry) >= 2.5 * risk - 1e-9 && opposing.includes(tp2) ? "next major level" : "measured objective"}; take another 30%.`,
    Number.isFinite(ext) && Math.abs(ext - entry) > Math.abs(tp2 - entry)
      ? `TP3 at the 1.618 Fibonacci extension ${fmt(tp3)} — runner, managed with the trailing stop.`
      : `TP3 at ${rr[2].toFixed(1)}R (${fmt(tp3)}) — runner, managed with the trailing stop.`,
  ];

  // Chandelier trailing stop (real-time exit)
  const look = cs.slice(-22);
  const trailingStop = long
    ? Math.max(...look.map((x) => x.high)) - 3 * A
    : Math.min(...look.map((x) => x.low)) + 3 * A;

  // Grade: conviction + HTF alignment + regime + reward-to-risk
  const gradeScore =
    confidence * 0.5 +
    (htfAligned && htfBias && htfBias !== "neutral" ? 20 : htfAligned ? 10 : -10) +
    (trending ? 15 : 5) +
    Math.min(20, rr[0] * 8);
  const grade: Grade =
    gradeScore >= 70
      ? "A+"
      : gradeScore >= 55
        ? "A"
        : gradeScore >= 40
          ? "B"
          : gradeScore >= 28
            ? "C"
            : "D";
  // Rigour gate: a setup with sub-1.3R to first target or fighting the HTF is not a trade
  const noTrade = rr[0] < 1.3 || !htfAligned || grade === "D";
  const status: TradePlan["status"] = noTrade
    ? "NO TRADE"
    : strong
      ? "ACTIVE SETUP"
      : "WAIT FOR CONFIRMATION";

  const supporting = factors
    .filter((f) => f.bias === (long ? "bull" : "bear"))
    .sort((x, y) => y.weight - x.weight);
  const opposing2 = factors
    .filter((f) => f.bias === (long ? "bear" : "bull"))
    .sort((x, y) => y.weight - x.weight);
  const entryReason = supporting.slice(0, 5).map((f) => `${f.label}: ${f.detail}`);
  if (opposing2.length)
    entryReason.push(`Against the trade: ${opposing2[0].label} — ${opposing2[0].detail}`);
  if (canPullback)
    entryReason.unshift(
      `Price is extended from value — the disciplined entry is a pullback into ${fmt(entryZone[0])}–${fmt(entryZone[1])} (confluence of ${long ? "support, EMA20/VWAP/POC" : "resistance, EMA20/VWAP/POC"}), not chasing.`,
    );

  const sizingNote = `Position size = (account equity × 1% risk) ÷ stop distance ${fmt(risk)}. Example: $10,000 account risks $100 → size = $100 ÷ ${fmt(risk)} per unit. Risking more than 1–2% per trade invalidates the edge statistically.`;
  const timeStop = `Time stop: if price has not reached TP1 within 10 bars of entry, the thesis is not being paid — exit and reassess. Good trades work quickly.`;

  const plan: TradePlan = {
    direction: long ? "LONG" : "SHORT",
    status,
    entryType: canPullback ? "Limit (pullback)" : "Market",
    entry,
    entryZone,
    deepEntry,
    stop,
    tp1,
    tp2,
    tp3,
    trailingStop,
    riskPct: (risk / entry) * 100,
    rr,
    entryReason,
    stopReason,
    tpReason,
    exitRules: [
      `Real-time trailing exit (Chandelier 3×ATR): ${fmt(trailingStop)} — exit any remaining position on a close ${long ? "below" : "above"} it.`,
      `After TP1, move stop to breakeven (${fmt(entry)}) — a stopped trade then costs nothing.`,
      `After TP2, trail the stop below each new swing ${long ? "low" : "high"} instead of the Chandelier.`,
      `Exit early on a close ${long ? "below" : "above"} the 20 EMA (${fmt(e20[n])}) combined with a MACD histogram flip, a supertrend flip, or an opposing engulfing/pin bar at a key level.`,
      timeStop,
    ],
    sizingNote,
    timeStop,
    invalidation: `Setup invalid on a close ${long ? "below" : "above"} ${fmt(stop)}${!strong ? ", or if confluence score stays below ±3" : ""}${!htfAligned && htfBias ? ". WARNING: this trades AGAINST the higher-timeframe trend — counter-trend trades demand half size" : ""}.`,
  };

  return {
    price,
    atr: A,
    score,
    confidence,
    grade,
    verdict,
    regime: trending
      ? `Trending (ADX ${adxNow.toFixed(0)}, ER ${erNow.toFixed(2)})`
      : `Ranging (ADX ${adxNow.toFixed(0)}, ER ${erNow.toFixed(2)})`,
    volRegime:
      atrPct >= 85
        ? "High volatility"
        : atrPct <= 15
          ? "Low volatility (coiled)"
          : "Normal volatility",
    structure,
    premium,
    profile: profile ? { poc: profile.poc, vah: profile.vah, val: profile.val } : null,
    pools: pools.sort((x, y) => Math.abs(x.price - price) - Math.abs(y.price - price)).slice(0, 6),
    factors,
    levels: [...supports.slice(0, 4), ...resist.slice(0, 4)],
    fib,
    plan,
    indicators: {
      rsi: R,
      stochK: sK,
      stochD: sD,
      macdHist: h,
      adx: adxNow,
      cci: cc,
      mfi: hasVol ? mfiV[n] : null,
      ema20: e20[n],
      ema50: e50[n],
      ema200: e200[n],
      bbUp: bb.up[n],
      bbLo: bb.lo[n],
      vwap: vwapNow,
      supertrend: st.line[n],
      supertrendDir: stDir,
      tenkan: t,
      kijun: kj,
      er: erNow,
      atrPct,
    },
    series: { ema20: e20, ema50: e50, ema200: e200, vwap: vw.vwap, supertrend: st.line },
    markers,
    zones: zones
      .filter((z) => Math.abs((z.top + z.bottom) / 2 - price) < 6 * A)
      .sort((x, y) => y.i - x.i)
      .slice(0, 8),
  };
}

export function decimals(p: number) {
  const a = Math.abs(p);
  return a >= 1000 ? 2 : a >= 10 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : 8;
}
export function fmtPrice(p: number) {
  if (!Number.isFinite(p)) return "—";
  return p.toLocaleString("en-US", {
    minimumFractionDigits: decimals(p),
    maximumFractionDigits: decimals(p),
  });
}
