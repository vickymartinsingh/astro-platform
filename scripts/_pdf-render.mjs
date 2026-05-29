// Render specific PDF pages to PNG using mupdf-wasm.
// Usage: node _pdf-render.mjs <pdfPath> <outDir> <page1> [page2 ...]
import fs from 'node:fs';
import path from 'node:path';
import * as mupdf from 'mupdf';

const [, , pdfPath, outDir, ...pages] = process.argv;
if (!pdfPath || !outDir || pages.length === 0) {
  console.error('args: <pdf> <outDir> <pages...>');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const buf = fs.readFileSync(pdfPath);
const doc = mupdf.PDFDocument.openDocument(buf, 'application/pdf');

for (const pStr of pages) {
  const p = Number(pStr);
  if (!(p >= 1)) continue;
  if (p > doc.countPages()) continue;
  const page = doc.loadPage(p - 1);
  const pix = page.toPixmap(
    mupdf.Matrix.scale(1.2, 1.2),
    mupdf.ColorSpace.DeviceRGB,
    false, true);
  const png = pix.asPNG();
  const out = path.join(outDir,
    `${path.basename(pdfPath, '.pdf')}-p${String(p).padStart(3, '0')}.png`);
  fs.writeFileSync(out, png);
  console.log(out);
  pix.destroy();
  page.destroy();
}
