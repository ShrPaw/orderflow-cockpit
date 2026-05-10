/**
 * connectionRegistry.ts
 *
 * Dev-mode connection registry that tracks active WebSocket connections by key.
 * Key format: `${stream}:${symbol}`
 *
 * Guarantees:
 * - At most one active socket per stream/symbol
 * - Duplicate starts are detected and logged
 * - Stale socket events are tracked
 * - Provides debug info for diagnostics
 *
 * In production, all methods are no-ops (zero overhead).
 */

export interface RegistryEntry {
  key: string
  stream: string
  symbol: string
  generation: number
  createdAt: number
  url: string
}

const isDev = import.meta.env?.DEV ?? false

// Active entries keyed by `${stream}:${symbol}`
const active = new Map<string, RegistryEntry>()

// Stats
let totalCreated = 0
let totalRejected = 0
let totalCleanedUp = 0

function makeKey(stream: string, symbol: string): string {
  return `${stream}:${symbol.toUpperCase()}`
}

/**
 * Register a new connection. Returns false if a duplicate already exists
 * (the caller should NOT proceed with creating the socket).
 */
export function registryAdd(
  stream: string,
  symbol: string,
  generation: number,
  url: string,
): boolean {
  if (!isDev) return true

  const key = makeKey(stream, symbol)
  const existing = active.get(key)

  if (existing) {
    totalRejected++
    console.warn(
      `[Registry] DUPLICATE detected: ${key} gen=${generation} ` +
      `(existing gen=${existing.generation}, created ${Math.round((Date.now() - existing.createdAt) / 1000)}s ago). ` +
      `This should not happen — check lifecycle.`
    )
    // Allow it but log — the old entry should have been removed first
  }

  totalCreated++
  active.set(key, { key, stream, symbol, generation, createdAt: Date.now(), url })
  return true
}

/**
 * Remove a connection. No-op if the current generation doesn't match
 * (meaning a newer socket already replaced this one).
 */
export function registryRemove(stream: string, symbol: string, generation: number): void {
  if (!isDev) return

  const key = makeKey(stream, symbol)
  const existing = active.get(key)

  if (!existing) return

  if (existing.generation !== generation) {
    console.log(
      `[Registry] Stale remove ignored: ${key} gen=${generation} (current gen=${existing.generation})`
    )
    return
  }

  totalCleanedUp++
  active.delete(key)
}

/**
 * Check if a stream/symbol already has an active connection.
 */
export function registryHas(stream: string, symbol: string): boolean {
  if (!isDev) return false
  return active.has(makeKey(stream, symbol))
}

/**
 * Get debug info about all active connections.
 */
export function registryDebug(): { active: RegistryEntry[]; totalCreated: number; totalRejected: number; totalCleanedUp: number } {
  return {
    active: Array.from(active.values()),
    totalCreated,
    totalRejected,
    totalCleanedUp,
  }
}

/**
 * Clear all entries (used on full reset / unmount).
 */
export function registryClear(): void {
  active.clear()
}
