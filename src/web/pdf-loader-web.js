'use strict';

// Web loader for pdf.js (replaces src/extract/pdf-loader.js in the web build).
// Runs inside the extraction Web Worker; paths are relative to the site root.
const base = new URL('./vendor/pdfjs/', self.location.href.replace(/[^/]*$/, '')).href;

let promise = null;
function loadPdfjs() {
  if (!promise) {
    require('../extract/dom-polyfill');
    promise = import(base + 'pdf.min.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
      return lib;
    });
  }
  return promise;
}

module.exports = { loadPdfjs, cMapUrl: base + 'cmaps/', standardFontDataUrl: base + 'standard_fonts/' };
