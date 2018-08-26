import Asset from '../Asset';
import path from 'path';
import json5 from 'json5';
import { minify } from 'terser';

class JSONAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';
  }

  parse(code) {
    return path.extname(this.name) === '.json5' ? json5.parse(code) : null;
  }

  generate() {
    let code = `module.exports = ${
      this.ast ? JSON.stringify(this.ast, null, 2) : this.contents
    };`;

    if (this.options.minify && !this.options.scopeHoist) {
      let minified = minify(code);
      if (minified.error) {
        throw minified.error;
      }

      code = minified.code;
    }

    return code;
  }
}

module.exports = JSONAsset;
