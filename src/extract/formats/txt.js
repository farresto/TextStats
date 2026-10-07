'use strict';

const { DocBuilder } = require('../builder');

function decodeTextBuffer(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  // UTF-16 without BOM: many zero bytes in alternating positions.
  const n = Math.min(buf.length, 4000);
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < n; i++) if (buf[i] === 0) (i % 2 ? oddZero++ : evenZero++);
  if (oddZero > n * 0.3) return new TextDecoder('utf-16le').decode(buf);
  if (evenZero > n * 0.3) return new TextDecoder('utf-16be').decode(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (_) {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

// Plain text: paragraphs are separated by blank lines when the file uses them
// (hard-wrapped books such as Project Gutenberg); otherwise every line is a paragraph.
function textToBlocks(builder, text) {
  text = text.replace(/\r\n?/g, '\n');
  const pages = text.split('\f');
  for (const page of pages) {
    const lines = page.split('\n');
    const nonEmpty = lines.filter((l) => l.trim()).length;
    const blank = lines.length - nonEmpty;
    const blankSeparated = nonEmpty > 0 && blank >= Math.max(2, nonEmpty * 0.08);
    if (blankSeparated) {
      let para = [];
      const flush = () => {
        if (!para.length) return;
        // A single short line on its own stays a separate block (possible heading).
        builder.add(para.join(' '));
        para = [];
      };
      for (const line of lines) {
        if (!line.trim()) flush();
        else para.push(line.trim());
      }
      flush();
    } else {
      for (const line of lines) builder.add(line);
    }
    builder.newSection();
  }
}

async function extract(buf) {
  const b = new DocBuilder();
  textToBlocks(b, decodeTextBuffer(buf));
  return b;
}

module.exports = { extract, decodeTextBuffer, textToBlocks };
