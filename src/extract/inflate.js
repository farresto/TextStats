'use strict';

// Pure-JavaScript DEFLATE decoder (RFC 1951) and gzip unwrapper, so the same code
// reads ZIP-based files (EPUB, DOCX, ODT, Pages) on the desktop and in the browser.

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
  4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// Canonical Huffman table: counts per length + symbols sorted by code.
function buildTable(lengths, n) {
  const counts = new Uint16Array(16);
  for (let i = 0; i < n; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
  const symbols = new Uint16Array(n);
  for (let i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
  return { counts, symbols };
}

let FIXED_LIT = null;
let FIXED_DIST = null;
function fixedTables() {
  if (!FIXED_LIT) {
    const l = new Uint8Array(288);
    l.fill(8, 0, 144);
    l.fill(9, 144, 256);
    l.fill(7, 256, 280);
    l.fill(8, 280, 288);
    FIXED_LIT = buildTable(l, 288);
    FIXED_DIST = buildTable(new Uint8Array(30).fill(5), 30);
  }
  return [FIXED_LIT, FIXED_DIST];
}

function inflateRaw(input, sizeHint = 0) {
  const src = input instanceof Uint8Array ? input : new Uint8Array(input);
  let out = new Uint8Array(Math.max(sizeHint, src.length * 4, 1024));
  let o = 0;
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;

  const need = (n) => {
    while (o + n > out.length) {
      const bigger = new Uint8Array(out.length * 2);
      bigger.set(out.subarray(0, o));
      out = bigger;
    }
  };
  const bits = (n) => {
    while (bitCnt < n) {
      if (pos >= src.length) throw new Error('unexpected end of compressed data');
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };
  const decode = (t) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = t.counts[len];
      if (code - first < count) return t.symbols[index + code - first];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('bad Huffman code');
  };

  let final = 0;
  while (!final) {
    final = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0;
      bitCnt = 0;
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      need(len);
      out.set(src.subarray(pos, pos + len), o);
      o += len;
      pos += len;
      continue;
    }
    let lit;
    let dist;
    if (type === 1) [lit, dist] = fixedTables();
    else if (type === 2) {
      const hlit = bits(5) + 257;
      const hdist = bits(5) + 1;
      const hclen = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = bits(3);
      const clTable = buildTable(cl, 19);
      const lengths = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist; ) {
        const sym = decode(clTable);
        if (sym < 16) lengths[i++] = sym;
        else if (sym === 16) {
          const prev = lengths[i - 1];
          for (let r = 3 + bits(2); r > 0; r--) lengths[i++] = prev;
        } else if (sym === 17) i += 3 + bits(3);
        else i += 11 + bits(7);
      }
      lit = buildTable(lengths.subarray(0, hlit), hlit);
      dist = buildTable(lengths.subarray(hlit), hdist);
    } else throw new Error('bad block type');

    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        need(1);
        out[o++] = sym;
      } else if (sym === 256) break;
      else {
        const li = sym - 257;
        const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
        const di = decode(dist);
        const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
        need(len);
        for (let k = 0; k < len; k++, o++) out[o] = out[o - d];
      }
    }
  }
  return out.subarray(0, o);
}

// gzip: skip the header (RFC 1952) and inflate the members.
function gunzip(input) {
  const src = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (src[0] !== 0x1f || src[1] !== 0x8b) throw new Error('not gzip data');
  const flags = src[3];
  let p = 10;
  if (flags & 4) p += 2 + (src[p] | (src[p + 1] << 8));
  if (flags & 8) while (src[p++]);
  if (flags & 16) while (src[p++]);
  if (flags & 2) p += 2;
  const size = (src[src.length - 4] | (src[src.length - 3] << 8) | (src[src.length - 2] << 16)) + src[src.length - 1] * 16777216;
  return inflateRaw(src.subarray(p, src.length - 8), size);
}

module.exports = { inflateRaw, gunzip };
