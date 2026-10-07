'use strict';

const { DocBuilder } = require('../builder');
const { decodeTextBuffer } = require('./txt');

function detectDelimiter(sample) {
  const lines = sample.split(/\r?\n/).slice(0, 20);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => l.split(d).length - 1).filter((c) => c > 0);
    if (!counts.length) continue;
    const consistent = counts.filter((c) => c === counts[0]).length;
    const score = consistent * 10 + counts[0];
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function parseCsv(text, delim) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') inQuotes = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Each row becomes one block; cell values are counted as words.
async function extract(buf, { ext }) {
  const b = new DocBuilder();
  const text = decodeTextBuffer(buf);
  const delim = ext === '.tsv' ? '\t' : detectDelimiter(text.slice(0, 20000));
  for (const row of parseCsv(text, delim)) {
    b.add(row.map((c) => c.trim()).filter(Boolean).join(' '));
  }
  b.structuralHeadings = true; // tabular data: no heading detection
  b.noHeuristics = true;
  return b;
}

module.exports = { extract, parseCsv };
