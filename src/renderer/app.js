/* TextStats renderer: file list, report configuration, point picker, report view, preferences. */
(() => {
  'use strict';

  const api = window.textstats;
  const Core = window.TextStatsCore;
  const WordClasses = window.TextStatsWordClasses;
  const I18n = window.TextStatsI18n;
  const t = I18n.t;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  let settings = { wordsPerMinute: 238, theme: 'system', language: 'en', hiddenWordClasses: [] };
  const files = [];
  let nextId = 1;

  // ================================================================ helpers

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtInt = (n) => Number(n).toLocaleString(I18n.locale(), { useGrouping: 'always' });
  function fmtSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let v = bytes / 1024;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) {
      v /= 1024;
      u++;
    }
    const num = (v < 10 ? Number(v.toFixed(1)) : Math.round(v)).toLocaleString(I18n.locale());
    return `${num} ${units[u]}`;
  }
  function fmtPct(p) {
    const digits = p >= 0.01 ? 2 : 4;
    const v = p.toLocaleString(I18n.locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return I18n.getLanguage() === 'es' ? `${v} %` : `${v}%`;
  }
  const baseName = (name) => name.replace(/\.[^.]+$/, '');
  const quote = (s) => (I18n.getLanguage() === 'es' ? `«${s}»` : `“${s}”`);

  let toastTimer = null;
  function toast(msg, ms = 3200) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  // ================================================================ theme & settings

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  // While Preferences is open, its unsaved choices are shown live ("preview").
  let preview = null;
  const shown = () => preview || settings;
  // "system" is only the starting point: until the user picks Light or Dark, follow Windows.
  function effectiveTheme() {
    const theme = shown().theme;
    return theme === 'light' || theme === 'dark' ? theme : media.matches ? 'dark' : 'light';
  }
  function applyTheme() {
    const theme = effectiveTheme();
    document.documentElement.dataset.theme = theme;
    const btn = $('#themeToggle');
    const label = t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark');
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }

  // Translate everything marked with data-i18n* in the page.
  function applyLanguage() {
    I18n.setLanguage(shown().language);
    document.documentElement.lang = I18n.getLanguage();
    for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of $$('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
    for (const el of $$('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
    for (const el of $$('[data-i18n-aria-label]')) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
    applyTheme();
  }
  media.addEventListener('change', applyTheme);

  async function saveSettings(patch) {
    settings = await api.setSettings(patch);
    applyLanguage();
    renderTable();
  }

  $('#themeToggle').addEventListener('click', () => {
    saveSettings({ theme: effectiveTheme() === 'dark' ? 'light' : 'dark' });
  });

  // ================================================================ adding files

  async function addEntries(entries) {
    let skipped = 0;
    for (const entry of entries) {
      if (!entry || !entry.path) continue;
      if (entry.isDirectory) {
        skipped++;
        continue;
      }
      const existing = files.find((f) => f.path === entry.path);
      if (existing) {
        flashRow(existing.id);
        continue;
      }
      const file = {
        id: nextId++,
        path: entry.path,
        name: entry.name,
        ext: (entry.ext || '').replace(/^\./, '').toUpperCase() || '?',
        size: entry.size,
        status: 'loading',
        progress: 0,
        doc: null,
        stats: null,
        error: null,
        config: null,
        report: null,
        reportRunning: false,
        reportProgress: 0,
      };
      files.push(file);
      extract(file);
    }
    if (skipped) toast(t('foldersSkipped'));
    renderTable();
  }

  async function extract(file) {
    let res;
    try {
      res = await api.extract(file.path);
    } catch (err) {
      res = { ok: false, error: { code: 'generic', detail: String(err && err.message ? err.message : err) } };
    }
    if (!files.includes(file)) return;
    if (res.ok) {
      file.doc = res.doc;
      file.stats = Core.computeStats(res.doc.blocks.map((b) => b.t));
      file.status = 'ready';
      let acc = 0;
      file.offsets = res.doc.blocks.map((b) => {
        const o = acc;
        acc += b.t.length + 1;
        return o;
      });
      file.totalChars = acc || 1;
      file.textLang = detectTextLanguage(res.doc.blocks);
    } else {
      file.status = 'error';
      file.error = res.error || null;
    }
    renderRow(file);
  }

  // Guess English or Spanish from the most common short words in the first ~20,000 words.
  const LANG_HINTS = {
    en: new Set('the and of to a in is that it was he for with as his on be at by i you she they not but had have this'.split(' ')),
    es: new Set('de la que el en y los del se las por un para con no una su al es lo como más pero sus le ya o fue este ha muy'.split(' ')),
  };
  function detectTextLanguage(blocks) {
    const score = { en: 0, es: 0 };
    let seen = 0;
    const re = new RegExp(Core.WORD_RE.source, 'gu');
    for (const b of blocks) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(b.t)) && seen < 20000) {
        const w = m[0].toLocaleLowerCase();
        if (LANG_HINTS.en.has(w)) score.en++;
        if (LANG_HINTS.es.has(w)) score.es++;
        if (/[ñáéíóú¿¡]/.test(w)) score.es += 2;
        seen++;
      }
      if (seen >= 20000) break;
    }
    if (score.en === score.es) return I18n.getLanguage();
    return score.es > score.en ? 'es' : 'en';
  }

  api.onExtractProgress(({ filePath, value }) => {
    for (const f of files) {
      if (f.path === filePath && f.status === 'loading') {
        f.progress = value;
        const bar = $(`tr[data-id="${f.id}"] .progress > span`);
        const label = $(`tr[data-id="${f.id}"] .progress-label`);
        if (bar) bar.style.width = `${Math.round(value * 100)}%`;
        if (label) label.textContent = `${Math.round(value * 100)}%`;
      }
    }
  });

  async function openDialog() {
    const entries = await api.openFiles();
    if (entries && entries.length) addEntries(entries);
  }
  $('#openBtn').addEventListener('click', openDialog);
  $('#dropCard').addEventListener('click', openDialog);
  $('#dropCard').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openDialog();
    }
  });
  $('#clearBtn').addEventListener('click', () => {
    files.length = 0;
    renderTable();
  });

  // Drag & drop anywhere in the window.
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    dragDepth++;
    $('#dragOverlay').hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = document.querySelector('dialog[open]') ? 'none' : 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) $('#dragOverlay').hidden = true;
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#dragOverlay').hidden = true;
    if (document.querySelector('dialog[open]')) return;
    const list = [...(e.dataTransfer ? e.dataTransfer.files : [])];
    const entries = await Promise.all(
      list.map(async (f) => {
        const p = api.pathForFile(f);
        return p ? api.describeFile(p) : null;
      })
    );
    addEntries(entries.filter(Boolean));
  });

  // ================================================================ file table

  function renderTable() {
    const has = files.length > 0;
    $('#emptyState').hidden = has;
    $('#filesSection').hidden = !has;
    $('#filesTitle').textContent = t('files', { n: files.length });
    $('#wpmNote').textContent = t('wpmNote', { wpm: fmtInt(settings.wordsPerMinute) });
    $('#filesBody').innerHTML = files.map(rowHtml).join('');
  }

  function renderRow(file) {
    const tr = $(`tr[data-id="${file.id}"]`);
    if (!tr) return renderTable();
    tr.outerHTML = rowHtml(file);
  }

  function flashRow(id) {
    const tr = $(`tr[data-id="${id}"]`);
    if (!tr) return;
    tr.classList.remove('flash');
    void tr.offsetWidth;
    tr.classList.add('flash');
    tr.scrollIntoView({ block: 'nearest' });
  }

  function rowHtml(f) {
    const nameCell = (sub, subClass = '') => `
      <td>
        <div class="file-name">
          <span class="ext-badge">${esc(f.ext.slice(0, 5))}</span>
          <div class="file-meta">
            <div class="file-title" title="${esc(f.path)}">${esc(f.name)}</div>
            ${sub ? `<div class="file-sub ${subClass}">${sub}</div>` : ''}
          </div>
        </div>
      </td>`;
    const remove = `<td><button class="btn btn-ghost icon-btn remove-btn" data-action="remove" title="${esc(t('removeFromList'))}" aria-label="${esc(t('removeFile', { name: f.name }))}"><svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></td>`;

    if (f.status === 'loading') {
      const pct = Math.round(f.progress * 100);
      return `<tr data-id="${f.id}">
        ${nameCell(esc(t('reading')))}
        <td class="num">${fmtSize(f.size)}</td>
        <td class="num pending">—</td><td class="num pending">—</td><td class="num pending">—</td><td class="num pending">—</td>
        <td><div class="actions"><div class="progress"><span style="width:${pct}%"></span></div><span class="progress-label">${pct}%</span></div></td>
        ${remove}
      </tr>`;
    }
    if (f.status === 'error') {
      return `<tr data-id="${f.id}">
        ${nameCell(esc(I18n.message(f.error)), 'error')}
        <td class="num">${fmtSize(f.size)}</td>
        <td class="num pending">—</td><td class="num pending">—</td><td class="num pending">—</td><td class="num pending">—</td>
        <td></td>
        ${remove}
      </tr>`;
    }
    const s = f.stats;
    const warnings = f.doc.warnings || [];
    const format = t(`format.${f.doc.formatKey}`);
    const sub = warnings.length ? `${esc(format)} · ${esc(I18n.message(warnings[0]))}` : esc(format);
    let actions = `<button class="btn btn-sm" data-action="create" ${f.reportRunning || !s.words ? 'disabled' : ''}>${esc(t('createReport'))}</button>`;
    if (f.reportRunning) {
      const pct = Math.round(f.reportProgress * 100);
      actions += `<div class="progress" title="${esc(t('analysing'))}"><span style="width:${pct}%"></span></div><span class="progress-label">${pct}%</span>`;
    } else if (f.report) {
      actions += `<button class="btn btn-sm btn-soft" data-action="open-report">${esc(t('openReport'))}</button>`;
    }
    return `<tr data-id="${f.id}">
      ${nameCell(sub, warnings.length ? 'warn' : '')}
      <td class="num">${fmtSize(f.size)}</td>
      <td class="num">${fmtInt(s.words)}</td>
      <td class="num">${fmtInt(s.charsNoSpaces)}</td>
      <td class="num">${fmtInt(s.charsWithSpaces)}</td>
      <td class="num">${Core.readingTime(s.words, settings.wordsPerMinute)}</td>
      <td><div class="actions">${actions}</div></td>
      ${remove}
    </tr>`;
  }

  $('#filesBody').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = Number(btn.closest('tr').dataset.id);
    const file = files.find((f) => f.id === id);
    if (!file) return;
    const action = btn.dataset.action;
    if (action === 'remove') {
      files.splice(files.indexOf(file), 1);
      renderTable();
    } else if (action === 'create') openConfig(file);
    else if (action === 'open-report') openReport(file);
  });

  // ================================================================ dialogs: shared

  for (const btn of $$('[data-close]')) {
    btn.addEventListener('click', () => btn.closest('dialog').close());
  }

  // ================================================================ report configuration

  const OPTIONS = ['includeHeadings', 'includeCopyright', 'includeToc', 'mergePossessives'];
  let cfgFile = null;
  let cfg = null;

  function defaultConfig() {
    return { start: null, end: null, includeHeadings: false, includeCopyright: false, includeToc: false, mergePossessives: true };
  }

  function openConfig(file) {
    cfgFile = file;
    cfg = { ...defaultConfig(), textLanguage: file.textLang || I18n.getLanguage(), ...(file.config || {}) };
    $('#configFile').textContent = file.name;
    renderConfig();
    $('#configDialog').showModal();
  }

  function pointLabel(file, point, kind) {
    if (!point) return `<span class="excerpt">${esc(kind === 'start' ? t('cfg.beginning') : t('cfg.endDefault'))}</span>`;
    const text = file.doc.blocks[point.b].t;
    let excerpt;
    if (kind === 'start') {
      excerpt = text.slice(point.o, point.o + 60).trim();
      excerpt = quote(`${excerpt}${point.o + 60 < text.length ? '…' : ''}`);
    } else {
      const from = Math.max(0, point.o - 60);
      excerpt = quote(`${from > 0 ? '…' : ''}${text.slice(from, point.o).trim()}`);
    }
    const pct = Math.round(((file.offsets[point.b] + point.o) / file.totalChars) * 100);
    return `<span class="excerpt">${esc(excerpt)}</span><span class="pos">${pct}%</span>`;
  }

  function renderConfig() {
    const file = cfgFile;
    const startBtn = $('#startBtn');
    const endBtn = $('#endBtn');
    startBtn.innerHTML = pointLabel(file, cfg.start, 'start');
    endBtn.innerHTML = pointLabel(file, cfg.end, 'end');
    startBtn.classList.toggle('default', !cfg.start);
    endBtn.classList.toggle('default', !cfg.end);
    startBtn.title = t('cfg.startTitle');
    endBtn.title = t('cfg.endTitle');
    $('#startReset').hidden = !cfg.start;
    $('#endReset').hidden = !cfg.end;

    const caps = file.doc.caps;
    const blocks = file.doc.blocks;
    const counts = {
      includeHeadings: blocks.filter((b) => b.k === 'h').length,
      includeCopyright: blocks.filter((b) => b.r === 'copyright').length,
      includeToc: blocks.filter((b) => b.r === 'toc' || b.r === 'index').length,
    };
    const langRow = $('.toggle-row[data-opt="textLanguage"]');
    $('.toggle-note', langRow).textContent = t(cfg.textLanguage === file.textLang ? 'cfg.textLangDetected' : 'cfg.textLangChosen');
    for (const b of $$('button', langRow)) {
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(b.dataset.val === cfg.textLanguage));
    }
    const english = cfg.textLanguage === 'en';
    const avail = { includeHeadings: caps.headings, includeCopyright: caps.copyright, includeToc: caps.toc, mergePossessives: english };
    for (const opt of OPTIONS) {
      const row = $(`.toggle-row[data-opt="${opt}"]`);
      const ok = !!avail[opt];
      row.classList.toggle('disabled', !ok);
      const note = $('.toggle-note', row);
      if (opt === 'mergePossessives') note.textContent = !english ? t('poss.notEnglish') : cfg[opt] ? t('poss.merge') : t('poss.keep');
      else if (!ok) note.textContent = t('notRecognised');
      else if (opt === 'includeHeadings') note.textContent = t('headingsFound', { n: counts[opt] });
      else note.textContent = t('parasFound', { n: counts[opt] });
      for (const b of $$('button', row)) {
        b.disabled = !ok;
        const checked = ok && (b.dataset.val === 'include') === !!cfg[opt];
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(checked));
      }
    }
    const invalid = cfg.start && cfg.end && compare(cfg.start, cfg.end) >= 0;
    $('#startReportBtn').disabled = !!invalid;
  }

  function compare(a, b) {
    return a.b !== b.b ? a.b - b.b : a.o - b.o;
  }

  for (const row of $$('.toggle-row')) {
    row.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-val]');
      if (!b || b.disabled) return;
      if (row.dataset.opt === 'textLanguage') cfg.textLanguage = b.dataset.val;
      else cfg[row.dataset.opt] = b.dataset.val === 'include';
      renderConfig();
    });
  }
  $('#startBtn').addEventListener('click', () => openPicker('start'));
  $('#endBtn').addEventListener('click', () => openPicker('end'));
  $('#startReset').addEventListener('click', () => {
    cfg.start = null;
    renderConfig();
  });
  $('#endReset').addEventListener('click', () => {
    cfg.end = null;
    renderConfig();
  });

  $('#configForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const file = cfgFile;
    const config = { ...cfg };
    // Options that are not available in this file are simply not applicable.
    file.config = config;
    $('#configDialog').close();
    runReport(file, config);
  });

  async function runReport(file, config) {
    file.reportRunning = true;
    file.reportProgress = 0;
    renderRow(file);
    let lastPaint = 0;
    // The possessive 's rule is English-only.
    const runConfig = { ...config, mergePossessives: config.mergePossessives && config.textLanguage === 'en' };
    const result = await Core.buildReport(file.doc.blocks, runConfig, (p) => {
      file.reportProgress = p;
      const now = performance.now();
      if (now - lastPaint < 50 && p < 1) return;
      lastPaint = now;
      const tr = $(`tr[data-id="${file.id}"]`);
      if (!tr) return;
      const bar = $('.progress > span', tr);
      const label = $('.progress-label', tr);
      if (bar) bar.style.width = `${Math.round(p * 100)}%`;
      if (label) label.textContent = `${Math.round(p * 100)}%`;
    });
    // Word classes (noun, verb ...) for the table, in the text's language.
    try {
      result.classes = await api.classifyWords(
        result.rows.map((r) => r.word),
        config.textLanguage || I18n.getLanguage()
      );
    } catch (_) {
      result.classes = null;
    }
    // Keep the bar visible briefly so very fast reports still show progress.
    await new Promise((r) => setTimeout(r, 350));
    if (!files.includes(file)) return;
    file.report = { result, config, createdAt: new Date() };
    file.reportRunning = false;
    renderRow(file);
  }

  // ================================================================ point picker

  const picker = {
    file: null,
    mode: 'start',
    point: null,
    els: [],
    matches: [],
    matchIndex: -1,
  };
  const supportsHighlights = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';

  function openPicker(mode) {
    const file = cfgFile;
    picker.file = file;
    picker.mode = mode;
    picker.point = mode === 'start' ? cfg.start : cfg.end;
    $('#pickerTitle').textContent = t(mode === 'start' ? 'pick.startTitle' : 'pick.endTitle');
    $('#pickerHelp').textContent = t(mode === 'start' ? 'pick.startHelp' : 'pick.endHelp');
    $('#pickerReset').textContent = t(mode === 'start' ? 'pick.useBeginning' : 'pick.useEnd');
    $('#pickerSearch').value = '';
    $('#pickerSearchCount').textContent = '';
    picker.matches = [];
    picker.matchIndex = -1;

    const host = $('#pickerText');
    host.textContent = '';
    const frag = document.createDocumentFragment();
    const ROLE_LABEL = { toc: t('role.toc'), index: t('role.index'), copyright: t('role.copyright') };
    picker.els = [];
    let prevSection = null;
    file.doc.blocks.forEach((b, i) => {
      if (prevSection !== null && b.s !== prevSection) {
        const hr = document.createElement('hr');
        hr.className = 'section-break';
        frag.appendChild(hr);
      }
      prevSection = b.s;
      const p = document.createElement(b.k === 'h' ? 'h4' : 'p');
      p.className = b.k === 'h' ? 'pblock h' : 'pblock';
      p.dataset.i = i;
      if (b.r) p.dataset.role = ROLE_LABEL[b.r] || b.r;
      p.textContent = b.t;
      frag.appendChild(p);
      picker.els.push(p);
    });
    host.appendChild(frag);
    $('#pickerDialog').showModal();
    paintPicker(true);
  }

  function rangeFor(point, kind) {
    const el = picker.els[point.b];
    if (!el || !el.firstChild) return null;
    const text = picker.file.doc.blocks[point.b].t;
    const w = wordAt(text, point.o, kind);
    const r = new Range();
    r.setStart(el.firstChild, w.start);
    r.setEnd(el.firstChild, w.end);
    return r;
  }

  // Word containing (or nearest after) a character offset; for end points the offset is the word end.
  function wordAt(text, offset, kind) {
    const re = new RegExp(Core.WORD_RE.source, 'gu');
    let m;
    let last = null;
    while ((m = re.exec(text))) {
      const s = m.index;
      const e = s + m[0].length;
      if (kind === 'end' ? e >= offset : e > offset) return { start: s, end: e };
      last = { start: s, end: e };
    }
    return last || { start: 0, end: Math.min(text.length, 1) };
  }

  function paintPicker(scroll) {
    const file = picker.file;
    const other = picker.mode === 'start' ? cfg.end : cfg.start;
    const lo = picker.mode === 'start' ? picker.point : cfg.start;
    const hi = picker.mode === 'end' ? picker.point : cfg.end;
    for (let i = 0; i < picker.els.length; i++) {
      const out = (lo && i < lo.b) || (hi && i > hi.b);
      picker.els[i].classList.toggle('out', !!out);
    }
    if (supportsHighlights) {
      CSS.highlights.delete('pick');
      CSS.highlights.delete('other');
      if (picker.point) {
        const r = rangeFor(picker.point, picker.mode);
        if (r) CSS.highlights.set('pick', new Highlight(r));
      }
      if (other) {
        const r = rangeFor(other, picker.mode === 'start' ? 'end' : 'start');
        if (r) CSS.highlights.set('other', new Highlight(r));
      }
    }
    const status = $('#pickerStatus');
    let valid = true;
    if (picker.point) {
      const text = file.doc.blocks[picker.point.b].t;
      const w = wordAt(text, picker.point.o, picker.mode);
      const word = text.slice(w.start, w.end);
      const pct = Math.round(((file.offsets[picker.point.b] + picker.point.o) / file.totalChars) * 100);
      if (other && (picker.mode === 'start' ? compare(picker.point, other) >= 0 : compare(other, picker.point) >= 0)) {
        valid = false;
        status.innerHTML = `<span style="color:var(--danger)">${esc(t(picker.mode === 'start' ? 'pick.startBeforeEnd' : 'pick.endAfterStart'))}</span>`;
      } else {
        status.innerHTML = t('pick.status', {
          which: esc(t(picker.mode === 'start' ? 'pick.start' : 'pick.end')),
          word: esc(word),
          p: fmtInt(picker.point.b + 1),
          total: fmtInt(file.doc.blocks.length),
          pct,
        });
      }
      if (scroll) picker.els[picker.point.b].scrollIntoView({ block: 'center' });
    } else {
      status.textContent = t(picker.mode === 'start' ? 'pick.currentlyStart' : 'pick.currentlyEnd');
      if (scroll) $('#pickerText').scrollTop = 0;
    }
    $('#pickerOk').disabled = !picker.point || !valid;
  }

  function caretFromPoint(x, y) {
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) return { node: p.offsetNode, offset: p.offset };
    }
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) return { node: r.startContainer, offset: r.startOffset };
    }
    return null;
  }

  $('#pickerText').addEventListener('click', (e) => {
    const block = e.target.closest('.pblock');
    if (!block) return;
    const i = Number(block.dataset.i);
    const text = picker.file.doc.blocks[i].t;
    let offset = 0;
    const c = caretFromPoint(e.clientX, e.clientY);
    if (c && c.node && block.contains(c.node) && c.node.nodeType === Node.TEXT_NODE) offset = c.offset;
    const w = wordAt(text, picker.mode === 'end' ? Math.min(offset + 1, text.length) : offset, picker.mode);
    picker.point = { b: i, o: picker.mode === 'start' ? w.start : w.end };
    paintPicker(false);
  });

  $('#pickerOk').addEventListener('click', () => {
    if (picker.mode === 'start') cfg.start = picker.point;
    else cfg.end = picker.point;
    closePicker();
  });
  $('#pickerReset').addEventListener('click', () => {
    if (picker.mode === 'start') cfg.start = null;
    else cfg.end = null;
    closePicker();
  });
  $('#pickerCancel').addEventListener('click', closePicker);
  $('#pickerDialog').addEventListener('cancel', (e) => {
    e.preventDefault();
    closePicker();
  });
  function closePicker() {
    if (supportsHighlights) {
      CSS.highlights.delete('pick');
      CSS.highlights.delete('other');
      CSS.highlights.delete('find');
    }
    $('#pickerDialog').close();
    $('#pickerText').textContent = '';
    picker.els = [];
    renderConfig();
  }

  // Find in text
  let searchTimer = null;
  $('#pickerSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 180);
  });
  $('#pickerSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!picker.matches.length) runSearch();
      else stepSearch(e.shiftKey ? -1 : 1);
    }
  });
  function runSearch() {
    const q = $('#pickerSearch').value.trim().toLocaleLowerCase();
    picker.matches = [];
    picker.matchIndex = -1;
    if (q.length >= 2) {
      picker.file.doc.blocks.forEach((b, i) => {
        const t = b.t.toLocaleLowerCase();
        let k = t.indexOf(q);
        while (k >= 0 && picker.matches.length < 5000) {
          picker.matches.push({ b: i, start: k, end: k + q.length });
          k = t.indexOf(q, k + q.length);
        }
      });
    }
    stepSearch(1);
  }
  function stepSearch(dir) {
    const count = $('#pickerSearchCount');
    if (supportsHighlights) CSS.highlights.delete('find');
    if (!picker.matches.length) {
      count.textContent = $('#pickerSearch').value.trim().length >= 2 ? t('pick.noMatches') : '';
      return;
    }
    picker.matchIndex = (picker.matchIndex + dir + picker.matches.length) % picker.matches.length;
    const m = picker.matches[picker.matchIndex];
    count.textContent = `${picker.matchIndex + 1} / ${picker.matches.length}${picker.matches.length >= 5000 ? '+' : ''}`;
    const el = picker.els[m.b];
    el.scrollIntoView({ block: 'center' });
    if (supportsHighlights && el.firstChild) {
      const r = new Range();
      r.setStart(el.firstChild, m.start);
      r.setEnd(el.firstChild, m.end);
      CSS.highlights.set('find', new Highlight(r));
    }
  }

  // ================================================================ report view

  const ROW_H = 34;
  const view = { file: null, rows: [], filtered: [], sortKey: 'count', sortDir: 'desc', maxPct: 1 };

  function describeRange(file, config) {
    const startTxt = config.start ? pointLabelPlain(file, config.start, 'start') : t('rep.beginning');
    const endTxt = config.end ? pointLabelPlain(file, config.end, 'end') : t('rep.end');
    return t('rep.range', { start: startTxt, end: endTxt });
  }
  function pointLabelPlain(file, point, kind) {
    const text = file.doc.blocks[point.b].t;
    const w = wordAt(text, point.o, kind);
    const pct = Math.round(((file.offsets[point.b] + point.o) / file.totalChars) * 100);
    return `${quote(text.slice(w.start, w.end))} (${pct}${I18n.getLanguage() === 'es' ? ' %' : '%'})`;
  }
  function optLabel(file, config, opt, cap) {
    if (!file.doc.caps[cap]) return t('rep.notRecognised');
    return config[opt] ? t('rep.included') : t('rep.excluded');
  }

  function openReport(file) {
    const { result, config } = file.report;
    view.file = file;
    const lang = config.textLanguage || I18n.getLanguage();
    view.rows = result.rows.map((r, i) => ({
      ...r,
      rank: i + 1,
      // every class the word can have, e.g. ['nouns', 'verbs'] for "vino"
      classes: result.classes ? [].concat(result.classes[i]) : [WordClasses.classify(r.word, lang) || 'other'],
    }));
    view.classCounts = {};
    for (const r of view.rows) for (const c of r.classes) view.classCounts[c] = (view.classCounts[c] || 0) + 1;
    view.sortKey = 'count';
    view.sortDir = 'desc';
    view.maxPct = result.rows.length ? result.rows[0].pct : 1;
    $('#reportTitle').textContent = file.name;
    const chips = [
      describeRange(file, config),
      t('rep.headings', { state: optLabel(file, config, 'includeHeadings', 'headings') }),
      t('rep.copyright', { state: optLabel(file, config, 'includeCopyright', 'copyright') }),
      t('rep.toc', { state: optLabel(file, config, 'includeToc', 'toc') }),
      t('rep.textLang', { lang: t(`lang.${config.textLanguage || 'en'}`) }),
      ...(config.textLanguage === 'es' ? [] : [t(config.mergePossessives ? 'rep.possMerged' : 'rep.possKept')]),
    ];
    $('#reportChips').innerHTML = chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
    const cards = [
      [t('rep.words'), fmtInt(result.words), true],
      [t('rep.charsNoSpaces'), fmtInt(result.charsNoSpaces)],
      [t('rep.charsWithSpaces'), fmtInt(result.charsWithSpaces)],
      [t('rep.unique'), fmtInt(result.uniqueWords)],
      [t('rep.readingTime'), Core.readingTime(result.words, settings.wordsPerMinute)],
    ];
    $('#reportStats').innerHTML = cards
      .map(([l, v, primary]) => `<div class="stat-card${primary ? ' primary' : ''}"><div class="label">${l}</div><div class="value">${v}</div></div>`)
      .join('');
    $('#reportFootNote').textContent = t('rep.created', { date: file.report.createdAt.toLocaleString(I18n.locale()) });
    $('#reportFilter').value = '';
    renderTypeToggles();
    $('#reportDialog').showModal();
    applySortFilter();
    $('#vscroll').scrollTop = 0;
  }

  function applySortFilter() {
    const q = $('#reportFilter').value.trim().toLocaleLowerCase();
    const { sortKey, sortDir } = view;
    const dir = sortDir === 'asc' ? 1 : -1;
    const hidden = hiddenClasses();
    // A word stays visible while at least one of its types is switched on.
    let rows = view.rows.filter((r) => r.classes.some((c) => !hidden.has(c)) && (!q || r.word.includes(q)));
    rows.sort((a, b) => {
      // An exact match for the filter text always comes first.
      if (q && (a.word === q) !== (b.word === q)) return a.word === q ? -1 : 1;
      if (sortKey === 'word') return dir * a.word.localeCompare(b.word);
      return (a[sortKey] - b[sortKey]) * dir || a.word.localeCompare(b.word);
    });
    view.filtered = rows;
    for (const h of $$('.vcell.sort')) {
      const active = h.dataset.key === sortKey;
      h.classList.toggle('active', active);
      h.setAttribute('aria-sort', active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      $('.arrow', h).textContent = active ? (sortDir === 'asc' ? '▲' : '▼') : '';
    }
    $('#vspacer').style.height = `${rows.length * ROW_H}px`;
    const shown = rows.length;
    const total = view.rows.length;
    $('#reportCount').textContent =
      shown === total ? t('rep.countAll', { n: fmtInt(total) }) : t('rep.countSome', { shown: fmtInt(shown), total: fmtInt(total) });
    paintRows();
  }

  function paintRows() {
    const scroller = $('#vscroll');
    const win = $('#vwindow');
    const rows = view.filtered;
    $('#vtable').style.setProperty('--sbw', `${scroller.offsetWidth - scroller.clientWidth}px`);
    if (!rows.length) {
      win.style.transform = 'translateY(0)';
      win.innerHTML = `<div class="vempty">${esc(t(hiddenClasses().size ? 'rep.noMatchTypes' : 'rep.noMatch'))}</div>`;
      return;
    }
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_H) - 8);
    const count = Math.ceil((scroller.clientHeight || 600) / ROW_H) + 16;
    const slice = rows.slice(first, first + count);
    win.style.transform = `translateY(${first * ROW_H}px)`;
    win.innerHTML = slice
      .map(
        (r) => `<div class="vrow clickable" role="row" data-word="${esc(r.word)}" title="${esc(t('rep.clickFilter', { word: r.word }))}">
          <div class="vcell"><span class="rank">#${r.rank}</span><span class="word">${esc(r.word)}</span>${
            r.classes.filter((c) => c !== 'other').map((c) => `<span class="wtag">${esc(t(`tag.${c}`))}</span>`).join('')
          }</div>
          <div class="vcell num">${fmtInt(r.count)}</div>
          <div class="vcell num pct-cell"><span>${fmtPct(r.pct)}</span><span class="pct-bar"><span style="width:${Math.max(
            2,
            (r.pct / view.maxPct) * 100
          ).toFixed(1)}%"></span></span></div>
        </div>`
      )
      .join('');
  }

  $('#vscroll').addEventListener('scroll', () => requestAnimationFrame(paintRows));

  // Clicking a word puts it in the filter box.
  $('#vwindow').addEventListener('click', (e) => {
    const row = e.target.closest('.vrow[data-word]');
    if (!row) return;
    $('#reportFilter').value = row.dataset.word;
    applySortFilter();
    $('#vscroll').scrollTop = 0;
  });

  // Word-type toggles (articles, prepositions ...). Hidden types are remembered between sessions.
  function hiddenClasses() {
    return new Set(settings.hiddenWordClasses || []);
  }
  function renderTypeToggles() {
    const hidden = hiddenClasses();
    $('#typeToggles').innerHTML = WordClasses.CLASSES.map((c) => {
      const on = !hidden.has(c.key);
      const n = (view.classCounts && view.classCounts[c.key]) || 0;
      const label = t(`cls.${c.key}`);
      const title = t(on ? 'rep.toggleTitleOn' : 'rep.toggleTitleOff', { n: fmtInt(n), label: label.toLowerCase() });
      return `<button type="button" class="type-toggle${on ? ' on' : ''}" role="switch" aria-checked="${on}" data-key="${c.key}" title="${esc(title)}">
        <span class="switch" aria-hidden="true"></span><span class="type-label">${esc(label)}</span><span class="type-count">${fmtInt(n)}</span>
      </button>`;
    }).join('');
  }
  $('#typeToggles').addEventListener('click', (e) => {
    const b = e.target.closest('.type-toggle');
    if (!b) return;
    const hidden = hiddenClasses();
    if (hidden.has(b.dataset.key)) hidden.delete(b.dataset.key);
    else hidden.add(b.dataset.key);
    settings = { ...settings, hiddenWordClasses: [...hidden] };
    renderTypeToggles();
    applySortFilter();
    api.setSettings({ hiddenWordClasses: [...hidden] }).catch(() => {});
  });
  window.addEventListener('resize', () => {
    if ($('#reportDialog').open) paintRows();
  });
  for (const h of $$('.vcell.sort')) {
    h.addEventListener('click', () => {
      const key = h.dataset.key;
      if (view.sortKey === key) view.sortDir = view.sortDir === 'asc' ? 'desc' : 'asc';
      else {
        view.sortKey = key;
        view.sortDir = key === 'word' ? 'asc' : 'desc';
      }
      applySortFilter();
      $('#vscroll').scrollTop = 0;
    });
  }
  let filterTimer = null;
  $('#reportFilter').addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
      applySortFilter();
      $('#vscroll').scrollTop = 0;
    }, 120);
  });

  $('#saveCsvBtn').addEventListener('click', async () => {
    const file = view.file;
    if (!file) return;
    const { result, config } = file.report;
    // Export the words in the order currently shown, without the hidden word types
    // (the text filter is ignored so the file always has the full list).
    const filterBackup = $('#reportFilter').value;
    $('#reportFilter').value = '';
    applySortFilter();
    const rows = view.filtered.map((r) => ({
      ...r,
      types: r.classes.filter((c) => c !== 'other').map((c) => t(`tag.${c}`)).join(' / '),
    }));
    $('#reportFilter').value = filterBackup;
    applySortFilter();
    const csv = Core.reportToCsv(
      { ...result, rows },
      {
        fileName: file.name,
        range: describeRange(file, config),
        headings: optLabel(file, config, 'includeHeadings', 'headings'),
        copyright: optLabel(file, config, 'includeCopyright', 'copyright'),
        toc: optLabel(file, config, 'includeToc', 'toc'),
        textLanguage: t(`lang.${config.textLanguage || 'en'}`),
        possessives: config.textLanguage === 'es' ? '' : t(config.mergePossessives ? 'csv.possMerged' : 'csv.possKept'),
        hiddenTypes: WordClasses.CLASSES.filter((c) => hiddenClasses().has(c.key)).map((c) => t(`cls.${c.key}`)).join('; '),
      },
      csvOptions()
    );
    const res = await api.saveCsv(t('csv.fileName', { name: baseName(file.name) }), csv);
    if (res && res.saved) toast(t('rep.saved', { path: res.filePath }));
  });

  // CSV labels in the chosen language. Spanish uses ";" between columns and a decimal
  // comma, which is what Excel expects on Spanish-language Windows.
  function csvOptions() {
    const es = I18n.getLanguage() === 'es';
    const labels = {};
    for (const k of ['colTypes', 'textLang', 'file', 'range', 'headings', 'copyright', 'toc', 'possessive', 'hidden', 'words', 'charsNoSpaces', 'charsWithSpaces', 'unique', 'colWord', 'colCount', 'colPct']) {
      labels[k] = t(`csv.${k}`);
    }
    return { labels, delimiter: es ? ';' : ',', decimal: es ? ',' : '.' };
  }

  // ================================================================ preferences

  let prefSaved = false;
  function paintPrefs() {
    const p = preview || settings;
    for (const b of $$('#langSeg button')) {
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(b.dataset.val === p.language));
    }
    const wpm = Number($('#wpmInput').value);
    for (const c of $$('.chip-btn[data-wpm]')) c.classList.toggle('active', Number(c.dataset.wpm) === wpm);
    for (const b of $$('#themeSeg button')) {
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(b.dataset.val === effectiveTheme()));
    }
  }
  // Show the unsaved theme/language right away.
  function updatePreview(patch) {
    preview = { ...(preview || settings), ...patch };
    applyLanguage();
    renderTable();
    paintPrefs();
  }
  $('#prefsBtn').addEventListener('click', () => {
    $('#wpmInput').value = settings.wordsPerMinute;
    preview = { ...settings };
    prefSaved = false;
    paintPrefs();
    $('#prefsDialog').showModal();
  });
  $('#wpmInput').addEventListener('input', paintPrefs);
  for (const c of $$('.chip-btn[data-wpm]')) {
    c.addEventListener('click', () => {
      $('#wpmInput').value = c.dataset.wpm;
      paintPrefs();
    });
  }
  $('#langSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-val]');
    if (b) updatePreview({ language: b.dataset.val });
  });
  $('#themeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-val]');
    if (b) updatePreview({ theme: b.dataset.val });
  });
  // Cancel, the close button and Esc all end here: undo the live preview.
  $('#prefsDialog').addEventListener('close', () => {
    if (prefSaved) return;
    preview = null;
    applyLanguage();
    renderTable();
  });
  $('#prefsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const wpm = Math.round(Number($('#wpmInput').value));
    if (!Number.isFinite(wpm) || wpm < 50 || wpm > 2000) {
      toast(t('pref.wpmRange'));
      return;
    }
    const chosen = preview || settings;
    prefSaved = true;
    $('#prefsDialog').close();
    preview = null;
    await saveSettings({ wordsPerMinute: wpm, theme: chosen.theme, language: chosen.language });
    toast(t('pref.saved'));
  });

  // ================================================================ start

  (async () => {
    try {
      settings = await api.getSettings();
    } catch (_) {
      /* defaults */
    }
    applyLanguage();
    renderTable();
  })();
})();
