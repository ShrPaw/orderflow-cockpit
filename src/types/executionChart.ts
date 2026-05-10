/**
 * executionChart.ts
 *
 * Types for the unified execution chart — Lightweight Charts base + custom overlay.
 */

import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import type { Candle, Bubble, OrderLevel, OrderBookHealth, VolumeLevel } from './market'
import type { AuctionCluster } from '../utils/auctionClusters'
import type { LevelRecord } from '../utils/levelMemory'

/** Coordinate-mapped point on the overlay canvas */
export interface PixelCoord {
  x: number
  y: number
}

/** Frame of data the overlay renderer needs each draw call */
export interface OverlayFrame {
  /** Closed candles + current candle merged */
  allCandles: Candle[]
  /** Live price for price line */
  livePrice: number
  /** Order book bid levels */
  bids: OrderLevel[]
  /** Order book ask levels */
  asks: OrderLevel[]
  /** All bubbles from visible candles */
  bubbles: Bubble[]
  /** Interval in ms */
  intervalMs: number
  /** Current symbol */
  symbol: string
  /** Auction clusters (used for enrichment context in Smart Flow) */
  clusters: AuctionCluster[]
  /** Order book health state */
  orderBookHealth: OrderBookHealth
  /** Level memory records */
  levelRecords: LevelRecord[]
  /** Whether chart is following live */
  followLive: boolean
  /** Current timestamp */
  now: number
}

/** Context passed to the overlay renderer */
export interface OverlayRenderContext {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  dpr: number
  chart: IChartApi
  candleSeries: ISeriesApi<'Candlestick'>
  frame: OverlayFrame
}

/** Exposed chart API for toolbar integration */
export interface ExecutionChartApi {
  goLive: () => void
  resetView: () => void
  fitAll: () => void
  fitRecent: () => void
  getChart: () => IChartApi | null
}
