const { readdirSync, readFileSync, writeFileSync } = require('fs');
const { join } = require('path');
const { imageSize } = require('image-size');

const IMAGE_EXT = /\.(jpg|jpeg|png|webp)$/i;
const DOWNLOADS_DIR = join(__dirname, '..', 'public', 'downloads');
const OUTPUT = join(__dirname, '..', 'public', 'images-manifest.json');

function scanDir(dir, prefix, files) {
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
      } catch { /* skip */ }
    }
  }
}

const images = [];
scanDir(DOWNLOADS_DIR, '', images);
writeFileSync(OUTPUT, JSON.stringify({ images, total: images.length }));
console.log(`Generated manifest: ${images.length} images`);
