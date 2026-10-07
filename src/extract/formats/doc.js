'use strict';

// Word 97-2003 (.doc): Compound File Binary container + piece table text extraction.
const { DocBuilder } = require('../builder');
const { UserError } = require('../errors');

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

class Cfb {
  constructor(buf) {
    this.buf = buf;
    this.sectorSize = 1 << buf.readUInt16LE(0x1e);
    this.miniSize = 1 << buf.readUInt16LE(0x20);
    this.miniCutoff = buf.readUInt32LE(0x38);
    const numFat = buf.readUInt32LE(0x2c);
    const firstDir = buf.readUInt32LE(0x30);
    const firstMiniFat = buf.readUInt32LE(0x3c);
    let difatSector = buf.readUInt32LE(0x44);

    const fatSectors = [];
    for (let i = 0; i < 109 && fatSectors.length < numFat; i++) fatSectors.push(buf.readUInt32LE(0x4c + i * 4));
    let guard = 0;
    while (difatSector !== ENDOFCHAIN && difatSector !== FREESECT && fatSectors.length < numFat && guard++ < 10000) {
      const off = this.offset(difatSector);
      const per = this.sectorSize / 4 - 1;
      for (let i = 0; i < per && fatSectors.length < numFat; i++) fatSectors.push(buf.readUInt32LE(off + i * 4));
      difatSector = buf.readUInt32LE(off + per * 4);
    }
    const perSector = this.sectorSize / 4;
    this.fat = new Uint32Array(fatSectors.length * perSector);
    fatSectors.forEach((s, k) => {
      const off = this.offset(s);
      for (let i = 0; i < perSector; i++) this.fat[k * perSector + i] = buf.readUInt32LE(off + i * 4);
    });

    const dir = this.chain(firstDir);
    this.entries = [];
    for (let p = 0; p + 128 <= dir.length; p += 128) {
      const nameLen = dir.readUInt16LE(p + 0x40);
      const name = dir.subarray(p, p + Math.max(0, nameLen - 2)).toString('utf16le');
      this.entries.push({ name, type: dir[p + 0x42], start: dir.readUInt32LE(p + 0x74), size: dir.readUInt32LE(p + 0x78) });
    }
    const root = this.entries[0];
    this.miniStream = root ? this.chain(root.start, root.size) : Buffer.alloc(0);
    const mf = firstMiniFat !== ENDOFCHAIN ? this.chain(firstMiniFat) : Buffer.alloc(0);
    this.miniFat = new Uint32Array(mf.length / 4);
    for (let i = 0; i < this.miniFat.length; i++) this.miniFat[i] = mf.readUInt32LE(i * 4);
  }

  offset(sector) {
    return (sector + 1) * this.sectorSize;
  }

  chain(start, size) {
    const parts = [];
    let s = start;
    let guard = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && s < this.fat.length && guard++ < 1e7) {
      const off = this.offset(s);
      parts.push(this.buf.subarray(off, off + this.sectorSize));
      s = this.fat[s];
    }
    const out = Buffer.concat(parts);
    return size !== undefined ? out.subarray(0, size) : out;
  }

  miniChain(start, size) {
    const parts = [];
    let s = start;
    let guard = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && s < this.miniFat.length && guard++ < 1e7) {
      parts.push(this.miniStream.subarray(s * this.miniSize, (s + 1) * this.miniSize));
      s = this.miniFat[s];
    }
    return Buffer.concat(parts).subarray(0, size);
  }

  stream(name) {
    const e = this.entries.find((x) => x.type === 2 && x.name.toLowerCase() === name.toLowerCase());
    if (!e) return null;
    return e.size < this.miniCutoff ? this.miniChain(e.start, e.size) : this.chain(e.start, e.size);
  }
}

const cp1252 = new TextDecoder('windows-1252');

async function extract(buf, { onProgress }) {
  let cfb;
  try {
    cfb = new Cfb(buf);
  } catch (err) {
    throw new UserError('docDamaged');
  }
  const word = cfb.stream('WordDocument');
  if (!word) {
    if (cfb.stream('EncryptedPackage')) throw new UserError('docPassword');
    throw new UserError('docNotWord');
  }
  if (word.readUInt16LE(0) !== 0xa5ec) throw new UserError('docNotWord');
  const nFib = word.readUInt16LE(2);
  const flags = word.readUInt16LE(0x0a);
  if (flags & 0x0100) throw new UserError('docPassword');
  if (nFib < 0x00c1) throw new UserError('docTooOld');
  const table = cfb.stream(flags & 0x0200 ? '1Table' : '0Table');
  if (!table) throw new UserError('docDamaged');

  const ccpText = word.readUInt32LE(0x4c);
  const fcClx = word.readUInt32LE(0x1a2);
  const lcbClx = word.readUInt32LE(0x1a6);
  onProgress(0.3);

  // Find the piece table (Pcdt) inside the Clx.
  let p = fcClx;
  const end = fcClx + lcbClx;
  while (p < end && table[p] === 0x01) p += 3 + table.readUInt16LE(p + 1);
  if (table[p] !== 0x02) throw new UserError('docDamaged');
  const lcb = table.readUInt32LE(p + 1);
  const plc = table.subarray(p + 5, p + 5 + lcb);
  const n = (lcb - 4) / 12;
  let text = '';
  for (let i = 0; i < n && text.length < ccpText; i++) {
    const cpStart = plc.readUInt32LE(i * 4);
    const cpEnd = plc.readUInt32LE((i + 1) * 4);
    const pcd = 4 * (n + 1) + i * 8;
    const fcRaw = plc.readUInt32LE(pcd + 2);
    const compressed = (fcRaw & 0x40000000) !== 0;
    const fc = fcRaw & 0x3fffffff;
    const count = cpEnd - cpStart;
    if (compressed) {
      const start = fc / 2;
      text += cp1252.decode(word.subarray(start, start + count));
    } else {
      text += word.subarray(fc, fc + count * 2).toString('utf16le');
    }
  }
  text = text.slice(0, ccpText);
  onProgress(0.7);

  // Fields: \x13 code \x14 result \x15 -> keep the result only. Detect TOC/INDEX fields.
  const b = new DocBuilder();
  let out = '';
  const fieldStack = [];
  let role = null;
  const flush = () => {
    if (out.trim()) b.add(out, 'p', role);
    out = '';
  };
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code === 0x13) {
      fieldStack.push({ code: '', inCode: true, role: null });
      continue;
    }
    if (code === 0x14) {
      const f = fieldStack[fieldStack.length - 1];
      if (f) {
        f.inCode = false;
        if (/^\s*TOC\b/i.test(f.code)) f.role = 'toc';
        else if (/^\s*INDEX\b/i.test(f.code)) f.role = 'index';
        role = fieldStack.map((x) => x.role).find((x) => x) || null;
      }
      continue;
    }
    if (code === 0x15) {
      fieldStack.pop();
      const r = fieldStack.map((x) => x.role).find((x) => x) || null;
      if (r !== role) {
        flush();
        role = r;
      }
      continue;
    }
    const top = fieldStack[fieldStack.length - 1];
    if (top && top.inCode) {
      top.code += ch;
      continue;
    }
    if (code === 0x0d || code === 0x07 || code === 0x0b) flush();
    else if (code === 0x0c) {
      flush();
      b.newSection();
    } else if (code === 0x09) out += '\t';
    else if (code === 0x1e) out += '-';
    else if (code === 0x1f || code < 0x09 || (code > 0x0d && code < 0x20)) continue;
    else out += ch;
  }
  flush();
  return b;
}

module.exports = { extract, Cfb };
