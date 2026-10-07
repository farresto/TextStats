'use strict';

// Recognises chapter headings, copyright pages, tables of contents and indexes
// for formats that do not mark them explicitly, then packages the document.

const CHAPTER_RE = new RegExp(
  '^(chapter|chap\\.|part|book|volume|vol\\.|section|prologue|epilogue|introduction|preface|foreword|afterword|' +
    'acknowledg(e)?ments?|appendix|interlude|conclusion|dedication|about the author|' +
    'cap[ií]tulo|chapitre|kapitel|parte|libro|pr[oó]logo|ep[ií]logo|introducci[oó]n|prologue|avant-propos)\\b',
  'i'
);
const TOC_TITLE_RE = /^(table of contents|contents|content|toc|[íi]ndice|sumario|sommaire|table des mati[eè]res|inhalt|inhaltsverzeichnis|indice|sum[aá]rio)[:.]?$/i;
const INDEX_TITLE_RE = /^(index|general index|subject index|index of names|[íi]ndice (alfab[eé]tico|anal[ií]tico)|index alphab[eé]tique|register)[:.]?$/i;
const COPYRIGHT_MARKERS = [
  /©/, /\(c\)\s*(19|20)\d\d/i, /\bcopyright\b/i, /all rights reserved|todos los derechos reservados|tous droits r[eé]serv[eé]s/i,
  /\bisbn\b/i, /\bpublished (by|in)\b/i, /\bfirst (published|edition|printing)\b/i, /\bprinted in\b/i,
  /library of congress|cataloging|catalogu(e|ing) record|british library/i, /no part of this (book|publication|work)/i,
  /\bcover (design|art|image|illustration)\b/i, /\btypeset\b/i, /\bimprint\b/i, /\bedition\b/i,
  /\bwithout (the )?(prior )?(written )?permission\b/i, /\bfictitious|coincidental|resemblance to actual persons\b/i,
  /\bpublisher\b/i, /\bdep[oó]sito legal\b/i,
];

const wordCount = (t) => (t.match(/[\p{L}\p{N}]+/gu) || []).length;

function finalize(builder) {
  const blocks = builder.blocks;
  const hasRole = (r) => blocks.some((b) => b.r === r);

  if (!builder.noHeuristics) {
    if (!hasRole('toc')) detectToc(blocks);
    if (!blocks.some((b) => b.k === 'h')) detectHeadings(blocks);
    if (!hasRole('index')) detectIndex(blocks);
    if (!hasRole('copyright')) detectCopyright(blocks);
  }

  if (blocks.length === 0) builder.warn('noText');

  return {
    blocks,
    caps: {
      headings: blocks.some((b) => b.k === 'h'),
      copyright: hasRole('copyright'),
      toc: hasRole('toc') || hasRole('index'),
    },
    warnings: builder.warnings,
  };
}

// ---------------------------------------------------------------- headings

function looksLikeHeading(t) {
  if (t.length > 80) return false;
  const words = wordCount(t);
  if (words === 0 || words > 12) return false;
  if (CHAPTER_RE.test(t)) return !/[,;]$/.test(t);
  if (/^[IVXLCDM]{1,7}\.?$/.test(t) && t !== 'I' && t !== 'I.') return true;
  if (/^\d{1,3}\.?$/.test(t)) return true;
  const letters = t.replace(/[^\p{L}]/gu, '');
  if ((t.match(/\d/g) || []).length > 2) return false;
  if (letters.length >= 3 && words <= 8 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
    return !/[.!?,;:]$/.test(t) || /^[IVXLCDM\d]+\.$/.test(t);
  }
  return false;
}

function detectHeadings(blocks) {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.r) continue;
    if (!looksLikeHeading(b.t)) continue;
    // A heading is followed by body text, not the start of a long list of similar lines.
    b.k = 'h';
  }
}

// ---------------------------------------------------------------- table of contents

function stripEntry(t) {
  return t
    .toLowerCase()
    .replace(/[.…·_\s-]{2,}\s*\d+\s*$/u, '')
    .replace(/\s+\d+\s*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function detectToc(blocks) {
  const limit = Math.max(60, Math.floor(blocks.length * 0.3));
  for (let i = 0; i < Math.min(limit, blocks.length); i++) {
    if (!TOC_TITLE_RE.test(blocks[i].t)) continue;
    const entries = new Set();
    let end = i;
    let shortRun = 0;
    for (let j = i + 1; j < blocks.length && j < i + 600; j++) {
      const b = blocks[j];
      const words = wordCount(b.t);
      const key = stripEntry(b.t);
      if (key && entries.has(key)) break; // reached the real chapter carrying a listed title
      const entryLike = words <= 14 || /(\.{2,}|…|\t)\s*\d+\s*$/.test(b.t) || /\s\d{1,4}$/.test(b.t);
      if (!entryLike || words > 25) break;
      if (b.s !== blocks[j - 1].s && b.k === 'h' && entries.size > 2) break;
      if (key) entries.add(key);
      end = j;
      shortRun++;
    }
    if (shortRun >= 2) {
      for (let k = i; k <= end; k++) blocks[k].r = 'toc';
      return;
    }
  }
}

// ---------------------------------------------------------------- back-of-book index

function detectIndex(blocks) {
  const startAt = Math.floor(blocks.length * 0.6);
  for (let i = blocks.length - 1; i >= startAt; i--) {
    if (!INDEX_TITLE_RE.test(blocks[i].t)) continue;
    let end = i;
    let entries = 0;
    for (let j = i + 1; j < blocks.length; j++) {
      const t = blocks[j].t;
      if (wordCount(t) > 30) break;
      end = j;
      if (/\d/.test(t) || wordCount(t) <= 3) entries++;
    }
    if (entries >= 3) {
      for (let k = i; k <= end; k++) blocks[k].r = blocks[k].r || 'index';
      return;
    }
  }
}

// ---------------------------------------------------------------- copyright page

function markerCount(t) {
  let n = 0;
  for (const re of COPYRIGHT_MARKERS) if (re.test(t)) n++;
  return n;
}

function segments(blocks) {
  const segs = [];
  let cur = null;
  blocks.forEach((b, i) => {
    if (!cur || b.s !== blocks[i - 1].s || b.k === 'h') {
      cur = { start: i, end: i, words: 0 };
      segs.push(cur);
    }
    cur.end = i;
    cur.words += wordCount(b.t);
  });
  return segs;
}

function detectCopyright(blocks) {
  if (!blocks.length) return;
  const total = blocks.reduce((n, b) => n + wordCount(b.t), 0);
  const frontLimit = Math.max(total * 0.25, 1500);
  const backStart = total * 0.9;

  // 1) A short section (page, chapter file, or heading-delimited part) full of copyright markers.
  let seen = 0;
  let found = false;
  for (const seg of segments(blocks)) {
    const inZone = seen <= frontLimit || seen >= backStart;
    seen += seg.words;
    if (!inZone || seg.words > 700) continue;
    let text = '';
    let hasRole = false;
    for (let i = seg.start; i <= seg.end; i++) {
      text += blocks[i].t + '\n';
      if (blocks[i].r) hasRole = true;
    }
    if (hasRole) continue;
    if (markerCount(text) >= 3 || (markerCount(text) >= 2 && /©|copyright|all rights reserved/i.test(text))) {
      for (let i = seg.start; i <= seg.end; i++) blocks[i].r = 'copyright';
      found = true;
    }
  }
  if (found) return;

  // 2) A cluster of nearby paragraphs carrying markers (documents without page/section structure).
  seen = 0;
  let cluster = null;
  const clusters = [];
  for (let i = 0; i < blocks.length && seen <= frontLimit; i++) {
    const b = blocks[i];
    seen += wordCount(b.t);
    if (b.r) continue;
    const m = markerCount(b.t);
    if (m > 0 && wordCount(b.t) <= 120) {
      if (cluster && i - cluster.end <= 3) {
        cluster.end = i;
        cluster.markers += m;
      } else {
        cluster = { start: i, end: i, markers: m };
        clusters.push(cluster);
      }
    }
  }
  for (const c of clusters) {
    let words = 0;
    for (let i = c.start; i <= c.end; i++) words += wordCount(blocks[i].t);
    if (c.markers >= 2 && words <= 700) {
      for (let i = c.start; i <= c.end; i++) if (!blocks[i].r) blocks[i].r = 'copyright';
    }
  }
}

module.exports = { finalize, looksLikeHeading, wordCount };
