// Geçmiş Test (Backtest) Motoru
// Bir varlığın geçmiş mumlarında (örneğin son 1-2 yılda) analiz motorunun ürettiği sinyallerin
// hedefe ulaşıp ulaşmadığını (başarı oranını, ortalama kâr/zararı, risk-ödül tutarlılığını) test eder.
'use strict';
const { analizEt } = require('./analiz');

function geriyeTest(mumlar, zamanDilimi = 's4', benchMumlar = null, ayarlar = {}) {
  // En az 80 mumluk geçmişe ihtiyaç var
  if (!mumlar || mumlar.length < 90) {
    return { hata: 'Test için yeterli mum verisi yok (en az 90 mum gerekli).' };
  }

  const minSkor = ayarlar.minSkor || 30; // Alım sinyali için asgari skor (+30 ve üzeri)
  const maksBekleme = ayarlar.maksBeklemeMum || 20; // Kaç mum içinde sonuca ulaşmalı
  const islemler = [];

  // Mumlar üzerinde geçmişten bugüne kayan pencere simülasyonu
  // İlk 60 mum başlangıç indikatör hesapları için ayrılır
  for (let i = 60; i < mumlar.length - maksBekleme; i += 2) {
    const pencere = mumlar.slice(0, i + 1);
    const benchPencere = benchMumlar ? benchMumlar.slice(0, Math.min(i + 1, benchMumlar.length)) : null;

    // Basitleştirilmiş tek periyotluk set oluştur
    const setler = {};
    setler[zamanDilimi] = pencere;
    // Üst periyot verisi yoksa veya pencereye göre analizi çalıştır
    const benchSet = benchPencere ? { [zamanDilimi]: benchPencere, ters: false, ad: 'Endeks' } : null;

    const bilgi = { id: 'TEST', ad: 'Test', tur: 'bist', kaynak: { tip: 'test' } };
    let analiz;
    try {
      analiz = analizEt(setler, benchSet, bilgi);
    } catch (_) {
      continue;
    }

    const z = analiz.zamanDilimleri[zamanDilimi];
    if (!z || z.hata) continue;

    // Alım Sinyali Kontrolü: Belirli skorun üstünde ve Tuzak riski "Yüksek" değilse
    if (z.skor >= minSkor && z.tuzak.seviye !== 'Yüksek') {
      const girisFiyat = z.seviyeler.fiyat;
      const stopFiyat = z.seviyeler.alimStop;
      const hedefFiyat = z.seviyeler.alimHedef;

      if (!stopFiyat || !hedefFiyat || stopFiyat >= girisFiyat || hedefFiyat <= girisFiyat) continue;

      let sonuc = 'bekliyor';
      let cikisFiyat = girisFiyat;
      let barSayisi = 0;

      // Sonraki mumları incele: Önce hedefe mi vurdu, yoksa stop'a mı?
      for (let j = i + 1; j <= i + maksBekleme && j < mumlar.length; j++) {
        barSayisi++;
        const m = mumlar[j];
        if (m.l <= stopFiyat) {
          sonuc = 'stop';
          cikisFiyat = stopFiyat;
          break;
        }
        if (m.h >= hedefFiyat) {
          sonuc = 'hedef';
          cikisFiyat = hedefFiyat;
          break;
        }
      }

      if (sonuc === 'bekliyor') {
        cikisFiyat = mumlar[Math.min(i + maksBekleme, mumlar.length - 1)].c;
        sonuc = cikisFiyat >= girisFiyat ? 'sure_doldu_kar' : 'sure_doldu_zarar';
      }

      const karZararYuzde = ((cikisFiyat - girisFiyat) / girisFiyat) * 100;

      islemler.push({
        girisTarih: new Date(mumlar[i].t * 1000).toISOString().slice(0, 16),
        girisFiyat,
        stopFiyat,
        hedefFiyat,
        skor: z.skor,
        sonuc,
        karZararYuzde: +karZararYuzde.toFixed(2),
        mumBekleme: barSayisi
      });

      // Aynı hareket içinde mükerrer sinyal üretmemek için birkaç mum atla
      i += Math.max(3, Math.floor(barSayisi / 2));
    }
  }

  if (islemler.length === 0) {
    return {
      toplamIslem: 0,
      mesaj: 'Belirtilen kriterlerde geçmişte açılmış işlem bulunamadı (kurallar güvenli tarafta kalmış).'
    };
  }

  const basarili = islemler.filter(x => x.sonuc === 'hedef' || (x.sonuc === 'sure_doldu_kar' && x.karZararYuzde > 0));
  const basarisiz = islemler.filter(x => x.sonuc === 'stop' || (x.sonuc === 'sure_doldu_zarar' && x.karZararYuzde <= 0));
  const basariOrani = +((basarili.length / islemler.length) * 100).toFixed(1);

  const toplamKazanc = basarili.reduce((a, b) => a + b.karZararYuzde, 0);
  const toplamKayip = Math.abs(basarisiz.reduce((a, b) => a + b.karZararYuzde, 0));
  const ortKazanc = basarili.length ? +(toplamKazanc / basarili.length).toFixed(2) : 0;
  const ortKayip = basarisiz.length ? +(toplamKayip / basarisiz.length).toFixed(2) : 0;
  const karFaktoru = toplamKayip > 0 ? +(toplamKazanc / toplamKayip).toFixed(2) : 999;

  return {
    toplamIslem: islemler.length,
    basariliSayi: basarili.length,
    basarisizSayi: basarisiz.length,
    basariOrani,
    ortKazanc,
    ortKayip,
    karFaktoru,
    sonIslemler: islemler.slice(-8).reverse() // Son 8 işlemin detay dökümü
  };
}

module.exports = { geriyeTest };

