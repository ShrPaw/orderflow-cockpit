// Profile engine — volume/delta profile for selected ranges
// Computes: POC, VAH, VAL, HVN, LVN, delta POC, absorption/rejection levels

class ProfileEngine {
  static compute(candles, options = {}) {
    const { priceLow = null, priceHigh = null, binSize = null } = options;
    if (!candles || candles.length === 0) return ProfileEngine.emptyProfile();

    let pLow = priceLow ?? Math.min(...candles.map(c => c.low));
    let pHigh = priceHigh ?? Math.max(...candles.map(c => c.high));
    if (pLow > pHigh) { const t = pLow; pLow = pHigh; pHigh = t; }

    const autoBin = binSize || ProfileEngine._autoBinSize(pLow, pHigh);
    const volumeByPrice = new Map();
    let totalVolume = 0, totalBuyVolume = 0, totalSellVolume = 0, totalDelta = 0;
    let totalTradeCount = 0, maxTradeSize = 0;
    let totalBubbleCount = 0, totalAbsorptionCount = 0, totalRejectionCount = 0;
    const bubbleStates = { accepted: 0, rejected: 0, absorbed: 0, exhausted: 0 };

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

      if (candle.bubbles) {
        for (const b of candle.bubbles) {
          if (b.state && bubbleStates[b.state] !== undefined) bubbleStates[b.state]++;
        }
      }
    }

    const levels = [];
    for (const [price, data] of volumeByPrice) levels.push({ price, ...data });
    levels.sort((a, b) => a.price - b.price);

    // POC
    let pocLevel = null, maxVol = 0;
    for (const l of levels) { if (l.total > maxVol) { maxVol = l.total; pocLevel = l; } }

    // Value Area (70%)
    const vaResult = ProfileEngine._computeValueArea(levels, totalVolume, 0.70);

    // HVN/LVN
    const { hvns, lvns } = ProfileEngine._detectNodes(levels);

    // Delta POC
    let deltaPocLevel = null, maxAbsDelta = 0;
    for (const l of levels) { if (Math.abs(l.delta) > maxAbsDelta) { maxAbsDelta = Math.abs(l.delta); deltaPocLevel = l; } }

    // VWAP
    let vwapNum = 0, vwapDen = 0;
    for (const c of candles) {
      const typical = (c.high + c.low + c.close) / 3;
      vwapNum += typical * c.volume;
      vwapDen += c.volume;
    }
    const vwap = vwapDen > 0 ? vwapNum / vwapDen : 0;

    // Directional efficiency
    const rangeSize = pHigh - pLow;
    const netMove = (candles[candles.length - 1]?.close || 0) - (candles[0]?.open || 0);
    const directionalEfficiency = rangeSize > 0 ? netMove / rangeSize : 0;

    // Dominant side
    const dominantSide = totalDelta > 0 ? 'buy' : totalDelta < 0 ? 'sell' : 'neutral';

    // Acceptance above/below POC
    const pocPrice = pocLevel ? pocLevel.price : (pHigh + pLow) / 2;
    let volAbovePoc = 0, volBelowPoc = 0;
    for (const l of levels) {
      if (l.price > pocPrice) volAbovePoc += l.total;
      if (l.price < pocPrice) volBelowPoc += l.total;
    }
    const acceptance = volAbovePoc > volBelowPoc ? 'above_poc' : volBelowPoc > volAbovePoc ? 'below_poc' : 'balanced';

    // Absorption/rejection levels
    const absorptionLevels = levels.filter(l => l.absorptions > 0).map(l => ({ price: l.price, count: l.absorptions }));
    const rejectionLevels = levels.filter(l => l.rejections > 0).map(l => ({ price: l.price, count: l.rejections }));

    return {
      timeRange: { start: candles[0]?.openTime || 0, end: candles[candles.length - 1]?.closeTime || 0 },
      priceRange: { low: pLow, high: pHigh }, binSize: autoBin,
      totalVolume, buyVolume: totalBuyVolume, sellVolume: totalSellVolume, delta: totalDelta,
      tradeCount: totalTradeCount, maxTradeSize,
      poc: pocLevel?.price ?? null, pocVolume: pocLevel?.total ?? 0,
      vah: vaResult.vah, val: vaResult.val,
      hvns: hvns.map(h => h.price), lvns: lvns.map(l => l.price),
      deltaPoc: deltaPocLevel?.price ?? null,
      absorptionLevels, rejectionLevels,
      vwap, directionalEfficiency, dominantSide, acceptance,
      bubbleCount: totalBubbleCount, bubbleStates,
      absorptionCount: totalAbsorptionCount, rejectionCount: totalRejectionCount,
      levels
    };
  }

  static _computeValueArea(levels, totalVolume, pct) {
    if (levels.length === 0) return { vah: null, val: null };
    let pocIdx = 0, maxVol = 0;
    for (let i = 0; i < levels.length; i++) { if (levels[i].total > maxVol) { maxVol = levels[i].total; pocIdx = i; } }
    const targetVol = totalVolume * pct;
    let vaVol = levels[pocIdx].total, hi = pocIdx, lo = pocIdx;
    while (vaVol < targetVol && (hi < levels.length - 1 || lo > 0)) {
      const upVol = hi < levels.length - 1 ? levels[hi + 1].total : 0;
      const dnVol = lo > 0 ? levels[lo - 1].total : 0;
      if (upVol >= dnVol && hi < levels.length - 1) { hi++; vaVol += levels[hi].total; }
      else if (lo > 0) { lo--; vaVol += levels[lo].total; } else break;
    }
    return { vah: levels[hi]?.price ?? null, val: levels[lo]?.price ?? null };
  }

  static _detectNodes(levels) {
    if (levels.length < 3) return { hvns: [], lvns: [] };
    const avgVol = levels.reduce((s, l) => s + l.total, 0) / levels.length;
    const hvns = [], lvns = [];
    for (let i = 1; i < levels.length - 1; i++) {
      const prev = levels[i - 1].total, curr = levels[i].total, next = levels[i + 1].total;
      if (curr > prev && curr > next && curr > avgVol * 1.5) hvns.push(levels[i]);
      if (curr < prev && curr < next && curr < avgVol * 0.5) lvns.push(levels[i]);
    }
    return { hvns, lvns };
  }

  static _autoBinSize(low, high) {
    const range = high - low;
    if (range > 1000) return 10; if (range > 100) return 5; if (range > 50) return 2;
    if (range > 10) return 1; if (range > 1) return 0.1; if (range > 0.1) return 0.01; return 0.001;
  }

  static emptyProfile() {
    return {
      timeRange: { start: 0, end: 0 }, priceRange: { low: 0, high: 0 }, binSize: 0,
      totalVolume: 0, buyVolume: 0, sellVolume: 0, delta: 0, tradeCount: 0, maxTradeSize: 0,
      poc: null, pocVolume: 0, vah: null, val: null, hvns: [], lvns: [], deltaPoc: null,
      absorptionLevels: [], rejectionLevels: [], vwap: 0, directionalEfficiency: 0,
      dominantSide: 'neutral', acceptance: 'balanced', bubbleCount: 0,
      bubbleStates: { accepted: 0, rejected: 0, absorbed: 0, exhausted: 0 },
      absorptionCount: 0, rejectionCount: 0, levels: []
    };
  }

  static interpret(profile) {
    const parts = [];
    if (profile.dominantSide === 'buy') parts.push(`Buy-side dominance (delta: ${profile.delta.toFixed(2)})`);
    else if (profile.dominantSide === 'sell') parts.push(`Sell-side dominance (delta: ${profile.delta.toFixed(2)})`);
    if (profile.poc && profile.acceptance === 'above_poc') parts.push('Price acceptance above POC — buyers in control');
    else if (profile.poc && profile.acceptance === 'below_poc') parts.push('Price acceptance below POC — sellers in control');
    else parts.push('Balanced acceptance around POC');
    if (profile.absorptionLevels.length > 0) parts.push(`${profile.absorptionLevels.length} absorption level(s)`);
    if (profile.rejectionLevels.length > 0) parts.push(`${profile.rejectionLevels.length} rejection level(s)`);
    if (profile.bubbleStates.rejected > 0) parts.push(`${profile.bubbleStates.rejected} rejected bubble(s) — aggression failed`);
    if (profile.bubbleStates.absorbed > 0) parts.push(`${profile.bubbleStates.absorbed} absorbed bubble(s) — passive defense`);
    if (profile.directionalEfficiency > 0.5) parts.push('Strong directional efficiency — trending');
    else if (profile.directionalEfficiency < -0.5) parts.push('Strong negative efficiency — reversal');
    else parts.push('Low directional efficiency — rotational');
    return parts.join('. ') + '.';
  }
}

module.exports = ProfileEngine;
