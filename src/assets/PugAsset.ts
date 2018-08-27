import path from 'path';
import Asset from '../Asset';
import localRequire from '../utils/localRequire';

export default class PugAsset extends Asset {
    constructor(name, options) {
        super(name, options);
        this.type = 'html';
    }

    async generate() {
        const pug = await localRequire('pug', this.name);
        const config =
            (await this.getConfig(['.pugrc', '.pugrc.js', 'pug.config.js'])) || {};

        const compiled = pug.compile(this.contents, {
            compileDebug: false,
            filename: this.name,
            basedir: path.dirname(this.name),
            pretty: !this.options.minify,
            templateName: path.basename(this.basename, path.extname(this.basename)),
            filters: config.filters,
            filterOptions: config.filterOptions,
            filterAliases: config.filterAliases
        });

        if (compiled.dependencies) {
            for (let item of compiled.dependencies) {
                this.addDependency(item, {
                    includedInParent: true
                });
            }
        }

        return compiled(config.locals);
    }
}