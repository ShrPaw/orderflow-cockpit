/**
 * bubbleMethodology.ts
 *
 * ─── Financial Interpretation ───
 *
 * A bubble is NOT a trading signal.
 * A bubble is a VISUAL RECORD of an aggressive flow event and the
 * market's observed reaction to that event.
 *
 * ─── Visual Grammar ───
 *
 * The primary visual identity is SIDE (buy/sell), not state.
 * - Buy aggression → GREEN base
 * - Sell aggression → RED base
 *
 * State modifies the visual but does not erase side identity:
 * - ACCEPTED: clean fill, strong readability
 * - REJECTED: failure indicator, origin still visible
 * - ABSORBED: ring-style, shrinking over time, origin accent
 * - EXHAUSTED: faded, low intensity
 * - INVALIDATED: dashed/broken, warning style
 * - RESISTANCE: purple primary, origin accent preserved
 *
 * Size encodes notional (order magnitude).
 * Age modifies intensity, not identity.
 */

import type { Bubble, BubbleState } from '../types/market'

// ═══════════════════════════════════════════
// A. EVENT AGE PHASE
// ═══════════════════════════════════════════

export type BubbleAgePhase = 'FRESH' | 'ACTIVE' | 'FADING' | 'EXPIRED'

export const BUBBLE_FRESH_MS = 30_000
export const BUBBLE_ACTIVE_MS = 180_000
export const BUBBLE_FADE_MS = 600_000
export const BUBBLE_EXPIRE_MS = 900_000

export function getBubbleAgePhase(
  bubble: Bubble,
  now: number,
  _intervalMs: number
): BubbleAgePhase {
  const age = now - bubble.timestamp
  if (age < 0) return 'FRESH'
  if (age < BUBBLE_FRESH_MS) return 'FRESH'
  if (age < BUBBLE_ACTIVE_MS) return 'ACTIVE'
  if (age < BUBBLE_FADE_MS) return 'FADING'
  return 'EXPIRED'
}

// ═══════════════════════════════════════════
// B. RENDER RELEVANCE
// ═══════════════════════════════════════════

export const MAX_RENDERED_BUBBLES = 60

export function shouldRenderBubble(
  bubble: Bubble,
  now: number,
  intervalMs: number
): boolean {
  if (!bubble.timestamp || bubble.timestamp <= 0) return false
  if (!isFinite(bubble.price) || bubble.price <= 0) return false
  const phase = getBubbleAgePhase(bubble, now, intervalMs)
  if (phase === 'EXPIRED') return false
  return true
}

export function getRenderableBubbles(
  bubbles: Bubble[],
  now: number,
  intervalMs: number
): Bubble[] {
  const phasePriority: Record<BubbleAgePhase, number> = {
    FRESH: 3, ACTIVE: 2, FADING: 1, EXPIRED: 0,
  }
  const scored: Array<{ bubble: Bubble; score: number }> = []
  for (const bubble of bubbles) {
    if (!shouldRenderBubble(bubble, now, intervalMs)) continue
    const phase = getBubbleAgePhase(bubble, now, intervalMs)
    const ageScore = phasePriority[phase] * 1_000_000
    const notionalScore = Math.min(999_999, bubble.notional)
    scored.push({ bubble, score: ageScore + notionalScore })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, MAX_RENDERED_BUBBLES).map(s => s.bubble)
}

// ═══════════════════════════════════════════
// C. VISUAL ENCODING — SIDE-BASED COLOR SYSTEM
// ═══════════════════════════════════════════

export interface BubbleVisualStyle {
  fillColor: string
  fillAlpha: number
  strokeColor: string
  strokeAlpha: number
  strokeWidth: number
  dashed: boolean
  radius: number
  /** Side indicator: direction of notch (-1=up/buy, 1=down/sell) */
  sideDirection: number
  /** Accent color for side origin indicator */
  sideAccentColor: string
  /** Size of directional notch triangle */
  sideNotchSize: number
  /** Whether this is a ring-style (absorbed) rendering */
  ringStyle: boolean
  /** Whether to draw a broken/crossed outline (invalidated) */
  brokenOutline: boolean
}

// ─── Side × State color matrix ───
// PRIMARY IDENTITY = SIDE (green for buy, red for sell)
// STATE modifies style but does NOT erase side identity
//
// RESISTANCE = purple primary, with origin accent preserved

interface SideStateColors {
  fill: string
  stroke: string
}

const SIDE_STATE_COLORS: Record<string, SideStateColors> = {
  // ─── BUY side (green base) ───
  'buy-PENDING':     { fill: '#34d399', stroke: '#34d399' },   // green, waiting
  'buy-ACCEPTED':    { fill: '#2dd4a0', stroke: '#2dd4a0' },   // teal-green, confirmed
  'buy-REJECTED':    { fill: '#f87171', stroke: '#ef4444' },   // red stroke (failure), green tint remains
  'buy-ABSORBED':    { fill: '#2dd4a0', stroke: '#4fc3f7' },   // green fill faint, cyan ring
  'buy-EXHAUSTED':   { fill: '#4a7a6a', stroke: '#3d5f52' },   // muted green-gray
  'buy-INVALIDATED': { fill: '#f97316', stroke: '#ea580c' },   // orange warning
  'buy-RESISTANCE':  { fill: '#a855f7', stroke: '#22c55e' },   // purple primary + green origin accent

  // ─── SELL side (red base) ───
  'sell-PENDING':     { fill: '#f87171', stroke: '#f87171' },   // red, waiting
  'sell-ACCEPTED':    { fill: '#ef6461', stroke: '#ef6461' },   // red, confirmed
  'sell-REJECTED':    { fill: '#34d399', stroke: '#2dd4a0' },   // green stroke (failure), red tint remains
  'sell-ABSORBED':    { fill: '#ef6461', stroke: '#4fc3f7' },   // red fill faint, cyan ring
  'sell-EXHAUSTED':   { fill: '#7a4a4a', stroke: '#5f3d3d' },   // muted red-gray
  'sell-INVALIDATED': { fill: '#f97316', stroke: '#ea580c' },   // orange warning
  'sell-RESISTANCE':  { fill: '#a855f7', stroke: '#ef6461' },   // purple primary + red origin accent
}

// ─── Age phase modifiers ───
// Age modifies INTENSITY only, not side/state identity
const AGE_MODIFIERS = {
  FRESH:   { fillAlphaMul: 1.0, strokeAlphaMul: 1.0, radiusMul: 1.0 },
  ACTIVE:  { fillAlphaMul: 0.85, strokeAlphaMul: 0.9, radiusMul: 0.95 },
  FADING:  { fillAlphaMul: 0.5, strokeAlphaMul: 0.6, radiusMul: 0.85 },
  EXPIRED: { fillAlphaMul: 0.0, strokeAlphaMul: 0.0, radiusMul: 0.0 },
} as const

// ─── Notional radius mapping ───
const RADIUS_MIN = 5
const RADIUS_MAX = 24
const RADIUS_WHALE = 28
const RADIUS_LOG_MIN = 3   // log10(1000)
const RADIUS_LOG_MAX = 6   // log10(1_000_000)

// ─── State-specific base alphas ───
// These determine how prominent the bubble is before age/zoom modifiers
const STATE_BASE_FILL_ALPHA: Record<BubbleState, number> = {
  PENDING: 0.20,
  ACCEPTED: 0.22,
  REJECTED: 0.18,
  ABSORBED: 0.06,
  EXHAUSTED: 0.05,
  INVALIDATED: 0.14,
  RESISTANCE: 0.16,
}

const STATE_BASE_STROKE_ALPHA: Record<BubbleState, number> = {
  PENDING: 0.40,
  ACCEPTED: 0.60,
  REJECTED: 0.70,
  ABSORBED: 0.80,
  EXHAUSTED: 0.18,
  INVALIDATED: 0.55,
  RESISTANCE: 0.75,
}

const STATE_LINE_WIDTH: Record<BubbleState, number> = {
  PENDING: 1.0,
  ACCEPTED: 1.5,
  REJECTED: 2.0,
  ABSORBED: 2.5,
  EXHAUSTED: 0.7,
  INVALIDATED: 1.5,
  RESISTANCE: 2.0,
}

// ─── Absorption shrink ───
// Absorbed bubbles progressively lose force over time
const ABSORBED_SHRINK_START_MS = 10_000   // start shrinking after 10s
const ABSORBED_SHRINK_FULL_MS = 120_000   // fully shrunk at 2min
const ABSORBED_MIN_RADIUS_MUL = 0.45      // don't shrink below 45% of original

/**
 * Compute the complete visual style for a bubble.
 *
 * PRIMARY IDENTITY: side (green=buy, red=sell)
 * SECONDARY: state (accepted/rejected/absorbed/exhausted/invalidated/resistance)
 * SIZE: notional (log/percentile scale)
 * AGE: intensity modifier (does NOT erase identity)
 */
export function getBubbleVisualStyle(
  bubble: Bubble,
  now: number,
  intervalMs: number,
  zoomAlphaScale: number = 1.0,
  notionalPercentile?: number
): BubbleVisualStyle {
  const phase = getBubbleAgePhase(bubble, now, intervalMs)
  const ageMod = AGE_MODIFIERS[phase]

  // ─── Side × State color lookup ───
  const colorKey = `${bubble.side}-${bubble.state}`
  const colors = SIDE_STATE_COLORS[colorKey] || SIDE_STATE_COLORS['buy-EXHAUSTED']

  // ─── Radius: percentile-based or log-scale ───
  let baseRadius: number
  if (notionalPercentile !== undefined) {
    if (notionalPercentile >= 0.95) {
      baseRadius = RADIUS_WHALE
    } else {
      baseRadius = RADIUS_MIN + (notionalPercentile / 0.95) * (RADIUS_MAX - RADIUS_MIN)
    }
  } else {
    const logNotional = Math.log10(Math.max(1, bubble.notional))
    const normalized = Math.max(0, Math.min(1,
      (logNotional - RADIUS_LOG_MIN) / (RADIUS_LOG_MAX - RADIUS_LOG_MIN)
    ))
    baseRadius = RADIUS_MIN + normalized * (RADIUS_MAX - RADIUS_MIN)
  }

  // ─── Absorption shrink ───
  // Absorbed bubbles progressively lose visual force
  let radiusMul = ageMod.radiusMul
  if (bubble.state === 'ABSORBED') {
    const absorbedAge = now - bubble.timestamp
    if (absorbedAge > ABSORBED_SHRINK_START_MS) {
      const shrinkProgress = Math.min(1,
        (absorbedAge - ABSORBED_SHRINK_START_MS) / (ABSORBED_SHRINK_FULL_MS - ABSORBED_SHRINK_START_MS)
      )
      const shrinkMul = 1 - shrinkProgress * (1 - ABSORBED_MIN_RADIUS_MUL)
      radiusMul *= shrinkMul
    }
  }

  const radius = Math.max(RADIUS_MIN, Math.min(RADIUS_WHALE,
    baseRadius * radiusMul
  ))

  // ─── Fill alpha ───
  const baseFillAlpha = STATE_BASE_FILL_ALPHA[bubble.state] ?? 0.15
  const fillAlpha = Math.max(0, Math.min(1,
    baseFillAlpha * ageMod.fillAlphaMul * zoomAlphaScale
  ))

  // ─── Stroke alpha ───
  const strength = bubble.confidence
  const baseStrokeAlpha = STATE_BASE_STROKE_ALPHA[bubble.state] ?? 0.5
  const strokeAlpha = Math.max(0, Math.min(1,
    (baseStrokeAlpha + strength * 0.25) * ageMod.strokeAlphaMul * zoomAlphaScale
  ))

  const lineWidth = STATE_LINE_WIDTH[bubble.state] ?? 1.5

  // ─── Side encoding ───
  const sideDirection = bubble.side === 'buy' ? -1 : 1
  const sideAccentColor = bubble.side === 'buy' ? '#22c55e' : '#ef6444'
  const sideNotchSize = Math.max(3, Math.min(6, radius * 0.3))

  // ─── State-specific style modifiers ───
  const ringStyle = bubble.state === 'ABSORBED'
  const brokenOutline = bubble.state === 'INVALIDATED'
  const dashed = bubble.state === 'PENDING' || bubble.state === 'INVALIDATED'

  // ─── Resistance origin accent ───
  // For RESISTANCE state, stroke shows origin (green=buy-origin, red=sell-origin)
  // The fill is purple, stroke carries the origin signal
  let strokeColor = colors.stroke
  if (bubble.state === 'RESISTANCE') {
    strokeColor = bubble.resistanceOrigin === 'sell' ? '#ef6461' : '#22c55e'
  }

  return {
    fillColor: colors.fill,
    fillAlpha,
    strokeColor,
    strokeAlpha,
    strokeWidth: lineWidth,
    dashed,
    radius,
    sideDirection,
    sideAccentColor,
    sideNotchSize,
    ringStyle,
    brokenOutline,
  }
}
