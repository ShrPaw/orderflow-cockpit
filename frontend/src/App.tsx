import React, { useEffect, useRef } from 'react';
import { useMarketStore } from './stores/marketStore';
import Toolbar from './components/Toolbar';
import ChartCanvas from './components/ChartCanvas';
import SidePanel from './components/SidePanel';

const App: React.FC = () => {
  const { init, tick, isPaused } = useMarketStore();
  const tickRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    init();
    tickRef.current = setInterval(() => {
      tick();
    }, 200);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [init, tick]);

  return (
    <div style={styles.app}>
      <Toolbar />
      <div style={styles.main}>
        <ChartCanvas />
        <SidePanel />
      </div>
      <div style={styles.footer}>
        <span style={styles.footerText}>ORDERFLOW COCKPIT v0.1 — Crypto-Native</span>
        <span style={styles.footerText}>Data: Simulated BTC/USDT • {isPaused ? 'PAUSED' : 'LIVE'}</span>
        <span style={styles.footerText}>Scroll: zoom • Drag: pan • Ctrl+scroll: price scale</span>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  app: {
    width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column',
    background: '#0a0a0f', color: '#e0e0e0', overflow: 'hidden',
  },
  main: { flex: 1, display: 'flex', overflow: 'hidden' },
  footer: {
    display: 'flex', justifyContent: 'space-between', padding: '4px 12px',
    background: '#0a0a0f', borderTop: '1px solid #1a1a25', height: '24px', flexShrink: 0,
  },
  footerText: { fontSize: '9px', color: '#4a4a5a', fontFamily: 'monospace' },
};

export default App;
