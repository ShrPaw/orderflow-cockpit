import React, { useRef, useEffect, useCallback } from 'react';
import { useMarketStore } from '../stores/marketStore';
import { renderChart } from '../utils/chartRenderer';

const ChartCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, startTime: 0, endTime: 0, priceLow: 0, priceHigh: 0 });

  const {
    candles, bigTrades, volumeProfile, viewport, currentPrice,
    showBigTrades, showVolumeProfile, bigTradeFilter, showDelta, showCVD,
    setViewport, zoomIn, zoomOut,
  } = useMarketStore();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const deltaPanelHeight = showDelta ? 80 : 0;
    const cvdPanelHeight = showCVD ? 80 : 0;

    renderChart(ctx, rect.width, rect.height, candles, bigTrades,
      showVolumeProfile ? volumeProfile : null, viewport, currentPrice,
      { showBigTrades, showVolumeProfile, bigTradeFilter, panelHeights: { delta: deltaPanelHeight, cvd: cvdPanelHeight } }
    );
  }, [candles, bigTrades, volumeProfile, viewport, currentPrice, showBigTrades, showVolumeProfile, bigTradeFilter, showDelta, showCVD]);

  useEffect(() => {
    const animate = () => {
      draw();
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [draw]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const priceRange = viewport.priceHigh - viewport.priceLow;
      const priceDelta = priceRange * 0.1 * (e.deltaY > 0 ? 1 : -1);
      setViewport({ priceLow: viewport.priceLow - priceDelta, priceHigh: viewport.priceHigh + priceDelta });
    } else {
      if (e.deltaY < 0) zoomIn();
      else zoomOut();
    }
  }, [viewport, setViewport, zoomIn, zoomOut]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, startTime: viewport.startTime, endTime: viewport.endTime, priceLow: viewport.priceLow, priceHigh: viewport.priceHigh };
  }, [viewport]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;

    const timePerPixel = (dragStart.current.endTime - dragStart.current.startTime) / rect.width;
    const pricePerPixel = (dragStart.current.priceHigh - dragStart.current.priceLow) / rect.height;

    setViewport({
      startTime: dragStart.current.startTime - dx * timePerPixel,
      endTime: dragStart.current.endTime - dx * timePerPixel,
      priceLow: dragStart.current.priceLow + dy * pricePerPixel,
      priceHigh: dragStart.current.priceHigh + dy * pricePerPixel,
    });
  }, [setViewport]);

  const handleMouseUp = useCallback(() => { isDragging.current = false; }, []);

  return (
    <div ref={containerRef} style={{ flex: 1, position: 'relative', cursor: isDragging.current ? 'grabbing' : 'crosshair' }}>
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </div>
  );
};

export default ChartCanvas;
