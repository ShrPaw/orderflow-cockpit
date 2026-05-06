import { useState, useRef, useEffect, useMemo } from 'react'
import { useMarketStore } from '../stores/marketStore'
import { INSTRUMENTS } from '../types/market'
import { fetchFuturesInstruments } from '../connectors/binanceTicker'
import type { Instrument } from '../types/market'

const CATEGORIES = ['major', 'alt', 'defi', 'meme'] as const

export default function AssetSelector({ onClose }: { onClose: () => void }) {
  const currentSymbol = useMarketStore(s => s.symbol)
  const setSymbol = useMarketStore(s => s.setSymbol)
  const instruments = useMarketStore(s => s.instruments)
  const instrumentsLoading = useMarketStore(s => s.instrumentsLoading)
  const setInstruments = useMarketStore(s => s.setInstruments)
  const setInstrumentsLoading = useMarketStore(s => s.setInstrumentsLoading)

  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch instruments on mount if not already loaded
  useEffect(() => {
    if (instruments.length === 0 && !instrumentsLoading) {
      setInstrumentsLoading(true)
      fetchFuturesInstruments().then(fetched => {
        if (fetched.length > 0) {
          setInstruments(fetched)
        } else {
          // Fallback to static list
          setInstruments(INSTRUMENTS)
        }
        setInstrumentsLoading(false)
      })
    }
  }, [instruments.length, instrumentsLoading, setInstruments, setInstrumentsLoading])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    let list = instruments.length > 0 ? instruments : INSTRUMENTS
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
  }, [search, activeCategory, instruments])

  const select = (inst: Instrument) => {
    if (inst.symbol !== currentSymbol) {
      setSymbol(inst.symbol)
    }
    onClose()
  }

  return (
    <div className="asset-selector-overlay" onClick={onClose}>
      <div className="asset-selector" onClick={e => e.stopPropagation()}>
        <div className="asset-selector-header">
          <span className="asset-selector-title">
            Select Instrument
            {instrumentsLoading && <span className="asset-loading"> Loading…</span>}
            {!instrumentsLoading && instruments.length > 0 && (
              <span className="asset-count">{instruments.length} pairs</span>
            )}
          </span>
          <button className="asset-close" onClick={onClose}>✕</button>
        </div>

        <div className="asset-search-wrap">
          <input
            ref={inputRef}
            className="asset-search"
            placeholder="Search symbol (e.g. BTC, ETH, SOL)…"
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
          {filtered.length === 0 && !instrumentsLoading && (
            <div className="asset-empty">No matching instruments</div>
          )}
          {filtered.length === 0 && instrumentsLoading && (
            <div className="asset-empty">Loading instruments from Binance…</div>
          )}
        </div>
      </div>
    </div>
  )
}
