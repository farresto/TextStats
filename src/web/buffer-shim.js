'use strict';

// A small stand-in for Node's Buffer, with only what the file readers use.
// Loaded first in the web build; the desktop app uses the real Buffer.
(function () {
  if (typeof globalThis.Buffer !== 'undefined') return;

  const latin1 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return s;
  };

  class Buffer extends Uint8Array {
    static from(src, a, b) {
      if (src instanceof ArrayBuffer) return new Buffer(src, a || 0, b === undefined ? src.byteLength - (a || 0) : b);
      if (typeof src === 'string') {
        if (a === 'latin1' || a === 'binary') {
          const out = new Buffer(src.length);
          for (let i = 0; i < src.length; i++) out[i] = src.charCodeAt(i) & 0xff;
          return out;
        }
        const e = new TextEncoder().encode(src);
        return new Buffer(e.buffer, e.byteOffset, e.byteLength);
      }
      const out = new Buffer(src.length);
      out.set(src);
      return out;
    }
    static alloc(n) {
      return new Buffer(n);
    }
    static concat(list) {
      let n = 0;
      for (const b of list) n += b.length;
      const out = new Buffer(n);
      let o = 0;
      for (const b of list) {
        out.set(b, o);
        o += b.length;
      }
      return out;
    }
    get _dv() {
      return new DataView(this.buffer, this.byteOffset, this.byteLength);
    }
    readUInt16LE(o) { return this._dv.getUint16(o, true); }
    readUInt16BE(o) { return this._dv.getUint16(o, false); }
    readUInt32LE(o) { return this._dv.getUint32(o, true); }
    readUInt32BE(o) { return this._dv.getUint32(o, false); }
    readBigUInt64LE(o) { return this._dv.getBigUint64(o, true); }
    readBigUInt64BE(o) { return this._dv.getBigUint64(o, false); }
    writeUInt16BE(v, o) { this._dv.setUint16(o, v, false); return o + 2; }
    writeUInt32BE(v, o) { this._dv.setUint32(o, v, false); return o + 4; }
    toString(enc = 'utf8', start = 0, end = this.length) {
      const part = this.subarray(start, end);
      if (enc === 'latin1' || enc === 'binary' || enc === 'ascii') return latin1(part);
      if (enc === 'utf16le' || enc === 'ucs2') return new TextDecoder('utf-16le').decode(part);
      return new TextDecoder('utf-8').decode(part);
    }
    equals(other) {
      if (other.length !== this.length) return false;
      for (let i = 0; i < this.length; i++) if (this[i] !== other[i]) return false;
      return true;
    }
    copy(target, targetStart = 0, start = 0, end = this.length) {
      target.set(this.subarray(start, end), targetStart);
      return end - start;
    }
  }
  globalThis.Buffer = Buffer;
})();
