// Sembol kataloğu: TradingView kimliği (tarama için) -> mum verisi kaynağı (ayrıntılı analiz için)
'use strict';

// tur: bist | emtia | doviz | endeks | kripto
// bench: piyasa ortamı karşılaştırması ('XU100' | 'BTC' | 'DXY_TERS' | null)
const EKSTRA = {
  // Emtia
  'OANDA:XAUUSD':   { ad: 'Altın (Ons / USD)',      tur: 'emtia',  kaynak: { tip: 'yahoo', kod: 'GC=F' },      bench: 'DXY_TERS' },
  'BIST:ALTIN':     { ad: 'Darphane Altın Sertifikası (BIST)', tur: 'emtia', kaynak: { tip: 'gram' },          bench: 'DXY_TERS' },
  'TVC:SILVER':     { ad: 'Gümüş (Ons / USD)',      tur: 'emtia',  kaynak: { tip: 'yahoo', kod: 'SI=F' },      bench: 'DXY_TERS' },
  'FX:UKOIL':       { ad: 'Brent Petrol',           tur: 'emtia',  kaynak: { tip: 'yahoo', kod: 'BZ=F' },      bench: null },
  'FX:USOIL':       { ad: 'WTI Petrol',             tur: 'emtia',  kaynak: { tip: 'yahoo', kod: 'CL=F' },      bench: null },
  
  // Forex & Döviz Pariteleri
  'FX:USDJPY':      { ad: 'Dolar / Japon Yeni (USD/JPY)', tur: 'doviz', kaynak: { tip: 'yahoo', kod: 'JPY=X' }, bench: null },
  'FX:EURUSD':      { ad: 'Euro / Dolar (EUR/USD)',       tur: 'doviz', kaynak: { tip: 'yahoo', kod: 'EURUSD=X' }, bench: 'DXY_TERS' },
  'FX:GBPUSD':      { ad: 'Sterlin / Dolar (GBP/USD)',    tur: 'doviz', kaynak: { tip: 'yahoo', kod: 'GBPUSD=X' }, bench: 'DXY_TERS' },
  'FX:USDCHF':      { ad: 'Dolar / İsviçre Frangı (USD/CHF)', tur: 'doviz', kaynak: { tip: 'yahoo', kod: 'CHF=X' }, bench: null },
  'FX:AUDUSD':      { ad: 'Avustralya Doları / USD',      tur: 'doviz', kaynak: { tip: 'yahoo', kod: 'AUDUSD=X' }, bench: 'DXY_TERS' },
  'FX:USDCAD':      { ad: 'Dolar / Kanada Doları (USD/CAD)', tur: 'doviz', kaynak: { tip: 'yahoo', kod: 'CAD=X' }, bench: null },
  'FX:EURJPY':      { ad: 'Euro / Japon Yeni (EUR/JPY)',  tur: 'doviz', kaynak: { tip: 'yahoo', kod: 'EURJPY=X' }, bench: null },
  'FX:GBPJPY':      { ad: 'Sterlin / Japon Yeni (GBP/JPY)', tur: 'doviz', kaynak: { tip: 'yahoo', kod: 'GBPJPY=X' }, bench: null },
  'FX:USDTRY':      { ad: 'Dolar / TL',             tur: 'doviz',  kaynak: { tip: 'yahoo', kod: 'USDTRY=X' },  bench: null },
  'FX:EURTRY':      { ad: 'Euro / TL',              tur: 'doviz',  kaynak: { tip: 'yahoo', kod: 'EURTRY=X' },  bench: null },
  
  // Endeksler
  'TVC:DXY':        { ad: 'Dolar Endeksi (DXY)',    tur: 'endeks', kaynak: { tip: 'yahoo', kod: 'DX-Y.NYB' },  bench: null },
  'BIST:XU100':     { ad: 'BIST 100 Endeksi',       tur: 'endeks', kaynak: { tip: 'yahoo', kod: 'XU100.IS' },  bench: null },
  'BIST:XU030':     { ad: 'BIST 30 Endeksi',        tur: 'endeks', kaynak: { tip: 'yahoo', kod: 'XU030.IS' },  bench: 'XU100' },
  'BIST:XBANK':     { ad: 'BIST Bankacılık Endeksi',tur: 'endeks', kaynak: { tip: 'yahoo', kod: 'XBANK.IS' },  bench: 'XU100' },
  'GATE:PIUSDT':    { ad: 'Pi Network (PI / USDT)', tur: 'kripto', kaynak: { tip: 'pi' },                      bench: 'BTC' },
};

const KRIPTO_TEMEL = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'SUI',
  'DOT', 'NEAR', 'SHIB', 'PEPE', 'LTC', 'BCH', 'UNI', 'APT', 'FET', 'RENDER',
  'TAO', 'INJ', 'ATOM', 'TIA', 'FIL', 'ARB', 'OP', 'ICP', 'RUNE', 'KAS', 'PI'
];

let KRIPTO_HAVUZ = [];
try {
  KRIPTO_HAVUZ = require('./veri/kripto_havuz.json');
} catch (_) {
  KRIPTO_HAVUZ = KRIPTO_TEMEL;
}

function sembolBilgisi(id, bistAdlari = {}) {
  if (EKSTRA[id]) return { id, ...EKSTRA[id] };
  const [borsa, kod] = id.split(':');
  if (borsa === 'BIST') {
    return { id, ad: bistAdlari[id] || kod, tur: 'bist', kaynak: { tip: 'yahoo', kod: kod + '.IS' }, bench: 'XU100' };
  }
  if (borsa === 'BINANCE') {
    const taban = kod.replace(/USDT$/, '');
    return { id, ad: taban + ' / USDT', tur: 'kripto', kaynak: { tip: 'binance', kod }, bench: kod === 'BTCUSDT' ? null : 'BTC' };
  }
  if (borsa === 'YAHOO') {
    return { id, ad: kod, tur: 'diger', kaynak: { tip: 'yahoo', kod }, bench: null };
  }
  return null;
}

function varsayilanListeler() {
  return {
    surum: 3,
    listeler: [
      { id: 'tum-bist', ad: 'Tüm BIST Hisseleri', dinamik: 'bist', cikarilanlar: [] },
      { 
        id: 'forex', 
        ad: '🌍 Forex & Dünya Pariteleri', 
        semboller: [
          'FX:USDJPY', 'FX:EURUSD', 'FX:GBPUSD', 'FX:USDCHF', 'FX:AUDUSD', 'FX:USDCAD',
          'FX:EURJPY', 'FX:GBPJPY', 'FX:USDTRY', 'FX:EURTRY', 'OANDA:XAUUSD', 'TVC:SILVER', 'FX:UKOIL', 'TVC:DXY'
        ] 
      },
      { id: 'emtia-doviz', ad: 'Altın, Petrol ve Döviz', semboller: ['OANDA:XAUUSD', 'BIST:ALTIN', 'TVC:SILVER', 'FX:UKOIL', 'FX:USOIL', 'FX:USDTRY', 'FX:EURTRY', 'FX:EURUSD', 'TVC:DXY'] },
      { id: 'endeksler', ad: 'Endeksler', semboller: ['BIST:XU100', 'BIST:XU030', 'BIST:XBANK', 'TVC:DXY'] },
      { id: 'kripto', ad: 'Kripto Paralar', dinamik: 'kripto', semboller: [] },
      { id: 'favoriler', ad: '⭐ Favorilerim', semboller: ['OANDA:XAUUSD', 'FX:USDJPY', 'FX:EURUSD', 'BIST:ALTIN', 'FX:UKOIL', 'BIST:THYAO', 'BIST:TUPRS', 'BIST:ASELS', 'BINANCE:BTCUSDT', 'GATE:PIUSDT'] },
    ],
  };
}

module.exports = { EKSTRA, sembolBilgisi, varsayilanListeler, KRIPTO_HAVUZ };

