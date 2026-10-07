'use strict';

// Keeps the word lists loaded in a background thread so the window never freezes.
const { parentPort } = require('worker_threads');
const { classifyAll } = require('./lexicon');

parentPort.on('message', ({ id, words, lang }) => {
  try {
    parentPort.postMessage({ id, classes: classifyAll(words, lang) });
  } catch (err) {
    parentPort.postMessage({ id, error: err && err.message ? err.message : String(err) });
  }
});
