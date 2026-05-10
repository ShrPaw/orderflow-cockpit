/**
 * bubbleMethodology.ts
 *
 * ─── Financial Interpretation ───
 *
 * A bubble is NOT a trading signal.
 * A bubble is NOT a prediction of future price movement.
 * A bubble is a VISUAL RECORD of an aggressive flow event and the
 * market's observed reaction to that event.
 *
 * The classification describes what the market DID after the event,
 * not what it WILL do. This is a methodology for visualizing
 * orderflow microstructure, not a buy/sell recommendation system.
 *
 * ─── Methodology ───
 *
 * 1. Event Detection    — aggressive trade exceeds notional/qty threshold
 * 2. Context Snapshot   — store price, side, notional, timestamp, candle
 * 3. Reaction Tracking  — measure price response at 3s, 10s, final
 * 4. State Classification — PENDING → ACCEPTED / REJECTED / ABSORBED / EXHAUSTED
 * 5. Time Relevance     — FRESH → ACTIVE → FADING → EXPIRED
 * 6. Level Interaction  — (TODO) round levels, orderbook, repeated rejection
 * 7. Visual Encoding    — color, radius, opacity, stroke encode all dimensions
 * 8. Storage / Retention — bounded store, render filtering by relevance
 * 9. Hybrid Overlay     — Lightweight Charts base + custom canvas overlay
 * 10. Validation        — visual alignment, state meaning, time decay
 */

import type { Bubble, BubbleState } from '../types/market'

// ═══════════════════════════════════════════
// A. EVENT AGE PHASE
// ═══════════════════════════════════════════

export type BubbleAgePhase = 'FRESH' | 'ACTIVE' | 'FADING' | 'EXPIRED'

/**
 * Time windows for age phase classification.
 * These define how long a bubble remains contextually useful.
 *
 * FRESH:   0–30s    — the event just happened, highest informational value
 * ACTIVE:  30s–3m   — reaction is still forming, market is digesting
 * FADING:  3–10m    — reaction is established, context weakening
 * EXPIRED: 10m+     — no longer useful for real-time decision-making
 */
export const BUBBLE_FRESH_MS = 30_000
export const BUBBLE_ACTIVE_MS = 180_000
export const BUBBLE_FADE_MS = 600_000
export const BUBBLE_EXPIRE_MS = 900_000

/**
 * Determine the age phase of a bubble based on elapsed time since event.
 */
export function getBubbleAgePhase(
  bubble: Bubble,
  now: number,
  _intervalMs: number
): BubbleAgePhase {
  const age = now - bubble.timestamp

  if (age < 0) return 'FRESH'          // future timestamp (clock skew)
  if (age < BUBBLE_FRESH_MS) return 'FRESH'
  if (age < BUBBLE_ACTIVE_MS) return 'ACTIVE'
  if (age < BUBBLE_FADE_MS) return 'FADING'
  return 'EXPIRED'
}

// ═══════════════════════════════════════════
// B. RENDER RELEVANCE
// ═══════════════════════════════════════════

/**
 * Maximum number of bubbles to render on the overlay.
 * Prevents visual clutter when many events accumulate.
 */
export const MAX_RENDERED_BUBBLES = 60

/**
 * Determine whether a bubble should be rendered on the chart overlay.
 *
 * Rules:
 * - FRESH, ACTIVE, FADING: render (subject to other filters)
 * - EXPIRED: do NOT render on main chart overlay
 * - Skip bubbles with invalid timestamp or price
 */
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

/**
 * Select and prioritize bubbles for rendering.
 *
 * Priority rules:
 * 1. Recent bubbles (FRESH > ACTIVE > FADING)
 * 2. Larger notional bubbles within same age phase
 * 3. Cap at MAX_RENDERED_BUBBLES
 */
export function getRenderableBubbles(
  bubbles: Bubble[],
  now: number,
  intervalMs: number
): Bubble[] {
  const phasePriority: Record<BubbleAgePhase, number> = {
    FRESH: 3,
    ACTIVE: 2,
    FADING: 1,
    EXPIRED: 0,
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
// C. VISUAL ENCODING
// ═══════════════════════════════════════════

/**
 * Visual style parameters for a single bubble.
 * All dimensions are derived from the bubble's financial meaning.
 */
export interface BubbleVisualStyle {
  /** Fill color (hex or rgba) */
  fillColor: string
  /** Fill alpha (0–1) */
  fillAlpha: number
  /** Stroke color */
  strokeColor: string
  /** Stroke alpha (0–1) */
  strokeAlpha: number
  /** Stroke width (px) */
  strokeWidth: number
  /** Whether to use dashed stroke */
  dashed: boolean
  /** Circle radius (px) */
  radius: number
  /** Side indicator tick length (px, 0 = no tick) */
  sideTick: number
  /** Side indicator direction: -1 = up (buy), 1 = down (sell) */
  sideDirection: number
  /** Subtle accent color for side indicator */
  sideAccentColor: string
  /** Size of directional notch/triangle */
  sideNotchSize: number
  /** Vertical offset (buy: -2px above, sell: +2px below) */
  sidePlacement: number
}

// ─── State colors ───
// These encode the market's observed reaction to the aggressive flow event.

const STATE_COLORS: Record<BubbleState, { fill: string; stroke: string }> = {
  /** PENDING: amber — event detected, reaction not yet classified */
  PENDING: { fill: '#e4a73b', stroke: '#e4a73b' },
  /** ACCEPTED: teal — price moved in the direction of aggression */
  ACCEPTED: { fill: '#2dd4a0', stroke: '#2dd4a0' },
  /** REJECTED: red — price moved against the aggression */
  REJECTED: { fill: '#ef6461', stroke: '#ef6461' },
  /** ABSORBED: cyan — large print but price barely moved (liquidity absorbed it) */
  ABSORBED: { fill: '#4fc3f7', stroke: '#4fc3f7' },
  /** EXHAUSTED: gray-purple — no meaningful follow-through */
  EXHAUSTED: { fill: '#4a5e78', stroke: '#4a5e78' },
  /** INVALIDATED: orange-red — ACCEPTED bubble reversed, price returned to event level */
  INVALIDATED: { fill: '#e06040', stroke: '#e06040' },
}

// ─── Age phase modifiers ───
// Older bubbles become less visually prominent as their relevance decays.
// IMPORTANT: These modify INTENSITY only, not STATE IDENTITY.
// A FADING REJECTED bubble is still red/rejected, just dimmer.

const AGE_MODIFIERS = {
  FRESH:   { fillAlphaMul: 1.0, strokeAlphaMul: 1.0, radiusMul: 1.0 },
  ACTIVE:  { fillAlphaMul: 0.85, strokeAlphaMul: 0.9, radiusMul: 0.95 },
  FADING:  { fillAlphaMul: 0.5, strokeAlphaMul: 0.6, radiusMul: 0.85 },
  EXPIRED: { fillAlphaMul: 0.0, strokeAlphaMul: 0.0, radiusMul: 0.0 },
} as const

// ─── Notional radius mapping (percentile-based) ───
const RADIUS_MIN = 5
const RADIUS_MAX = 24
const RADIUS_WHALE = 28
const RADIUS_LOG_MIN = 3      // log10(1000)
const RADIUS_LOG_MAX = 6      // log10(1_000_000)

// ─── State-specific base alphas ───
// ABSORBED is ring-style: very low fill, strong stroke — large print, small price move
// EXHAUSTED is faded: low fill, low stroke — no meaningful response
// These must remain visually distinct from each other and from other states.
const STATE_BASE_FILL_ALPHA: Record<BubbleState, number> = {
  PENDING: 0.18,
  ACCEPTED: 0.15,
  REJECTED: 0.22,
  ABSORBED: 0.05,
  EXHAUSTED: 0.06,
  INVALIDATED: 0.14,
}

const STATE_BASE_STROKE_ALPHA: Record<BubbleState, number> = {
  PENDING: 0.40,
  ACCEPTED: 0.55,
  REJECTED: 0.70,
  ABSORBED: 0.80,
  EXHAUSTED: 0.20,
  INVALIDATED: 0.55,
}

const STATE_LINE_WIDTH: Record<BubbleState, number> = {
  PENDING: 1.0,
  ACCEPTED: 1.5,
  REJECTED: 2.0,
  ABSORBED: 2.5,
  EXHAUSTED: 0.8,
  INVALIDATED: 1.5,
}

/**
 * Compute the complete visual style for a bubble.
 *
 * Encodes:
 * - state (color, stroke style) — THE primary visual identity
 * - side (directional tick)
 * - notional (radius)
 * - response strength (stroke intensity, NOT "confidence" in predictive sense)
 * - age phase (opacity modifier, NOT state override)
 *
 * @param bubble - The bubble to style
 * @param now - Current timestamp (ms)
 * @param intervalMs - Current candle interval duration (ms)
 * @param zoomAlphaScale - Zoom-dependent opacity multiplier (0.5–1.0)
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
  const stateCol = STATE_COLORS[bubble.state] || STATE_COLORS.EXHAUSTED

  // ─── Radius: percentile-based or log-scale notional, bounded ───
  let baseRadius: number
  if (notionalPercentile !== undefined) {
    // Percentile-based: 0→RADIUS_MIN, 0.95→RADIUS_MAX, 1.0→RADIUS_WHALE
    if (notionalPercentile >= 0.95) {
      baseRadius = RADIUS_WHALE
    } else {
      baseRadius = RADIUS_MIN + (notionalPercentile / 0.95) * (RADIUS_MAX - RADIUS_MIN)
    }
  } else {
    // Fallback: log-scale notional
    const logNotional = Math.log10(Math.max(1, bubble.notional))
    const normalizedNotional = Math.max(0, Math.min(1,
      (logNotional - RADIUS_LOG_MIN) / (RADIUS_LOG_MAX - RADIUS_LOG_MIN)
    ))
    baseRadius = RADIUS_MIN + normalizedNotional * (RADIUS_MAX - RADIUS_MIN)
  }
  const radius = Math.max(RADIUS_MIN, Math.min(RADIUS_WHALE,
    baseRadius * ageMod.radiusMul
  ))

  // ─── Fill alpha: state base × age modifier × zoom ───
  const baseFillAlpha = STATE_BASE_FILL_ALPHA[bubble.state] ?? 0.15
  const fillAlpha = Math.max(0, Math.min(1,
    baseFillAlpha * ageMod.fillAlphaMul * zoomAlphaScale
  ))

  // ─── Stroke: response strength affects intensity ───
  // confidence represents observed reaction strength, NOT predictive confidence.
  const strength = bubble.confidence
  const baseStrokeAlpha = STATE_BASE_STROKE_ALPHA[bubble.state] ?? 0.5
  const strokeAlpha = Math.max(0, Math.min(1,
    (baseStrokeAlpha + strength * 0.3) * ageMod.strokeAlphaMul * zoomAlphaScale
  ))

  const lineWidth = STATE_LINE_WIDTH[bubble.state] ?? 1.5

  // ─── Side encoding ───
  const sideTick = radius >= 5 ? Math.min(4, radius * 0.35) : 0
  const sideDirection = bubble.side === 'buy' ? -1 : 1
  const sideAccentColor = bubble.side === 'buy' ? '#2dd4a0' : '#ef6461'
  const sideNotchSize = Math.max(3, Math.min(6, radius * 0.3))
  const sidePlacement = bubble.side === 'buy' ? -2 : 2

  // ─── Dashed for PENDING and INVALIDATED ───
  const dashed = bubble.state === 'PENDING' || bubble.state === 'INVALIDATED'

  return {
    fillColor: stateCol.fill,
    fillAlpha,
    strokeColor: stateCol.stroke,
    strokeAlpha,
    strokeWidth: lineWidth,
    dashed,
    radius,
    sideTick,
    sideDirection,
    sideAccentColor,
    sideNotchSize,
    sidePlacement,
  }
}
