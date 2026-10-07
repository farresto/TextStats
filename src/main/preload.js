'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('textstats', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  openFiles: () => ipcRenderer.invoke('dialog:open'),
  describeFile: (filePath) => ipcRenderer.invoke('file:describe', filePath),
  extract: (filePath) => ipcRenderer.invoke('file:extract', filePath),
  classifyWords: (words, lang) => ipcRenderer.invoke('words:classify', { words, lang }),
  saveCsv: (defaultName, content) => ipcRenderer.invoke('report:save-csv', { defaultName, content }),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (_) {
      return file && file.path ? file.path : '';
    }
  },
  onExtractProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('extract:progress', handler);
    return () => ipcRenderer.removeListener('extract:progress', handler);
  },
});
