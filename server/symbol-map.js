// Cross-venue symbol mapping: Hyperliquid <-> Binance USD-M
const SPECIAL_MAPPINGS = {
  'PEPE': '1000PEPEUSDT', 'LUNC': '1000LUNCUSDT', 'SHIB': '1000SHIBUSDT',
  'BONK': '1000BONKUSDT', 'FLOKI': '1000FLOKIUSDT', 'XEC': '1000XECUSDT',
  'CAT': '1000CATSUSDT', 'RATS': '1000RATSUSDT',
};
const REVERSE_MAPPINGS = {};
for (const [coin, bn] of Object.entries(SPECIAL_MAPPINGS)) REVERSE_MAPPINGS[bn] = coin;

class SymbolMap {
  constructor() {
    this.binanceFuturesSymbols = new Set();
    this.hlCoins = new Set();
    this.overlap = [];
    this.specialMappings = SPECIAL_MAPPINGS;
  }
  setBinanceSymbols(symbols) { this.binanceFuturesSymbols = new Set(symbols); this._recompute(); }
  setHLCoins(coins) { this.hlCoins = new Set(coins); this._recompute(); }
  _recompute() {
    this.overlap = [];
    for (const coin of this.hlCoins) {
      const bn = this.toBinance(coin);
      this.overlap.push({
        hlCoin: coin, binanceSymbol: bn,
        availableOnBinance: this.binanceFuturesSymbols.has(bn),
        matchType: SPECIAL_MAPPINGS[coin] ? 'special' : 'standard',
        displaySymbol: coin
      });
    }
  }
  toBinance(coin) { return SPECIAL_MAPPINGS[coin] || `${coin}USDT`; }
  toHL(bn) { return REVERSE_MAPPINGS[bn] || bn.replace('USDT', ''); }
  getOverlap() { return this.overlap; }
  existsOnBoth(coin) { return this.hlCoins.has(coin) && this.binanceFuturesSymbols.has(this.toBinance(coin)); }
  normalize(raw, source) {
    if (source === 'hyperliquid') return raw;
    if (source === 'binance_futures' || source === 'binance_spot') return this.toHL(raw);
    return raw;
  }
}
module.exports = SymbolMap;
