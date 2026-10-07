'use strict';

// Word-class lookup shared by the desktop app and the website. A word gets every class
// it really has ("vino": noun and verb). The hand-made function-word lists in
// src/renderer/wordclasses.js are combined with the word-form lists in vendor/lexicon
// (built by tools/build-lexicon.py). Loading those files is platform-specific.
const WordClasses = require('../renderer/wordclasses');

// Lexicon text: "#class1,class2" header lines followed by the word forms with those classes.
function parseLexicon(text) {
  const map = new Map();
  let cls = null;
  for (const line of text.split('\n')) {
    if (!line) continue;
    if (line[0] === '#') cls = Object.freeze(line.slice(1).split(','));
    else map.set(line, cls);
  }
  return map;
}

const isVerb = (classes) => !!classes && classes.includes('verbs');
const CLITICS = /(me|te|se|nos|os|lo|la|los|las|le|les)$/;
const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');

// Spanish verbs with attached pronouns: dímelo, hacerlo, diciéndole, vámonos.
function spanishClitic(word, map) {
  let base = word;
  let removed = '';
  for (let i = 0; i < 3; i++) {
    const m = CLITICS.exec(base);
    if (!m || base.length - m[0].length < 2) break;
    base = base.slice(0, -m[0].length);
    removed = m[0] + removed;
    const plain = base.normalize('NFC');
    for (const cand of new Set([plain, stripAccents(plain), removed.startsWith('nos') ? `${plain}s` : null])) {
      if (cand && isVerb(map.get(cand))) return true;
      if (cand && isVerb(map.get(stripAccents(cand)))) return true;
    }
  }
  return false;
}

const ORDER = ['nouns', 'verbs', 'adjectives', 'adverbs', 'pronouns', 'determiners', 'articles',
  'prepositions', 'conjunctions', 'interjections', 'numbers'];

function lexiconClasses(word, lang, map) {
  const hit = map.get(word);
  if (hit) return hit;
  if (lang === 'en') {
    if (/n't$/.test(word)) return ['verbs']; // don't, can't, wouldn't
    if (/'s$/.test(word)) {
      const base = map.get(word.slice(0, -2));
      if (base) return base;
    }
  } else {
    if (/mente$/.test(word) && word.length > 7) return ['adverbs']; // rápidamente
    if (spanishClitic(word, map)) return ['verbs'];
  }
  if (word.includes('-')) {
    const last = word.split('-').pop();
    const fn = WordClasses.classify(last, lang);
    return fn ? [fn] : map.get(last) || [];
  }
  return [];
}

const CONTENT = new Set(['nouns', 'verbs', 'adjectives', 'adverbs']);

// Returns an array of classes, e.g. ['nouns', 'verbs'], or ['other'].
// Lexicon classes ending in "?" are rare uses of that word (see tools/build-lexicon.py).
function classifyOne(word, lang, map) {
  const fn = WordClasses.classify(word, lang);
  const set = new Set();
  for (const raw of lexiconClasses(word, lang, map)) {
    const rare = raw.endsWith('?');
    const cls = rare ? raw.slice(0, -1) : raw;
    if (fn) {
      if (!rare) set.add(cls); // function words: only their common uses
    } else if (!rare || CONTENT.has(cls)) {
      set.add(cls); // other words: every noun/verb/adjective/adverb use, even rare ones
    }
  }
  if (fn) {
    set.add(fn);
    if (fn === 'articles') set.delete('determiners'); // articles are listed on their own
    if (fn === 'numbers') set.delete('nouns'); // "seven" is a number, not a noun
  }
  if (!set.size) return ['other'];
  return ORDER.filter((c) => set.has(c));
}

// words: lower-case word forms; map: parseLexicon() result for that language.
function classifyWith(words, lang, map) {
  const l = lang === 'es' ? 'es' : 'en';
  return words.map((w) => classifyOne(w, l, map));
}

module.exports = { parseLexicon, classifyWith };
