import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { NextResponse } from 'next/server';
import { imageSize } from 'image-size';

export const runtime = 'nodejs';

const IMAGE_EXT = /\.(jpg|jpeg|png|webp)$/i;

export interface ImageInfo {
  path: string;
  w: number;
  h: number;
}

function scanDir(dir: string, prefix: string, files: ImageInfo[]): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full, prefix + entry.name + '/', files);
    } else if (IMAGE_EXT.test(entry.name)) {
      try {
        const buf = readFileSync(full);
        const dims = imageSize(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        if (dims.width && dims.height) {
          files.push({ path: prefix + entry.name, w: dims.width, h: dims.height });
        }
      } catch {
        // skip unreadable files
      }
    }
  }
}

export async function GET() {
  const downloadsDir = join(process.cwd(), 'public', 'downloads');
  const images: ImageInfo[] = [];
  scanDir(downloadsDir, '', images);
  return NextResponse.json({ images, total: images.length });
}
