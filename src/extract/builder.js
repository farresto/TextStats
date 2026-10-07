'use strict';

const { local } = require('./markup');

// Collects the document as a flat list of blocks (paragraph-like units).
// Block: { t: text, k: 'p' | 'h', r: null | 'toc' | 'index' | 'copyright', s: section number }
class DocBuilder {
  constructor() {
    this.blocks = [];
    this.section = 0;
    this.structuralHeadings = false; // the format told us which blocks are headings
    this.warnings = [];
    this.formatKey = null;
  }

  add(text, kind = 'p', role = null) {
    const t = normalize(text);
    if (!t) return null;
    const block = { t, k: kind === 'h' ? 'h' : 'p', r: role || null, s: this.section };
    this.blocks.push(block);
    if (block.k === 'h') this.structuralHeadings = true;
    return block;
  }

  newSection() {
    const last = this.blocks[this.blocks.length - 1];
    if (last && last.s === this.section) this.section++;
  }

  // Warnings are codes translated by the window (i18n keys "warn.<code>").
  warn(code, detail) {
    if (!this.warnings.some((w) => w.code === code)) this.warnings.push({ kind: 'warn', code, detail });
  }
}

function normalize(text) {
  return String(text)
    .replace(/[­​‌‍⁠﻿￼�\u0000-\u0008\u000e-\u001f]/g, '')
    .replace(/[\s  - \u2028\u2029  　]+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------- HTML -> blocks

const BLOCK = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'dt', 'dd', 'blockquote', 'pre', 'section', 'article',
  'header', 'footer', 'aside', 'nav', 'figure', 'figcaption', 'table', 'tr', 'td', 'th', 'caption', 'ul', 'ol', 'dl',
  'address', 'center', 'main', 'body', 'html', 'tbody', 'thead', 'tfoot', 'hgroup', 'details', 'summary', 'fieldset',
  'legend', 'form', 'option',
]);
const SKIP = new Set(['head', 'script', 'style', 'title', 'template', 'noscript', 'svg:style', 'math', 'object', 'iframe', 'select']);
const HEADING_CLASS = /(^|[\s_-])(chap(ter)?[\s_-]?(title|head(ing)?|num(ber)?|name)|ch[\s_-]?title|heading|title|subtitle|part[\s_-]?title|section[\s_-]?title|h[1-6])($|[\s_-])/i;

function roleFromAttrs(el) {
  const v = `${el.attrs['epub:type'] || ''} ${el.attrs.role || ''} ${el.attrs.type || ''}`.toLowerCase();
  if (!v.trim()) return null;
  if (/\b(doc-)?toc\b|\blandmarks\b|\bpage-list\b|\bloi\b|\blot\b/.test(v)) return 'toc';
  if (/\b(doc-)?index\b/.test(v)) return 'index';
  if (/copyright-page|\bdoc-colophon\b|\bcopyright\b/.test(v)) return 'copyright';
  return null;
}

function isHidden(el) {
  if (el.attrs.hidden !== undefined) return true;
  const st = el.attrs.style;
  return !!(st && /display\s*:\s*none/i.test(st));
}

function htmlToBlocks(builder, root, opts = {}) {
  let buf = '';
  let bufCtx = null;

  const flush = () => {
    if (buf.trim() && bufCtx) builder.add(buf, bufCtx.heading ? 'h' : 'p', bufCtx.role);
    buf = '';
    bufCtx = null;
  };

  const visit = (node, ctx) => {
    if (typeof node === 'string') {
      if (!bufCtx) bufCtx = ctx;
      buf += node;
      return;
    }
    const name = node.name;
    const ln = local(name);
    if (SKIP.has(name) || SKIP.has(ln) || isHidden(node)) return;
    if (ln === 'pagebreak') {
      flush();
      builder.newSection();
      return;
    }
    if (ln === 'br' || ln === 'hr') {
      flush();
      return;
    }
    if (ln === 'img') {
      return;
    }
    let next = ctx;
    const role = roleFromAttrs(node);
    const isHeading =
      /^h[1-6]$/.test(ln) ||
      node.attrs.role === 'heading' ||
      (node.attrs.class && HEADING_CLASS.test(node.attrs.class) && ln !== 'body' && ln !== 'section' && ln !== 'div') ||
      (node.attrs.class && HEADING_CLASS.test(node.attrs.class) && ln === 'div' && !hasBlockChild(node));
    if (role || isHeading) {
      next = { heading: ctx.heading || isHeading, role: role || ctx.role };
    }
    const block = BLOCK.has(ln) || isHeading;
    if (block) flush();
    for (const c of node.children) visit(c, next);
    if (block) flush();
    else if (ln === 'td' || ln === 'th') buf += ' ';
  };

  visit(root, { heading: false, role: opts.role || null });
  flush();
}

function hasBlockChild(el) {
  return el.children.some((c) => typeof c !== 'string' && BLOCK.has(local(c.name)));
}

module.exports = { DocBuilder, normalize, htmlToBlocks, roleFromAttrs };
