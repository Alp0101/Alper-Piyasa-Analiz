// Piyasa Asistanı – yerel sunucu (http://localhost:3737)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const V = require('./veri');
const { sembolBilgisi, varsayilanListeler } = require('./semboller');
const { analizEt } = require('./analiz');
const { geriyeTest } = require('./backtest');
const Demo = require('./demo');
const Ziyaret = require('./ziyaret');
const Alarm = require('./alarm');
const Guvenlik = require('./guvenlik');
const Bulut = require('./bulut');

const PORT = process.env.PORT || 3737;
const KOK = __dirname;
const LISTE_DOSYA = path.join(KOK, 'veri', 'listeler.json');
const BULUT_LISTE_ANAHTAR = 'kullanici_listeleri';

let onbellekListeler = null;

// ---------------- Listeler ----------------
function listeleriOku() {
  if (onbellekListeler) return onbellekListeler;
  try {
    const v = JSON.parse(fs.readFileSync(LISTE_DOSYA, 'utf8'));
    let degisti = false;
    if (!v.listeler.some(l => l.id === 'forex')) {
      const varsayilan = varsayilanListeler().listeler.find(l => l.id === 'forex');
      if (varsayilan) {
        v.listeler.splice(1, 0, varsayilan);
        degisti = true;
      }
    }
    const endeksListesi = v.listeler.find(l => l.id === 'endeksler');
    if (endeksListesi && Array.isArray(endeksListesi.semboller) && !endeksListesi.semboller.includes('BIST:XBANK')) {
      endeksListesi.semboller.push('BIST:XBANK');
      degisti = true;
    }
    if (degisti) {
      listeleriYaz(v);
    }
    onbellekListeler = v;
    return onbellekListeler;
  }
  catch (_) { const v = varsayilanListeler(); listeleriYaz(v); return v; }
}
function listeleriYaz(v) {
  onbellekListeler = v;
  try {
    fs.mkdirSync(path.dirname(LISTE_DOSYA), { recursive: true });
    const gecici = LISTE_DOSYA + '.tmp';
    fs.writeFileSync(gecici, JSON.stringify(v, null, 2), 'utf8');
    fs.renameSync(gecici, LISTE_DOSYA);
  } catch (_) {}
  if (Bulut.aktifMi()) {
    Bulut.kaydet(BULUT_LISTE_ANAHTAR, v).catch(() => {});
  }
}

// Buluttan listeleri yükle
async function buluttanListeleriYukle() {
  if (!Bulut.aktifMi()) return;
  const veri = await Bulut.getir(BULUT_LISTE_ANAHTAR);
  if (veri && Array.isArray(veri.listeler)) {
    let degisti = false;
    if (!veri.listeler.some(l => l.id === 'forex')) {
      const varsayilan = varsayilanListeler().listeler.find(l => l.id === 'forex');
      if (varsayilan) {
        veri.listeler.splice(1, 0, varsayilan);
        degisti = true;
      }
    }
    const endeksListesi = veri.listeler.find(l => l.id === 'endeksler');
    if (endeksListesi && Array.isArray(endeksListesi.semboller) && !endeksListesi.semboller.includes('BIST:XBANK')) {
      endeksListesi.semboller.push('BIST:XBANK');
      degisti = true;
    }
    if (degisti) {
      Bulut.kaydet(BULUT_LISTE_ANAHTAR, veri).catch(() => {});
    }
    onbellekListeler = veri;
    try {
      fs.mkdirSync(path.dirname(LISTE_DOSYA), { recursive: true });
      fs.writeFileSync(LISTE_DOSYA, JSON.stringify(veri, null, 2), 'utf8');
      console.log('☁️ Listeler bulut veritabanından yüklendi.');
    } catch (_) {}
  } else if (onbellekListeler) {
    Bulut.kaydet(BULUT_LISTE_ANAHTAR, onbellekListeler).catch(() => {});
  }
}
buluttanListeleriYukle();
function listeDogrula(v) {
  if (!v || !Array.isArray(v.listeler)) throw new Error('Geçersiz liste verisi');
  v.listeler.forEach(l => {
    if (typeof l.id !== 'string' || typeof l.ad !== 'string') throw new Error('Liste adı/kimliği eksik');
    if (!l.dinamik && !Array.isArray(l.semboller)) throw new Error(`"${l.ad}" listesinde sembol dizisi yok`);
  });
  return v;
}

// ---------------- Hızlı değerlendirme (tarama tablosu) ----------------
const tvEtiket = x => (x == null ? null : x > 0.5 ? 2 : x > 0.1 ? 1 : x < -0.5 ? -2 : x < -0.1 ? -1 : 0);
function hizliDegerlendir(r, benchmarkDegisim = 0) {
  const t = r.tv || {}, rs = r.rsi || {};
  const isaretler = [];
  const ozelTaktikler = [];
  const gh = r.goreceliHacim || 0;
  const deg = r.degisim || 0;

  // Standart analiz işaretleri
  if (t.s2 > 0.1 && t.s4 > 0.1 && t.g1 > 0.1 && rs.s4 >= 45 && rs.s4 <= 65 && gh >= 1.2) isaretler.push({ tip: 'firsat', metin: 'Kısa vade alım adayı' });
  if (rs.g1 != null && rs.g1 < 32 && t.s2 > 0.3 && t.s4 > -0.1) isaretler.push({ tip: 'firsat', metin: 'Dipten dönüş adayı' });
  if (r.degisim > 3 && r.goreceliHacim != null && r.goreceliHacim < 0.8) isaretler.push({ tip: 'tuzak', metin: 'Hacimsiz yükseliş' });
  if (rs.s4 > 75 || rs.g1 > 78) isaretler.push({ tip: 'tuzak', metin: 'Aşırı alım' });
  if (rs.g1 != null && rs.g1 < 25) isaretler.push({ tip: 'bilgi', metin: 'Aşırı satım' });

  const ayKonum = r.ayYuksek > r.ayDusuk ? Math.round(((r.fiyat - r.ayDusuk) / (r.ayYuksek - r.ayDusuk)) * 100) : null;

  // 1. Taktik: 🛡️ Endekse Direnç / Alfa Gücü
  if ((benchmarkDegisim <= -0.2 && (deg >= 0.2 || (deg - benchmarkDegisim) >= 1.8)) || (benchmarkDegisim > -0.2 && deg >= 3.0 && gh >= 1.4 && t.s4 > 0.2)) {
    ozelTaktikler.push('alfa');
    isaretler.push({ tip: 'ozel_alfa', metin: '🛡️ Alfa' });
  }

  // 2. Taktik: 📦 Gizli Toplama (Balina Hacim Anomalisi)
  if (Math.abs(deg) <= 2.2 && gh >= 1.8) {
    ozelTaktikler.push('toplama');
    isaretler.push({ tip: 'ozel_toplama', metin: '📦 Gizli Toplama' });
  }

  // 3. Taktik: 🌀 Volatilite Sıkışması (Bahar Yayı)
  if (Math.abs(deg) <= 1.2 && gh >= 0.8 && rs.s4 >= 42 && rs.s4 <= 58 && (t.s4 >= 0 || t.s2 >= 0)) {
    ozelTaktikler.push('sikisma');
    isaretler.push({ tip: 'ozel_sikisma', metin: '🌀 Sıkışma' });
  }

  // 4. Taktik: 🧲 Stop Avı & Silkeleme Dönüşü
  if (ayKonum != null && ayKonum <= 22 && (t.s2 > 0.1 || deg > 0.3) && (rs.s4 < 48 || rs.g1 < 42)) {
    ozelTaktikler.push('stop_avi');
    isaretler.push({ tip: 'ozel_stop_avi', metin: '🧲 Stop Avı' });
  }

  // 5. Taktik: 📈 Pozitif Uyumsuzluk
  if (ayKonum != null && ayKonum <= 40 && (rs.s4 > (rs.g1 || 50) + 4 || (rs.s4 > 35 && t.s2 > 0.2 && (t.g1 || 0) <= 0))) {
    ozelTaktikler.push('uyumsuzluk');
    isaretler.push({ tip: 'ozel_uyumsuzluk', metin: '📈 Uyumsuzluk' });
  }

  // Kombo Rozeti: 2 veya daha fazla taktik aynı anda tetiklendiyse en başa altın rozet koy
  if (ozelTaktikler.length >= 2) {
    isaretler.unshift({ tip: 'kombo', metin: `⭐ ${ozelTaktikler.length}x Özel Taktik` });
  }

  const agirlikli = [t.s2, t.s4, t.g1].some(x => x == null) ? null : Math.round((t.s2 * 0.25 + t.s4 * 0.35 + t.g1 * 0.4) * 100);
  return {
    ...r,
    yon: { s2: tvEtiket(t.s2), s4: tvEtiket(t.s4), g1: tvEtiket(t.g1) },
    hizliPuan: agirlikli, ayKonum, isaretler, ozelTaktikler,
    tlHacim: r.tlHacim || (r.hacim && r.fiyat ? r.hacim * r.fiyat : null),
    usdHacim: r.usdHacim || (r.id?.includes('USDT') && r.hacim && r.fiyat ? r.hacim * r.fiyat : null),
  };
}

async function listeTara(listeId) {
  const v = listeleriOku();
  const liste = v.listeler.find(l => l.id === listeId);
  if (!liste) throw new Error('Liste bulunamadı');
  let satirlar;
  if (liste.dinamik === 'bist') {
    const cik = new Set(liste.cikarilanlar || []);
    satirlar = (await V.tumBistTara()).filter(r => !cik.has(r.id));
  } else if (liste.dinamik === 'kripto' || liste.id === 'kripto') {
    const cik = new Set(liste.cikarilanlar || []);
    let kriptolar = await V.tumKriptoTara();
    const ozelSemboller = (liste.semboller || []).filter(id => !kriptolar.some(k => k.id === id));
    if (ozelSemboller.length > 0) {
      try {
        const ekstra = await V.sembolleriTara(ozelSemboller);
        const formatliEkstra = (ekstra || []).map(r => {
          const kod = r.kod ? r.kod.replace(/USDT$/, '') : (r.id ? r.id.split(':')[1].replace(/USDT$/, '') : '');
          const usdHacim = r.usdHacim || (r.hacim && r.fiyat ? r.hacim * r.fiyat : null);
          return {
            ...r,
            kod: kod || r.kod,
            ad: r.ad || (kod + ' / USDT'),
            usdHacim,
            tlHacim: usdHacim ? +(usdHacim * 50).toFixed(0) : null
          };
        });
        kriptolar = [...kriptolar, ...formatliEkstra];
      } catch (_) {}
    }
    satirlar = kriptolar.filter(r => !cik.has(r.id));
  } else {
    const gelen = await V.sembolleriTara(liste.semboller);
    const m = new Map(gelen.map(r => [r.id, r]));
    satirlar = liste.semboller.map(id => m.get(id) || { id, kod: id.split(':')[1], ad: (sembolBilgisi(id) || {}).ad || id, fiyat: null, tv: {}, rsi: {}, veriYok: true });
  }
  const adlar = {};
  satirlar.forEach(r => { const b = sembolBilgisi(r.id); if (b && b.tur !== 'bist' && b.ad) adlar[r.id] = b.ad; });
  
  // Benchmark (BIST için XU100, Kripto için BTC) günlük değişimini tespit et
  let benchDeg = 0;
  const bSatir = satirlar.find(x => x.id === 'BIST:XU100' || x.id === 'BINANCE:BTCUSDT' || x.kod === 'BTC');
  if (bSatir && bSatir.degisim != null) benchDeg = bSatir.degisim;

  return satirlar.map(r => hizliDegerlendir({ ...r, ad: adlar[r.id] || r.ad }, benchDeg));
}

async function sembolAnaliz(id, tf = 's4') {
  let adlar = {};
  if (id.startsWith('BIST:')) { try { adlar = await V.bistAdlari(); } catch (_) { /* ad olmadan devam */ } }
  const bilgi = sembolBilgisi(id, adlar);
  if (!bilgi) throw new Error('Bu sembol için veri kaynağı tanımlı değil');
  
  // Canlı scanner fiyatı ve mum verilerini paralel çek
  const [canliTarama, setler, bench] = await Promise.all([
    V.sembolleriTara([id]).catch(() => []),
    V.mumSetleri(bilgi),
    bilgi.bench ? V.benchSetleri(bilgi.bench).catch(() => null) : null
  ]);

  const canliSonFiyat = canliTarama?.[0]?.fiyat;

  // Mumların en son fiyatını canlı scanner fiyatıyla %100 senkronize et
  if (canliSonFiyat && canliSonFiyat > 0) {
    for (const key of ['m15', 's1', 's2', 's4', 'g1', 'h1', 'ay1']) {
      const arr = setler[key];
      if (arr && arr.length > 0) {
        const sonMum = arr[arr.length - 1];
        sonMum.c = canliSonFiyat;
        sonMum.h = Math.max(sonMum.h, canliSonFiyat);
        sonMum.l = Math.min(sonMum.l, canliSonFiyat);
      }
    }
  }

  const analizSonucu = analizEt(setler, bench, bilgi);

  // Backtest / Geçmiş test hesaplaması
  const hedefMumlar = setler[tf] || setler.s4 || setler.g1;
  const backtestSonucu = geriyeTest(hedefMumlar, tf, null);

  return { ...analizSonucu, backtest: backtestSonucu, canliFiyat: canliSonFiyat };
}

// ---------------- HTTP ----------------
const TIPLER = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function gonder(res, kod, veri) {
  res.writeHead(kod, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(veri));
}
function govdeOku(req) {
  return new Promise((ok, red) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 2e6) { red(new Error('Veri çok büyük')); req.destroy(); } });
    req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { red(new Error('Geçersiz JSON')); } });
  });
}

const sunucu = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    // Yönetici şifresi koruması: veri değiştiren işlemler şifre ister
    if (Guvenlik.korunanMi(req.method, p) && !Guvenlik.yetkiKontrol(req, res)) return;
    if (p === '/api/yonetici/dogrula') return gonder(res, 200, { yetki: true });

    if (p === '/api/listeler' && req.method === 'GET') return gonder(res, 200, listeleriOku());
    if (p === '/api/listeler' && req.method === 'POST') { const v = listeDogrula(await govdeOku(req)); listeleriYaz(v); return gonder(res, 200, v); }
    if (p === '/api/listeler/varsayilan' && req.method === 'POST') { const v = varsayilanListeler(); listeleriYaz(v); return gonder(res, 200, v); }
    if (p === '/api/tarama') return gonder(res, 200, { zaman: new Date().toISOString(), satirlar: await listeTara(url.searchParams.get('liste')) });
    if (p === '/api/analiz') return gonder(res, 200, await sembolAnaliz(url.searchParams.get('sembol') || '', url.searchParams.get('tf') || 's4'));
    if (p === '/api/ara') return gonder(res, 200, await V.ara(url.searchParams.get('q') || ''));

    // Demo Al-Sat Uç Noktaları (Canlı Piyasa Fiyat Beslemesi)
    if (p === '/api/demo/portfoy' && req.method === 'GET') {
      const qSembol = url.searchParams.get('semboller');
      const gelenSemboller = qSembol ? qSembol.split(',').filter(Boolean) : [];
      const semboller = [...new Set(gelenSemboller)];
      const fiyatHaritasi = {};
      if (semboller.length > 0) {
        try {
          const satirlar = await V.sembolleriTara(semboller);
          (satirlar || []).forEach(r => { if (r && r.id && r.fiyat) fiyatHaritasi[r.id] = r.fiyat; });
        } catch (_) {}
      }
      return gonder(res, 200, { fiyatHaritasi });
    }
    if (p === '/api/demo/al' && req.method === 'POST') {
      const g = await govdeOku(req);
      const sonuc = Demo.demoAl(g.sembol, g.ad, g.fiyat, g.adet, g.stopFiyat, g.hedefFiyat, g.yon, g.kaldirac);
      return gonder(res, 200, sonuc);
    }
    if (p === '/api/demo/sat' && req.method === 'POST') {
      const g = await govdeOku(req);
      const sonuc = Demo.demoSat(g.pozId, g.satisFiyat, g.sebep || 'manuel');
      return gonder(res, 200, sonuc);
    }
    if (p === '/api/demo/sifirla' && req.method === 'POST') {
      return gonder(res, 200, Demo.demoSifirla());
    }

    // Ziyaretçi İstatistikleri
    if (p === '/api/ziyaret/istatistik') {
      return gonder(res, 200, Ziyaret.istatistikGetir());
    }

    // Toplu Balina Radarı Taraması (Mevcut seçili listeye veya piyasaya göre dinamik)
    if (p === '/api/balina/tara') {
      const seciliListeId = url.searchParams.get('liste') || 'tum-bist';
      let satirlar = [];
      try {
        satirlar = await listeTara(seciliListeId);
      } catch (_) {
        satirlar = await V.tumBistTara();
      }

      const bulunanlar = [];
      satirlar.forEach(r => {
        const gh = r.goreceliHacim || 0;
        const deg = r.degisim || 0;
        const tv = r.tv || {};
        const rsi4h = r.rsi?.s4 || 50;

        // 1. Agresif Giriş / Hacimli Patlama: Sert yükseliş ve güçlü hacim (RSI aşırı şişmemişken)
        if (deg >= 2.8 && (gh >= 1.4 || tv.s4 > 0.3) && rsi4h <= 74) {
          bulunanlar.push({
            id: r.id, kod: r.kod, ad: r.ad, fiyat: r.fiyat, degisim: deg, gh: gh || 1.4,
            tlHacim: r.tlHacim, usdHacim: r.usdHacim,
            tur: 'patlama', seviye: 'Agresif Para Girişi', ikon: '🚀', renk: '#38bdf8',
            aciklama: `Günü %${deg.toFixed(1)} artıda götürüyor ve hacim ${gh.toFixed(1)} katı; güçlü alım baskısı var!`
          });
        }
        // 2. Mal Dağıtımı: RSI aşırı alımda (>= 75) iken yüksek hacimle tepede zorlanma
        else if (rsi4h >= 75 && (gh >= 1.35 || deg >= 2.5)) {
          bulunanlar.push({
            id: r.id, kod: r.kod, ad: r.ad, fiyat: r.fiyat, degisim: deg, gh: gh || 1.35,
            tlHacim: r.tlHacim, usdHacim: r.usdHacim,
            tur: 'dagitim', seviye: 'Mal Dağıtımı Riski', ikon: '⚠️', renk: '#ef4444',
            aciklama: `Hacim yüksek ancak RSI aşırı şişti (${rsi4h.toFixed(0)}). Tepede mal devri ve düzeltme riski!`
          });
        }
        // 3. Sessiz Toplama: Fiyat yatay (% -2.2 ile +2.2) ve hacim en az 1.35 kat artışta
        else if (Math.abs(deg) <= 2.2 && gh >= 1.35 && (r.fiyat > 0) && ((r.tlHacim || 0) > 8e6 || (r.usdHacim || 0) > 100e3)) {
          bulunanlar.push({
            id: r.id, kod: r.kod, ad: r.ad, fiyat: r.fiyat, degisim: deg, gh: gh,
            tlHacim: r.tlHacim, usdHacim: r.usdHacim,
            tur: 'toplama', seviye: 'Sessiz Toplama', ikon: '🧲', renk: '#10b981',
            aciklama: `Fiyat yatay (%${deg.toFixed(1)}) seyrederken hacim ortalamanın ${gh.toFixed(1)} katına fırladı; balinalar sessizce topluyor!`
          });
        }
        // 4. Dip Karşılama / Panik Alımı: Düşüş varken güçlü hacimle satışların emilmesi
        else if (deg <= -2.0 && gh >= 1.35 && (rsi4h < 42 || (r.rsi?.s2 || 50) < 38)) {
          bulunanlar.push({
            id: r.id, kod: r.kod, ad: r.ad, fiyat: r.fiyat, degisim: deg, gh: gh || 1.35,
            tlHacim: r.tlHacim, usdHacim: r.usdHacim,
            tur: 'toplama', seviye: 'Dip Karşılama (Panik Alımı)', ikon: '💎', renk: '#a855f7',
            aciklama: `Düşüşe rağmen hacim ${gh.toFixed(1)} katına çıktı; dip seviyeden satışlar balinalarca karşılanıyor!`
          });
        }
      });
      return gonder(res, 200, { zaman: new Date().toISOString(), liste: bulunanlar });
    }

    // Fiyat Alarmları Uç Noktaları
    if (p === '/api/alarm/liste' && req.method === 'GET') {
      return gonder(res, 200, Alarm.alarmlariOku());
    }
    if (p === '/api/alarm/ekle' && req.method === 'POST') {
      const g = await govdeOku(req);
      return gonder(res, 200, Alarm.alarmEkle(g.sembol, g.ad, g.hedefFiyat, g.yon, g.not));
    }
    if (p === '/api/alarm/sil' && req.method === 'POST') {
      const g = await govdeOku(req);
      return gonder(res, 200, Alarm.alarmSil(g.id));
    }
    if (p === '/api/alarm/kontrol' && req.method === 'POST') {
      const g = await govdeOku(req);
      return gonder(res, 200, Alarm.kontrolEt(g.fiyatHaritasi || {}));
    }

    if (p.startsWith('/api/')) return gonder(res, 404, { hata: 'Bilinmeyen istek' });

    // Sayfa ana girişi ise ziyaretçiyi kaydet
    if (p === '/' || p === '/index.html') {
      Ziyaret.ziyaretKaydet(req);
    }

    // Statik dosyalar (panel klasörü)
    const dosya = path.normalize(path.join(KOK, 'panel', p === '/' ? 'index.html' : p));
    if (!dosya.startsWith(path.join(KOK, 'panel'))) { res.writeHead(403); return res.end(); }
    fs.readFile(dosya, (err, icerik) => {
      if (err) { res.writeHead(404); return res.end('Bulunamadı'); }
      res.writeHead(200, { 'Content-Type': TIPLER[path.extname(dosya)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(icerik);
    });
  } catch (e) {
    console.error('Hata:', p, e.message);
    gonder(res, 500, { hata: e.message });
  }
});

const tarayiciAc = () => exec(`start "" http://localhost:${PORT}`);

sunucu.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.log('Sistem zaten çalışıyor, panel açılıyor...'); tarayiciAc(); setTimeout(() => process.exit(0), 500); }
  else { console.error(e); process.exit(1); }
});

sunucu.listen(PORT, '0.0.0.0', () => {
  console.log('==============================================');
  console.log("  🛡️  ALPER'İN PİYASA ASİSTANI ÇALIŞIYOR");
  console.log(`  Bilgisayardan Adres : http://localhost:${PORT}`);
  console.log('  Kapatmak için bu pencereyi kapatın.');
  console.log('==============================================');
  if (!process.argv.includes('--tarayicisiz')) tarayiciAc();
});
