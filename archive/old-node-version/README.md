# Archived: Old Node/Vanilla Implementation

This folder contains the **previous** Orderflow Cockpit implementation.

## What it was

A Node.js + vanilla JavaScript order-flow cockpit using:
- **Backend:** Node.js HTTP/WebSocket server (`server/index.js`)
- **Frontend:** Vanilla JS + Canvas2D (`public/js/app.js`)
- **Data sources:** Hyperliquid (primary), Binance USD-M (reference)
- **Features:** 40s candles, bubble state machine, volume profile, zone detection, scanner

## Why it was archived

The project direction shifted to a modern **Vite/React/TypeScript** architecture with:
- Direct Binance Futures WebSocket connections (no backend proxy needed)
- Zustand state management
- TypeScript type safety
- Component-based UI
- Heatmap, DOM-lite, footprint, delta/CVD panels

## What's preserved here

- `server/` — Node.js backend (index.js, hyperliquid.js, binance.js, candle-engine.js, profile-engine.js, scanner.js, symbol-map.js)
- `public/` — Vanilla JS frontend (app.js, style.css, index.html)
- `docs/` — Implementation reports
- `ORDERFLOW_*.md` — Build/fix reports

## Useful logic for future porting

The following modules contain valuable logic that may be ported into the Vite/React version:

- **candle-engine.js** — Bubble state machine (PENDING → ACCEPTED/REJECTED/ABSORBED/EXHAUSTED), price-level footprint, absorption/rejection detection, burst tracking
- **profile-engine.js** — Volume profile computation (POC, VAH, VAL, HVN, LVN, delta POC, VWAP, directional efficiency)
- **scanner.js** — Multi-symbol attention scoring, volatility expansion, status classification
- **hyperliquid.js** — Hyperliquid WebSocket connector (if HL support is added back)
- **symbol-map.js** — Cross-venue symbol mapping (Hyperliquid ↔ Binance)

This archive is **reference only**. It is not the active application.
