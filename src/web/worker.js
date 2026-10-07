/* TextStats web worker: reads files and classifies words off the main thread.
   core.js is the bundle of the same file readers the desktop app uses. */
'use strict';
importScripts('core.js');

const { extractBuffer, parseLexicon, classifyWith, gunzip } = self.TextStatsBundle;
const lexicons = {};

async function lexicon(lang) {
  if (!lexicons[lang]) {
    lexicons[lang] = fetch(`vendor/lexicon/${lang}.tsv.gz`)
      .then((r) => {
        if (!r.ok) throw new Error(`word list ${lang} not found (${r.status})`);
        return r.arrayBuffer();
      })
      .then((buf) => parseLexicon(new TextDecoder('utf-8').decode(gunzip(new Uint8Array(buf)))));
  }
  return lexicons[lang];
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'extract') {
    try {
      const doc = await extractBuffer(Buffer.from(msg.data), msg.name, (value) =>
        self.postMessage({ id: msg.id, type: 'progress', value })
      );
      self.postMessage({ id: msg.id, type: 'done', result: { ok: true, doc } });
    } catch (err) {
      const known = err && (err.isUser || (err.constructor && err.constructor.name === 'UserError'));
      self.postMessage({
        id: msg.id,
        type: 'done',
        result: { ok: false, error: known ? { code: err.code, detail: err.detail } : { code: 'generic', detail: String(err && err.message ? err.message : err) } },
      });
    }
  } else if (msg.type === 'classify') {
    try {
      const lang = msg.lang === 'es' ? 'es' : 'en';
      const classes = classifyWith(msg.words, lang, await lexicon(lang));
      self.postMessage({ id: msg.id, type: 'done', result: { ok: true, classes } });
    } catch (err) {
      self.postMessage({ id: msg.id, type: 'done', result: { ok: false, error: String(err && err.message ? err.message : err) } });
    }
  }
};
