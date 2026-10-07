'use strict';

const { parse, find, findAll } = require('../markup');
const { DocBuilder } = require('../builder');

const ROLE_ELEMENTS = {
  'text:table-of-content': 'toc',
  'text:illustration-index': 'toc',
  'text:table-index': 'toc',
  'text:object-index': 'toc',
  'text:user-index': 'toc',
  'text:alphabetical-index': 'index',
};

async function extract(zip, { onProgress }) {
  const xml = parse(zip.text('content.xml'));
  onProgress(0.4);

  // Paragraph styles that force a page break start a new section.
  const breakStyles = new Set();
  const headingStyles = new Set();
  const styleSources = [xml];
  if (zip.has('styles.xml')) styleSources.push(parse(zip.text('styles.xml')));
  for (const src of styleSources) {
    for (const s of findAll(src, (e) => e.name === 'style:style')) {
      const name = s.attrs['style:name'];
      const props = find(s, (e) => e.name === 'style:paragraph-properties');
      if (props && /page/.test(props.attrs['fo:break-before'] || '')) breakStyles.add(name);
      const parent = s.attrs['style:parent-style-name'] || '';
      if (/^(heading|title|subtitle)/i.test(name) || /^(heading|title|subtitle)/i.test(parent)) headingStyles.add(name);
    }
  }

  const body = find(xml, (e) => e.name === 'office:text') || xml;
  const b = new DocBuilder();

  const inline = (el) => {
    let s = '';
    for (const c of el.children) {
      if (typeof c === 'string') s += c;
      else if (c.name === 'text:s') s += ' '.repeat(Math.max(1, parseInt(c.attrs['text:c'] || '1', 10) || 1));
      else if (c.name === 'text:tab' || c.name === 'text:line-break') s += ' ';
      else if (c.name === 'text:note' || c.name === 'office:annotation' || c.name === 'text:bookmark-ref') continue;
      else if (c.name === 'draw:frame' || c.name === 'draw:custom-shape') s += ' '; // text boxes are added as their own paragraphs
      else s += inline(c);
    }
    return s;
  };

  const visit = (el, role) => {
    for (const c of el.children) {
      if (typeof c === 'string') continue;
      const name = c.name;
      if (name === 'text:h' || name === 'text:p') {
        const style = c.attrs['text:style-name'] || '';
        if (breakStyles.has(style)) b.newSection();
        const kind = name === 'text:h' || headingStyles.has(style) ? 'h' : 'p';
        b.add(inline(c), kind, role);
        // frames anchored in a paragraph may contain their own paragraphs
        for (const f of findAll(c, (e) => e.name === 'draw:text-box')) visit(f, role);
      } else if (ROLE_ELEMENTS[name]) {
        const bodyEl = find(c, (e) => e.name === 'text:index-body') || c;
        visit(bodyEl, ROLE_ELEMENTS[name]);
      } else if (name === 'text:index-title') {
        visit(c, role);
      } else if (
        name === 'text:sequence-decls' || name === 'text:variable-decls' || name === 'text:user-field-decls' ||
        name === 'office:forms' || name === 'table:table-columns' || name === 'text:tracked-changes'
      ) {
        continue;
      } else {
        visit(c, role);
      }
    }
  };
  visit(body, null);
  return b;
}

module.exports = { extract };
