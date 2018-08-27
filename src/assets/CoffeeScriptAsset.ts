import Asset, { AssetOptions } from '../Asset';
import localRequire from '../utils/localRequire';

export default class CoffeeScriptAsset extends Asset<unknown, unknown> {
    constructor(name: string, options: AssetOptions) {
        super(name, options);
        this.type = 'js';
    }

    async generate() {
        // require coffeescript, installed locally in the app
        let coffee = await localRequire<import('coffeescript')>('coffeescript', this.name);

        // Transpile Module using CoffeeScript and parse result as ast format through babylon
        let transpiled = coffee.compile(this.contents, {
            sourceMap: this.options.sourceMaps
        });

        let sourceMap;
        if (transpiled.sourceMap) {
            sourceMap = transpiled.sourceMap.generate();
            sourceMap.sources = [this.relativeName];
            sourceMap.sourcesContent = [this.contents];
        }

        return [
            {
                type: 'js',
                value: this.options.sourceMaps ? transpiled.js : transpiled,
                sourceMap
            }
        ];
    }
}
