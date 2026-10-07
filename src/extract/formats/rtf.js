'use strict';

const { DocBuilder } = require('../builder');

const SKIP_DEST = new Set([
  'fonttbl', 'colortbl', 'info', 'pict', 'object', 'header', 'footer', 'headerl', 'headerr', 'headerf', 'footerl',
  'footerr', 'footerf', 'footnote', 'annotation', 'listtable', 'listoverridetable', 'revtbl', 'rsidtbl', 'xmlnstbl',
  'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'generator', 'filetbl', 'pgdsctbl', 'nonshppict',
  'shp', 'shpinst', 'docvar', 'private', 'userprops', 'operator', 'author', 'title', 'subject', 'comment', 'company',
  'listtext', 'pntext', 'pntxta', 'pntxtb', 'bkmkstart', 'bkmkend', 'xe', 'tc', 'atnid', 'atnauthor', 'mmathPr',
  'background', 'oldcprops', 'oldpprops', 'oldsprops', 'oldtprops', 'protusertbl', 'wgrffmtfilter', 'fchars', 'lchars',
]);

const CHAR_WORDS = {
  tab: '\t', emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’',
  ldblquote: '“', rdblquote: '”', emspace: ' ', enspace: ' ', qmspace: ' ', cell: ' ', nestcell: ' ',
  zwj: '', zwnj: '', ltrmark: '', rtlmark: '',
};

function decoderFor(cp) {
  const labels = { 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 10000: 'macintosh', 65001: 'utf-8', 437: 'ibm866' };
  const label = labels[cp] || `windows-${cp}`;
  try {
    return new TextDecoder(label);
  } catch (_) {
    return new TextDecoder('windows-1252');
  }
}

async function extract(buf) {
  const b = new DocBuilder();
  const src = buf.toString('latin1');
  const styleNames = {};
  let decoder = decoderFor(1252);

  let state = { skip: false, uc: 1, style: 0, outline: null, role: null, field: null, styleDef: null, inStylesheet: false };
  const stack = [];
  let text = '';
  let paraStyle = state; // paragraph properties at the time of \par
  let hexBytes = [];
  let skipChars = 0;
  let starPending = false;
  let groupStart = false;

  const flushHex = () => {
    if (!hexBytes.length) return;
    const s = decoder.decode(Uint8Array.from(hexBytes));
    hexBytes = [];
    emit(s);
  };

  const emit = (s) => {
    if (state.skip) return;
    if (state.inStylesheet) {
      if (state.styleDef) state.styleDef.name += s;
      return;
    }
    if (state.fieldInst) {
      state.field.inst += s;
      return;
    }
    text += s;
    paraStyle = state;
  };

  const endParagraph = () => {
    flushHex();
    if (text.trim()) {
      const st = paraStyle;
      const name = (styleNames[st.style] || '').toLowerCase();
      let kind = 'p';
      if ((st.outline !== null && st.outline < 9) || /^(heading\s*\d|title|subtitle|t[ií]tulo|titre|[uü]berschrift)/.test(name)) kind = 'h';
      let role = st.role;
      if (/^toc\s*\d|^toc heading|^table of contents/.test(name)) role = 'toc';
      else if (/^index\s*\d|^index heading/.test(name)) role = role || 'index';
      b.add(text, kind, role);
    }
    text = '';
  };

  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '{') {
      flushHex();
      stack.push(state);
      state = { ...state };
      if (state.inStylesheet && stack.length && stack[stack.length - 1].inStylesheet && !state.styleDef) {
        state.styleDef = { num: null, name: '' };
      }
      groupStart = true;
      i++;
      continue;
    }
    if (c === '}') {
      flushHex();
      if (state.styleDef && !(stack[stack.length - 1] || {}).styleDef) {
        const d = state.styleDef;
        if (d.num !== null) styleNames[d.num] = d.name.replace(/;.*$/s, '').trim();
      }
      state = stack.pop() || state;
      skipChars = 0;
      i++;
      continue;
    }
    if (c === '\\') {
      const next = src[i + 1];
      if (next === "'") {
        const hex = src.substr(i + 2, 2);
        i += 4;
        if (skipChars > 0) {
          skipChars--;
          continue;
        }
        const v = parseInt(hex, 16);
        if (!Number.isNaN(v) && !state.skip) hexBytes.push(v);
        continue;
      }
      flushHex();
      if (/[a-zA-Z]/.test(next || '')) {
        let j = i + 1;
        while (j < n && /[a-zA-Z]/.test(src[j])) j++;
        const word = src.slice(i + 1, j);
        let param = null;
        let k = j;
        if (src[k] === '-' || /[0-9]/.test(src[k] || '')) {
          let m = k + 1;
          while (m < n && /[0-9]/.test(src[m])) m++;
          param = parseInt(src.slice(k, m), 10);
          k = m;
        }
        if (src[k] === ' ') k++;
        i = k;
        const wasGroupStart = groupStart;
        groupStart = false;

        if (word === 'bin' && param > 0) {
          i += param;
          continue;
        }
        if (starPending) {
          starPending = false;
          if (word === 'fldinst' && state.field) {
            state.fieldInst = true;
            continue;
          }
          state.skip = true;
          continue;
        }
        if (wasGroupStart && SKIP_DEST.has(word)) {
          state.skip = true;
          continue;
        }
        if (state.skip) continue;
        switch (word) {
          case 'ansicpg':
            decoder = decoderFor(param);
            break;
          case 'mac':
            decoder = decoderFor(10000);
            break;
          case 'stylesheet':
            state.inStylesheet = true;
            break;
          case 'field':
            state.field = { inst: '' };
            break;
          case 'fldinst':
            if (state.field) state.fieldInst = true;
            break;
          case 'fldrslt':
            state.fieldInst = false;
            if (state.field) {
              if (/^\s*TOC\b/i.test(state.field.inst)) state.role = 'toc';
              else if (/^\s*INDEX\b/i.test(state.field.inst)) state.role = 'index';
            }
            break;
          case 's':
            if (state.inStylesheet) {
              if (state.styleDef) state.styleDef.num = param;
            } else state.style = param;
            break;
          case 'cs':
          case 'ds':
          case 'ts':
            if (state.inStylesheet && state.styleDef) state.styleDef.num = null;
            break;
          case 'outlinelevel':
            state.outline = param;
            break;
          case 'pard':
            state.style = 0;
            state.outline = null;
            break;
          case 'uc':
            state.uc = param;
            break;
          case 'u': {
            let cp = param < 0 ? param + 65536 : param;
            emit(String.fromCharCode(cp));
            skipChars = state.uc;
            break;
          }
          case 'par':
          case 'line':
          case 'row':
            endParagraph();
            break;
          case 'page':
          case 'sect':
            endParagraph();
            b.newSection();
            break;
          default:
            if (Object.prototype.hasOwnProperty.call(CHAR_WORDS, word)) emit(CHAR_WORDS[word]);
        }
        continue;
      }
      // control symbols
      i += 2;
      groupStart = false;
      if (next === '*') {
        starPending = true;
        continue;
      }
      if (skipChars > 0) {
        skipChars--;
        continue;
      }
      if (next === '\\' || next === '{' || next === '}') emit(next);
      else if (next === '~') emit(' ');
      else if (next === '_') emit('-');
      else if (next === '\n' || next === '\r') endParagraph();
      continue;
    }
    if (c === '\r' || c === '\n') {
      i++;
      continue;
    }
    groupStart = false;
    if (skipChars > 0) {
      skipChars--;
      i++;
      continue;
    }
    // plain run
    let j = i;
    while (j < n && src[j] !== '\\' && src[j] !== '{' && src[j] !== '}' && src[j] !== '\r' && src[j] !== '\n') j++;
    emit(src.slice(i, j));
    i = j;
  }
  endParagraph();
  return b;
}

module.exports = { extract };
