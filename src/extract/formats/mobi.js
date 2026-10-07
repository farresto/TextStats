'use strict';

// MOBI / PRC / AZW / AZW3 (KF8) reader: PalmDB records, PalmDOC LZ77 and HUFF/CDIC decompression.
const { parse } = require('../markup');
const { DocBuilder, htmlToBlocks } = require('../builder');
const { UserError } = require('../errors');

function readRecords(buf) {
  const count = buf.readUInt16BE(76);
  const offsets = [];
  for (let i = 0; i < count; i++) offsets.push(buf.readUInt32BE(78 + i * 8));
  return offsets.map((start, i) => buf.subarray(start, i + 1 < count ? offsets[i + 1] : buf.length));
}

function palmDocDecompress(data) {
  const out = Buffer.alloc(data.length * 8 + 16);
  let o = 0;
  let i = 0;
  while (i < data.length) {
    const c = data[i++];
    if (c === 0 || (c >= 0x09 && c <= 0x7f)) out[o++] = c;
    else if (c >= 0x01 && c <= 0x08) {
      for (let k = 0; k < c && i < data.length; k++) out[o++] = data[i++];
    } else if (c >= 0x80 && c <= 0xbf) {
      const pair = (c << 8) | data[i++];
      const dist = (pair & 0x3fff) >> 3;
      const len = (pair & 7) + 3;
      for (let k = 0; k < len; k++) {
        out[o] = out[o - dist];
        o++;
      }
    } else {
      out[o++] = 0x20;
      out[o++] = c ^ 0x80;
    }
  }
  return out.subarray(0, o);
}

class Huffcdic {
  constructor(records) {
    const huff = records[0];
    if (huff.subarray(0, 4).toString('latin1') !== 'HUFF') throw new Error('bad HUFF record');
    const off1 = huff.readUInt32BE(8);
    const off2 = huff.readUInt32BE(12);
    this.dict1 = [];
    for (let i = 0; i < 256; i++) {
      const v = huff.readUInt32BE(off1 + i * 4);
      const codelen = v & 0x1f;
      const term = v & 0x80;
      const maxcode = ((BigInt(v >>> 8) + 1n) << BigInt(32 - codelen)) - 1n;
      this.dict1.push([codelen, term, maxcode]);
    }
    this.mincode = [0n];
    this.maxcode = [0n];
    for (let i = 0; i < 32; i++) {
      const codelen = i + 1;
      const min = BigInt(huff.readUInt32BE(off2 + i * 8));
      const max = BigInt(huff.readUInt32BE(off2 + i * 8 + 4));
      this.mincode.push(min << BigInt(32 - codelen));
      this.maxcode.push(((max + 1n) << BigInt(32 - codelen)) - 1n);
    }
    this.dictionary = [];
    for (const cdic of records.slice(1)) {
      if (cdic.subarray(0, 4).toString('latin1') !== 'CDIC') continue;
      const phrases = cdic.readUInt32BE(8);
      const bits = cdic.readUInt32BE(12);
      const n = Math.min(1 << bits, phrases - this.dictionary.length);
      for (let i = 0; i < n; i++) {
        const off = cdic.readUInt16BE(16 + i * 2);
        const blen = cdic.readUInt16BE(16 + off);
        this.dictionary.push([cdic.subarray(18 + off, 18 + off + (blen & 0x7fff)), blen & 0x8000]);
      }
    }
  }

  unpack(data, depth = 0) {
    if (depth > 32) return Buffer.alloc(0);
    let bitsleft = data.length * 8;
    const padded = Buffer.concat([data, Buffer.alloc(8)]);
    let pos = 0;
    let x = padded.readBigUInt64BE(0);
    let n = 32;
    const parts = [];
    for (;;) {
      if (n <= 0) {
        pos += 4;
        x = padded.readBigUInt64BE(pos);
        n += 32;
      }
      const code = (x >> BigInt(n)) & 0xffffffffn;
      let [codelen, term, maxcode] = this.dict1[Number(code >> 24n)];
      if (!term) {
        while (codelen < 32 && code < this.mincode[codelen]) codelen++;
        maxcode = this.maxcode[codelen];
      }
      n -= codelen;
      bitsleft -= codelen;
      if (bitsleft < 0) break;
      const r = Number((maxcode - code) >> BigInt(32 - codelen));
      const entry = this.dictionary[r];
      if (!entry) break;
      let [slice, flag] = entry;
      if (!flag) {
        this.dictionary[r] = [Buffer.alloc(0), 1];
        slice = this.unpack(slice, depth + 1);
        this.dictionary[r] = [slice, 1];
      }
      parts.push(slice);
    }
    return Buffer.concat(parts);
  }
}

function trailingSize(rec, flags) {
  let size = rec.length;
  let num = 0;
  const entry = (end) => {
    let bitpos = 0;
    let result = 0;
    while (end > 0) {
      const v = rec[end - 1];
      result |= (v & 0x7f) << bitpos;
      bitpos += 7;
      end--;
      if (v & 0x80 || bitpos >= 28 || end === 0) break;
    }
    return result;
  };
  let test = flags >> 1;
  while (test) {
    if (test & 1) num += entry(size - num);
    test >>= 1;
  }
  if (flags & 1) num += (rec[size - num - 1] & 0x3) + 1;
  return num;
}

function readExth(rec0, mobiHeaderLen) {
  const map = new Map();
  const start = 16 + mobiHeaderLen;
  if (rec0.subarray(start, start + 4).toString('latin1') !== 'EXTH') return map;
  const count = rec0.readUInt32BE(start + 8);
  let p = start + 12;
  for (let i = 0; i < count && p + 8 <= rec0.length; i++) {
    const type = rec0.readUInt32BE(p);
    const len = rec0.readUInt32BE(p + 4);
    map.set(type, rec0.subarray(p + 8, p + len));
    p += len;
  }
  return map;
}

// Decode the text of one book part starting at record index `base`.
function bookText(records, base) {
  const rec0 = records[base];
  const compression = rec0.readUInt16BE(0);
  const textRecords = rec0.readUInt16BE(8);
  const encryption = rec0.readUInt16BE(12);
  if (encryption !== 0) {
    throw new UserError('kindleDrm');
  }
  const isMobi = rec0.subarray(16, 20).toString('latin1') === 'MOBI';
  const headerLen = isMobi ? rec0.readUInt32BE(20) : 0;
  const encoding = isMobi ? rec0.readUInt32BE(28) : 1252;
  const version = isMobi ? rec0.readUInt32BE(36) : 0;
  let extraFlags = 0;
  if (isMobi && headerLen >= 0xe4 && rec0.length >= 0xf4) extraFlags = rec0.readUInt16BE(0xf2);

  let decompress;
  if (compression === 1) decompress = (d) => d;
  else if (compression === 2) decompress = palmDocDecompress;
  else if (compression === 17480) {
    const huffOff = rec0.readUInt32BE(0x70);
    const huffCount = rec0.readUInt32BE(0x74);
    const h = new Huffcdic(records.slice(base + huffOff, base + huffOff + huffCount));
    decompress = (d) => h.unpack(d);
  } else throw new UserError('kindleCompression', compression);

  const chunks = [];
  for (let i = 1; i <= textRecords && base + i < records.length; i++) {
    const rec = records[base + i];
    const trail = extraFlags ? trailingSize(rec, extraFlags) : 0;
    chunks.push(decompress(rec.subarray(0, rec.length - trail)));
  }
  let raw = Buffer.concat(chunks);

  // KF8: keep only the first flow (the HTML), dropping CSS/SVG flows.
  if (version >= 8 && headerLen >= 0xc4) {
    const fdstIndex = rec0.readUInt32BE(0xc0);
    const fdst = fdstIndex !== 0xffffffff ? records[base + fdstIndex] : null;
    if (fdst && fdst.subarray(0, 4).toString('latin1') === 'FDST') {
      const count = fdst.readUInt32BE(8);
      if (count > 0) raw = raw.subarray(fdst.readUInt32BE(12), fdst.readUInt32BE(16));
    }
  }
  const decoder = new TextDecoder(encoding === 65001 ? 'utf-8' : 'windows-1252');
  return { html: decoder.decode(raw), version };
}

async function extract(buf, { onProgress }) {
  const records = readRecords(buf);
  if (!records.length) throw new UserError('kindleEmpty');
  // Combined MOBI+KF8 files start with the legacy MOBI part (plain HTML); the KF8
  // part after the EXTH 121 boundary is a duplicate of the same text, so record 0 is always the right start.
  onProgress(0.2);
  const { html } = bookText(records, 0);
  onProgress(0.7);

  const b = new DocBuilder();
  const tree = parse(html.replace(/<\?xml[^>]*>/g, ''), { html: true });
  htmlToBlocks(b, tree);
  b.structuralHeadings = b.blocks.some((x) => x.k === 'h');
  return b;
}

module.exports = { extract, palmDocDecompress };
