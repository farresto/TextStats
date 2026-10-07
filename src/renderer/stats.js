/* Text statistics shared by the app window and the tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TextStatsCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // A word is a run of letters/digits, allowing inner apostrophes and hyphens
  // (don't, mother-in-law) and inner decimal points/commas in numbers (3.14, 1,000).
  const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:(?:['’ʼ\-‐‑]|[.,](?=\p{N}))[\p{L}\p{M}\p{N}]+)*/gu;
  const SPACE_RE = /\s/u;

  function countWords(text) {
    WORD_RE.lastIndex = 0;
    let n = 0;
    while (WORD_RE.exec(text)) n++;
    return n;
  }

  function countChars(text) {
    let withSpaces = 0;
    let noSpaces = 0;
    for (const ch of text) {
      withSpaces++;
      if (!SPACE_RE.test(ch)) noSpaces++;
    }
    return { withSpaces, noSpaces };
  }

  function computeStats(texts) {
    let words = 0;
    let charsWithSpaces = 0;
    let charsNoSpaces = 0;
    for (const t of texts) {
      words += countWords(t);
      const c = countChars(t);
      charsWithSpaces += c.withSpaces;
      charsNoSpaces += c.noSpaces;
    }
    return { words, charsWithSpaces, charsNoSpaces };
  }

  function normalizeWord(w) {
    return w.toLocaleLowerCase().replace(/[’ʼ]/g, "'").replace(/[‐‑]/g, '-');
  }

  // Words whose 's is (almost always) a contraction of "is"/"has"/"us", never a possessive.
  const CONTRACTION_HOSTS = new Set([
    'it', 'he', 'she', 'that', 'this', 'there', 'here', 'what', 'where', 'who', 'how', 'when', 'why', 'let',
  ]);

  // father's -> father (possessive). it's, he's, let's ... stay as written (contractions).
  function mergePossessive(w) {
    if (w.length > 2 && w.endsWith("'s")) {
      const base = w.slice(0, -2);
      if (!CONTRACTION_HOSTS.has(base)) return base;
    }
    return w;
  }

  // Select the report's text: range + exclusions. Points are { b: blockIndex, o: charOffset }.
  function selectTexts(blocks, opts) {
    const start = opts.start || { b: 0, o: 0 };
    const end = opts.end || { b: blocks.length - 1, o: Infinity };
    const out = [];
    for (let i = start.b; i <= end.b && i < blocks.length; i++) {
      const blk = blocks[i];
      if (!opts.includeHeadings && blk.k === 'h') continue;
      if (!opts.includeCopyright && blk.r === 'copyright') continue;
      if (!opts.includeToc && (blk.r === 'toc' || blk.r === 'index')) continue;
      let t = blk.t;
      const from = i === start.b ? start.o : 0;
      const to = i === end.b ? end.o : t.length;
      if (from > 0 || to < t.length) t = t.slice(from, to).trim();
      if (t) out.push(t);
    }
    return out;
  }

  // Builds the full report asynchronously, yielding to the UI so a progress bar can update.
  async function buildReport(blocks, opts, onProgress) {
    const texts = selectTexts(blocks, opts);
    const totalChars = texts.reduce((n, t) => n + t.length, 0) || 1;
    const freq = new Map();
    let words = 0;
    let charsWithSpaces = 0;
    let charsNoSpaces = 0;
    let done = 0;
    let lastYield = Date.now();
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      WORD_RE.lastIndex = 0;
      let m;
      while ((m = WORD_RE.exec(t))) {
        words++;
        let w = normalizeWord(m[0]);
        if (opts.mergePossessives) w = mergePossessive(w);
        freq.set(w, (freq.get(w) || 0) + 1);
      }
      const c = countChars(t);
      charsWithSpaces += c.withSpaces;
      charsNoSpaces += c.noSpaces;
      done += t.length;
      if (Date.now() - lastYield > 30) {
        if (onProgress) onProgress(done / totalChars);
        await new Promise((r) => setTimeout(r, 0));
        lastYield = Date.now();
      }
    }
    const rows = [...freq.entries()].map(([word, count]) => ({ word, count, pct: words ? (count / words) * 100 : 0 }));
    rows.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
    if (onProgress) onProgress(1);
    return { words, charsWithSpaces, charsNoSpaces, uniqueWords: rows.length, rows };
  }

  function readingTime(words, wpm) {
    if (!words) return '00:00';
    const minutes = Math.max(1, Math.round(words / (wpm || 238)));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  const CSV_LABELS_EN = {
    file: 'File', textLang: 'Text language', range: 'Range', headings: 'Chapter titles / headings', copyright: 'Copyright page',
    toc: 'Table of contents / index', possessive: "Possessive 's", hidden: 'Word types hidden from the table',
    words: 'Word count', charsNoSpaces: 'Character count (no spaces)', charsWithSpaces: 'Character count (with spaces)',
    unique: 'Unique words', colWord: 'Word', colCount: 'Times used', colPct: '% of total words', colTypes: 'Word type',
  };

  // options: { labels, delimiter: ',' | ';', decimal: '.' | ',' }
  function reportToCsv(report, meta, options = {}) {
    const L = { ...CSV_LABELS_EN, ...(options.labels || {}) };
    const d = options.delimiter || ',';
    const dec = options.decimal || '.';
    const cell = (v) => {
      const s = String(v);
      return s.includes(d) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const row = (...cells) => cells.map(cell).join(d);
    const lines = [];
    lines.push(row(L.file, meta.fileName));
    if (meta.textLanguage) lines.push(row(L.textLang, meta.textLanguage));
    lines.push(row(L.range, meta.range));
    lines.push(row(L.headings, meta.headings));
    lines.push(row(L.copyright, meta.copyright));
    lines.push(row(L.toc, meta.toc));
    if (meta.possessives) lines.push(row(L.possessive, meta.possessives));
    if (meta.hiddenTypes) lines.push(row(L.hidden, meta.hiddenTypes));
    lines.push(row(L.words, report.words));
    lines.push(row(L.charsNoSpaces, report.charsNoSpaces));
    lines.push(row(L.charsWithSpaces, report.charsWithSpaces));
    lines.push(row(L.unique, report.uniqueWords));
    lines.push('');
    const withTypes = report.rows.some((r) => r.types !== undefined);
    lines.push(withTypes ? row(L.colWord, L.colCount, L.colPct, L.colTypes) : row(L.colWord, L.colCount, L.colPct));
    for (const r of report.rows) {
      const cells = [r.word, r.count, r.pct.toFixed(4).replace('.', dec)];
      if (withTypes) cells.push(r.types || '');
      lines.push(row(...cells));
    }
    return lines.join('\r\n') + '\r\n';
  }

  return { WORD_RE, mergePossessive, countWords, countChars, computeStats, selectTexts, buildReport, readingTime, reportToCsv, normalizeWord };
});
