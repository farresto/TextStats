'use strict';

const { parentPort, workerData } = require('worker_threads');
const { extractFile } = require('./index');
const { UserError } = require('./errors');

// Errors are sent as { code, detail } so the window can show them in the chosen language.
extractFile(workerData.filePath, (value) => parentPort.postMessage({ type: 'progress', value }))
  .then((doc) => parentPort.postMessage({ ok: true, doc }))
  .catch((err) => {
    const known = err instanceof UserError || (err && err.isUser);
    parentPort.postMessage({
      ok: false,
      error: known
        ? { code: err.code, detail: err.detail }
        : { code: 'generic', detail: err && err.message ? err.message : String(err) },
    });
  });
