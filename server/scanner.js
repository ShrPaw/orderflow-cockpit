// Scanner — discovers and ranks symbols by volatility/attention
const EventEmitter = require('events');

class Scanner extends EventEmitter {
  constructor(candleEngine, symbolMap) {
    super();
    this.candleEngine = candleEngine;
    this.symbolMap = symbolMap;
    this.stats = new Map(); // symbol -> stats
    this.pinnedFundamentals = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'SUI', 'DOGE'];
    this.volatilityWatchlist = [
      'LAB', 'PLAY', 'CHIP', 'FHE', 'SKYAI', 'NAORIS', 'BIO', 'TAG',
      'XNY', 'ZEREBRO', 'AIXBT', 'KNC', 'U', 'BSB', '1000LUNC'
    ];
    this.updateInterval = null;
  }

  start() {
    this.updateInterval = setInterval(() => this._update(), 5000);
  }

  stop() {
    if (this.updateInterval) clearInterval(this.updateInterval);
  }

  processTrade(trade) {
    const sym = trade.symbol;
    let s = this.stats.get(sym);
    if (!s) {
      s = {
        symbol: sym,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        tradeCount: 0,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
        delta: 0,
        notional: 0,
        price: 0,
        priceChange: 0,
        priceStart: 0,
        high24h: 0,
        low24h: Infinity,
        bubbleCount: 0,
        absorptionCount: 0,
        rejectionCount: 0,
        largeTradeCount: 0,
        tradeFrequency: 0, // trades per second
        volatilityExpansion: 0,
        attentionScore: 0,
        status: 'NEW',
        source: trade.source,
        windowTrades: [],
        windowVolume: []
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

    if (trade.side === 'buy') {
      s.buyVolume += trade.qty;
      s.delta += trade.qty;
    } else {
      s.sellVolume += trade.qty;
      s.delta -= trade.qty;
    }

    // Rolling window for frequency calc
    const now = Date.now();
    s.windowTrades.push(now);
    s.windowVolume.push(trade.qty);
    // Keep last 60 seconds
    while (s.windowTrades.length > 0 && s.windowTrades[0] < now - 60000) {
      s.windowTrades.shift();
      s.windowVolume.shift();
    }
  }

  _update() {
    const now = Date.now();
    for (const [sym, s] of this.stats) {
      // Price change %
      if (s.priceStart > 0) {
        s.priceChange = ((s.price - s.priceStart) / s.priceStart) * 100;
      }

      // Trade frequency (trades/sec over last 60s)
      s.tradeFrequency = s.windowTrades.length / 60;

      // Volatility expansion (range / midpoint over last 60s)
      if (s.windowTrades.length > 10) {
        const mid = (s.high24h + s.low24h) / 2;
        s.volatilityExpansion = mid > 0 ? ((s.high24h - s.low24h) / mid) * 100 : 0;
      }

      // Attention score (composite)
      s.attentionScore = (
        s.tradeFrequency * 10 +
        s.volatilityExpansion * 5 +
        (s.bubbleCount / Math.max(1, s.tradeCount)) * 100 +
        Math.abs(s.delta) / Math.max(1, s.volume) * 50
      );

      // Status classification
      s.status = this._classify(s);

      // Stale check
      if (now - s.lastSeen > 120000) {
        s.status = 'STALE';
      }
    }

    // Update candle-based stats
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
    if (s.tradeFrequency > 10 && Math.abs(s.delta) / s.volume > 0.3) {
      return s.delta > 0 ? 'AGGRESSIVE_BUY_FLOW' : 'AGGRESSIVE_SELL_FLOW';
    }
    if (s.absorptionCount > 3) return 'ABSORPTION_ACTIVE';
    if (s.rejectionCount > 3) return 'REJECTION_CLUSTER';
    if (s.tradeFrequency > 2 && s.volatilityExpansion > 0.2) return 'WAKING_UP';
    if (s.tradeFrequency > 20) return 'HIGH_ATTENTION';
    if (s.volume < 100) return 'THIN';
    if (s.volatilityExpansion > 1 && s.bubbleCount > 5) return 'CHAOTIC';
    return 'GOOD_FLOW';
  }

  getOverview(mode = 'full') {
    let symbols = [...this.stats.values()];

    switch (mode) {
      case 'pinned':
        symbols = symbols.filter(s => this.pinnedFundamentals.includes(s.symbol));
        break;
      case 'volatility_watchlist':
        symbols = symbols.filter(s => this.volatilityWatchlist.includes(s.symbol));
        break;
      case 'top_movers':
        symbols.sort((a, b) => Math.abs(b.priceChange) - Math.abs(a.priceChange));
        break;
      case 'top_volatility':
        symbols.sort((a, b) => b.volatilityExpansion - a.volatilityExpansion);
        break;
      case 'top_bubbles':
        symbols.sort((a, b) => b.bubbleCount - a.bubbleCount);
        break;
      case 'top_absorption':
        symbols.sort((a, b) => b.absorptionCount - a.absorptionCount);
        break;
      case 'top_attention':
        symbols.sort((a, b) => b.attentionScore - a.attentionScore);
        break;
      default: // full
        symbols.sort((a, b) => b.attentionScore - a.attentionScore);
    }

    return symbols.slice(0, 100).map(s => ({
      symbol: s.symbol,
      source: s.source,
      price: s.price,
      priceChange: s.priceChange,
      volume: s.volume,
      delta: s.delta,
      tradeFrequency: s.tradeFrequency,
      volatilityExpansion: s.volatilityExpansion,
      bubbleCount: s.bubbleCount,
      absorptionCount: s.absorptionCount,
      rejectionCount: s.rejectionCount,
      attentionScore: s.attentionScore,
      status: s.status,
      binanceSymbol: this.symbolMap.toBinance(s.symbol),
      availableOnBinance: this.symbolMap.binanceFuturesSymbols.has(this.symbolMap.toBinance(s.symbol)),
      isPinned: this.pinnedFundamentals.includes(s.symbol),
      isWatchlist: this.volatilityWatchlist.includes(s.symbol)
    }));
  }
}

module.exports = Scanner;
