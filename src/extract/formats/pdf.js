'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { DocBuilder } = require('../builder');
const { UserError } = require('../errors');

const VENDOR = path.join(__dirname, '..', '..', '..', 'vendor', 'pdfjs');
let pdfjsPromise = null;

function loadPdfjs() {
  if (!pdfjsPromise) {
    require('../dom-polyfill');
    pdfjsPromise = import(pathToFileURL(path.join(VENDOR, 'pdf.min.mjs')).href).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(VENDOR, 'pdf.worker.min.mjs')).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

async function extract(buf, { onProgress }) {
  const pdfjs = await loadPdfjs();
  let pdf;
  let task;
  try {
    task = pdfjs.getDocument({
      data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
      cMapUrl: pathToFileURL(path.join(VENDOR, 'cmaps')).href + '/',
      cMapPacked: true,
      standardFontDataUrl: pathToFileURL(path.join(VENDOR, 'standard_fonts')).href + '/',
      disableFontFace: true,
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0,
    });
    pdf = await task.promise;
  } catch (err) {
    if (err && err.name === 'PasswordException') throw new UserError('pdfPassword');
    throw new UserError('pdfOpen', err && err.message ? err.message : String(err));
  }

  // Pass 1: lines per page with font sizes.
  const pages = [];
  const sizeChars = new Map();
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent({ includeMarkedContent: false });
    const viewport = page.getViewport({ scale: 1 });
    pages.push(buildLines(content.items, viewport.height, sizeChars));
    page.cleanup();
    onProgress(0.05 + 0.8 * (p / pdf.numPages));
  }
  await task.destroy();

  // Body font size = the size carrying the most characters.
  let bodySize = 0;
  let best = -1;
  for (const [size, count] of sizeChars) {
    if (count > best) {
      best = count;
      bodySize = size;
    }
  }

  const b = new DocBuilder();
  stripRunningHeaders(pages);
  for (const lines of pages) {
    let para = '';
    let paraIsHeading = false;
    let prev = null;
    const flush = () => {
      if (para.trim()) b.add(para, paraIsHeading ? 'h' : 'p');
      para = '';
      paraIsHeading = false;
    };
    for (const line of lines) {
      if (line.drop) continue;
      const isHeading = bodySize > 0 && line.size >= bodySize * 1.25 && line.text.length <= 120;
      const gap = prev ? prev.y - line.y : 0;
      const lineGap = prev ? Math.max(prev.size, line.size) * 1.75 : 0;
      const newPara =
        !prev ||
        isHeading !== paraIsHeading ||
        gap > lineGap ||
        gap < -2 || // jumped up: new column
        (prev.text.length < 0.6 * prev.maxLen && /[.!?:"”’)]$/.test(prev.text) && !isHeading) ||
        (line.x - prev.x > line.size * 1.2 && !isHeading); // indented first line
      if (newPara) {
        flush();
        paraIsHeading = isHeading;
        para = line.text;
      } else if (/[\p{L}]-$/u.test(para) && /^\p{Ll}/u.test(line.text)) {
        para = para.slice(0, -1) + line.text; // re-join hyphenated words
      } else {
        para += ' ' + line.text;
      }
      prev = line;
    }
    flush();
    b.newSection();
  }
  if (!b.blocks.length) {
    b.warn('pdfNoText');
  }
  return b;
}

function buildLines(items, pageHeight, sizeChars) {
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const tr = it.transform;
    const size = Math.round(Math.hypot(tr[2], tr[3]) * 10) / 10 || Math.round(it.height * 10) / 10 || 0;
    const x = tr[4];
    const y = tr[5];
    if (!it.str) {
      if (it.hasEOL && cur) cur.eol = true;
      continue;
    }
    const sameLine = cur && !cur.eol && Math.abs(cur.y - y) <= Math.max(2, size * 0.4);
    if (!sameLine) {
      cur = { text: '', x, y, size, end: x, eol: false, chars: 0 };
      lines.push(cur);
    } else {
      const gap = x - cur.end;
      if (gap > size * 0.15 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += ' ';
    }
    cur.text += it.str;
    cur.end = x + (it.width || 0);
    cur.size = Math.max(cur.size, size);
    cur.chars += it.str.length;
    sizeChars.set(size, (sizeChars.get(size) || 0) + it.str.length);
    if (it.hasEOL) cur.eol = true;
  }
  const out = [];
  let maxLen = 0;
  for (const l of lines) {
    l.text = l.text.replace(/\s+/g, ' ').trim();
    if (l.text) {
      out.push(l);
      maxLen = Math.max(maxLen, l.text.length);
    }
  }
  for (const l of out) {
    l.maxLen = maxLen;
    l.top = pageHeight - l.y;
  }
  return out;
}

// Remove page numbers and running headers/footers repeated across pages.
function stripRunningHeaders(pages) {
  const key = (t) => t.toLowerCase().replace(/\d+/g, '#').trim();
  const counts = new Map();
  for (const lines of pages) {
    const edge = [...lines.slice(0, 2), ...lines.slice(-2)];
    for (const l of new Set(edge)) counts.set(key(l.text), (counts.get(key(l.text)) || 0) + 1);
  }
  const minRepeats = Math.max(3, Math.floor(pages.length * 0.3));
  for (const lines of pages) {
    const edge = new Set([...lines.slice(0, 2), ...lines.slice(-2)]);
    for (const l of edge) {
      const t = l.text;
      if (/^(page\s*)?[-–—]?\s*\d{1,4}\s*[-–—]?$|^\d+\s*(of|\/)\s*\d+$|^page \d+ of \d+$/i.test(t)) l.drop = true;
      else if (pages.length >= 4 && counts.get(key(t)) >= minRepeats && t.length < 100) l.drop = true;
      else if (/^[ivxlc]{1,6}$/i.test(t) && t.length <= 5 && (l === lines[0] || l === lines[lines.length - 1])) l.drop = true;
    }
  }
}

module.exports = { extract };
