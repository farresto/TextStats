'use strict';
// Builds a minimal DRM-free MOBI (PalmDOC-compressed) file for testing the reader.
const fs = require('fs');

function compress(rec) {
  // Simple PalmDOC LZ77 compressor (back-references + literals).
  const out = [];
  let i = 0;
  while (i < rec.length) {
    let bestLen = 0;
    let bestDist = 0;
    for (let d = 1; d <= Math.min(2047, i); d++) {
      let l = 0;
      while (l < 10 && i + l < rec.length && rec[i + l - d] === rec[i + l]) l++;
      if (l > bestLen) {
        bestLen = l;
        bestDist = d;
      }
    }
    if (bestLen >= 3) {
      const v = 0x8000 | (bestDist << 3) | (bestLen - 3);
      out.push(v >> 8, v & 0xff);
      i += bestLen;
      continue;
    }
    const c = rec[i];
    if (c === 0x20 && i + 1 < rec.length && rec[i + 1] >= 0x40 && rec[i + 1] <= 0x7f) {
      out.push(rec[i + 1] ^ 0x80);
      i += 2;
    } else if (c === 0 || (c >= 0x09 && c <= 0x7f)) {
      out.push(c);
      i++;
    } else {
      out.push(1, c);
      i++;
    }
  }
  return Buffer.from(out);
}

function build(html, file, { trailing = false } = {}) {
  const text = Buffer.from(html, 'utf8');
  const recs = [];
  for (let p = 0; p < text.length; p += 4096) {
    let r = compress(text.subarray(p, p + 4096));
    if (trailing) r = Buffer.concat([r, Buffer.from([0x00, 0x00, 0x83])]); // flags 0b10: one trailing entry of size 3
    recs.push(r);
  }
  const rec0 = Buffer.alloc(16 + 0xe8 + 16);
  rec0.writeUInt16BE(2, 0);
  rec0.writeUInt32BE(text.length, 4);
  rec0.writeUInt16BE(recs.length, 8);
  rec0.writeUInt16BE(4096, 10);
  rec0.write('MOBI', 16, 'latin1');
  rec0.writeUInt32BE(0xe8, 20);
  rec0.writeUInt32BE(2, 24);
  rec0.writeUInt32BE(65001, 28);
  rec0.writeUInt32BE(6, 36);
  rec0.writeUInt32BE(0, 0x80);
  rec0.writeUInt16BE(trailing ? 2 : 0, 0xf2);
  const all = [rec0, ...recs];
  const header = Buffer.alloc(78 + all.length * 8 + 2);
  header.write('test-book', 0, 'latin1');
  header.write('BOOKMOBI', 60, 'latin1');
  header.writeUInt16BE(all.length, 76);
  let off = header.length;
  all.forEach((r, i) => {
    header.writeUInt32BE(off, 78 + i * 8);
    header.writeUInt32BE(i * 2, 78 + i * 8 + 4);
    off += r.length;
  });
  fs.writeFileSync(file, Buffer.concat([header, ...all]));
}

const html = fs.readFileSync(process.argv[2], 'utf8').replace(/<h1/g, '<mbp:pagebreak/><h1');
build(html, process.argv[3]);
build(html, process.argv[4], { trailing: true });
