'use strict';

// Desktop loader for the word lists in vendor/lexicon (the website loads them with fetch).
const fs = require('fs');
const path = require('path');
const { gunzip } = require('../extract/inflate');
const { parseLexicon, classifyWith } = require('../extract/lexicon-core');

const DIR = path.join(__dirname, '..', '..', 'vendor', 'lexicon');
const cache = {};

function load(lang) {
  if (!cache[lang]) {
    const bytes = gunzip(fs.readFileSync(path.join(DIR, `${lang}.tsv.gz`)));
    cache[lang] = parseLexicon(new TextDecoder('utf-8').decode(bytes));
  }
  return cache[lang];
}

function classifyAll(words, lang) {
  const l = lang === 'es' ? 'es' : 'en';
  return classifyWith(words, l, load(l));
}

module.exports = { classifyAll };
