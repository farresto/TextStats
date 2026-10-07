/* Web version of the desktop bridge (src/main/preload.js): the same window.textstats
   API, implemented with the browser's File API, a Web Worker and localStorage.
   Nothing is uploaded: files are read on the visitor's own computer. */
(() => {
  'use strict';

  const SETTINGS_KEY = 'textstats-settings';
  const WORD_CLASSES = ['nouns', 'verbs', 'adjectives', 'adverbs', 'pronouns', 'determiners', 'articles', 'prepositions',
    'conjunctions', 'interjections', 'numbers', 'other'];
  const DEFAULTS = {
    wordsPerMinute: 238,
    theme: 'system',
    hiddenWordClasses: [],
    language: /^es\b/i.test(navigator.language || '') ? 'es' : 'en',
  };

  function sanitize(s) {
    const wpm = Math.round(Number(s.wordsPerMinute));
    return {
      wordsPerMinute: Number.isFinite(wpm) && wpm >= 50 && wpm <= 2000 ? wpm : DEFAULTS.wordsPerMinute,
      theme: ['system', 'light', 'dark'].includes(s.theme) ? s.theme : DEFAULTS.theme,
      hiddenWordClasses: Array.isArray(s.hiddenWordClasses) ? s.hiddenWordClasses.filter((k) => WORD_CLASSES.includes(k)) : [],
      language: ['en', 'es'].includes(s.language) ? s.language : DEFAULTS.language,
    };
  }
  function loadSettings() {
    try {
      return sanitize({ ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') });
    } catch (_) {
      return { ...DEFAULTS };
    }
  }
  let memorySettings = null;
  function saveSettings(patch) {
    const next = sanitize({ ...(memorySettings || loadSettings()), ...(patch || {}) });
    memorySettings = next;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch (_) {
      /* private mode: keep settings for this visit only */
    }
    return next;
  }

  // Files picked or dropped get an id; the File object stays here.
  const filesById = new Map();
  let nextId = 1;
  function register(file) {
    for (const [id, f] of filesById) {
      if (f.name === file.name && f.size === file.size && f.lastModified === file.lastModified) return id;
    }
    const id = `file-${nextId++}`;
    filesById.set(id, file);
    return id;
  }
  function describe(id) {
    const f = filesById.get(id);
    const dot = f.name.lastIndexOf('.');
    return { path: id, name: f.name, ext: dot > 0 ? f.name.slice(dot).toLowerCase() : '', size: f.size, isDirectory: false };
  }

  // One worker does the reading and word classification.
  const worker = new Worker('worker.js');
  let seq = 0;
  const pending = new Map();
  const progressListeners = new Set();
  worker.onmessage = (e) => {
    const { id, type, value, result } = e.data;
    const p = pending.get(id);
    if (!p) return;
    if (type === 'progress') {
      for (const cb of progressListeners) cb({ filePath: p.fileId, value });
      return;
    }
    pending.delete(id);
    p.resolve(result);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.resolve({ ok: false, error: { code: 'generic', detail: e.message || 'worker error' } });
    pending.clear();
  };
  function call(msg, transfer, fileId) {
    const id = ++seq;
    return new Promise((resolve) => {
      pending.set(id, { resolve, fileId });
      worker.postMessage({ ...msg, id }, transfer || []);
    });
  }

  function pickFiles() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.txt,.text,.md,.csv,.tsv,.rtf,.pdf,.epub,.mobi,.prc,.azw,.azw3,.kf8,.kfx,.docx,.docm,.doc,.odt,.pages,.iba';
      input.style.display = 'none';
      input.addEventListener('change', () => {
        resolve([...input.files].map((f) => describe(register(f))));
        input.remove();
      });
      input.addEventListener('cancel', () => {
        resolve([]);
        input.remove();
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  window.textstats = {
    platform: 'web',
    getSettings: async () => memorySettings || loadSettings(),
    setSettings: async (patch) => saveSettings(patch),
    openFiles: pickFiles,
    describeFile: async (id) => describe(id),
    pathForFile: (file) => register(file),
    extract: async (id) => {
      const file = filesById.get(id);
      if (!file) return { ok: false, error: { code: 'notFound' } };
      let data;
      try {
        data = await file.arrayBuffer();
      } catch (err) {
        return { ok: false, error: { code: 'cannotOpen', detail: err.message } };
      }
      return call({ type: 'extract', name: file.name, data }, [data], id);
    },
    classifyWords: async (words, lang) => {
      const res = await call({ type: 'classify', words, lang });
      if (!res.ok) throw new Error(res.error);
      return res.classes;
    },
    saveCsv: async (defaultName, content) => {
      // UTF-8 BOM so Excel opens accented words correctly.
      const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = defaultName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
      return { saved: true, filePath: defaultName };
    },
    onExtractProgress: (cb) => {
      progressListeners.add(cb);
      return () => progressListeners.delete(cb);
    },
  };
})();
