'use strict';
// Runs every sample through the extractor and prints a summary.
const path = require('path');
const fs = require('fs');
const { extractFile } = require('../src/extract');
const { computeStats } = require('../src/renderer/stats');

(async () => {
  const dir = process.argv[2] || path.join(__dirname, 'samples');
  const files = fs.readdirSync(dir).filter((f) => !f.endsWith('.md') && !f.endsWith('.html')).sort();
  for (const f of files) {
    const t0 = Date.now();
    try {
      const doc = await extractFile(path.join(dir, f));
      const s = computeStats(doc.blocks.map((b) => b.t));
      const roles = {};
      for (const b of doc.blocks) if (b.r) roles[b.r] = (roles[b.r] || 0) + 1;
      const heads = doc.blocks.filter((b) => b.k === 'h').map((b) => b.t).slice(0, 8);
      console.log(
        `${f.padEnd(18)} ${doc.format.padEnd(20)} blocks=${String(doc.blocks.length).padEnd(4)} words=${String(s.words).padEnd(6)} ` +
          `chars=${s.charsNoSpaces}/${s.charsWithSpaces} caps=${JSON.stringify(doc.caps)} roles=${JSON.stringify(roles)} ${Date.now() - t0}ms`
      );
      console.log(`   headings: ${JSON.stringify(heads)}`);
      if (doc.warnings.length) console.log(`   warnings: ${doc.warnings.map((w) => w.code).join(' | ')}`);
    } catch (err) {
      console.log(`${f.padEnd(18)} ERROR ${err.code ? err.message : err.stack}`);
    }
  }
})();
