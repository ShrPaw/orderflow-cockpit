// Scanner — discovers and ranks symbols by volatility/attention
const EventEmitter = require('events');

class Scanner extends EventEmitter {
  constructor(candleEngine, symbolMap) {
    super();
    this.candleEngine = candleEngine;
    this.symbolMap = symbolMap;
    this.stats = new Map();
    this.pinnedFundamentals = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'SUI', 'DOGE', 'HYPE'];
    this.volatilityWatchlist = [
      'LAB', 'ORCA', 'PLAY', 'CHIP', 'FHE', 'SKYAI', 'NAORIS', 'BIO', 'TAG',
      'XNY', 'ZEREBRO', 'AIXBT', 'KNC', 'UB', 'BSB', '1000LUNC'
    ];
    this.updateInterval = null;
    this.hydrated = { hyperliquid: false, binance: false };
    this.startedAt = null;
    this.lastError = null;
  }

  start() {
    this.startedAt = Date.now();
    this.updateInterval = setInterval(() => this._update(), 5000);
    console.log('[Scanner] Started');
  }

  stop() { if (this.updateInterval) clearInterval(this.updateInterval); }

  setHydrated(source) {
    this.hydrated[source] = true;
    console.log(`[Scanner] Hydrated: ${source} | HL=${this.symbolMap.hlCoins.size} | Binance=${this.symbolMap.binanceFuturesSymbols.size}`);
  }

  processTrade(trade) {
    const sym = trade.symbol;
    let s = this.stats.get(sym);
    if (!s) {
      s = {
        symbol: sym, firstSeen: Date.now(), lastSeen: Date.now(),
        tradeCount: 0, volume: 0, buyVolume: 0, sellVolume: 0, delta: 0,
        notional: 0, price: 0, priceChange: 0, priceStart: 0,
        high24h: 0, low24h: Infinity,
        bubbleCount: 0, absorptionCount: 0, rejectionCount: 0, zoneCount: 0,
        largeTradeCount: 0, tradeFrequency: 0, volatilityExpansion: 0,
        attentionScore: 0, status: 'NEW', source: trade.source,
        windowTrades: [], windowVolume: []
      };
      this.stats.set(sym, s);
    }
    s.lastSeen = Date.now();
    s.tradeCount++;
    s.volume += trade.qty;
    s.notional += trade.price * trade.qty;
    s.price = trade.price;
    if (s.priceStart === 0) s.priceStart = trade.price;
    s.high24h = Math.max(s.high24h, trade.price);
    s.low24h = Math.min(s.low24h, trade.price);
    if (trade.side === 'buy') { s.buyVolume += trade.qty; s.delta += trade.qty; }
    else { s.sellVolume += trade.qty; s.delta -= trade.qty; }

    const now = Date.now();
    s.windowTrades.push(now);
    s.windowVolume.push(trade.qty);
    while (s.windowTrades.length > 0 && s.windowTrades[0] < now - 60000) { s.windowTrades.shift(); s.windowVolume.shift(); }
  }

  _update() {
    const now = Date.now();
    for (const [sym, s] of this.stats) {
      if (s.priceStart > 0) s.priceChange = ((s.price - s.priceStart) / s.priceStart) * 100;
      s.tradeFrequency = s.windowTrades.length / 60;
      if (s.windowTrades.length > 10) {
        const mid = (s.high24h + s.low24h) / 2;
        s.volatilityExpansion = mid > 0 ? ((s.high24h - s.low24h) / mid) * 100 : 0;
      }
      s.attentionScore = s.tradeFrequency * 10 + s.volatilityExpansion * 5 +
        (s.bubbleCount / Math.max(1, s.tradeCount)) * 100 + Math.abs(s.delta) / Math.max(1, s.volume) * 50;
      s.status = this._classify(s);
      if (now - s.lastSeen > 120000) s.status = 'STALE';
    }
    for (const [sym, s] of this.stats) {
      const candle = this.candleEngine.getCurrentCandle(sym);
      if (candle) {
        s.bubbleCount = candle.bubbleCount;
        s.absorptionCount = candle.absorptionCount;
        s.rejectionCount = candle.rejectionCount;
        s.largeTradeCount = candle.largeTradeCount;
      }
    }
  }

  _classify(s) {
    if (s.tradeFrequency > 5 && s.volatilityExpansion > 0.5) return 'EXPANDING';
    if (s.tradeFrequency > 10 && Math.abs(s.delta) / s.volume > 0.3) return s.delta > 0 ? 'AGGRESSIVE_BUY_FLOW' : 'AGGRESSIVE_SELL_FLOW';
    if (s.absorptionCount > 3) return 'ABSORPTION_ACTIVE';
    if (s.rejectionCount > 3) return 'REJECTION_CLUSTER';
    if (s.tradeFrequency > 2 && s.volatilityExpansion > 0.2) return 'WAKING_UP';
    if (s.tradeFrequency > 20) return 'HIGH_ATTENTION';
    if (s.volume < 100) return 'THIN';
    if (s.volatilityExpansion > 1 && s.bubbleCount > 5) return 'CHAOTIC';
    if (s.tradeFrequency < 0.5 && s.volatilityExpansion < 0.1) return 'QUIET';
    if (s.source !== 'hyperliquid') return 'SOURCE_LIMITED';
    return 'GOOD_FLOW';
  }

  _getDataQuality(s) {
    const parts = [];
    if (this.hydrated.hyperliquid) parts.push('HYPERLIQUID_DEEP');
    if (s.tradeCount > 0) parts.push('HYPERLIQUID_TRADES');
    if (s.source === 'hyperliquid') parts.push('HYPERLIQUID_BOOK');
    const bnSymbol = this.symbolMap.toBinance(s.symbol);
    if (this.symbolMap.binanceFuturesSymbols.has(bnSymbol)) parts.push('BINANCE_USDM_REFERENCE');
    parts.push('BINANCE_SPOT_DEBUG_DISABLED');
    return parts.join(', ');
  }

  getScannerResponse(mode = 'top_attention') {
    try {
      if (!this.hydrated.hyperliquid && !this.hydrated.binance) {
        return { ok: false, rows: [], reason: 'universe_not_loaded', hydrated: this.hydrated, lastError: this.lastError };
      }

      let symbols = [...this.stats.values()];

      if (mode === 'full_hyperliquid') {
        symbols = [];
        for (const coin of this.symbolMap.hlCoins) {
          const existing = this.stats.get(coin);
          symbols.push(existing || {
            symbol: coin, source: 'hyperliquid', price: 0, priceChange: 0,
            volume: 0, delta: 0, tradeFrequency: 0, volatilityExpansion: 0,
            bubbleCount: 0, absorptionCount: 0, rejectionCount: 0, zoneCount: 0,
            attentionScore: 0, status: 'NO_DATA', tradeCount: 0,
            firstSeen: Date.now(), lastSeen: 0, priceStart: 0, high24h: 0,
            low24h: Infinity, notional: 0, buyVolume: 0, sellVolume: 0,
            largeTradeCount: 0, windowTrades: [], windowVolume: []
          });
        }
        symbols.sort((a, b) => b.attentionScore - a.attentionScore);
      } else {
        switch (mode) {
          case 'pinned': symbols = symbols.filter(s => this.pinnedFundamentals.includes(s.symbol)); break;
          case 'volatility_watchlist': symbols = symbols.filter(s => this.volatilityWatchlist.includes(s.symbol)); break;
          case 'hl_binance_overlap': symbols = symbols.filter(s => this.symbolMap.binanceFuturesSymbols.has(this.symbolMap.toBinance(s.symbol))); break;
          case 'top_bubbles': symbols.sort((a, b) => b.bubbleCount - a.bubbleCount); break;
          case 'top_absorption': symbols.sort((a, b) => (b.absorptionCount + b.rejectionCount) - (a.absorptionCount + a.rejectionCount)); break;
          case 'top_volatility': symbols.sort((a, b) => b.volatilityExpansion - a.volatilityExpansion); break;
          case 'top_attention': default: symbols.sort((a, b) => b.attentionScore - a.attentionScore); break;
        }
      }

      if (symbols.length === 0) return { ok: false, rows: [], reason: 'no_price_data', hydrated: this.hydrated, lastError: this.lastError };

      const rows = symbols.slice(0, 200).map(s => {
        const bnSymbol = this.symbolMap.toBinance(s.symbol);
        return {
          hlSymbol: s.symbol, binanceSymbol: bnSymbol,
          availableOnBinance: this.symbolMap.binanceFuturesSymbols.has(bnSymbol),
          matchType: this.symbolMap.specialMappings[s.symbol] ? 'special' : 'standard',
          price: s.price, change24h: s.priceChange, volume: s.volume,
          volatilityExpansion: s.volatilityExpansion, tradeFrequency: s.tradeFrequency,
          bubbleCount: s.bubbleCount, absorptionCount: s.absorptionCount,
          rejectionCount: s.rejectionCount, zoneCount: s.zoneCount,
          attentionScore: s.attentionScore, statusTag: s.status,
          dataQuality: this._getDataQuality(s),
          isPinned: this.pinnedFundamentals.includes(s.symbol),
          isWatchlist: this.volatilityWatchlist.includes(s.symbol),
          source: s.source, tradeCount: s.tradeCount, delta: s.delta
        };
      });

      return { ok: true, rows, count: rows.length, source: 'hyperliquid', hydrated: this.hydrated, reason: null };
    } catch (e) {
      this.lastError = e.message;
      return { ok: false, rows: [], reason: 'parse_error', lastError: e.message };
    }
  }
}

module.exports = Scanner;
