'use strict';

// pdf.js expects a few browser geometry classes even when only extracting text.
// These minimal versions are enough for text extraction (nothing is rendered).

if (typeof globalThis.DOMMatrix === 'undefined') {
  class DOMMatrix {
    constructor(init) {
      const v = Array.isArray(init) && init.length >= 6 ? init : [1, 0, 0, 1, 0, 0];
      [this.a, this.b, this.c, this.d, this.e, this.f] = v.map(Number);
    }
    get m11() { return this.a; }
    get m12() { return this.b; }
    get m21() { return this.c; }
    get m22() { return this.d; }
    get m41() { return this.e; }
    get m42() { return this.f; }
    get is2D() { return true; }
    get isIdentity() {
      return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
    }
    multiplySelf(o) {
      const { a, b, c, d, e, f } = this;
      this.a = a * o.a + c * o.b;
      this.b = b * o.a + d * o.b;
      this.c = a * o.c + c * o.d;
      this.d = b * o.c + d * o.d;
      this.e = a * o.e + c * o.f + e;
      this.f = b * o.e + d * o.f + f;
      return this;
    }
    preMultiplySelf(o) {
      const m = new DOMMatrix([o.a, o.b, o.c, o.d, o.e, o.f]).multiplySelf(this);
      Object.assign(this, { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f });
      return this;
    }
    multiply(o) {
      return new DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(o);
    }
    translate(x = 0, y = 0) {
      return this.multiply(new DOMMatrix([1, 0, 0, 1, x, y]));
    }
    translateSelf(x = 0, y = 0) {
      return this.multiplySelf(new DOMMatrix([1, 0, 0, 1, x, y]));
    }
    scale(sx = 1, sy = sx) {
      return this.multiply(new DOMMatrix([sx, 0, 0, sy, 0, 0]));
    }
    scaleSelf(sx = 1, sy = sx) {
      return this.multiplySelf(new DOMMatrix([sx, 0, 0, sy, 0, 0]));
    }
    invertSelf() {
      const { a, b, c, d, e, f } = this;
      const det = a * d - b * c;
      if (!det) {
        Object.assign(this, { a: NaN, b: NaN, c: NaN, d: NaN, e: NaN, f: NaN });
        return this;
      }
      Object.assign(this, {
        a: d / det, b: -b / det, c: -c / det, d: a / det,
        e: (c * f - d * e) / det, f: (b * e - a * f) / det,
      });
      return this;
    }
    inverse() {
      return new DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).invertSelf();
    }
    transformPoint(p = {}) {
      const x = p.x || 0;
      const y = p.y || 0;
      return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 };
    }
  }
  globalThis.DOMMatrix = DOMMatrix;
}

if (typeof globalThis.Path2D === 'undefined') {
  globalThis.Path2D = class Path2D {
    addPath() {}
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    closePath() {}
    rect() {}
  };
}

if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}
