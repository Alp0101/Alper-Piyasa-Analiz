// Upstash Serverless Redis Bulut Veritabanı Entegrasyonu
// - Ortam değişkenleri (UPSTASH_REDIS_REST_URL ve UPSTASH_REDIS_REST_TOKEN) tanımlıysa doğrudan buluta yazar/okur.
// - Tanımlı değilse (örneğin yerel bilgisayarda internetsizken) yerel dosya sistemini kullanmaya devam eder.
'use strict';

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const aktifMi = () => !!(URL && TOKEN);

async function komut(komutDizisi) {
  if (!aktifMi()) return null;
  try {
    const res = await fetch(`${URL.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([komutDizisi])
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.[0]?.result;
  } catch (e) {
    console.warn('Bulut veritabanı uyarısı:', e.message);
    return null;
  }
}

// Anahtar-Değer işlemleri
async function getir(anahtar) {
  if (!aktifMi()) return null;
  const res = await komut(['GET', anahtar]);
  if (res == null) return null;
  try {
    return JSON.parse(res);
  } catch (_) {
    return res;
  }
}

async function kaydet(anahtar, veri) {
  if (!aktifMi()) return false;
  const deger = typeof veri === 'string' ? veri : JSON.stringify(veri);
  const res = await komut(['SET', anahtar, deger]);
  return res === 'OK';
}

module.exports = { aktifMi, getir, kaydet };

