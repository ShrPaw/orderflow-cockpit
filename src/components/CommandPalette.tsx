import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useMarketStore } from '../stores/marketStore'
import type { Interval } from '../types/market'
import { INSTRUMENTS } from '../types/market'

interface CommandItem {
  id: string
  label: string
  detail: string
  category: 'symbol' | 'interval' | 'action'
  action: () => void
}

const INTERVALS: Interval[] = ['10s', '20s', '40s', '1m', '3m', '5m']

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const symbol = useMarketStore(s => s.symbol)
  const interval = useMarketStore(s => s.interval)
  const instruments = useMarketStore(s => s.instruments)
  const setSymbol = useMarketStore(s => s.setSymbol)
  const setInterval = useMarketStore(s => s.setInterval)
  const setFollowLive = useMarketStore(s => s.setFollowLive)

  const allInstruments = instruments.length > 0 ? instruments : INSTRUMENTS

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = []

    // Symbol commands
    for (const inst of allInstruments) {
      const isActive = inst.symbol === symbol
      items.push({
        id: `sym-${inst.symbol}`,
        label: `${inst.base}/${inst.quote}`,
        detail: inst.category.toUpperCase() + (isActive ? ' — active' : ''),
        category: 'symbol',
        action: () => {
          if (!isActive) setSymbol(inst.symbol)
          setOpen(false)
        },
      })
    }

    // Interval commands
    for (const iv of INTERVALS) {
      const isActive = iv === interval
      items.push({
        id: `iv-${iv}`,
        label: `Interval: ${iv}`,
        detail: isActive ? 'active' : `switch from ${interval}`,
        category: 'interval',
        action: () => {
          if (!isActive) setInterval(iv)
          setOpen(false)
        },
      })
    }

    // Action commands
    const chartApi = (window as any).__chartApi
    items.push({
      id: 'act-live',
      label: 'Go to Live Edge',
      detail: 'Home key',
      category: 'action',
      action: () => { chartApi?.goLive(); setFollowLive(true); setOpen(false) },
    })
    items.push({
      id: 'act-fit-recent',
      label: 'Fit Recent 250',
      detail: 'F key',
      category: 'action',
      action: () => { chartApi?.fitRecent(); setOpen(false) },
    })
    items.push({
      id: 'act-fit-all',
      label: 'Fit All History',
      detail: 'A key',
      category: 'action',
      action: () => { chartApi?.fitAll(); setOpen(false) },
    })
    items.push({
      id: 'act-reset',
      label: 'Reset View',
      detail: 'R key',
      category: 'action',
      action: () => { chartApi?.resetView(); setOpen(false) },
    })

    return items
  }, [allInstruments, symbol, interval, setSymbol, setInterval, setFollowLive])

  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    const q = query.toLowerCase()
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.detail.toLowerCase().includes(q) ||
      c.category.includes(q)
    )
  }, [commands, query])

  // Reset selection when filter changes
  useEffect(() => { setSelectedIdx(0) }, [filtered.length])

  // Open/close with Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
        if (!open) setQuery('')
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // Keyboard navigation
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[selectedIdx]
      if (item) item.action()
    }
  }, [filtered, selectedIdx])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const selected = listRef.current.children[selectedIdx] as HTMLElement | undefined
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIdx])

  if (!open) return null

  const catIcon = (cat: CommandItem['category']) => {
    if (cat === 'symbol') return '◉'
    if (cat === 'interval') return '⊏'
    return '→'
  }

  const catColor = (cat: CommandItem['category']) => {
    if (cat === 'symbol') return 'var(--green)'
    if (cat === 'interval') return 'var(--yellow)'
    return 'var(--accent)'
  }

  return (
    <div className="cmd-overlay" onClick={() => setOpen(false)}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        <div className="cmd-input-wrap">
          <span className="cmd-icon">⌘</span>
          <input
            ref={inputRef}
            className="cmd-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search symbols, intervals, actions..."
            spellCheck={false}
          />
          <span className="cmd-hint">ESC</span>
        </div>
        <div className="cmd-list" ref={listRef}>
          {filtered.length === 0 && (
            <div className="cmd-empty">No matches</div>
          )}
          {filtered.map((item, i) => (
            <div
              key={item.id}
              className={`cmd-item ${i === selectedIdx ? 'selected' : ''}`}
              onClick={() => item.action()}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <span className="cmd-item-icon" style={{ color: catColor(item.category) }}>
                {catIcon(item.category)}
              </span>
              <span className="cmd-item-label">{item.label}</span>
              <span className="cmd-item-detail">{item.detail}</span>
            </div>
          ))}
        </div>
        <div className="cmd-footer">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
          <span>Ctrl+K toggle</span>
        </div>
      </div>
    </div>
  )
}
