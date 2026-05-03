// Profile engine — volume/delta profile computation for selected ranges
// Computes: POC, VAH, VAL, HVN, LVN, delta POC, absorption/rejection levels

class ProfileEngine {
  /**
   * Compute full profile for a set of candles within a price range
   */
  static compute(candles, options = {}) {
    const {
      priceLow = null,
      priceHigh = null,
      includeBubbles = true,
      binSize = null
    } = options;

    if (!candles || candles.length === 0) {
      return ProfileEngine.emptyProfile();
    }

    // Determine price range
    let pLow = priceLow ?? Math.min(...candles.map(c => c.low));
    let pHigh = priceHigh ?? Math.max(...candles.map(c => c.high));

    // Determine bin size
    const autoBin = binSize || ProfileEngine._autoBinSize(pLow, pHigh);

    // Aggregate volume by price bin
    const volumeByPrice = new Map();
    let totalVolume = 0;
    let totalBuyVolume = 0;
    let totalSellVolume = 0;
    let totalDelta = 0;
    let totalTradeCount = 0;
    let totalBubbleCount = 0;
    let totalAbsorptionCount = 0;
    let totalRejectionCount = 0;
    let maxTradeSize = 0;

    // Bubble state counters
    const bubbleStates = { accepted: 0, rejected: 0, absorbed: 0, exhausted: 0 };
    let totalBubbleNotional = 0;
    let largestBubble = null;

    for (const candle of candles) {
      totalVolume += candle.volume;
      totalBuyVolume += candle.buyVolume;
      totalSellVolume += candle.sellVolume;
      totalDelta += candle.delta;
      totalTradeCount += candle.tradeCount;
      totalBubbleCount += candle.bubbleCount;
      totalAbsorptionCount += candle.absorptionCount;
      totalRejectionCount += candle.rejectionCount;
      maxTradeSize = Math.max(maxTradeSize, candle.maxTradeSize);

      // Aggregate price levels
      const priceMap = candle.priceMap || {};
      for (const [priceStr, level] of Object.entries(priceMap)) {
        const price = parseFloat(priceStr);
        const bin = Math.round(price / autoBin) * autoBin;

        let entry = volumeByPrice.get(bin);
        if (!entry) {
          entry = { buy: 0, sell: 0, total: 0, delta: 0, maxPrint: 0, trades: 0, absorptions: 0, rejections: 0 };
          volumeByPrice.set(bin, entry);
        }
        entry.buy += level.buy || 0;
        entry.sell += level.sell || 0;
        entry.total += level.total || 0;
        entry.delta += level.delta || 0;
        entry.maxPrint = Math.max(entry.maxPrint, level.maxPrint || 0);
        entry.trades += level.trades || 0;
        entry.absorptions += level.absorptions || 0;
        entry.rejections += level.rejections || 0;
      }

      // Bubble analysis
      if (includeBubbles && candle.bubbles) {
        for (const b of candle.bubbles) {
          if (b.state && bubbleStates[b.state] !== undefined) {
            bubbleStates[b.state]++;
          }
          totalBubbleNotional += b.notional || 0;
          if (!largestBubble || (b.notional || 0) > (largestBubble.notional || 0)) {
            largestBubble = b;
          }
        }
      }
    }

    // Convert to sorted array
    const levels = [];
    for (const [price, data] of volumeByPrice) {
      levels.push({ price, ...data });
    }
    levels.sort((a, b) => a.price - b.price);

    // Find POC (Point of Control) — price with highest volume
    let pocLevel = null;
    let maxVol = 0;
    for (const l of levels) {
      if (l.total > maxVol) {
        maxVol = l.total;
        pocLevel = l;
      }
    }

    // Value Area (70% of volume)
    const vaResult = ProfileEngine._computeValueArea(levels, totalVolume, 0.70);

    // HVN and LVN detection
    const { hvns, lvns } = ProfileEngine._detectNodes(levels);

    // Volume gaps
    const volumeGaps = ProfileEngine._detectGaps(levels);

    // Delta POC — price with highest absolute delta
    let deltaPocLevel = null;
    let maxAbsDelta = 0;
    for (const l of levels) {
      if (Math.abs(l.delta) > maxAbsDelta) {
        maxAbsDelta = Math.abs(l.delta);
        deltaPocLevel = l;
      }
    }

    // Max positive/negative delta levels
    let maxPosDelta = null;
    let maxNegDelta = null;
    let maxPos = 0;
    let maxNeg = 0;
    for (const l of levels) {
      if (l.delta > maxPos) { maxPos = l.delta; maxPosDelta = l; }
      if (l.delta < maxNeg) { maxNeg = l.delta; maxNegDelta = l; }
    }

    // Stacked imbalance detection
    const stackedPositive = ProfileEngine._detectStackedImbalance(levels, 'positive');
    const stackedNegative = ProfileEngine._detectStackedImbalance(levels, 'negative');

    // Absorption/rejection levels
    const absorptionLevels = levels.filter(l => l.absorptions > 0).map(l => ({
      price: l.price,
      count: l.absorptions
    }));
    const rejectionLevels = levels.filter(l => l.rejections > 0).map(l => ({
      price: l.price,
      count: l.rejections
    }));

    // Time range
    const timeStart = candles[0]?.openTime || 0;
    const timeEnd = candles[candles.length - 1]?.closeTime || 0;

    // VWAP
    let vwapNum = 0;
    let vwapDen = 0;
    for (const candle of candles) {
      const typical = (candle.high + candle.low + candle.close) / 3;
      vwapNum += typical * candle.volume;
      vwapDen += candle.volume;
    }
    const vwap = vwapDen > 0 ? vwapNum / vwapDen : 0;

    // Directional efficiency
    const rangeHigh = pHigh;
    const rangeLow = pLow;
    const rangeSize = rangeHigh - rangeLow;
    const netMove = (candles[candles.length - 1]?.close || 0) - (candles[0]?.open || 0);
    const directionalEfficiency = rangeSize > 0 ? netMove / rangeSize : 0;

    // Close location
    const lastClose = candles[candles.length - 1]?.close || 0;
    const closeLocation = rangeSize > 0 ? (lastClose - rangeLow) / rangeSize : 0.5;

    // Dominant side
    const dominantSide = totalDelta > 0 ? 'buy' : totalDelta < 0 ? 'sell' : 'neutral';

    // Acceptance above/below POC
    const pocPrice = pocLevel ? pocLevel.price : (rangeHigh + rangeLow) / 2;
    let volAbovePoc = 0;
    let volBelowPoc = 0;
    for (const l of levels) {
      if (l.price > pocPrice) volAbovePoc += l.total;
      if (l.price < pocPrice) volBelowPoc += l.total;
    }
    const acceptance = volAbovePoc > volBelowPoc ? 'above_poc' : volBelowPoc > volAbovePoc ? 'below_poc' : 'balanced';

    return {
      timeRange: { start: timeStart, end: timeEnd },
      priceRange: { low: rangeHigh, high: rangeHigh },
      binSize: autoBin,
      totalVolume,
      buyVolume: totalBuyVolume,
      sellVolume: totalSellVolume,
      delta: totalDelta,
      tradeCount: totalTradeCount,
      maxTradeSize,
      poc: pocLevel ? pocLevel.price : null,
      pocVolume: pocLevel ? pocLevel.total : 0,
      vah: vaResult.vah,
      val: vaResult.val,
      hvns: hvns.map(h => h.price),
      lvns: lvns.map(l => l.price),
      volumeGaps,
      deltaPoc: deltaPocLevel ? deltaPocLevel.price : null,
      maxPositiveDeltaLevel: maxPosDelta ? maxPosDelta.price : null,
      maxNegativeDeltaLevel: maxNegDelta ? maxNegDelta.price : null,
      stackedPositive,
      stackedNegative,
      absorptionLevels,
      rejectionLevels,
      vwap,
      directionalEfficiency,
      closeLocation,
      acceptance,
      dominantSide,
      bubbleCount: totalBubbleCount,
      bubbleStates,
      totalBubbleNotional,
      largestBubble: largestBubble ? { price: largestBubble.price, notional: largestBubble.notional, side: largestBubble.side, state: largestBubble.state } : null,
      absorptionCount: totalAbsorptionCount,
      rejectionCount: totalRejectionCount,
      levels // full price-level detail
    };
  }

  static _computeValueArea(levels, totalVolume, pct) {
    if (levels.length === 0) return { vah: null, val: null };

    // Find POC index
    let pocIdx = 0;
    let maxVol = 0;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].total > maxVol) {
        maxVol = levels[i].total;
        pocIdx = i;
      }
    }

    const targetVol = totalVolume * pct;
    let vaVol = levels[pocIdx].total;
    let hi = pocIdx;
    let lo = pocIdx;

    while (vaVol < targetVol && (hi < levels.length - 1 || lo > 0)) {
      const upVol = hi < levels.length - 1 ? levels[hi + 1].total : 0;
      const dnVol = lo > 0 ? levels[lo - 1].total : 0;

      if (upVol >= dnVol && hi < levels.length - 1) {
        hi++;
        vaVol += levels[hi].total;
      } else if (lo > 0) {
        lo--;
        vaVol += levels[lo].total;
      } else {
        break;
      }
    }

    return {
      vah: levels[hi]?.price ?? null,
      val: levels[lo]?.price ?? null
    };
  }

  static _detectNodes(levels) {
    if (levels.length < 3) return { hvns: [], lvns: [] };

    const avgVol = levels.reduce((s, l) => s + l.total, 0) / levels.length;
    const hvns = [];
    const lvns = [];

    for (let i = 1; i < levels.length - 1; i++) {
      const prev = levels[i - 1].total;
      const curr = levels[i].total;
      const next = levels[i + 1].total;

      if (curr > prev && curr > next && curr > avgVol * 1.5) {
        hvns.push(levels[i]);
      }
      if (curr < prev && curr < next && curr < avgVol * 0.5) {
        lvns.push(levels[i]);
      }
    }

    return { hvns, lvns };
  }

  static _detectGaps(levels) {
    const gaps = [];
    for (let i = 1; i < levels.length; i++) {
      const gap = levels[i].price - levels[i - 1].price;
      const avgTotal = (levels[i].total + levels[i - 1].total) / 2;
      if (avgTotal > 0 && gap > levels[i].price * 0.005) {
        gaps.push({
          low: levels[i - 1].price,
          high: levels[i].price,
          gap
        });
      }
    }
    return gaps;
  }

  static _detectStackedImbalance(levels, direction) {
    const imbalances = [];
    for (let i = 2; i < levels.length; i++) {
      const a = levels[i - 2];
      const b = levels[i - 1];
      const c = levels[i];

      if (direction === 'positive') {
        if (a.buy > a.sell * 3 && b.buy > b.sell * 3 && c.buy > c.sell * 3) {
          imbalances.push({ start: a.price, end: c.price, count: 3 });
        }
      } else {
        if (a.sell > a.buy * 3 && b.sell > b.buy * 3 && c.sell > c.buy * 3) {
          imbalances.push({ start: a.price, end: c.price, count: 3 });
        }
      }
    }
    return imbalances;
  }

  static _autoBinSize(low, high) {
    const range = high - low;
    if (range > 1000) return 10;
    if (range > 100) return 5;
    if (range > 50) return 2;
    if (range > 10) return 1;
    if (range > 1) return 0.1;
    if (range > 0.1) return 0.01;
    return 0.001;
  }

  static emptyProfile() {
    return {
      timeRange: { start: 0, end: 0 },
      priceRange: { low: 0, high: 0 },
      binSize: 0,
      totalVolume: 0,
      buyVolume: 0,
      sellVolume: 0,
      delta: 0,
      tradeCount: 0,
      maxTradeSize: 0,
      poc: null,
      pocVolume: 0,
      vah: null,
      val: null,
      hvns: [],
      lvns: [],
      volumeGaps: [],
      deltaPoc: null,
      maxPositiveDeltaLevel: null,
      maxNegativeDeltaLevel: null,
      stackedPositive: [],
      stackedNegative: [],
      absorptionLevels: [],
      rejectionLevels: [],
      vwap: 0,
      directionalEfficiency: 0,
      closeLocation: 0.5,
      acceptance: 'balanced',
      dominantSide: 'neutral',
      bubbleCount: 0,
      bubbleStates: { accepted: 0, rejected: 0, absorbed: 0, exhausted: 0 },
      totalBubbleNotional: 0,
      largestBubble: null,
      absorptionCount: 0,
      rejectionCount: 0,
      levels: []
    };
  }

  /**
   * Generate interpretation text for a profile
   */
  static interpret(profile) {
    const parts = [];

    if (profile.dominantSide === 'buy') {
      parts.push(`Buy-side dominance (delta: ${profile.delta.toFixed(2)})`);
    } else if (profile.dominantSide === 'sell') {
      parts.push(`Sell-side dominance (delta: ${profile.delta.toFixed(2)})`);
    }

    if (profile.poc && profile.acceptance === 'above_poc') {
      parts.push('Price acceptance above POC — buyers in control');
    } else if (profile.poc && profile.acceptance === 'below_poc') {
      parts.push('Price acceptance below POC — sellers in control');
    } else {
      parts.push('Balanced acceptance around POC');
    }

    if (profile.absorptionLevels.length > 0) {
      parts.push(`${profile.absorptionLevels.length} absorption level(s) detected`);
    }
    if (profile.rejectionLevels.length > 0) {
      parts.push(`${profile.rejectionLevels.length} rejection level(s) detected`);
    }

    if (profile.bubbleStates.rejected > 0) {
      parts.push(`${profile.bubbleStates.rejected} rejected bubble(s) — aggression failed`);
    }
    if (profile.bubbleStates.absorbed > 0) {
      parts.push(`${profile.bubbleStates.absorbed} absorbed bubble(s) — passive defense`);
    }

    if (profile.directionalEfficiency > 0.5) {
      parts.push('Strong directional efficiency — trending move');
    } else if (profile.directionalEfficiency < -0.5) {
      parts.push('Strong negative efficiency — reversal or rejection');
    } else {
      parts.push('Low directional efficiency — rotational/consolidative');
    }

    return parts.join('. ') + '.';
  }
}

module.exports = ProfileEngine;
