'use strict';

// The few POSIX path helpers the EPUB reader needs (paths inside ZIP packages),
// written out so the same code runs in the browser.
function normalize(p) {
  const out = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return (p.startsWith('/') ? '/' : '') + out.join('/');
}
const dirname = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) || '/' : '.');
const basename = (p) => p.slice(p.lastIndexOf('/') + 1);
const join = (...parts) => normalize(parts.filter((x) => x && x !== '.').join('/'));
const extname = (p) => {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i) : '';
};

module.exports = { normalize, dirname, basename, join, extname };
