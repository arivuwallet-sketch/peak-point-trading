import type { Candle } from "./market.functions";

/**
 * Core quantitative indicator library.
 *
 * Conventions:
 * - All series are aligned to the input candles (same length); warm-up bars are NaN.
 * - Smoothing that Wilder defined (RSI, ATR, ADX) uses Wilder's method;
 *   modern indicators use standard EMA/SMA definitions from the literature.
 */

/* ---------------- Moving averages ---------------- */
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

export function wilder(v: number[], p: number): number[] {
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

/* ---------------- Momentum ---------------- */
export function rsi(c: number[], p = 14): number[] {
  const g: number[] = [0],
    l: number[] = [0];
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g.push(Math.max(d, 0));
    l.push(Math.max(-d, 0));
  }
  const ag = wilder(g, p),
    al = wilder(l, p);
  return ag.map((x, i) =>
    Number.isNaN(x) ? NaN : al[i] === 0 ? 100 : 100 - 100 / (1 + x / al[i]),
  );
}

/** Stochastic RSI: RSI normalised against its own range — catches turns earlier than raw RSI. */
export function stochRsi(c: number[], rsiP = 14, stochP = 14, kP = 3, dP = 3) {
  const r = rsi(c, rsiP);
  const raw: number[] = [];
  for (let i = 0; i < c.length; i++) {
    if (i < rsiP + stochP - 1) {
      raw.push(NaN);
      continue;
    }
    const win = r.slice(i - stochP + 1, i + 1);
    const lo = Math.min(...win),
      hi = Math.max(...win);
    raw.push(hi === lo ? 50 : (100 * (r[i] - lo)) / (hi - lo));
  }
  const k = sma(
    raw.map((x) => (Number.isNaN(x) ? 0 : x)),
    kP,
  ).map((x, i) => (Number.isNaN(raw[i]) ? NaN : x));
  const d = sma(
    k.map((x) => (Number.isNaN(x) ? 0 : x)),
    dP,
  ).map((x, i) => (Number.isNaN(k[i]) ? NaN : x));
  return { k, d };
}

export function macd(c: number[], fast = 12, slow = 26, sig = 9) {
  const ef = ema(c, fast),
    es = ema(c, slow);
  const line = ef.map((x, i) => x - es[i]);
  const signal = ema(line, sig);
  return { line, signal, hist: line.map((x, i) => x - signal[i]) };
}

/** Commodity Channel Index — deviation from the statistical mean, good for cycle extremes. */
export function cci(cs: Candle[], p = 20): number[] {
  const tp = cs.map((x) => (x.high + x.low + x.close) / 3);
  const m = sma(tp, p);
  return tp.map((x, i) => {
    if (i < p - 1) return NaN;
    const win = tp.slice(i - p + 1, i + 1);
    const md = win.reduce((s, v) => s + Math.abs(v - m[i]), 0) / p;
    return md === 0 ? 0 : (x - m[i]) / (0.015 * md);
  });
}

/* ---------------- Volatility ---------------- */
export function trueRange(cs: Candle[]): number[] {
  return cs.map((c, i) =>
    i === 0
      ? c.high - c.low
      : Math.max(
          c.high - c.low,
          Math.abs(c.high - cs[i - 1].close),
          Math.abs(c.low - cs[i - 1].close),
        ),
  );
}
export function atr(cs: Candle[], p = 14): number[] {
  return wilder(trueRange(cs), p);
}

/** Where current ATR sits inside its own history — volatility regime filter. */
export function atrPercentile(a: number[], lookback = 200): number {
  const n = a.length - 1;
  const win = a.slice(Math.max(0, n - lookback + 1)).filter((x) => Number.isFinite(x));
  if (win.length < 20 || !Number.isFinite(a[n])) return 50;
  const below = win.filter((x) => x <= a[n]).length;
  return (100 * below) / win.length;
}

export function bollinger(c: number[], p = 20, m = 2) {
  const mid = sma(c, p);
  const up: number[] = [],
    lo: number[] = [];
  for (let i = 0; i < c.length; i++) {
    if (i < p - 1) {
      up.push(NaN);
      lo.push(NaN);
      continue;
    }
    const s = c.slice(i - p + 1, i + 1);
    const sd = Math.sqrt(s.reduce((a, b) => a + (b - mid[i]) ** 2, 0) / p);
    up.push(mid[i] + m * sd);
    lo.push(mid[i] - m * sd);
  }
  return { mid, up, lo };
}

/** Keltner channels (EMA mid ± m·ATR) — squeeze vs Bollinger detects volatility coils. */
export function keltner(cs: Candle[], p = 20, m = 1.5) {
  const c = cs.map((x) => x.close);
  const mid = ema(c, p);
  const a = atr(cs, p);
  return { mid, up: mid.map((x, i) => x + m * a[i]), lo: mid.map((x, i) => x - m * a[i]) };
}

/* ---------------- Trend ---------------- */
export function adx(cs: Candle[], p = 14) {
  const pdm = [0],
    ndm = [0],
    tr = [cs[0].high - cs[0].low];
  for (let i = 1; i < cs.length; i++) {
    const up = cs[i].high - cs[i - 1].high,
      dn = cs[i - 1].low - cs[i].low;
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(
      Math.max(
        cs[i].high - cs[i].low,
        Math.abs(cs[i].high - cs[i - 1].close),
        Math.abs(cs[i].low - cs[i - 1].close),
      ),
    );
  }
  const str = wilder(tr, p),
    sp = wilder(pdm, p),
    sn = wilder(ndm, p);
  const pdi = sp.map((x, i) => (100 * x) / str[i]);
  const ndi = sn.map((x, i) => (100 * x) / str[i]);
  const dx = pdi.map((x, i) =>
    x + ndi[i] === 0 ? 0 : (100 * Math.abs(x - ndi[i])) / (x + ndi[i]),
  );
  const firstValid = dx.findIndex((x) => !Number.isNaN(x));
  const adxTail = wilder(dx.slice(firstValid), p);
  const adxv = [...Array(firstValid).fill(NaN), ...adxTail];
  return { adx: adxv, pdi, ndi };
}

/** Kaufman Efficiency Ratio — |net move| / total path length. 1 = pure trend, 0 = pure noise. */
export function efficiencyRatio(c: number[], p = 10): number[] {
  return c.map((_, i) => {
    if (i < p) return NaN;
    const net = Math.abs(c[i] - c[i - p]);
    let path = 0;
    for (let j = i - p + 1; j <= i; j++) path += Math.abs(c[j] - c[j - 1]);
    return path === 0 ? 0 : net / path;
  });
}

/** Linear regression over the window: slope (price/bar) and R² (trend cleanliness). */
export function linReg(c: number[], p: number): { slope: number; r2: number } {
  const n = c.length;
  if (n < p) return { slope: 0, r2: 0 };
  const win = c.slice(n - p);
  const xs = win.map((_, i) => i);
  const mx = (p - 1) / 2,
    my = win.reduce((a, b) => a + b, 0) / p;
  let sxy = 0,
    sxx = 0,
    sse = 0,
    sst = 0;
  for (let i = 0; i < p; i++) {
    sxy += (xs[i] - mx) * (win[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxy / sxx,
    intercept = my - slope * mx;
  for (let i = 0; i < p; i++) {
    const fit = intercept + slope * i;
    sse += (win[i] - fit) ** 2;
    sst += (win[i] - my) ** 2;
  }
  return { slope, r2: sst === 0 ? 0 : Math.max(0, 1 - sse / sst) };
}

/** Supertrend — ATR band trailing stop/trend line. */
export function supertrend(cs: Candle[], p = 10, mult = 3) {
  const a = atr(cs, p);
  const n = cs.length;
  const line: number[] = new Array(n).fill(NaN);
  const dir: number[] = new Array(n).fill(1); // 1 = up trend, -1 = down
  let fUp = 0,
    fDn = 0;
  for (let i = 1; i < n; i++) {
    if (!Number.isFinite(a[i])) continue;
    const hl2 = (cs[i].high + cs[i].low) / 2;
    const bUp = hl2 - mult * a[i],
      bDn = hl2 + mult * a[i];
    fUp = cs[i - 1].close > fUp ? Math.max(bUp, fUp) : bUp;
    fDn = cs[i - 1].close < fDn ? Math.min(bDn, fDn) : bDn;
    const prevDir = dir[i - 1];
    if (prevDir === -1 && cs[i].close > fDn) dir[i] = 1;
    else if (prevDir === 1 && cs[i].close < fUp) dir[i] = -1;
    else dir[i] = prevDir;
    line[i] = dir[i] === 1 ? fUp : fDn;
  }
  return { line, dir };
}

/** Ichimoku cloud (9/26/52). */
export function ichimoku(cs: Candle[]) {
  const mid = (i: number, p: number) => {
    if (i < p - 1) return NaN;
    let hi = -Infinity,
      lo = Infinity;
    for (let j = i - p + 1; j <= i; j++) {
      hi = Math.max(hi, cs[j].high);
      lo = Math.min(lo, cs[j].low);
    }
    return (hi + lo) / 2;
  };
  const tenkan = cs.map((_, i) => mid(i, 9));
  const kijun = cs.map((_, i) => mid(i, 26));
  const spanA = tenkan.map((t, i) =>
    Number.isFinite(t) && Number.isFinite(kijun[i]) ? (t + kijun[i]) / 2 : NaN,
  );
  const spanB = cs.map((_, i) => mid(i, 52));
  return { tenkan, kijun, spanA, spanB };
}

/* ---------------- Volume ---------------- */
/** Rolling anchored VWAP over `p` bars, with ±1σ and ±2σ bands. */
export function vwap(cs: Candle[], p = 20) {
  const out: number[] = [],
    up1: number[] = [],
    lo1: number[] = [],
    up2: number[] = [],
    lo2: number[] = [];
  for (let i = 0; i < cs.length; i++) {
    if (i < p - 1) {
      out.push(NaN);
      up1.push(NaN);
      lo1.push(NaN);
      up2.push(NaN);
      lo2.push(NaN);
      continue;
    }
    let pv = 0,
      vv = 0;
    const tps: number[] = [];
    for (let j = i - p + 1; j <= i; j++) {
      const tp = (cs[j].high + cs[j].low + cs[j].close) / 3;
      pv += tp * cs[j].volume;
      vv += cs[j].volume;
      tps.push(tp);
    }
    const v = vv > 0 ? pv / vv : cs[i].close;
    const sd = Math.sqrt(tps.reduce((s, x) => s + (x - v) ** 2, 0) / p);
    out.push(v);
    up1.push(v + sd);
    lo1.push(v - sd);
    up2.push(v + 2 * sd);
    lo2.push(v - 2 * sd);
  }
  return { vwap: out, up1, lo1, up2, lo2 };
}

export function obv(cs: Candle[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < cs.length; i++) {
    out.push(
      out[i - 1] +
        (cs[i].close > cs[i - 1].close
          ? cs[i].volume
          : cs[i].close < cs[i - 1].close
            ? -cs[i].volume
            : 0),
    );
  }
  return out;
}

/** Money Flow Index — volume-weighted RSI. */
export function mfi(cs: Candle[], p = 14): number[] {
  const tp = cs.map((x) => (x.high + x.low + x.close) / 3);
  const out: number[] = [];
  for (let i = 0; i < cs.length; i++) {
    if (i < p) {
      out.push(NaN);
      continue;
    }
    let pos = 0,
      neg = 0;
    for (let j = i - p + 1; j <= i; j++) {
      const mf = tp[j] * cs[j].volume;
      if (tp[j] > tp[j - 1]) pos += mf;
      else if (tp[j] < tp[j - 1]) neg += mf;
    }
    out.push(neg === 0 ? 100 : 100 - 100 / (1 + pos / neg));
  }
  return out;
}

/** Volume profile: distributes volume across price bins → POC, value area high/low (70%). */
export function volumeProfile(
  cs: Candle[],
  bins = 48,
): { poc: number; vah: number; val: number; total: number } | null {
  const withVol = cs.filter((c) => c.volume > 0);
  if (withVol.length < 30) return null;
  let hi = -Infinity,
    lo = Infinity;
  for (const c of cs) {
    hi = Math.max(hi, c.high);
    lo = Math.min(lo, c.low);
  }
  const step = (hi - lo) / bins || 1e-9;
  const vol = new Array(bins).fill(0);
  for (const c of cs) {
    const tp = (c.high + c.low + c.close) / 3;
    const b = Math.min(bins - 1, Math.floor((tp - lo) / step));
    vol[b] += c.volume;
  }
  const total = vol.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const pocBin = vol.indexOf(Math.max(...vol));
  let acc = vol[pocBin],
    loB = pocBin,
    hiB = pocBin;
  while (acc < 0.7 * total && (loB > 0 || hiB < bins - 1)) {
    const down = loB > 0 ? vol[loB - 1] : -1,
      up = hiB < bins - 1 ? vol[hiB + 1] : -1;
    if (up >= down) {
      hiB++;
      acc += vol[hiB];
    } else {
      loB--;
      acc += vol[loB];
    }
  }
  return {
    poc: lo + (pocBin + 0.5) * step,
    vah: lo + (hiB + 1) * step,
    val: lo + loB * step,
    total,
  };
}

/* ---------------- Divergence (generic) ---------------- */
/** Classic regular divergence between price pivots and an oscillator sampled at those pivots. */
export function diverged(
  p1: { i: number; price: number },
  p2: { i: number; price: number },
  osc: number[],
  kind: "lows" | "highs",
): boolean {
  const o1 = osc[p1.i],
    o2 = osc[p2.i];
  if (!Number.isFinite(o1) || !Number.isFinite(o2)) return false;
  return kind === "lows" ? p2.price < p1.price && o2 > o1 : p2.price > p1.price && o2 < o1;
}
