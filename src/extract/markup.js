'use strict';

// Small, tolerant HTML/XML parser producing a lightweight tree.
// Element: { name, attrs, children, parent }   Text: string
// Names and attribute keys are lower-cased; namespace prefixes are kept ("w:p").

const VOID = new Set([
  'br', 'hr', 'img', 'meta', 'link', 'input', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr',
  'mbp:pagebreak', 'image',
]);
const RAW = new Set(['script', 'style']);

const TAG_RE = /<([A-Za-z_][\w:.\-]*)((?:\s+[^\s=\/>"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>/y;
const ATTR_RE = /([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;

function parse(src, { html = false } = {}) {
  const root = { name: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      pushText(cur, src.slice(i));
      break;
    }
    if (lt > i) pushText(cur, src.slice(i, lt));
    i = lt;
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      const stop = end < 0 ? n : end;
      cur.children.push(src.slice(i + 9, stop));
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src[i + 1] === '!' || src[i + 1] === '?') {
      const end = src.indexOf('>', i + 2);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (src[i + 1] === '/') {
      const end = src.indexOf('>', i + 2);
      if (end < 0) break;
      const name = src.slice(i + 2, end).trim().toLowerCase();
      let el = cur;
      while (el && el !== root && el.name !== name) el = el.parent;
      if (el && el !== root) cur = el.parent;
      i = end + 1;
      continue;
    }
    TAG_RE.lastIndex = i;
    const m = TAG_RE.exec(src);
    if (!m) {
      pushText(cur, '<');
      i += 1;
      continue;
    }
    const name = m[1].toLowerCase();
    const el = { name, attrs: parseAttrs(m[2]), children: [], parent: cur };
    cur.children.push(el);
    i = TAG_RE.lastIndex;
    const selfClosing = m[3] === '/' || (html && VOID.has(name));
    if (selfClosing) continue;
    if (html && RAW.has(name)) {
      const close = src.toLowerCase().indexOf(`</${name}`, i);
      const end = close < 0 ? n : src.indexOf('>', close);
      i = end < 0 ? n : end + 1;
      continue;
    }
    cur = el;
  }
  return root;
}

function pushText(el, raw) {
  if (!raw) return;
  el.children.push(decodeEntities(raw));
}

function parseAttrs(s) {
  const attrs = {};
  if (!s) return attrs;
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(s))) {
    const v = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[m[1].toLowerCase()] = decodeEntities(v);
  }
  return attrs;
}

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  shy: '­', zwnj: '‌', zwj: '‍', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', hellip: '…', bull: '•', middot: '·',
  copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±', times: '×', divide: '÷',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', iexcl: '¡', iquest: '¿', cent: '¢',
  pound: '£', euro: '€', yen: '¥', sect: '§', para: '¶', dagger: '†', Dagger: '‡',
  prime: '′', Prime: '″', frac12: '½', frac14: '¼', frac34: '¾', sup1: '¹', sup2: '²',
  sup3: '³', ordf: 'ª', ordm: 'º', micro: 'µ', not: '¬', macr: '¯', acute: '´',
  cedil: '¸', uml: '¨', szlig: 'ß', oelig: 'œ', OElig: 'Œ', scaron: 'š', Scaron: 'Š',
  yuml: 'ÿ', Yuml: 'Ÿ', fnof: 'ƒ', circ: 'ˆ', tilde: '˜', larr: '←', rarr: '→',
  uarr: '↑', darr: '↓', harr: '↔', minus: '−', infin: '∞', ne: '≠', le: '≤', ge: '≥',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', pi: 'π', sigma: 'σ', omega: 'ω',
  lrm: '‎', rlm: '‏',
};
// Latin-1 letters: agrave, Agrave, eacute ...
const LATIN = {
  grave: { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  acute: { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý' },
  circ: { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  tilde: { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
  uml: { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü' },
  ring: { a: 'å', A: 'Å' },
  cedil: { c: 'ç', C: 'Ç' },
  slash: { o: 'ø', O: 'Ø' },
  lig: { ae: 'æ', AE: 'Æ' },
};

function named(name) {
  if (Object.prototype.hasOwnProperty.call(NAMED, name)) return NAMED[name];
  const m = /^([A-Za-z]{1,2})(grave|acute|circ|tilde|uml|ring|cedil|slash|lig)$/.exec(name);
  if (m && LATIN[m[2]] && LATIN[m[2]][m[1]]) return LATIN[m[2]][m[1]];
  if (name === 'eth') return 'ð';
  if (name === 'ETH') return 'Ð';
  if (name === 'thorn') return 'þ';
  if (name === 'THORN') return 'Þ';
  return null;
}

function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);?/g, (all, body) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return all;
      return cp === 160 ? ' ' : String.fromCodePoint(cp);
    }
    const v = named(body);
    return v === null ? all : v;
  });
}

// ---------------------------------------------------------------- helpers

const local = (name) => {
  const k = name.indexOf(':');
  return k < 0 ? name : name.slice(k + 1);
};

function* walk(el) {
  const stack = [el];
  while (stack.length) {
    const node = stack.pop();
    if (typeof node === 'string') continue;
    yield node;
    for (let k = node.children.length - 1; k >= 0; k--) stack.push(node.children[k]);
  }
}

function find(el, pred) {
  for (const node of walk(el)) if (pred(node)) return node;
  return null;
}

function findAll(el, pred) {
  const out = [];
  for (const node of walk(el)) if (pred(node)) out.push(node);
  return out;
}

function textOf(el) {
  if (typeof el === 'string') return el;
  let s = '';
  for (const c of el.children) s += typeof c === 'string' ? c : textOf(c);
  return s;
}

function attr(el, ...keys) {
  for (const k of keys) {
    if (el.attrs[k] !== undefined) return el.attrs[k];
  }
  return undefined;
}

module.exports = { parse, decodeEntities, local, walk, find, findAll, textOf, attr };
