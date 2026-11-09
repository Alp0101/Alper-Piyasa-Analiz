// Analiz motoru: her zaman dilimi için 8 yöntemle yorum, tuzak tespiti ve seviyeler
'use strict';
const G = require('./gostergeler');

const AGIRLIK = { trend: 1.5, momentum: 1.2, oynaklik: 0.8, seviye: 1.0, hacim: 1.0, mum: 0.6, uyum: 1.2, ortam: 0.8 };
const TF_ADI = {
  m15: '15 Dakikalık',
  s1: '1 Saatlik',
  s2: '2 Saatlik',
  s4: '4 Saatlik',
  g1: '24 Saatlik (Günlük)',
  h1: 'Haftalık',
  ay1: 'Aylık'
};
const UST_TF = {
  m15: ['s1', 's4'],
  s1: ['s4', 'g1'],
  s2: ['s4', 'g1'],
  s4: ['g1'],
  g1: ['h1'],
  h1: ['ay1'],
  ay1: []
};

const sinirla = (v, a = -2, b = 2) => Math.max(a, Math.min(b, v));
const son = a => a[a.length - 1];
const yuvarla = (v, b = 2) => (v == null || !isFinite(v) ? null : +v.toFixed(b));

function fiyatHassasiyet(f) {
  if (f >= 1000) return 2; if (f >= 10) return 2; if (f >= 1) return 4; return 6;
}

// ---------------------------------------------------------------
function hazirla(mumlar) {
  const c = mumlar.map(m => m.c), h = mumlar.map(m => m.h), l = mumlar.map(m => m.l),
    o = mumlar.map(m => m.o), v = mumlar.map(m => m.v);
  return {
    mumlar, c, h, l, o, v,
    e20: G.ema(c, 20), e50: G.ema(c, 50), e200: G.ema(c, 200),
    rsi: G.rsi(c, 14), macd: G.macd(c), stoch: G.stoch(h, l, c),
    bb: G.bollinger(c, 20, 2), atr: G.atr(h, l, c, 14), obv: G.obv(c, v),
    piv: G.pivots(h, l, 3, 3),
  };
}

// Sadece trend + momentum ile hızlı yön (üst zaman dilimi ve piyasa ortamı için)
function hizliYon(d) {
  if (!d || d.c.length < 30) return 0;
  const c = son(d.c), e20 = son(d.e20), e50 = son(d.e50), r = son(d.rsi), hist = son(d.macd.hist);
  let p = 0;
  if (e20 != null) p += c > e20 ? 1 : -1;
  if (e50 != null) p += e20 > e50 ? 1 : -1;
  if (r != null) p += r > 55 ? 1 : r < 45 ? -1 : 0;
  if (hist != null) p += hist > 0 ? 0.5 : -0.5;
  return sinirla(p / 1.75);
}

// 1) TREND
function trendYontemi(d) {
  const c = son(d.c), e20 = son(d.e20), e50 = son(d.e50), e200 = son(d.e200);
  const notlar = [];
  let p = 0, n = 0;
  if (e20 != null) { p += c > e20 ? 1 : -1; n++; }
  if (e50 != null && e20 != null) { p += e20 > e50 ? 1 : -1; n++; }
  if (e200 != null) { p += c > e200 ? 1 : -1; n++; notlar.push(c > e200 ? 'fiyat ana trendin (200 ort.) üzerinde' : 'fiyat ana trendin (200 ort.) altında'); }
  const egim = e50 != null ? G.slope(d.e50, 10) / (son(d.atr) || 1) : 0;
  if (Math.abs(egim) > 0.05) { p += egim > 0 ? 0.5 : -0.5; n += 0.5; }
  const puan = n ? sinirla((p / n) * 2) : 0;
  let yorum;
  if (puan >= 1.5) yorum = 'Güçlü yükseliş trendi: fiyat 20 ve 50 ortalamanın üzerinde, ortalamalar yukarı sıralı';
  else if (puan >= 0.5) yorum = 'Yükseliş eğilimi var ama tam oturmuş değil';
  else if (puan > -0.5) yorum = 'Yatay / kararsız seyir: ortalamalar birbirine karışmış';
  else if (puan > -1.5) yorum = 'Düşüş eğilimi: fiyat kısa ortalamaların altında';
  else yorum = 'Güçlü düşüş trendi: fiyat ortalamaların altında, ortalamalar aşağı sıralı';
  if (notlar.length) yorum += '; ' + notlar.join(', ');
  return { anahtar: 'trend', ad: 'Trend (Ortalamalar)', puan, yorum };
}

// Uyumsuzluk (divergence) arama: son 40 mum içindeki son iki pivot
function uyumsuzluk(d) {
  const N = d.c.length, alt = N - 45;
  const pl = d.piv.pl.filter(i => i >= alt), ph = d.piv.ph.filter(i => i >= alt);
  let sonuc = null;
  if (pl.length >= 2) {
    const [a, b] = pl.slice(-2);
    if (d.l[b] < d.l[a] && d.rsi[b] != null && d.rsi[a] != null && d.rsi[b] > d.rsi[a] + 2 && N - 1 - b <= 12)
      sonuc = { tip: 'pozitif', yorum: 'Pozitif uyumsuzluk: fiyat yeni dip yaptı ama RSI yapmadı (satış gücü azalıyor, dönüş sinyali)' };
  }
  if (ph.length >= 2) {
    const [a, b] = ph.slice(-2);
    if (d.h[b] > d.h[a] && d.rsi[b] != null && d.rsi[a] != null && d.rsi[b] < d.rsi[a] - 2 && N - 1 - b <= 12)
      sonuc = { tip: 'negatif', yorum: 'Negatif uyumsuzluk: fiyat yeni tepe yaptı ama RSI yapmadı (alış gücü zayıflıyor, tuzak işareti)' };
  }
  return sonuc;
}

// 2) MOMENTUM
function momentumYontemi(d) {
  const r = son(d.rsi), r1 = d.rsi[d.rsi.length - 2], hist = son(d.macd.hist), hist1 = d.macd.hist[d.macd.hist.length - 2];
  const k = son(d.stoch.k), dd = son(d.stoch.d);
  const parcalar = [];
  let p = 0;
  if (r != null) {
    if (r > 55) p += 1; else if (r < 45) p -= 1;
    if (r1 != null) p += r > r1 ? 0.4 : -0.4;
    if (r >= 75) { p -= 1; parcalar.push(`RSI ${r.toFixed(0)} – aşırı alım, düzeltme riski`); }
    else if (r <= 25) { p += 1; parcalar.push(`RSI ${r.toFixed(0)} – aşırı satım, tepki gelebilir`); }
    else parcalar.push(`RSI ${r.toFixed(0)} (${r > r1 ? 'yükseliyor' : 'düşüyor'})`);
  }
  if (hist != null) {
    p += hist > 0 ? 0.8 : -0.8;
    if (hist1 != null) {
      if (hist > 0 && hist1 <= 0) parcalar.push('MACD yukarı kesti (al sinyali)');
      else if (hist < 0 && hist1 >= 0) parcalar.push('MACD aşağı kesti (sat sinyali)');
      else parcalar.push(hist > 0 ? (hist > hist1 ? 'MACD güçleniyor' : 'MACD pozitif ama zayıflıyor') : (hist < hist1 ? 'MACD negatif ama toparlanıyor' : 'MACD negatif ve zayıflıyor'));
    }
  }
  if (k != null && dd != null) {
    if (k > dd && k < 80) p += 0.3; else if (k < dd && k > 20) p -= 0.3;
  }
  const uy = uyumsuzluk(d);
  if (uy) { p += uy.tip === 'pozitif' ? 1.5 : -1.5; parcalar.push(uy.yorum); }
  return { anahtar: 'momentum', ad: 'Momentum (RSI, MACD, Stokastik)', puan: sinirla(p), yorum: parcalar.join('; '), uyumsuzluk: uy ? uy.tip : null };
}

// 3) OYNAKLIK – Bollinger ve ATR
function oynaklikYontemi(d) {
  const c = son(d.c), pb = son(d.bb.pctB), w = son(d.bb.width), a = son(d.atr);
  const parcalar = [];
  let p = 0, sikisma = false;
  if (pb != null) {
    if (pb < 0) { p += 0.8; parcalar.push('Fiyat alt bandın altına sarktı (aşırı ucuzlama, tepki ihtimali)'); }
    else if (pb < 0.2) { p += 1; parcalar.push('Fiyat kanalın alt bölgesinde (ucuz bölge)'); }
    else if (pb > 1) { p -= 0.8; parcalar.push('Fiyat üst bandın üstüne taştı (aşırı şişme, geri çekilme riski)'); }
    else if (pb > 0.8) { p -= 1; parcalar.push('Fiyat kanalın üst bölgesinde (pahalı bölge)'); }
    else parcalar.push(`Fiyat kanalın ortasında (%${(pb * 100).toFixed(0)} konumda)`);
  }
  const genislikler = d.bb.width.slice(-120).filter(x => x != null);
  if (w != null && genislikler.length > 40) {
    const sirali = [...genislikler].sort((x, y) => x - y);
    if (w <= sirali[Math.floor(sirali.length * 0.12)]) { sikisma = true; parcalar.push('⚡ Bantlar çok daraldı: sıkışma var, yakında sert hareket gelebilir'); }
  }
  if (a != null) parcalar.push(`Mum başına ortalama oynaklık %${((a / c) * 100).toFixed(2)}`);
  return { anahtar: 'oynaklik', ad: 'Oynaklık (Bollinger, ATR)', puan: sinirla(p), yorum: parcalar.join('; '), sikisma, pctB: pb };
}

// 4) DESTEK / DİRENÇ
function seviyeleriBul(d) {
  const N = d.c.length, a = son(d.atr) || son(d.c) * 0.01, c = son(d.c);
  const ham = [];
  d.piv.ph.filter(i => i >= N - 200).forEach(i => ham.push({ f: d.h[i], i }));
  d.piv.pl.filter(i => i >= N - 200).forEach(i => ham.push({ f: d.l[i], i }));
  ham.sort((x, y) => x.f - y.f);
  const kumeler = [];
  for (const s of ham) {
    const k = son(kumeler);
    if (k && s.f - k.ust <= a * 0.6) { k.ust = s.f; k.toplam += s.f; k.say++; k.sonI = Math.max(k.sonI, s.i); }
    else kumeler.push({ alt: s.f, ust: s.f, toplam: s.f, say: 1, sonI: s.i });
  }
  const seviyeler = kumeler.map(k => ({ fiyat: k.toplam / k.say, guc: k.say, sonI: k.sonI }));
  const destekler = seviyeler.filter(s => s.fiyat < c - a * 0.15).sort((x, y) => y.fiyat - x.fiyat);
  const direncler = seviyeler.filter(s => s.fiyat > c + a * 0.15).sort((x, y) => x.fiyat - y.fiyat);
  const dip50 = Math.min(...d.l.slice(-50)), tepe50 = Math.max(...d.h.slice(-50));

  // Fibonacci Düzeltme Seviyeleri (Son belirgin dalgaya göre)
  // Son 60 mum içindeki en dip ve en tepeyi referans al
  const fibN = Math.min(60, d.c.length);
  const fibLows = d.l.slice(-fibN);
  const fibHighs = d.h.slice(-fibN);
  const minF = Math.min(...fibLows);
  const maxF = Math.max(...fibHighs);
  const minIdx = fibLows.lastIndexOf(minF);
  const maxIdx = fibHighs.lastIndexOf(maxF);

  // Dalga yönü: dip mi önce geldi tepe mi?
  const fibYukselisDalgasi = minIdx < maxIdx;
  const fibFark = maxF - minF;
  const fib = {
    dip: minF,
    tepe: maxF,
    yon: fibYukselisDalgasi ? 'yukselis' : 'dusus',
    f0236: fibYukselisDalgasi ? maxF - fibFark * 0.236 : minF + fibFark * 0.236,
    f0382: fibYukselisDalgasi ? maxF - fibFark * 0.382 : minF + fibFark * 0.382,
    f0500: fibYukselisDalgasi ? maxF - fibFark * 0.500 : minF + fibFark * 0.500,
    f0618: fibYukselisDalgasi ? maxF - fibFark * 0.618 : minF + fibFark * 0.618,
    f0786: fibYukselisDalgasi ? maxF - fibFark * 0.786 : minF + fibFark * 0.786,
  };

  return {
    destek: destekler[0] ? destekler[0].fiyat : dip50,
    destek2: destekler[1] ? destekler[1].fiyat : null,
    direnc: direncler[0] ? direncler[0].fiyat : (tepe50 > c ? tepe50 : null),
    direnc2: direncler[1] ? direncler[1].fiyat : null,
    destekGuc: destekler[0] ? destekler[0].guc : 1,
    direncGuc: direncler[0] ? direncler[0].guc : 1,
    tumSeviyeler: seviyeler,
    fib
  };
}

function seviyeYontemi(d, sv) {
  const c = son(d.c), c1 = d.c[d.c.length - 2], c3 = d.c[d.c.length - 4], a = son(d.atr) || c * 0.01;
  const parcalar = [];
  let p = 0, kirilim = null;
  // Kırılım: son 3 mumda geçilen seviye
  for (const s of sv.tumSeviyeler) {
    if (s.guc < 2) continue;
    if (c3 < s.fiyat && c > s.fiyat + a * 0.2) kirilim = { yon: 'yukari', fiyat: s.fiyat };
    if (c3 > s.fiyat && c < s.fiyat - a * 0.2) kirilim = { yon: 'asagi', fiyat: s.fiyat };
  }
  const dS = sv.destek != null ? (c - sv.destek) / a : null;
  const dR = sv.direnc != null ? (sv.direnc - c) / a : null;
  if (kirilim) {
    if (kirilim.yon === 'yukari') { p += 1.5; parcalar.push(`Direnç kırıldı (${kirilim.fiyat.toFixed(fiyatHassasiyet(c))}) – kalıcılığı teyit edilmeli`); }
    else { p -= 1.5; parcalar.push(`Destek kırıldı (${kirilim.fiyat.toFixed(fiyatHassasiyet(c))}) – satış baskısı artabilir`); }
  }
  if (dS != null && dS < 1) { p += 0.8; parcalar.push('Fiyat desteğe çok yakın (alım için riskin düşük olduğu bölge)'); }
  if (dR != null && dR < 1) { p -= 0.8; parcalar.push('Fiyat dirence dayandı (yükseliş burada takılabilir)'); }
  if (dR == null) { p += 0.5; parcalar.push('Yakında belirgin direnç yok (zirve bölgesi)'); }
  let rr = null;
  if (dS != null && dR != null && dS > 0) {
    rr = dR / dS;
    parcalar.push(`Destek ${dS.toFixed(1)} ATR aşağıda, direnç ${dR.toFixed(1)} ATR yukarıda`);
    if (rr >= 2) p += 0.5; else if (rr < 0.7) p -= 0.5;
  }
  if (c1 && !parcalar.length) parcalar.push('Fiyat iki seviye arasında');
  return { anahtar: 'seviye', ad: 'Destek / Direnç', puan: sinirla(p), yorum: parcalar.join('; '), kirilim, riskOdul: rr };
}

// 5) HACİM
function hacimYontemi(d) {
  const v = d.v, N = v.length;
  const son20 = v.slice(-20);
  if (son20.reduce((s, x) => s + x, 0) === 0 || son20.filter(x => x > 0).length < 10)
    return { anahtar: 'hacim', ad: 'Hacim (Para Girişi)', puan: 0, yorum: 'Bu varlık için güvenilir hacim verisi yok (döviz / endeks / türetilmiş veri)', veriYok: true };
  const ort = G.sma(v, 20)[N - 4] || 1;
  const sonHacim = (v[N - 1] + v[N - 2] + v[N - 3]) / 3;
  const goreceli = sonHacim / ort;
  const fiyatEgim = G.slope(d.c, 15) / (son(d.atr) || 1);
  const obvEgim = G.slope(d.obv, 15);
  const obvOlcek = ort || 1;
  const obvN = obvEgim / obvOlcek;
  let yukariHacim = 0, asagiHacim = 0;
  for (let i = N - 20; i < N; i++) { if (d.c[i] >= d.o[i]) yukariHacim += v[i]; else asagiHacim += v[i]; }
  const oran = asagiHacim ? yukariHacim / asagiHacim : 2;
  const parcalar = [];
  let p = 0, zayifYukselis = false;
  if (fiyatEgim > 0.03 && obvN > 0.02) { p += 1; parcalar.push('Yükseliş hacimle destekleniyor (gerçek para girişi var)'); }
  else if (fiyatEgim > 0.03 && obvN <= 0) { p -= 1; zayifYukselis = true; parcalar.push('Fiyat yükseliyor ama para girişi yok (zayıf yükseliş – tuzak riski)'); }
  else if (fiyatEgim < -0.03 && obvN >= 0) { p += 0.7; parcalar.push('Fiyat düşüyor ama satış hacmi zayıf (sessiz toplama olabilir)'); }
  else if (fiyatEgim < -0.03 && obvN < -0.02) { p -= 1; parcalar.push('Düşüş yüksek hacimle geliyor (gerçek satış baskısı)'); }
  else parcalar.push('Hacim ve fiyat dengeli');
  if (oran > 1.4) { p += 0.5; parcalar.push(`Alıcılı mumların hacmi satıcılıdan ${oran.toFixed(1)} kat fazla`); }
  else if (oran < 0.7) { p -= 0.5; parcalar.push(`Satıcılı mumların hacmi baskın (oran ${oran.toFixed(2)})`); }
  parcalar.push(`Son hacim ortalamanın ${goreceli.toFixed(1)} katı`);
  return { anahtar: 'hacim', ad: 'Hacim (Para Girişi)', puan: sinirla(p), yorum: parcalar.join('; '), goreceliHacim: goreceli, zayifYukselis };
}

// 6) MUM FORMASYONLARI
function mumYontemi(d) {
  const N = d.c.length;
  const m = i => ({ o: d.o[i], h: d.h[i], l: d.l[i], c: d.c[i], g: Math.abs(d.c[i] - d.o[i]), r: d.h[i] - d.l[i] });
  const a = m(N - 1), b = m(N - 2), cc = m(N - 3);
  const pb = son(d.bb.pctB) ?? 0.5;
  const altBolge = pb < 0.45, ustBolge = pb > 0.55;
  const bulunan = [];
  let p = 0;
  const yesil = x => x.c > x.o, kirmizi = x => x.c < x.o;
  const ustFitil = x => x.h - Math.max(x.o, x.c), altFitil = x => Math.min(x.o, x.c) - x.l;
  if (yesil(a) && kirmizi(b) && a.c >= b.o && a.o <= b.c && a.g > b.g) { p += altBolge ? 1.5 : 0.8; bulunan.push('Boğa yutan mum (alıcılar kontrolü aldı)'); }
  if (kirmizi(a) && yesil(b) && a.o >= b.c && a.c <= b.o && a.g > b.g) { p -= ustBolge ? 1.5 : 0.8; bulunan.push('Ayı yutan mum (satıcılar kontrolü aldı)'); }
  if (a.r > 0 && altFitil(a) >= 2 * a.g && ustFitil(a) <= a.g * 0.6 + a.r * 0.05 && altBolge) { p += 1.2; bulunan.push('Çekiç mum (dipte alıcı tepkisi)'); }
  if (a.r > 0 && ustFitil(a) >= 2 * a.g && altFitil(a) <= a.g * 0.6 + a.r * 0.05 && ustBolge) { p -= 1.2; bulunan.push('Kayan yıldız (tepede satıcı baskısı – tuzak işareti)'); }
  if (kirmizi(cc) && b.g < cc.g * 0.4 && yesil(a) && a.c > (cc.o + cc.c) / 2 && altBolge) { p += 1.5; bulunan.push('Sabah yıldızı (dipten dönüş formasyonu)'); }
  if (yesil(cc) && b.g < cc.g * 0.4 && kirmizi(a) && a.c < (cc.o + cc.c) / 2 && ustBolge) { p -= 1.5; bulunan.push('Akşam yıldızı (tepeden dönüş formasyonu)'); }
  if (yesil(a) && yesil(b) && yesil(cc) && a.c > b.c && b.c > cc.c) { p += 0.7; bulunan.push('Üç ardışık yükselen yeşil mum'); }
  if (kirmizi(a) && kirmizi(b) && kirmizi(cc) && a.c < b.c && b.c < cc.c) { p -= 0.7; bulunan.push('Üç ardışık düşen kırmızı mum'); }
  if (!bulunan.length && a.r > 0 && a.g / a.r < 0.1) bulunan.push('Doji (kararsızlık mumu – yön arayışı)');
  return { anahtar: 'mum', ad: 'Mum Formasyonları', puan: sinirla(p), yorum: bulunan.length ? bulunan.join('; ') + ' (son mum henüz kapanmamış olabilir)' : 'Belirgin bir dönüş formasyonu yok' };
}

// 8) PİYASA ORTAMI
function ortamYontemi(d, benchD, bench) {
  if (!benchD) return { anahtar: 'ortam', ad: 'Piyasa Ortamı', puan: 0, yorum: 'Bu varlık için karşılaştırma endeksi kullanılmıyor', veriYok: true };
  let yon = hizliYon(benchD);
  if (bench.ters) yon = -yon;
  const parcalar = [];
  let p = yon * 0.6;
  const benchAd = bench.ad;
  if (bench.ters) parcalar.push(`${benchAd} ${yon > 0.3 ? 'zayıflıyor (bu varlık için olumlu)' : yon < -0.3 ? 'güçleniyor (bu varlık için baskı)' : 'yatay'}`);
  else parcalar.push(`${benchAd} ${yon > 0.3 ? 'yükselişte (genel hava olumlu)' : yon < -0.3 ? 'düşüşte (genel hava olumsuz)' : 'kararsız'}`);
  if (!bench.ters && d.c.length > 21 && benchD.c.length > 21) {
    const kendi = son(d.c) / d.c[d.c.length - 21] - 1;
    const end = son(benchD.c) / benchD.c[benchD.c.length - 21] - 1;
    const fark = (kendi - end) * 100;
    if (fark > 2) { p += 0.8; parcalar.push(`Son 20 mumda endeksten %${fark.toFixed(1)} daha güçlü`); }
    else if (fark < -2) { p -= 0.8; parcalar.push(`Son 20 mumda endeksten %${(-fark).toFixed(1)} daha zayıf`); }
    else parcalar.push('Endeksle benzer performans');
  }
  return { anahtar: 'ortam', ad: 'Piyasa Ortamı', puan: sinirla(p), yorum: parcalar.join('; ') };
}

// TUZAK TESPİTİ
function tuzakAnalizi(d, y, sv, ustYon) {
  const c = son(d.c), a = son(d.atr) || c * 0.01;
  const hareket = (c - d.c[d.c.length - 6]) / a; // son 5 mumdaki hareket (ATR cinsinden)
  const boga = [], ayi = [];
  if (hareket > 0.8) {
    if (y.hacim.zayifYukselis) boga.push('Yükseliş hacimsiz');
    if (y.momentum.uyumsuzluk === 'negatif') boga.push('RSI negatif uyumsuzluk');
    if (sv.direnc && (sv.direnc - c) / a < 0.8) boga.push('Fiyat güçlü dirence dayandı');
    const r = son(d.rsi); if (r > 72) boga.push('RSI aşırı alımda');
    if (ustYon < -0.5) boga.push('Üst zaman dilimi düşüşte (yükseliş akıntıya karşı)');
    const N = d.c.length, ust = d.h[N - 1] - Math.max(d.o[N - 1], d.c[N - 1]);
    if (ust > (d.h[N - 1] - d.l[N - 1]) * 0.5) boga.push('Son mumda uzun üst fitil (satıcılar fiyatı geri itiyor)');
  }
  if (hareket < -0.8) {
    if (y.momentum.uyumsuzluk === 'pozitif') ayi.push('RSI pozitif uyumsuzluk');
    if (sv.destek && (c - sv.destek) / a < 0.8) ayi.push('Fiyat güçlü desteğe geldi');
    const r = son(d.rsi); if (r < 28) ayi.push('RSI aşırı satımda');
    if (ustYon > 0.5) ayi.push('Üst zaman dilimi yükselişte (düşüş geçici olabilir)');
  }
  const seviye = n => (n >= 3 ? 'Yüksek' : n === 2 ? 'Orta' : n === 1 ? 'Düşük' : 'Yok');
  if (boga.length >= ayi.length && boga.length)
    return { tip: 'boga', seviye: seviye(boga.length), nedenler: boga, aciklama: 'Boğa tuzağı (gel-gel) riski: yükseliş sahte olabilir' };
  if (ayi.length)
    return { tip: 'ayi', seviye: seviye(ayi.length), nedenler: ayi, aciklama: 'Ayı tuzağı riski: düşüş sahte olabilir, sert tepki gelebilir' };
  return { tip: null, seviye: 'Yok', nedenler: [], aciklama: 'Belirgin bir tuzak işareti yok' };
}

function yonEtiketi(skor) {
  if (skor >= 40) return { etiket: 'Güçlü Yükseliş', kod: 2 };
  if (skor >= 15) return { etiket: 'Yükseliş', kod: 1 };
  if (skor > -15) return { etiket: 'Kararsız', kod: 0 };
  if (skor > -40) return { etiket: 'Düşüş', kod: -1 };
  return { etiket: 'Güçlü Düşüş', kod: -2 };
}

// Ana fonksiyon
function analizEt(setler, benchSet, bilgi) {
  const hazir = {};
  const tumTfler = ['m15', 's1', 's2', 's4', 'g1', 'h1', 'ay1'];
  for (const tf of tumTfler) if (setler[tf] && setler[tf].length >= 20) hazir[tf] = hazirla(setler[tf]);
  const benchHazir = {};
  if (benchSet) for (const tf of tumTfler) if (benchSet[tf] && benchSet[tf].length >= 20) benchHazir[tf] = hazirla(benchSet[tf]);
  const ham = {};
  for (const tf of tumTfler) if (hazir[tf]) ham[tf] = hizliYon(hazir[tf]);

  const zamanDilimleri = {};
  for (const tf of tumTfler) {
    const d = hazir[tf];
    if (!d) { zamanDilimleri[tf] = { ad: TF_ADI[tf] || tf, hata: 'Yeterli mum verisi yok' }; continue; }
    const sv = seviyeleriBul(d);
    const y = {
      trend: trendYontemi(d),
      momentum: momentumYontemi(d),
      oynaklik: oynaklikYontemi(d),
      seviye: seviyeYontemi(d, sv),
      hacim: hacimYontemi(d),
      mum: mumYontemi(d),
    };
    // 7) Çoklu zaman uyumu
    const ustler = (UST_TF[tf] || []).filter(u => ham[u] != null);
    const ustYon = ustler.length ? ustler.reduce((s, u) => s + ham[u], 0) / ustler.length : 0;
    const kendiYon = ham[tf] || 0;
    let uyumP = 0, uyumYorum;
    if (!ustler.length) uyumYorum = 'Üst zaman dilimi verisi yok';
    else if (Math.sign(ustYon) === Math.sign(kendiYon) && Math.abs(ustYon) > 0.4) {
      uyumP = sinirla(ustYon * 1.2);
      uyumYorum = `Üst zaman dilimleri (${ustler.map(u => TF_ADI[u] || u).join(', ')}) aynı yönü gösteriyor – sinyal daha güvenilir`;
    } else if (Math.abs(ustYon) > 0.4) {
      uyumP = sinirla(ustYon * 0.8);
      uyumYorum = `Dikkat: üst zaman dilimi ${ustYon > 0 ? 'yükselişte' : 'düşüşte'}, bu grafik ters yönde – akıntıya karşı işlem riskli`;
    } else { uyumYorum = 'Üst zaman dilimi kararsız'; }
    y.uyum = { anahtar: 'uyum', ad: 'Çoklu Zaman Uyumu', puan: uyumP, yorum: uyumYorum };
    y.ortam = ortamYontemi(d, benchHazir[tf], benchSet ? { ters: benchSet.ters, ad: benchSet.ad } : null);

    let top = 0, maks = 0;
    for (const [k, m] of Object.entries(y)) { if (m.veriYok) continue; top += m.puan * AGIRLIK[k]; maks += 2 * AGIRLIK[k]; }
    const skor = Math.round((top / maks) * 100);
    const yon = yonEtiketi(skor);
    // Yöntemler arası uzlaşma (kaç yöntem aynı yönde)
    const aktif = Object.values(y).filter(m => !m.veriYok);
    const ayniYon = aktif.filter(m => Math.sign(m.puan) === Math.sign(skor) && Math.abs(m.puan) >= 0.5).length;
    const tuzak = tuzakAnalizi(d, y, sv, ustYon);

    const c = son(d.c), a = son(d.atr) || c * 0.01, hs = fiyatHassasiyet(c);
    let stop = Math.min(c - 1.5 * a, (sv.destek ?? c) - 0.3 * a);
    stop = Math.max(stop, c - 3 * a);
    const risk = c - stop;
    let hedef = sv.direnc && sv.direnc - c > risk * 1.2 ? sv.direnc : c + 2 * risk;
    const hedef2 = sv.direnc2 && sv.direnc2 > hedef ? sv.direnc2 : c + 3 * risk;

    // Fibonacci Seviyelerini Hassasiyete Göre Yuvarla
    const fibSeviyeleri = sv.fib ? {
      dip: yuvarla(sv.fib.dip, hs),
      tepe: yuvarla(sv.fib.tepe, hs),
      yon: sv.fib.yon,
      f0236: yuvarla(sv.fib.f0236, hs),
      f0382: yuvarla(sv.fib.f0382, hs),
      f0500: yuvarla(sv.fib.f0500, hs),
      f0618: yuvarla(sv.fib.f0618, hs),
      f0786: yuvarla(sv.fib.f0786, hs),
    } : null;

    zamanDilimleri[tf] = {
      ad: TF_ADI[tf] || tf, skor, yon: yon.etiket, yonKod: yon.kod,
      uzlasma: `${aktif.length} yöntemden ${ayniYon} tanesi aynı yönde`,
      yontemler: ['trend', 'momentum', 'oynaklik', 'seviye', 'hacim', 'mum', 'uyum', 'ortam'].map(k => ({ ...y[k], puan: yuvarla(y[k].puan, 1) })),
      tuzak,
      seviyeler: {
        fiyat: yuvarla(c, hs), destek: yuvarla(sv.destek, hs), destek2: yuvarla(sv.destek2, hs),
        direnc: yuvarla(sv.direnc, hs), direnc2: yuvarla(sv.direnc2, hs), atr: yuvarla(a, hs),
        alimStop: yuvarla(stop, hs), alimHedef: yuvarla(hedef, hs), alimHedef2: yuvarla(hedef2, hs),
        riskOdul: yuvarla((hedef - c) / risk, 2),
      },
      fibonacci: fibSeviyeleri,
      rsi: yuvarla(son(d.rsi), 1),
      sonMum: new Date(son(d.mumlar).t * 1000).toISOString(),
      mumSayisi: d.c.length,
    };
  }
  return { sembol: bilgi.id, ad: bilgi.ad, tur: bilgi.tur, zamanDilimleri, not: setler.not, zaman: new Date().toISOString() };
}

module.exports = { analizEt };

