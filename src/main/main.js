'use strict';

const { app, BrowserWindow, ipcMain, dialog, nativeTheme, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const settings = require('./settings');
const { SUPPORTED_EXTENSIONS } = require('../extract/formats-list');

let mainWindow = null;

// First run follows the Windows display language (Spanish or English).
const firstRun = () => ({ language: /^es\b/i.test(app.getLocale() || '') ? 'es' : 'en' });
// The portable .exe keeps its settings in a file next to itself, so the app leaves
// nothing behind on the computer and settings travel with it (e.g. on a USB stick).
const settingsDir = () => process.env.PORTABLE_EXECUTABLE_DIR || app.getPath('userData');
const loadSettings = () => settings.load(settingsDir(), firstRun());

const DIALOG_TEXT = {
  en: { open: 'Add documents', supported: 'Supported documents', all: 'All files', save: 'Save report as CSV', csv: 'CSV (comma separated)' },
  es: { open: 'Añadir documentos', supported: 'Documentos compatibles', all: 'Todos los archivos', save: 'Guardar informe como CSV', csv: 'CSV (separado por punto y coma)' },
};
const dialogText = () => DIALOG_TEXT[loadSettings().language] || DIALOG_TEXT.en;

function createWindow() {
  const prefs = loadSettings();
  nativeTheme.themeSource = prefs.theme || 'system';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    title: 'TextStats',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f6f7f9',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Dropping a file outside the drop handler must never navigate the window.
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------- IPC

ipcMain.handle('settings:get', () => loadSettings());

ipcMain.handle('settings:set', (_e, patch) => {
  const next = settings.save(settingsDir(), patch, firstRun());
  if (patch && patch.theme) nativeTheme.themeSource = patch.theme;
  return next;
});

ipcMain.handle('dialog:open', async () => {
  const exts = SUPPORTED_EXTENSIONS.map((e) => e.replace(/^\./, ''));
  const result = await dialog.showOpenDialog(mainWindow, {
    title: dialogText().open,
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: dialogText().supported, extensions: exts },
      { name: dialogText().all, extensions: ['*'] },
    ],
  });
  if (result.canceled) return [];
  return result.filePaths.map(describeFile);
});

ipcMain.handle('file:describe', (_e, filePath) => describeFile(filePath));

ipcMain.handle('file:extract', (_e, filePath) => extractInWorker(filePath));

ipcMain.handle('words:classify', (_e, { words, lang }) => classifyInWorker(words, lang));

// One long-lived worker holds the word lists (loaded on first use).
let lexWorker = null;
let lexSeq = 0;
const lexPending = new Map();
function classifyInWorker(words, lang) {
  if (!lexWorker) {
    lexWorker = new Worker(path.join(__dirname, 'lexicon-worker.js'));
    lexWorker.on('message', ({ id, classes, error }) => {
      const p = lexPending.get(id);
      lexPending.delete(id);
      if (p) error ? p.reject(new Error(error)) : p.resolve(classes);
    });
    const fail = (err) => {
      for (const p of lexPending.values()) p.reject(err instanceof Error ? err : new Error(String(err)));
      lexPending.clear();
      lexWorker = null;
    };
    lexWorker.on('error', fail);
    lexWorker.on('exit', (code) => code && fail(new Error(`word list worker stopped (${code})`)));
  }
  const id = ++lexSeq;
  return new Promise((resolve, reject) => {
    lexPending.set(id, { resolve, reject });
    lexWorker.postMessage({ id, words, lang });
  });
}

ipcMain.handle('report:save-csv', async (_e, { defaultName, content }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: dialogText().save,
    defaultPath: defaultName,
    filters: [{ name: dialogText().csv, extensions: ['csv'] }],
  });
  if (result.canceled || !result.filePath) return { saved: false };
  // UTF-8 BOM so Excel opens accented words correctly.
  fs.writeFileSync(result.filePath, '﻿' + content, 'utf8');
  return { saved: true, filePath: result.filePath };
});

function describeFile(filePath) {
  let size = 0;
  let isDirectory = false;
  try {
    const st = fs.statSync(filePath);
    size = st.size;
    isDirectory = st.isDirectory();
  } catch (_) {
    /* reported by the extractor */
  }
  return { path: filePath, name: path.basename(filePath), ext: path.extname(filePath).toLowerCase(), size, isDirectory };
}

// Extraction runs in a worker thread so big PDFs or e-books never freeze the window.
function extractInWorker(filePath) {
  return new Promise((resolve) => {
    const worker = new Worker(path.join(__dirname, '..', 'extract', 'worker.js'), {
      workerData: { filePath },
    });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      worker.terminate().catch(() => {});
    };
    worker.on('message', (msg) => {
      if (msg && msg.type === 'progress') {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('extract:progress', { filePath, value: msg.value });
        }
        return;
      }
      finish(msg);
    });
    worker.on('error', (err) => finish({ ok: false, error: { code: 'generic', detail: err && err.message ? err.message : String(err) } }));
    worker.on('exit', (code) => {
      if (!settled) finish({ ok: false, error: { code: 'workerStopped', detail: code } });
    });
  });
}
