import Asset from '../Asset';
import * as fs from '../utils/fs';
import localRequire from '../utils/localRequire';

export default class ReasonAsset extends Asset {
    constructor(name, options) {
        super(name, options);
        this.type = 'js';
    }

    async generate() {
        const bsb = await localRequire('bsb-js', this.name);

        // This runs BuckleScript - the Reason to JS compiler.
        // Other Asset types use `localRequire` but the `bsb-js` package already
        // does that internally. This should also take care of error handling in
        // the Reason compilation process.
        if (process.env.NODE_ENV !== 'test') {
            await bsb.runBuild();
        }

        // This is a simplified use-case for Reason - it only loads the recommended
        // BuckleScript configuration to simplify the file processing.
        const outputFile = this.name.replace(/\.(re|ml)$/, '.bs.js');
        const outputContent = await fs.readFile(outputFile);
        return outputContent.toString();
    }
}
