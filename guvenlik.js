// Yönetici Şifresi Koruması
// - Okuma işlemleri (tarama, analiz, listeleri görme) herkese açıktır.
// - Sunucuda veri değiştiren işlemler (liste kaydetme, demo al/sat/sıfırla, alarm ekle/sil/kontrol)
//   "X-Yonetici-Sifre" başlığıyla doğru şifre gönderilmesini ister.
// - Şifrenin kendisi kodda YOKTUR; yalnızca tuzlanmış scrypt özeti saklanır (GitHub'da okunsa bile çözülemez).
// - Render'da YONETICI_SIFRE ortam değişkeni tanımlanırsa, o şifre geçerli olur (varsayılanın yerine geçer).
'use strict';
const crypto = require('crypto');

const VARSAYILAN_TUZ = '2cc3ef91f5d221982d46eb532296098e';
const VARSAYILAN_OZET = 'b38fd125d5ed6d905656ddf66462c9101f06dd8af5fe6ba81038b1cd0a5f9ab0';

// Kaba kuvvet (deneme-yanılma) saldırılarına karşı IP başına hatalı deneme sınırı
const HATALI_SINIR = 8;            // 15 dakikada en fazla 8 hatalı deneme
const KILIT_SURESI = 15 * 60_000;  // 15 dakika
const denemeler = new Map();       // ip -> { sayi, ilk }

function ipAl(req) {
  const xf = req.headers['x-forwarded-for'];
  return (xf ? String(xf).split(',')[0] : req.socket.remoteAddress || '').trim();
}

function esitMi(a, b) {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function sifreDogruMu(sifre) {
  if (typeof sifre !== 'string' || !sifre || sifre.length > 200) return false;
  const ortam = process.env.YONETICI_SIFRE;
  if (ortam) {
    const a = crypto.createHash('sha256').update(sifre).digest('hex');
    const b = crypto.createHash('sha256').update(ortam).digest('hex');
    return esitMi(a, b);
  }
  const ozet = crypto.scryptSync(sifre, VARSAYILAN_TUZ, 32).toString('hex');
  return esitMi(ozet, VARSAYILAN_OZET);
}

// true: yetkili | false: yanıt (401/429) gönderildi
function yetkiKontrol(req, res) {
  const ip = ipAl(req);
  const k = denemeler.get(ip);
  const simdi = Date.now();
  if (k && simdi - k.ilk > KILIT_SURESI) denemeler.delete(ip);
  const kayit = denemeler.get(ip);
  if (kayit && kayit.sayi >= HATALI_SINIR) {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ hata: 'Çok fazla hatalı şifre denemesi. 15 dakika sonra tekrar deneyin.', yetki: false }));
    return false;
  }
  let sifre = req.headers['x-yonetici-sifre'];
  try { sifre = sifre ? decodeURIComponent(sifre) : ''; } catch (_) { sifre = ''; }
  if (sifreDogruMu(sifre)) { denemeler.delete(ip); return true; }
  if (sifre) {
    const yeni = kayit || { sayi: 0, ilk: simdi };
    yeni.sayi++;
    denemeler.set(ip, yeni);
  }
  res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ hata: sifre ? 'Yönetici şifresi hatalı.' : 'Bu işlem için yönetici şifresi gerekli.', yetki: false }));
  return false;
}

// Korunan (veri değiştiren) uç noktalar
const KORUNAN = new Set([
  'POST /api/listeler',
  'POST /api/listeler/varsayilan',
  'POST /api/demo/al',
  'POST /api/demo/sat',
  'POST /api/demo/sifirla',
  'POST /api/alarm/ekle',
  'POST /api/alarm/sil',
  'POST /api/alarm/kontrol',
  'POST /api/yonetici/dogrula',
]);
const korunanMi = (method, p) => KORUNAN.has(`${method} ${p}`);

module.exports = { yetkiKontrol, korunanMi };

