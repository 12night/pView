'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { ImageItem } from '../lib/imageGenerator';
import { ensureColumnsCover, getViewportWorldBounds, clearColumnCache } from '../lib/imageGenerator';
import { initPool, compressImage, revokeBlobUrl } from '../lib/imageLoader';
import type { ImageInfo } from '../app/api/images/route';

const SCALE_MIN = 0.6;
const SCALE_MAX = 5;
const ZOOM_FACTOR = 1.08;
const INITIAL_SCALE = 2.0;
const CLICK_THRESHOLD = 5;
const LOAD_MARGIN = 400;
const KEEP_MARGIN = 900;
const INERTIA_FRICTION = 0.92;
const INERTIA_STOP = 0.3;
const MAX_CONCURRENT = 6;

export default function InfiniteCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);

  const isDraggingRef = useRef(false);
  const pointerDownPos = useRef({ x: 0, y: 0 });
  const dragStartOffset = useRef({ x: 0, y: 0 });
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStartDist = useRef(0);
  const pinchStartScale = useRef(1);
  const pinchStartOffset = useRef({ x: 0, y: 0 });
  const zCounterRef = useRef(0);
  const velocityRef = useRef({ x: 0, y: 0 });
  const inertiaRef = useRef(0);
  const lastMovePosRef = useRef({ x: 0, y: 0 });

  const blobCacheRef = useRef<Map<string, string>>(new Map());
  const loadingSetRef = useRef<Set<string>>(new Set());
  const pendingQueueRef = useRef<ImageItem[]>([]);
  const activeCountRef = useRef(0);
  const poolReadyRef = useRef(false);

  const [images, setImages] = useState<ImageItem[]>([]);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(INITIAL_SCALE);
  const [isDragging, setIsDragging] = useState(false);
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });
  const [blobTick, setBlobTick] = useState(0);
  const [poolReady, setPoolReady] = useState(false);

  const offsetRef = useRef(offset);
  const scaleRef = useRef(scale);
  offsetRef.current = offset;
  scaleRef.current = scale;

  const loadOneImage = useCallback((item: ImageItem) => {
    const path = item.imagePath!;
    if (loadingSetRef.current.has(path)) return;
    if (blobCacheRef.current.has(path)) {
      item.blobUrl = blobCacheRef.current.get(path);
      setBlobTick((t) => t + 1);
      return;
    }
    if (activeCountRef.current >= MAX_CONCURRENT) return;

    activeCountRef.current++;
    loadingSetRef.current.add(path);

    compressImage(`/downloads/${path}`)
      .then((blobUrl) => {
        blobCacheRef.current.set(path, blobUrl);
        item.blobUrl = blobUrl;
        setBlobTick((t) => t + 1);
      })
      .catch(() => {})
      .finally(() => {
        loadingSetRef.current.delete(path);
        activeCountRef.current--;
        processQueue();
      });
  }, []);

  const processQueue = useCallback(() => {
    const queue = pendingQueueRef.current;
    while (activeCountRef.current < MAX_CONCURRENT && queue.length > 0) {
      const item = queue.shift()!;
      loadOneImage(item);
    }
  }, [loadOneImage]);

  const updateImages = useCallback(
    (currentOffset: { x: number; y: number }, currentScale: number) => {
      const { w, h } = viewportSize;
      if (w === 0 || h === 0) return;

      const bounds = getViewportWorldBounds(
        currentOffset.x,
        currentOffset.y,
        w,
        h,
        currentScale
      );

      const newImages = ensureColumnsCover(
        bounds.minX,
        bounds.maxX,
        bounds.minY,
        bounds.maxY,
        LOAD_MARGIN,
        KEEP_MARGIN
      );

      setImages(newImages);

      if (!poolReadyRef.current) return;

      const vpCenterX = (bounds.minX + bounds.maxX) / 2;
      const vpCenterY = (bounds.minY + bounds.maxY) / 2;

      const needsLoad = newImages.filter(
        (img) => img.imagePath && !img.blobUrl
      );
      needsLoad.sort((a, b) => {
        const da = Math.hypot(a.x - vpCenterX, a.y - vpCenterY);
        const db = Math.hypot(b.x - vpCenterX, b.y - vpCenterY);
        return da - db;
      });

      pendingQueueRef.current = needsLoad;
      processQueue();
    },
    [viewportSize, processQueue]
  );

  const initCanvas = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;
    setViewportSize({ w, h });

    setOffset({
      x: w / 2,
      y: h / 2,
    });
  }, []);

  useEffect(() => {
    initCanvas();
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setViewportSize({ w: width, h: height });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [initCanvas]);

  useEffect(() => {
    fetch('/api/images')
      .then((r) => r.json())
      .then((data: { images: ImageInfo[]; total: number }) => {
        initPool(data.images);
        poolReadyRef.current = true;
        setPoolReady(true);
      });
  }, []);

  useEffect(() => {
    if (!poolReady) return;
    clearColumnCache();
    updateImages(offset, scale);
    // Only run when poolReady becomes true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolReady]);

  useEffect(() => {
    if (!poolReady) return;
    updateImages(offset, scale);
  }, [offset, scale, updateImages, poolReady]);

  useEffect(() => {
    return () => {
      for (const url of blobCacheRef.current.values()) {
        revokeBlobUrl(url);
      }
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? -1 : 1;
      const factor = dir > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      const newScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, scaleRef.current * factor));
      if (newScale === scaleRef.current) return;

      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      setScale(newScale);
      setOffset({
        x: cx - (cx - offsetRef.current.x) * (newScale / scaleRef.current),
        y: cy - (cy - offsetRef.current.y) * (newScale / scaleRef.current),
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  function getPointerDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  const runInertia = useCallback(() => {
    cancelAnimationFrame(inertiaRef.current);

    const tick = () => {
      const v = velocityRef.current;
      setOffset((prev) => ({
        x: prev.x + v.x,
        y: prev.y + v.y,
      }));
      velocityRef.current = {
        x: v.x * INERTIA_FRICTION,
        y: v.y * INERTIA_FRICTION,
      };
      if (Math.hypot(velocityRef.current.x, velocityRef.current.y) > INERTIA_STOP) {
        inertiaRef.current = requestAnimationFrame(tick);
      }
    };

    inertiaRef.current = requestAnimationFrame(tick);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      cancelAnimationFrame(inertiaRef.current);
      velocityRef.current = { x: 0, y: 0 };

      containerRef.current?.setPointerCapture(e.pointerId);
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.current.size === 1) {
        isDraggingRef.current = true;
        setIsDragging(true);
        pointerDownPos.current = { x: e.clientX, y: e.clientY };
        dragStartOffset.current = { x: offset.x, y: offset.y };
        lastMovePosRef.current = { x: e.clientX, y: e.clientY };
      } else if (activePointers.current.size === 2) {
        const pts = Array.from(activePointers.current.values());
        pinchStartDist.current = getPointerDist(pts[0], pts[1]);
        pinchStartScale.current = scale;
        pinchStartOffset.current = { x: offset.x, y: offset.y };
      }
    },
    [offset, scale]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.current.size === 2) {
        const pts = Array.from(activePointers.current.values());
        const dist = getPointerDist(pts[0], pts[1]);
        const newScale = Math.min(
          SCALE_MAX,
          Math.max(SCALE_MIN, pinchStartScale.current * (dist / pinchStartDist.current))
        );

        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const mx = (pts[0].x + pts[1].x) / 2 - rect.left;
        const my = (pts[0].y + pts[1].y) / 2 - rect.top;

        setScale(newScale);
        setOffset({
          x: mx - (mx - pinchStartOffset.current.x) * (newScale / pinchStartScale.current),
          y: my - (my - pinchStartOffset.current.y) * (newScale / pinchStartScale.current),
        });
        return;
      }

      if (!isDraggingRef.current) return;

      velocityRef.current = {
        x: e.clientX - lastMovePosRef.current.x,
        y: e.clientY - lastMovePosRef.current.y,
      };
      lastMovePosRef.current = { x: e.clientX, y: e.clientY };

      setOffset({
        x: dragStartOffset.current.x + (e.clientX - pointerDownPos.current.x),
        y: dragStartOffset.current.y + (e.clientY - pointerDownPos.current.y),
      });
    },
    []
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const ptrCountBefore = activePointers.current.size;
      activePointers.current.delete(e.pointerId);

      if (ptrCountBefore === 2 && activePointers.current.size === 1) {
        const remaining = Array.from(activePointers.current.values())[0];
        pointerDownPos.current = { x: remaining.x, y: remaining.y };
        dragStartOffset.current = { x: offset.x, y: offset.y };
        lastMovePosRef.current = { x: remaining.x, y: remaining.y };
        velocityRef.current = { x: 0, y: 0 };
        return;
      }

      if (activePointers.current.size === 0) {
        isDraggingRef.current = false;
        setIsDragging(false);

        const dx = e.clientX - pointerDownPos.current.x;
        const dy = e.clientY - pointerDownPos.current.y;
        if (Math.hypot(dx, dy) <= CLICK_THRESHOLD) {
          const target = e.target as HTMLElement;
          const imgEl = target.closest('[data-image-id]') as HTMLElement | null;
          if (imgEl) {
            const imageId = imgEl.dataset.imageId!;
            const newZ = ++zCounterRef.current;
            setImages((prev) =>
              prev.map((img) => (img.id === imageId ? { ...img, zIndex: newZ } : img))
            );
          }
        } else if (Math.hypot(velocityRef.current.x, velocityRef.current.y) > INERTIA_STOP) {
          runInertia();
        }
      }
    },
    [offset]
  );

  if (viewportSize.w === 0) {
    return <div ref={containerRef} className="w-full h-screen bg-slate-900 overflow-hidden" />;
  }

  return (
    <div
      ref={containerRef}
      className={`w-full h-screen bg-slate-900 overflow-hidden select-none ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div
        ref={worldRef}
        className="absolute top-0 left-0 origin-top-left"
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
          willChange: isDragging ? 'transform' : 'auto',
        }}
      >
        {images.map((img) => {
          const url = img.blobUrl;
          return (
            <div
              key={img.id}
              data-image-id={img.id}
              className="absolute"
              style={{
                left: img.x - img.width / 2,
                top: img.y - img.height / 2,
                width: img.width,
                height: img.height,
                zIndex: img.zIndex,
                background: url
                  ? `url(${url}) center/contain no-repeat`
                  : img.color,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
