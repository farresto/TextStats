'use strict';

// Apple Pages and iBooks Author.
//  - Pages 5+ / newer iWork: "IWA" archives (Snappy-compressed protobuf) inside Index/.
//  - Pages '09 and iBooks Author: XML using the "sf:" (SFWP) vocabulary.
const zlib = require('zlib');
const { ZipFile, decodeText } = require('../zip');
const { parse, local, walk } = require('../markup');
const { DocBuilder, htmlToBlocks } = require('../builder');
const { UserError } = require('../errors');

// ---------------------------------------------------------------- Snappy (raw, no framing CRC)

function snappyDecompress(src) {
  let p = 0;
  let len = 0;
  let shift = 0;
  for (;;) {
    const c = src[p++];
    len |= (c & 0x7f) << shift;
    if (!(c & 0x80)) break;
    shift += 7;
  }
  const out = Buffer.alloc(len);
  let o = 0;
  while (p < src.length && o < len) {
    const tag = src[p++];
    const type = tag & 3;
    if (type === 0) {
      let l = tag >> 2;
      if (l >= 60) {
        const bytes = l - 59;
        l = 0;
        for (let k = 0; k < bytes; k++) l |= src[p++] << (8 * k);
      }
      l += 1;
      src.copy(out, o, p, p + l);
      p += l;
      o += l;
    } else {
      let l;
      let off;
      if (type === 1) {
        l = ((tag >> 2) & 7) + 4;
        off = ((tag >> 5) << 8) | src[p++];
      } else if (type === 2) {
        l = (tag >> 2) + 1;
        off = src[p] | (src[p + 1] << 8);
        p += 2;
      } else {
        l = (tag >> 2) + 1;
        off = src.readUInt32LE(p);
        p += 4;
      }
      for (let k = 0; k < l; k++, o++) out[o] = out[o - off];
    }
  }
  return out.subarray(0, o);
}

function iwaDecompress(buf) {
  const parts = [];
  let p = 0;
  while (p + 4 <= buf.length) {
    const type = buf[p];
    const len = buf[p + 1] | (buf[p + 2] << 8) | (buf[p + 3] << 16);
    const chunk = buf.subarray(p + 4, p + 4 + len);
    parts.push(type === 0 ? snappyDecompress(chunk) : chunk);
    p += 4 + len;
  }
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------- protobuf

function varint(buf, pos) {
  let result = 0;
  let mul = 1;
  let b;
  do {
    b = buf[pos.p++];
    result += (b & 0x7f) * mul;
    mul *= 128;
  } while (b & 0x80 && pos.p < buf.length);
  return result;
}

function fields(buf) {
  const out = [];
  const pos = { p: 0 };
  while (pos.p < buf.length) {
    const key = varint(buf, pos);
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) out.push({ field, value: varint(buf, pos) });
    else if (wire === 1) pos.p += 8;
    else if (wire === 5) pos.p += 4;
    else if (wire === 2) {
      const l = varint(buf, pos);
      out.push({ field, bytes: buf.subarray(pos.p, pos.p + l) });
      pos.p += l;
    } else break; // groups / garbage
  }
  return out;
}

// Iterate (type, payload) for every message in a decompressed IWA stream.
function* iwaMessages(data) {
  const pos = { p: 0 };
  while (pos.p < data.length) {
    const infoLen = varint(data, pos);
    const info = fields(data.subarray(pos.p, pos.p + infoLen));
    pos.p += infoLen;
    for (const f of info) {
      if (f.field !== 2 || !f.bytes) continue;
      const mi = fields(f.bytes);
      const type = (mi.find((x) => x.field === 1) || {}).value;
      const length = (mi.find((x) => x.field === 3) || {}).value || 0;
      yield { type, payload: data.subarray(pos.p, pos.p + length) };
      pos.p += length;
    }
  }
}

const STORAGE_TYPES = new Set([2001, 2005]); // TSWP.StorageArchive

function extractIwa(zip, b) {
  let names = zip.names().filter((n) => /^Index\/.*\.iwa$/i.test(n));
  let source = zip;
  if (!names.length && zip.has('Index.zip')) {
    source = new ZipFile(zip.bytes('Index.zip'));
    names = source.names().filter((n) => /\.iwa$/i.test(n));
  }
  if (!names.length) return false;
  names.sort((a, c) => (/Document\.iwa$/i.test(a) ? -1 : /Document\.iwa$/i.test(c) ? 1 : a.localeCompare(c)));

  // StorageArchive.kind: 0 BODY, 1 HEADER, 2 FOOTNOTE, 3 TEXTBOX (default), 4 NOTE, 5 CELL, 6 UNCLASSIFIED, 7 TOC
  const body = [];
  const toc = [];
  const other = [];
  for (const name of names) {
    let data;
    try {
      data = iwaDecompress(source.bytes(name));
    } catch (_) {
      continue;
    }
    for (const m of iwaMessages(data)) {
      if (!STORAGE_TYPES.has(m.type)) continue;
      const f = fields(m.payload);
      const kind = (f.find((x) => x.field === 1 && x.value !== undefined) || { value: 3 }).value;
      const text = f.filter((x) => x.field === 3 && x.bytes).map((x) => x.bytes.toString('utf8')).join('');
      if (!text.trim()) continue;
      if (kind === 0) body.push(text);
      else if (kind === 7) toc.push(text);
      else if (kind === 3 || kind === 5 || kind === 6) other.push(text);
    }
  }
  const texts = body.length ? body : other;
  if (texts.length) {
    for (const t of toc) {
      for (const para of t.split(/[\n\r\u2029\u2028\u000b]/)) b.add(para, 'p', 'toc');
      b.newSection();
    }
  }
  for (const t of texts) {
    for (const para of t.split(/[\n\r\u2029\u2028\u000b]/)) b.add(para);
    b.newSection();
  }
  if (!body.length && other.length) b.warn('iworkNoBody');
  return texts.length > 0;
}

// ---------------------------------------------------------------- SF XML (Pages '09, iBooks Author)

function extractSfXml(xmlText, b) {
  const tree = parse(xmlText);
  let found = false;
  const styleIsHeading = (v) => /head|title|chapter|section/i.test(v || '');
  for (const el of walk(tree)) {
    const ln = local(el.name);
    if (el.name.startsWith('sf:') && ln === 'p') {
      if (insideSkipped(el)) continue;
      let s = '';
      const inner = (n) => {
        for (const c of n.children) {
          if (typeof c === 'string') s += c;
          else {
            const cl = local(c.name);
            if (cl === 'tab' || cl === 'br' || cl === 'lnbr' || cl === 'crbr' || cl === 'intratopicbr') s += ' ';
            else if (cl === 'pgbr' || cl === 'sectbr') s += ' ';
            else if (cl !== 'footnote' && cl !== 'annotation-field') inner(c);
          }
        }
      };
      inner(el);
      const style = el.attrs['sf:style'] || el.attrs['sf:para-style'] || '';
      b.add(s, styleIsHeading(style) ? 'h' : 'p');
      if (el.children.some((c) => typeof c !== 'string' && /^(pgbr|sectbr)$/.test(local(c.name)))) b.newSection();
      found = true;
    }
  }
  return found;
}

function insideSkipped(el) {
  for (let p = el.parent; p; p = p.parent) {
    const ln = local(p.name || '');
    if (ln === 'stylesheet' || ln === 'metadata' || ln === 'footnotes' || ln === 'p') return true;
  }
  return false;
}

function readMaybeGzip(zip, name) {
  const data = zip.bytes(name);
  return decodeText(/\.gz$/i.test(name) ? zlib.gunzipSync(data) : data);
}

async function extract(zip, { kind, onProgress }) {
  const b = new DocBuilder();
  onProgress(0.2);
  if (extractIwa(zip, b)) {
    b.warn(kind === 'iba' ? 'ibaBestEffort' : 'pagesBestEffort');
    return b;
  }
  const xmlNames = zip
    .names()
    .filter((n) => /\.(xml|xml\.gz|apxl|apxl\.gz)$/i.test(n) && !/(^|\/)(META-INF|__MACOSX)\//i.test(n) && !/plist|metadata|buildversion|properties/i.test(n));
  xmlNames.sort((a, c) => (/^index\.xml/i.test(a) ? -1 : /^index\.xml/i.test(c) ? 1 : a.localeCompare(c, undefined, { numeric: true })));
  let found = false;
  for (const name of xmlNames) {
    try {
      if (extractSfXml(readMaybeGzip(zip, name), b)) {
        found = true;
        b.newSection();
      }
    } catch (_) {
      /* try the next part */
    }
  }
  if (!found) {
    // Last resort: any XHTML content inside the package.
    for (const name of zip.names().filter((n) => /\.x?html?$/i.test(n))) {
      htmlToBlocks(b, parse(zip.text(name), { html: true }));
      b.newSection();
      found = b.blocks.length > 0;
    }
  }
  if (!found) {
    throw new UserError(kind === 'iba' ? 'ibaNoText' : 'pagesNoText');
  }
  b.structuralHeadings = b.blocks.some((x) => x.k === 'h');
  b.warn(kind === 'iba' ? 'ibaBestEffort' : 'pagesBestEffort');
  return b;
}

module.exports = { extract, snappyDecompress };
