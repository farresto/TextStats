'use strict';

const { parse, find, findAll } = require('../markup');
const { DocBuilder } = require('../builder');

const HEADING_STYLE = /^(heading\s*\d|title|subtitle|t[ií]tulo\s*\d*|titre\s*\d*|[uü]berschrift\s*\d*|kop\s*\d*|titolo\s*\d*)$/i;
const TOC_STYLE = /^(toc\s*\d|toc heading|table of contents|tdc\s*\d|ti\s*\d|verzeichnis\s*\d|inhaltsverzeichnisüberschrift)$/i;
const INDEX_STYLE = /^(index\s*\d|index heading)$/i;

async function extract(zip, { onProgress }) {
  const styles = new Map(); // styleId -> { name, outline, basedOn }
  if (zip.has('word/styles.xml')) {
    const st = parse(zip.text('word/styles.xml'));
    for (const s of findAll(st, (e) => e.name === 'w:style')) {
      const id = s.attrs['w:styleid'];
      const nameEl = find(s, (e) => e.name === 'w:name');
      const outlineEl = find(s, (e) => e.name === 'w:outlinelvl');
      const basedOn = find(s, (e) => e.name === 'w:basedon');
      styles.set(id, {
        name: nameEl ? nameEl.attrs['w:val'] || '' : '',
        outline: outlineEl ? parseInt(outlineEl.attrs['w:val'], 10) : null,
        basedOn: basedOn ? basedOn.attrs['w:val'] : null,
      });
    }
  }
  const styleInfo = (id) => {
    let name = '';
    let outline = null;
    for (let s = styles.get(id), depth = 0; s && depth < 10; s = styles.get(s.basedOn), depth++) {
      if (!name) name = s.name;
      if (outline === null && Number.isFinite(s.outline)) outline = s.outline;
    }
    return { name: name || id || '', outline };
  };

  onProgress(0.2);
  const docName = zip.has('word/document.xml') ? 'word/document.xml' : zip.names().find((n) => /^word\/document\d*\.xml$/.test(n));
  const doc = parse(zip.text(docName));
  onProgress(0.5);
  const body = find(doc, (e) => e.name === 'w:body') || doc;

  const b = new DocBuilder();
  let fieldDepth = 0;
  const fieldRoles = [];

  const paragraph = (p, role) => {
    let text = '';
    let pageBreakBefore = false;
    const pPr = p.children.find((c) => typeof c !== 'string' && c.name === 'w:ppr');
    let styleId = null;
    let outline = null;
    if (pPr) {
      const ps = pPr.children.find((c) => typeof c !== 'string' && c.name === 'w:pstyle');
      if (ps) styleId = ps.attrs['w:val'];
      const ol = pPr.children.find((c) => typeof c !== 'string' && c.name === 'w:outlinelvl');
      if (ol) outline = parseInt(ol.attrs['w:val'], 10);
      if (pPr.children.some((c) => typeof c !== 'string' && c.name === 'w:pagebreakbefore')) pageBreakBefore = true;
    }
    const info = styleInfo(styleId || 'Normal');
    if (outline === null) outline = info.outline;

    let fieldRole = fieldRoles.length ? fieldRoles[fieldRoles.length - 1] : null;
    const visit = (el) => {
      for (const c of el.children) {
        if (typeof c === 'string') continue;
        switch (c.name) {
          case 'w:t':
            text += c.children.join('');
            break;
          case 'w:tab':
          case 'w:ptab':
            text += '\t';
            break;
          case 'w:br':
          case 'w:cr':
            if (c.attrs['w:type'] === 'page') {
              if (text.trim()) {
                emit(text);
                text = '';
              }
              b.newSection();
            } else text += ' ';
            break;
          case 'w:nobreakhyphen':
            text += '-';
            break;
          case 'w:fldchar': {
            const t = c.attrs['w:fldchartype'];
            if (t === 'begin') {
              fieldDepth++;
              fieldRoles.push(null);
            } else if (t === 'end') {
              fieldDepth = Math.max(0, fieldDepth - 1);
              fieldRoles.pop();
            }
            fieldRole = fieldRoles.length ? fieldRoles[fieldRoles.length - 1] : null;
            break;
          }
          case 'w:instrtext': {
            const instr = c.children.join('');
            if (fieldRoles.length) {
              if (/^\s*TOC\b/i.test(instr)) fieldRoles[fieldRoles.length - 1] = 'toc';
              else if (/^\s*INDEX\b/i.test(instr)) fieldRoles[fieldRoles.length - 1] = 'index';
              fieldRole = fieldRoles.find((r) => r) || null;
            }
            break;
          }
          case 'w:deltext':
          case 'w:delinstrtext':
          case 'w:rpr':
          case 'w:ppr':
          case 'mc:fallback':
          case 'w:footnotereference':
          case 'w:endnotereference':
            break;
          default:
            visit(c);
        }
      }
    };
    const emit = (t) => {
      let kind = 'p';
      const name = info.name;
      if (HEADING_STYLE.test(name) || (outline !== null && outline >= 0 && outline < 9)) kind = 'h';
      let r = role || fieldRoles.find((x) => x) || fieldRole;
      if (TOC_STYLE.test(name)) r = 'toc';
      else if (INDEX_STYLE.test(name)) r = r || 'index';
      b.add(t, kind, r);
    };
    if (pageBreakBefore) b.newSection();
    visit(p);
    if (text.trim()) emit(text);
    if (pPr && pPr.children.some((c) => typeof c !== 'string' && c.name === 'w:sectpr')) b.newSection();
  };

  const container = (el, role) => {
    for (const c of el.children) {
      if (typeof c === 'string') continue;
      if (c.name === 'w:p') paragraph(c, role);
      else if (c.name === 'w:sdt') {
        const gallery = find(c, (e) => e.name === 'w:docpartgallery');
        const g = gallery ? (gallery.attrs['w:val'] || '').toLowerCase() : '';
        const content = c.children.find((x) => typeof x !== 'string' && x.name === 'w:sdtcontent');
        if (content) container(content, g.includes('table of contents') ? 'toc' : g.includes('bibliograph') ? role : role);
      } else if (c.name === 'w:tbl' || c.name === 'w:tr' || c.name === 'w:tc' || c.name === 'w:customxml' || c.name === 'w:smarttag') {
        container(c, role);
      } else if (c.name === 'w:sectpr') {
        b.newSection();
      }
    }
  };
  container(body, null);
  onProgress(0.9);
  return b;
}

module.exports = { extract };
