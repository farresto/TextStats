'use strict';

const fs = require('fs');
const path = require('path');

// 238 words per minute: average silent reading speed for adults
// (Brysbaert, 2019, meta-analysis of 190 studies).
const DEFAULTS = Object.freeze({
  wordsPerMinute: 238,
  theme: 'system', // 'system' | 'light' | 'dark'
  hiddenWordClasses: [], // word types hidden in report tables
  language: 'en', // 'en' | 'es'; on first run it follows the Windows language
});
const WORD_CLASSES = ['nouns', 'verbs', 'adjectives', 'adverbs', 'pronouns', 'determiners', 'articles', 'prepositions', 'conjunctions', 'interjections', 'numbers', 'other'];

function file(dir) {
  return path.join(dir, 'TextStats-settings.json');
}

// firstRun: defaults that depend on the computer (e.g. { language: 'es' }).
function load(dir, firstRun = {}) {
  const base = sanitize({ ...DEFAULTS, ...firstRun });
  try {
    const raw = JSON.parse(fs.readFileSync(file(dir), 'utf8'));
    // Settings saved before version 2 could hold a light/dark choice made with the old
    // quick toggle; the default is now System, so start from it once.
    if (!(raw.settingsVersion >= 2)) delete raw.theme;
    return sanitize({ ...base, ...raw });
  } catch (_) {
    return base;
  }
}

function save(dir, patch, firstRun = {}) {
  const next = sanitize({ ...load(dir, firstRun), ...(patch || {}) });
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file(dir), JSON.stringify(next, null, 2), 'utf8');
  } catch (_) {
    /* settings are a convenience; failure to persist is not fatal */
  }
  return next;
}

function sanitize(s) {
  const wpm = Math.round(Number(s.wordsPerMinute));
  return {
    wordsPerMinute: Number.isFinite(wpm) && wpm >= 50 && wpm <= 2000 ? wpm : DEFAULTS.wordsPerMinute,
    theme: ['system', 'light', 'dark'].includes(s.theme) ? s.theme : DEFAULTS.theme,
    hiddenWordClasses: Array.isArray(s.hiddenWordClasses) ? s.hiddenWordClasses.filter((k) => WORD_CLASSES.includes(k)) : [],
    language: ['en', 'es'].includes(s.language) ? s.language : DEFAULTS.language,
    settingsVersion: 2,
  };
}

module.exports = { load, save, DEFAULTS };
