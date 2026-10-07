'use strict';

const path = require('path').posix;
const { parse, find, findAll, local, attr } = require('../markup');
const { DocBuilder, htmlToBlocks } = require('../builder');
const { UserError } = require('../errors');

function resolveHref(base, href) {
  const clean = decodeURIComponent(String(href).split('#')[0]);
  return path.normalize(path.join(path.dirname(base), clean)).replace(/^\.\//, '');
}

async function extract(zip, { onProgress }) {
  checkDrm(zip);
  const container = parse(zip.text('META-INF/container.xml'));
  const rootfile = find(container, (e) => local(e.name) === 'rootfile' && attr(e, 'full-path'));
  const opfPath = rootfile ? attr(rootfile, 'full-path') : zip.names().find((n) => n.toLowerCase().endsWith('.opf'));
  if (!opfPath || !zip.has(opfPath)) throw new UserError('epubNoOpf');
  const opf = parse(zip.text(opfPath));

  const manifest = new Map();
  for (const item of findAll(opf, (e) => local(e.name) === 'item')) {
    manifest.set(attr(item, 'id'), {
      href: resolveHref(opfPath, attr(item, 'href') || ''),
      type: (attr(item, 'media-type') || '').toLowerCase(),
      props: (attr(item, 'properties') || '').toLowerCase(),
    });
  }
  const spine = findAll(opf, (e) => local(e.name) === 'itemref')
    .map((r) => ({ item: manifest.get(attr(r, 'idref')), linear: attr(r, 'linear') !== 'no' }))
    .filter((r) => r.item && /html|xml/.test(r.item.type));

  // EPUB 2 <guide> and EPUB 3 landmarks tell us which files are the TOC / copyright / index.
  const fileRoles = new Map();
  for (const ref of findAll(opf, (e) => local(e.name) === 'reference')) {
    const role = guideRole(attr(ref, 'type'));
    if (role && attr(ref, 'href') && !attr(ref, 'href').includes('#')) fileRoles.set(resolveHref(opfPath, attr(ref, 'href')), role);
  }
  for (const item of manifest.values()) {
    if (item.props.split(/\s+/).includes('nav')) {
      fileRoles.set(item.href, 'toc');
      try {
        const nav = parse(zip.text(item.href), { html: true });
        for (const a of findAll(nav, (e) => local(e.name) === 'a' && /landmarks/.test(ancestorType(e)))) {
          const role = guideRole(attr(a, 'epub:type'));
          const href = attr(a, 'href');
          if (role && href && !href.includes('#')) fileRoles.set(resolveHref(item.href, href), role);
        }
      } catch (_) {
        /* the landmarks are optional */
      }
    }
  }

  const b = new DocBuilder();
  b.structuralHeadings = true;
  for (let i = 0; i < spine.length; i++) {
    const { item } = spine[i];
    if (!zip.has(item.href)) continue;
    let role = fileRoles.get(item.href) || null;
    if (!role) {
      const base = path.basename(item.href).toLowerCase();
      if (/copyright|copy-?right|colophon|imprint|legal|rights/.test(base)) role = 'copyright';
      else if (/(^|[^a-z])(toc|contents)([^a-z]|$)/.test(base)) role = 'toc';
    }
    const tree = parse(zip.text(item.href), { html: true });
    const body = find(tree, (e) => local(e.name) === 'body') || tree;
    const before = b.blocks.length;
    htmlToBlocks(b, body, { role });
    // Filename guess for copyright pages must be confirmed by content.
    if (role === 'copyright' && !fileRoles.has(item.href)) {
      const text = b.blocks.slice(before).map((x) => x.t).join(' ');
      if (!/©|copyright|all rights reserved|isbn|derechos/i.test(text)) {
        for (let k = before; k < b.blocks.length; k++) if (b.blocks[k].r === 'copyright') b.blocks[k].r = null;
      }
    }
    b.newSection();
    onProgress(0.1 + 0.8 * ((i + 1) / spine.length));
  }
  b.structuralHeadings = b.blocks.some((x) => x.k === 'h');
  return b;
}

function ancestorType(el) {
  let s = '';
  for (let p = el.parent; p; p = p.parent) s += ' ' + (p.attrs && p.attrs['epub:type'] ? p.attrs['epub:type'] : '');
  return s;
}

function guideRole(type) {
  const t = String(type || '').toLowerCase();
  if (/\btoc\b|contents|loi|lot/.test(t)) return 'toc';
  if (/copyright|colophon/.test(t)) return 'copyright';
  if (/\bindex\b/.test(t)) return 'index';
  return null;
}

function checkDrm(zip) {
  if (zip.has('META-INF/rights.xml')) {
    throw new UserError('epubAdobeDrm');
  }
  if (!zip.has('META-INF/encryption.xml')) return;
  const enc = parse(zip.text('META-INF/encryption.xml'));
  const methods = findAll(enc, (e) => local(e.name) === 'encryptedata' || local(e.name) === 'encrypteddata');
  for (const ed of methods) {
    const m = find(ed, (e) => local(e.name) === 'encryptionmethod');
    const ref = find(ed, (e) => local(e.name) === 'cipherreference');
    const algo = m ? attr(m, 'algorithm') || '' : '';
    const uri = ref ? attr(ref, 'uri') || '' : '';
    const isFontObfuscation = /idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/.test(algo);
    if (!isFontObfuscation && /\.(x?html?|xml)$/i.test(uri)) {
      throw new UserError('epubDrm');
    }
  }
}

module.exports = { extract };
