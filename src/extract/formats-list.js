'use strict';

// Extensions offered in the Open dialog. Files with other extensions are still
// sniffed by content, so a renamed file can still be read.
const SUPPORTED_EXTENSIONS = [
  '.txt', '.text', '.md', '.csv', '.tsv', '.rtf',
  '.pdf',
  '.epub', '.mobi', '.prc', '.azw', '.azw3', '.kf8', '.kfx',
  '.docx', '.docm', '.doc', '.odt', '.pages', '.iba',
];

module.exports = { SUPPORTED_EXTENSIONS };
