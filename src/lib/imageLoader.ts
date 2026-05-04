import type { ImageInfo } from '../app/api/images/route';

const TARGET_W = 400;
const JPEG_QUALITY = 0.75;

let imagePool: ImageInfo[] = [];
let available: ImageInfo[] = [];
const dimCache = new Map<string, { w: number; h: number }>();

export function initPool(images: ImageInfo[]): void {
  imagePool = [...images];
  available = [...images];
  dimCache.clear();
  for (const img of images) {
    dimCache.set(img.path, { w: img.w, h: img.h });
  }
}

export function getImageDims(path: string): { w: number; h: number } | undefined {
  return dimCache.get(path);
}

export function pickImage(): ImageInfo | null {
  if (available.length === 0) {
    available = [...imagePool];
  }
  if (available.length === 0) return null;
  const idx = Math.floor(Math.random() * available.length);
  const picked = available[idx];
  available.splice(idx, 1);
  return picked;
}

export function releaseImage(path: string): void {
  const info = imagePool.find((img) => img.path === path);
  if (info && !available.includes(info)) {
    available.push(info);
  }
}

export function compressImage(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(1, TARGET_W / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(URL.createObjectURL(blob));
          else reject(new Error('toBlob failed'));
        },
        'image/jpeg',
        JPEG_QUALITY
      );
    };
    img.onerror = () => reject(new Error(`Failed to load: ${url}`));
    img.src = url;
  });
}

export function revokeBlobUrl(url: string): void {
  URL.revokeObjectURL(url);
}
