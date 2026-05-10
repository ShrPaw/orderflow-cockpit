# Local Runbook

## Requirements

- **Node.js** 18+ (recommend 20 LTS)
- **npm** 9+
- **Git**
- Modern browser (Chrome, Firefox, Edge, Safari)

## Setup

```bash
git clone https://github.com/ShrPaw/orderflow-cockpit.git
cd orderflow-cockpit
npm install
npm run dev
```

Vite will print the local URL, typically:
```
http://localhost:5173
```

## Production Build

```bash
npm run build
npm run preview
```

## Windows

```powershell
cd C:\path\to\orderflow-cockpit
npm install
npm run dev
```

## Common Errors

### `git` not recognized
Install Git: https://git-scm.com/downloads

### `node` / `npm` not recognized
Install Node.js: https://nodejs.org/en/download

### Port busy
Vite auto-selects another port. Check terminal output for the actual URL.

### WebSocket blocked
Corporate firewalls or VPNs may block `wss://fstream.binance.com`. Try:
- Disable VPN temporarily
- Use a different network
- Check browser DevTools → Network → WS tab for connection errors

### Blank screen
1. Open browser DevTools (F12)
2. Check Console tab for errors
3. Check Network tab for failed requests
4. Try `npm run build` to check for TypeScript errors

### Build fails
```bash
npm install
npm run build
```
If TypeScript errors appear, check the error messages for file/line references.

## Verifying the App is Running

1. Open the URL from Vite output
2. You should see a dark-themed dashboard
3. The toolbar shows "LIVE" mode and "BTCUSDT"
4. Connection dots in the toolbar should turn green
5. The chart should show candles updating in real time
6. The Time & Sales panel at the bottom should show live trades

## DevTools Console

Press F12 → Console tab. You should see:
- `[Binance trade] Connected: BTCUSDT`
- `[LocalBook] Diff stream connected: BTCUSDT`
- `[MiniTicker] Connected: BTCUSDT`
- Periodic diagnostic tables every 15 seconds

If you see repeated connect/disconnect messages, something is wrong.

## Pulling Latest Changes

```bash
git pull origin main
npm install
npm run dev
```

If build breaks after pull:
```bash
rm -rf node_modules
npm install
npm run build
```
