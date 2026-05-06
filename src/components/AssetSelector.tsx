import { useState, useRef, useEffect, useMemo } from 'react'
import { useMarketStore } from '../stores/marketStore'
import { INSTRUMENTS } from '../types/market'
import type { Instrument } from '../types/market'

const CATEGORIES = ['major', 'alt', 'defi', 'meme'] as const

export default function AssetSelector({ onClose }: { onClose: () => void }) {
  const currentSymbol = useMarketStore(s => s.symbol)
  const setSymbol = useMarketStore(s => s.setSymbol)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    let list = INSTRUMENTS
    if (activeCategory !== 'all') {
      list = list.filter(i => i.category === activeCategory)
    }
    if (search) {
      const q = search.toUpperCase()
      list = list.filter(i =>
        i.symbol.includes(q) || i.base.includes(q)
      )
    }
    return list
  }, [search, activeCategory])

  const select = (inst: Instrument) => {
    setSymbol(inst.symbol)
    onClose()
  }

  return (
    <div className="asset-selector-overlay" onClick={onClose}>
      <div className="asset-selector" onClick={e => e.stopPropagation()}>
        <div className="asset-selector-header">
          <span className="asset-selector-title">Select Instrument</span>
          <button className="asset-close" onClick={onClose}>✕</button>
        </div>

        <div className="asset-search-wrap">
          <input
            ref={inputRef}
            className="asset-search"
            placeholder="Search symbol..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'Enter' && filtered.length === 1) select(filtered[0])
            }}
          />
        </div>

        <div className="asset-categories">
          <button
            className={`cat-btn ${activeCategory === 'all' ? 'active' : ''}`}
            onClick={() => setActiveCategory('all')}
          >All</button>
          {CATEGORIES.map(c => (
            <button
              key={c}
              className={`cat-btn ${activeCategory === c ? 'active' : ''}`}
              onClick={() => setActiveCategory(c)}
            >{c.toUpperCase()}</button>
          ))}
        </div>

        <div className="asset-list">
          {filtered.map(inst => (
            <button
              key={inst.symbol}
              className={`asset-row ${inst.symbol === currentSymbol ? 'active' : ''}`}
              onClick={() => select(inst)}
            >
              <span className="asset-base">{inst.base}</span>
              <span className="asset-quote">/ {inst.quote}</span>
              <span className="asset-cat">{inst.category}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="asset-empty">No matching instruments</div>
          )}
        </div>
      </div>
    </div>
  )
}
