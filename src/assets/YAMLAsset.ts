import Asset from '../Asset';
import yaml from 'js-yaml';
import serializeObject from '../utils/serializeObject';

class YAMLAsset extends Asset {
  constructor(name, options) {
    super(name, options);
    this.type = 'js';
  }

  parse(code) {
    return yaml.safeLoad(code);
  }

  generate() {
    return serializeObject(
      this.ast,
      this.options.minify && !this.options.scopeHoist
    );
  }
}

module.exports = YAMLAsset;
