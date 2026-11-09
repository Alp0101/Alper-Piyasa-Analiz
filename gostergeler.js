// Teknik göstergeler – tüm hesaplamalar dizi döndürür, yetersiz veri olan yerler null olur.
'use strict';

function sma(arr, n) {
  const out = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= n) sum -= arr[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function ema(arr, n) {
  const out = new Array(arr.length).fill(null);
  if (arr.length < n) return out;
  const k = 2 / (n + 1);
  let prev = 0;
  for (let i = 0; i < n; i++) prev += arr[i];
  prev /= n;
  out[n - 1] = prev;
  for (let i = n; i < arr.length; i++) {
    prev = arr[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function macd(closes, f = 12, s = 26, sig = 9) {
  const ef = ema(closes, f), es = ema(closes, s);
  const line = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const start = line.findIndex(v => v != null);
  const signal = new Array(closes.length).fill(null);
  if (start >= 0) {
    const sub = ema(line.slice(start), sig);
    sub.forEach((v, i) => { signal[start + i] = v; });
  }
  const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { line, signal, hist };
}

function stoch(highs, lows, closes, n = 14, kS = 3, dS = 3) {
  const raw = closes.map((c, i) => {
    if (i < n - 1) return null;
    let hh = -Infinity, ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, highs[j]); ll = Math.min(ll, lows[j]); }
    return hh === ll ? 50 : ((c - ll) / (hh - ll)) * 100;
  });
  const smooth = (a, m) => {
    const out = new Array(a.length).fill(null);
    for (let i = 0; i < a.length; i++) {
      let s = 0, ok = true;
      for (let j = i - m + 1; j <= i; j++) { if (j < 0 || a[j] == null) { ok = false; break; } s += a[j]; }
      if (ok) out[i] = s / m;
    }
    return out;
  };
  const k = smooth(raw, kS);
  const d = smooth(k, dS);
  return { k, d };
}

function bollinger(closes, n = 20, mult = 2) {
  const mid = sma(closes, n);
  const up = [], low = [], pctB = [], width = [];
  for (let i = 0; i < closes.length; i++) {
    if (mid[i] == null) { up.push(null); low.push(null); pctB.push(null); width.push(null); continue; }
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / n);
    const u = mid[i] + mult * sd, l = mid[i] - mult * sd;
    up.push(u); low.push(l);
    pctB.push(u === l ? 0.5 : (closes[i] - l) / (u - l));
    width.push(mid[i] ? (u - l) / mid[i] : null);
  }
  return { mid, up, low, pctB, width };
}

function atr(highs, lows, closes, n = 14) {
  const tr = closes.map((c, i) => i === 0 ? highs[0] - lows[0]
    : Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  const out = new Array(closes.length).fill(null);
  if (closes.length < n) return out;
  let a = 0;
  for (let i = 0; i < n; i++) a += tr[i];
  a /= n; out[n - 1] = a;
  for (let i = n; i < closes.length; i++) { a = (a * (n - 1) + tr[i]) / n; out[i] = a; }
  return out;
}

function obv(closes, volumes) {
  const out = [0];
  for (let i = 1; i < closes.length; i++) {
    const v = volumes[i] || 0;
    out.push(out[i - 1] + (closes[i] > closes[i - 1] ? v : closes[i] < closes[i - 1] ? -v : 0));
  }
  return out;
}

// Pivot (dönüş) noktaları: sol ve sağdaki L/R mumdan daha yüksek/alçak olanlar
function pivots(highs, lows, L = 3, R = 3) {
  const ph = [], pl = [];
  for (let i = L; i < highs.length - R; i++) {
    let isH = true, isL = true;
    for (let j = i - L; j <= i + R; j++) {
      if (j === i) continue;
      if (highs[j] >= highs[i]) isH = false;
      if (lows[j] <= lows[i]) isL = false;
    }
    if (isH) ph.push(i);
    if (isL) pl.push(i);
  }
  return { ph, pl };
}

// Basit doğrusal eğim (son n değer, ortalamaya göre normalize)
function slope(arr, n) {
  const a = arr.slice(-n).filter(v => v != null);
  if (a.length < 3) return 0;
  const m = a.length, xm = (m - 1) / 2, ym = a.reduce((s, v) => s + v, 0) / m;
  let num = 0, den = 0;
  a.forEach((y, x) => { num += (x - xm) * (y - ym); den += (x - xm) ** 2; });
  return den ? num / den : 0;
}

module.exports = { sma, ema, rsi, macd, stoch, bollinger, atr, obv, pivots, slope };

