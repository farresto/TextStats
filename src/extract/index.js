'use strict';

const fs = require('fs');
const path = require('path');
const { UserError } = require('./errors');
const { ZipFile } = require('./zip');
const { finalize } = require('./classify');

const formats = {
  txt: () => require('./formats/txt'),
  csv: () => require('./formats/csv'),
  rtf: () => require('./formats/rtf'),
  pdf: () => require('./formats/pdf'),
  epub: () => require('./formats/epub'),
  mobi: () => require('./formats/mobi'),
  docx: () => require('./formats/docx'),
  doc: () => require('./formats/doc'),
  odt: () => require('./formats/odt'),
  iwork: () => require('./formats/iwork'),
};

const LABELS = {
  txt: 'Plain text', csv: 'CSV', rtf: 'RTF', pdf: 'PDF', epub: 'EPUB', mobi: 'Kindle (MOBI/AZW)',
  docx: 'Word (DOCX)', doc: 'Word 97-2003 (DOC)', odt: 'OpenDocument (ODT)', pages: 'Apple Pages', iba: 'iBooks Author',
};

async function extractFile(filePath, onProgress = () => {}) {
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (err) {
    throw err.code === 'ENOENT' ? new UserError('notFound') : new UserError('cannotOpen', err.code || err.message);
  }
  const ext = path.extname(filePath).toLowerCase();
  const kind = sniff(buf, ext);
  onProgress(0.05);

  let builder;
  switch (kind.type) {
    case 'zip':
      builder = await extractZip(buf, ext, onProgress);
      break;
    case 'kfx':
      throw new UserError('kfx');
    case 'topaz':
      throw new UserError('topaz');
    default:
      builder = await formats[kind.type]().extract(buf, { ext, onProgress, filePath });
  }
  onProgress(0.95);
  const doc = finalize(builder);
  doc.formatKey = builder.formatKey || kind.type;
  doc.format = LABELS[doc.formatKey] || doc.formatKey.toUpperCase();
  return doc;
}

function sniff(buf, ext) {
  const head = buf.subarray(0, 8).toString('latin1');
  if (head.startsWith('%PDF') || buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) return { type: 'pdf' };
  if (head.startsWith('PK\x03\x04') || head.startsWith('PK\x05\x06')) return { type: 'zip' };
  if (buf.length > 8 && buf.readUInt32BE(0) === 0xd0cf11e0 && buf.readUInt32BE(4) === 0xa1b11ae1) return { type: 'doc' };
  if (head.startsWith('{\\rtf')) return { type: 'rtf' };
  if (buf.length > 68) {
    const type = buf.subarray(60, 68).toString('latin1');
    if (type === 'BOOKMOBI' || type === 'TEXtREAd') return { type: 'mobi' };
  }
  if (head.startsWith('TPZ')) return { type: 'topaz' };
  if (head.startsWith('CONT') || head.startsWith('\xeaDRMION') || buf.subarray(0, 4).equals(Buffer.from([0xe0, 0x01, 0x00, 0xea]))) {
    return { type: 'kfx' };
  }
  if (ext === '.kfx') return { type: 'kfx' };
  if (['.mobi', '.azw', '.azw3', '.prc', '.kf8'].includes(ext)) {
    throw new UserError('badKindle');
  }
  if (['.docx', '.docm', '.odt', '.epub', '.pages', '.iba'].includes(ext)) {
    throw new UserError('notZip', ext);
  }
  if (ext === '.pdf') throw new UserError('badPdf');
  if (ext === '.doc') throw new UserError('docNot97');
  if (ext === '.csv' || ext === '.tsv') return { type: 'csv' };
  if (looksBinary(buf)) throw new UserError('unsupported');
  return { type: 'txt' };
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  if (n === 0) return false;
  // UTF-16 with BOM is text.
  if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) return false;
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const c = buf[i];
    if (c === 0) return true;
    if (c < 9 || (c > 13 && c < 32 && c !== 27)) ctrl++;
  }
  return ctrl / n > 0.05;
}

async function extractZip(buf, ext, onProgress) {
  let zip;
  try {
    zip = new ZipFile(buf);
  } catch (err) {
    throw new UserError('zipDamaged', err.message);
  }
  const names = zip.names();
  const has = (n) => zip.has(n);
  const mimetype = has('mimetype') ? zip.text('mimetype').trim() : '';

  if (ext === '.iba') {
    const b = await formats.iwork().extract(zip, { kind: 'iba', onProgress });
    b.formatKey = 'iba';
    return b;
  }
  if (mimetype === 'application/epub+zip' || (has('META-INF/container.xml') && ext !== '.pages')) {
    const b = await formats.epub().extract(zip, { onProgress });
    b.formatKey = 'epub';
    return b;
  }
  if (has('word/document.xml') || names.some((n) => /^word\/document\d*\.xml$/.test(n))) {
    const b = await formats.docx().extract(zip, { onProgress });
    b.formatKey = 'docx';
    return b;
  }
  if (mimetype.startsWith('application/vnd.oasis.opendocument') || has('content.xml')) {
    const b = await formats.odt().extract(zip, { onProgress });
    b.formatKey = 'odt';
    return b;
  }
  if (names.some((n) => /\.(kfx|kdf|azw\.res|ion)$/i.test(n))) {
    throw new UserError('kfxZip');
  }
  if (ext === '.pages' || names.some((n) => /^Index(\/|\.zip$)/.test(n)) || has('index.xml') || has('index.xml.gz')) {
    const b = await formats.iwork().extract(zip, { kind: 'pages', onProgress });
    b.formatKey = 'pages';
    return b;
  }
  throw new UserError('zipUnknown');
}

module.exports = { extractFile, sniff };
