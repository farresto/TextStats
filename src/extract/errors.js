'use strict';

// An error meant for the user. The window shows it in the chosen language using
// the code (see src/renderer/i18n.js, keys "err.<code>"); detail fills {detail}.
class UserError extends Error {
  constructor(code, detail) {
    super(detail !== undefined ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail;
  }
}

module.exports = { UserError };
