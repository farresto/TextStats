'use strict';

// Minimal dependency-free ZIP reader (stored + deflate, ZIP64 sizes).
const zlib = require('zlib');

class ZipFile {
  constructor(buf) {
    this.buf = buf;
    this.entries = new Map();
    this.lower = new Map();
    this._readCentralDirectory();
  }

  _readCentralDirectory() {
    const buf = this.buf;
    let eocd = -1;
    const stop = Math.max(0, buf.length - 65557);
    for (let i = buf.length - 22; i >= stop; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return this._scanLocalHeaders();
    let count = buf.readUInt16LE(eocd + 10);
    let cdOffset = buf.readUInt32LE(eocd + 16);
    // ZIP64 end of central directory
    if (cdOffset === 0xffffffff || count === 0xffff) {
      const locator = eocd - 20;
      if (locator >= 0 && buf.readUInt32LE(locator) === 0x07064b50) {
        const z64 = Number(buf.readBigUInt64LE(locator + 8));
        if (buf.readUInt32LE(z64) === 0x06064b50) {
          count = Number(buf.readBigUInt64LE(z64 + 32));
          cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
        }
      }
    }
    let p = cdOffset;
    for (let i = 0; i < count; i++) {
      if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
      const flags = buf.readUInt16LE(p + 8);
      const method = buf.readUInt16LE(p + 10);
      let csize = buf.readUInt32LE(p + 20);
      let usize = buf.readUInt32LE(p + 24);
      const nameLen = buf.readUInt16LE(p + 28);
      const extraLen = buf.readUInt16LE(p + 30);
      const commentLen = buf.readUInt16LE(p + 32);
      let localOffset = buf.readUInt32LE(p + 42);
      const nameBuf = buf.subarray(p + 46, p + 46 + nameLen);
      const name = flags & 0x800 ? nameBuf.toString('utf8') : decodeCp437(nameBuf);
      // ZIP64 extra field
      let e = p + 46 + nameLen;
      const eEnd = e + extraLen;
      while (e + 4 <= eEnd) {
        const id = buf.readUInt16LE(e);
        const sz = buf.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (usize === 0xffffffff) { usize = Number(buf.readBigUInt64LE(q)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(q)); q += 8; }
          if (localOffset === 0xffffffff) { localOffset = Number(buf.readBigUInt64LE(q)); q += 8; }
        }
        e += 4 + sz;
      }
      this._add({ name, flags, method, csize, usize, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (this.entries.size === 0) this._scanLocalHeaders();
  }

  // Fallback for archives with a damaged central directory.
  _scanLocalHeaders() {
    const buf = this.buf;
    let p = 0;
    while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
      const flags = buf.readUInt16LE(p + 6);
      const method = buf.readUInt16LE(p + 8);
      const csize = buf.readUInt32LE(p + 18);
      const usize = buf.readUInt32LE(p + 22);
      const nameLen = buf.readUInt16LE(p + 26);
      const extraLen = buf.readUInt16LE(p + 28);
      const name = buf.subarray(p + 30, p + 30 + nameLen).toString('utf8');
      if (flags & 0x8) break; // sizes unknown without central directory
      this._add({ name, flags, method, csize, usize, localOffset: p });
      p += 30 + nameLen + extraLen + csize;
    }
    if (this.entries.size === 0) throw new Error('no ZIP directory found');
  }

  _add(entry) {
    if (entry.name.endsWith('/')) return;
    this.entries.set(entry.name, entry);
    this.lower.set(entry.name.toLowerCase(), entry.name);
  }

  names() {
    return [...this.entries.keys()];
  }

  // Exact match first, then case-insensitive (EPUBs made on Windows often mismatch case).
  resolve(name) {
    if (this.entries.has(name)) return name;
    return this.lower.get(String(name).toLowerCase()) || null;
  }

  has(name) {
    return this.resolve(name) !== null;
  }

  bytes(name) {
    const real = this.resolve(name);
    if (!real) throw new Error(`missing entry ${name}`);
    const en = this.entries.get(real);
    if (en.flags & 0x1) {
      const err = new Error('encrypted entry');
      err.code = 'encrypted';
      err.isUser = true;
      throw err;
    }
    const buf = this.buf;
    const lp = en.localOffset;
    if (buf.readUInt32LE(lp) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const start = lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28);
    const data = buf.subarray(start, start + en.csize);
    if (en.method === 0) return Buffer.from(data);
    if (en.method === 8) return zlib.inflateRawSync(data);
    throw new Error(`unsupported compression method ${en.method} for ${name}`);
  }

  text(name) {
    return decodeText(this.bytes(name));
  }
}

const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeCp437(b) {
  let s = '';
  for (const c of b) s += c < 128 ? String.fromCharCode(c) : CP437_HIGH[c - 128];
  return s;
}

// Decode XML/HTML bytes honouring BOMs and declared encodings.
function decodeText(b) {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString('utf8');
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  const head = b.subarray(0, 1024).toString('latin1');
  const m = /encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head) || /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head);
  if (m) {
    const enc = m[1].toLowerCase();
    if (enc !== 'utf-8' && enc !== 'utf8') {
      try {
        return new TextDecoder(enc).decode(b);
      } catch (_) {
        /* unknown label, fall through */
      }
    }
  }
  return b.toString('utf8');
}

module.exports = { ZipFile, decodeText };
