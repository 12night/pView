import { pickImage, releaseImage, getImageDims } from './imageLoader';

export interface ImageItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  color: string;
  imagePath?: string;
  blobUrl?: string;
}

const MIN_COL_W = 210;
const MAX_COL_W = 250;
const IMG_GAP = 3;
const MIN_IMG_H = 60;

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fallbackAspect(rng: () => number): number {
  return 0.55 + rng() * 1.45;
}

function getColumnWidth(absCol: number): number {
  const rng = mulberry32(((absCol * 0x9e3779b1) >>> 0));
  return Math.floor(MIN_COL_W + rng() * (MAX_COL_W - MIN_COL_W));
}

const colStartXCache = new Map<number, number>();

function getColumnStartX(absCol: number): number {
  const cached = colStartXCache.get(absCol);
  if (cached !== undefined) return cached;

  if (absCol === 0) {
    colStartXCache.set(0, 0);
    return 0;
  }
  if (absCol > 0) {
    const prevStart = getColumnStartX(absCol - 1);
    const prevW = getColumnWidth(absCol - 1);
    colStartXCache.set(absCol, prevStart + prevW);
    return prevStart + prevW;
  }
  const nextStart = getColumnStartX(absCol + 1);
  const w = getColumnWidth(absCol);
  colStartXCache.set(absCol, nextStart - w);
  return nextStart - w;
}

interface ColumnInfo {
  absCol: number;
  startX: number;
  width: number;
}

function getColumnsInXRange(minX: number, maxX: number): ColumnInfo[] {
  const cols: ColumnInfo[] = [];
  const avgW = (MIN_COL_W + MAX_COL_W) / 2;
  let guessCol = Math.floor(minX / avgW);
  while (getColumnStartX(guessCol) > minX) guessCol--;
  while (getColumnStartX(guessCol) + getColumnWidth(guessCol) <= minX) guessCol++;

  let col = guessCol;
  let x = getColumnStartX(col);
  while (x < maxX) {
    const w = getColumnWidth(col);
    cols.push({ absCol: col, startX: x, width: w });
    x += w;
    col++;
  }
  return cols;
}

function getColumnPhase(absCol: number): number {
  const rng = mulberry32(((absCol * 0x3d9b7e15) >>> 0));
  return Math.floor(rng() * 200);
}

function makeColRng(absCol: number, counter: number): () => number {
  return mulberry32(((absCol * 0x7f4a7c13 + counter * 0x9e3779b1) >>> 0));
}

interface ColumnData {
  absCol: number;
  images: ImageItem[];
  minY: number;
  maxY: number;
  phase: number;
  genCounter: number;
}

const columnMap = new Map<number, ColumnData>();

function getColumn(absCol: number): ColumnData {
  let col = columnMap.get(absCol);
  if (!col) {
    col = {
      absCol,
      images: [],
      minY: 0,
      maxY: 0,
      phase: getColumnPhase(absCol),
      genCounter: 0,
    };
    columnMap.set(absCol, col);
  }
  return col;
}

export function clearColumnCache(): void {
  for (const col of columnMap.values()) {
    for (const img of col.images) {
      if (img.imagePath) releaseImage(img.imagePath);
    }
  }
  columnMap.clear();
}

function imageHeight(imgW: number, rng: () => number): number {
  const info = pickImage();
  if (info) {
    const ar = info.w / info.h;
    return Math.max(MIN_IMG_H, Math.round(imgW / ar));
  }
  return Math.max(MIN_IMG_H, Math.round(imgW * fallbackAspect(rng)));
}

function extendDown(col: ColumnData, fromY: number, targetMaxY: number): void {
  const colW = getColumnWidth(col.absCol);
  const imgW = colW - IMG_GAP * 2;
  const colCenterX = getColumnStartX(col.absCol) + colW / 2;

  let y = fromY;

  while (y < targetMaxY) {
    const rng = makeColRng(col.absCol, col.genCounter);
    const info = pickImage();
    let h: number;
    if (info) {
      const ar = info.w / info.h;
      h = Math.max(MIN_IMG_H, Math.round(imgW / ar));
    } else {
      h = Math.max(MIN_IMG_H, Math.round(imgW * fallbackAspect(rng)));
    }

    col.images.push({
      id: `${col.absCol}:${col.genCounter}`,
      x: colCenterX,
      y: y + h / 2,
      width: imgW,
      height: h - IMG_GAP,
      zIndex: 0,
      color: '#2d3035',
      imagePath: info?.path,
    });
    col.genCounter++;
    y += h + IMG_GAP;
  }
  col.maxY = y;
}

function extendUp(col: ColumnData, targetMinY: number): void {
  const colW = getColumnWidth(col.absCol);
  const imgW = colW - IMG_GAP * 2;
  const colCenterX = getColumnStartX(col.absCol) + colW / 2;

  let bottomY = col.minY - IMG_GAP;

  while (bottomY > targetMinY) {
    const rng = makeColRng(col.absCol, col.genCounter);
    const info = pickImage();
    let h: number;
    if (info) {
      const ar = info.w / info.h;
      h = Math.max(MIN_IMG_H, Math.round(imgW / ar));
    } else {
      h = Math.max(MIN_IMG_H, Math.round(imgW * fallbackAspect(rng)));
    }

    const topY = bottomY - h;

    col.images.unshift({
      id: `${col.absCol}:${col.genCounter}`,
      x: colCenterX,
      y: topY + h / 2,
      width: imgW,
      height: h - IMG_GAP,
      zIndex: 0,
      color: '#2d3035',
      imagePath: info?.path,
    });
    col.genCounter++;
    bottomY = topY - IMG_GAP;
  }
  col.minY = bottomY + IMG_GAP;
}

function trimColumn(col: ColumnData, keepMinY: number, keepMaxY: number): void {
  while (col.images.length > 0) {
    const first = col.images[0];
    if (first.y + first.height / 2 < keepMinY) {
      if (first.imagePath) releaseImage(first.imagePath);
      col.images.shift();
    } else break;
  }

  while (col.images.length > 0) {
    const last = col.images[col.images.length - 1];
    if (last.y - last.height / 2 > keepMaxY) {
      if (last.imagePath) releaseImage(last.imagePath);
      col.images.pop();
    } else break;
  }

  if (col.images.length > 0) {
    col.minY = col.images[0].y - col.images[0].height / 2;
    col.maxY = col.images[col.images.length - 1].y + col.images[col.images.length - 1].height / 2;
  } else {
    col.minY = 0;
    col.maxY = 0;
  }
}

export function ensureColumnsCover(
  vpMinX: number,
  vpMaxX: number,
  vpMinY: number,
  vpMaxY: number,
  loadMargin: number,
  keepMargin: number
): ImageItem[] {
  const loadMinX = vpMinX - loadMargin;
  const loadMaxX = vpMaxX + loadMargin;
  const loadMinY = vpMinY - loadMargin;
  const loadMaxY = vpMaxY + loadMargin;
  const keepMinY = vpMinY - keepMargin;
  const keepMaxY = vpMaxY + keepMargin;

  const columns = getColumnsInXRange(loadMinX, loadMaxX);
  const result: ImageItem[] = [];

  for (const { absCol } of columns) {
    const col = getColumn(absCol);

    if (col.images.length === 0) {
      const startY = loadMinY + col.phase;
      extendDown(col, startY, loadMaxY);
    } else {
      if (loadMaxY > col.maxY) {
        extendDown(col, col.maxY + IMG_GAP, loadMaxY);
      }
      if (loadMinY < col.minY) {
        extendUp(col, loadMinY);
      }
    }

    trimColumn(col, keepMinY, keepMaxY);

    for (const img of col.images) {
      const imgTop = img.y - img.height / 2;
      const imgBottom = img.y + img.height / 2;
      if (imgBottom >= loadMinY && imgTop <= loadMaxY) {
        result.push(img);
      }
    }
  }

  return result;
}

export function getViewportWorldBounds(
  offsetX: number,
  offsetY: number,
  viewportW: number,
  viewportH: number,
  scale: number
): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: -offsetX / scale,
    minY: -offsetY / scale,
    maxX: (viewportW - offsetX) / scale,
    maxY: (viewportH - offsetY) / scale,
  };
}
