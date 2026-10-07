'use strict';

// Desktop (Node/Electron) loader for pdf.js. The web build swaps this file for
// src/web/pdf-loader-web.js (see tools/build-web.js).
const path = require('path');
const { pathToFileURL } = require('url');

const VENDOR = path.join(__dirname, '..', '..', 'vendor', 'pdfjs');
const url = (p) => pathToFileURL(path.join(VENDOR, p)).href;

let promise = null;
function loadPdfjs() {
  if (!promise) {
    require('./dom-polyfill');
    promise = import(url('pdf.min.mjs')).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = url('pdf.worker.min.mjs');
      return lib;
    });
  }
  return promise;
}

module.exports = { loadPdfjs, cMapUrl: url('cmaps') + '/', standardFontDataUrl: url('standard_fonts') + '/' };
