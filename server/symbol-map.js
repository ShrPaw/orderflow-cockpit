// Cross-venue symbol mapping: Hyperliquid <-> Binance USD-M
// Handles special cases: PEPE->1000PEPE, LUNC->1000LUNC, etc.

const SPECIAL_MAPPINGS = {
  // Hyperliquid coin -> Binance USD-M symbol
  'PEPE': '1000PEPEUSDT',
  'LUNC': '1000LUNCUSDT',
  'SHIB': '1000SHIBUSDT',
  'BONK': '1000BONKUSDT',
  'FLOKI': '1000FLOKIUSDT',
  'XEC': '1000XECUSDT',
  'CAT': '1000CATSUSDT',
  'RATS': '1000RATSUSDT',
};

// Reverse mapping: Binance symbol -> HL coin
const REVERSE_MAPPINGS = {};
for (const [coin, binance] of Object.entries(SPECIAL_MAPPINGS)) {
  REVERSE_MAPPINGS[binance] = coin;
}

class SymbolMap {
  constructor() {
    this.binanceFuturesSymbols = new Set();
    this.hlCoins = new Set();
    this.overlap = [];
  }

  setBinanceSymbols(symbols) {
    this.binanceFuturesSymbols = new Set(symbols);
    this._recompute();
  }

  setHLCoins(coins) {
    this.hlCoins = new Set(coins);
    this._recompute();
  }

  _recompute() {
    this.overlap = [];
    for (const coin of this.hlCoins) {
      const binanceSymbol = this.toBinance(coin);
      const available = this.binanceFuturesSymbols.has(binanceSymbol);
      this.overlap.push({
        hlCoin: coin,
        binanceSymbol,
        availableOnBinance: available,
        matchType: SPECIAL_MAPPINGS[coin] ? 'special' : 'standard',
        displaySymbol: coin
      });
    }
  }

  /**
   * Convert Hyperliquid coin name to Binance USD-M symbol
   */
  toBinance(coin) {
    if (SPECIAL_MAPPINGS[coin]) {
      return SPECIAL_MAPPINGS[coin];
    }
    return `${coin}USDT`;
  }

  /**
   * Convert Binance symbol to Hyperliquid coin name
   */
  toHL(binanceSymbol) {
    if (REVERSE_MAPPINGS[binanceSymbol]) {
      return REVERSE_MAPPINGS[binanceSymbol];
    }
    return binanceSymbol.replace('USDT', '');
  }

  /**
   * Get overlap info for all known symbols
   */
  getOverlap() {
    return this.overlap;
  }

  /**
   * Check if a symbol exists on both venues
   */
  existsOnBoth(coin) {
    const binance = this.toBinance(coin);
    return this.hlCoins.has(coin) && this.binanceFuturesSymbols.has(binance);
  }

  /**
   * Get normalized symbol for internal use
   */
  normalize(rawSymbol, source) {
    if (source === 'hyperliquid') return rawSymbol;
    if (source === 'binance_futures' || source === 'binance_spot') {
      return this.toHL(rawSymbol);
    }
    return rawSymbol;
  }
}

module.exports = SymbolMap;
