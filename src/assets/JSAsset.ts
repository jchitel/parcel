import { File as BabelFile } from 'babel-core';
import traverse from 'babel-traverse';
import codeFrame from 'babel-code-frame';
import collectDependencies from '../visitors/dependencies';
import walk from 'babylon-walk';
import Asset from '../Asset';
import babylon from 'babylon';
import insertGlobals from '../visitors/globals';
import fsVisitor from '../visitors/fs';
import envVisitor from '../visitors/env';
import babel from '../transforms/babel';
import generate from 'babel-generator';
import terser from '../transforms/terser';
import SourceMap from '../SourceMap';
import hoist from '../scope-hoisting/hoist';
import path from 'path';
import * as fs from '../utils/fs';
import logger from '../Logger';

const IMPORT_RE = /\b(?:import\b|export\b|require\s*\()/;
const ENV_RE = /\b(?:process\.env)\b/;
const GLOBAL_RE = /\b(?:process|__dirname|__filename|global|Buffer|define)\b/;
const FS_RE = /\breadFileSync\b/;
const SW_RE = /\bnavigator\s*\.\s*serviceWorker\s*\.\s*register\s*\(/;
const WORKER_RE = /\bnew\s*Worker\s*\(/;
const SOURCEMAP_RE = /\/\/\s*[@#]\s*sourceMappingURL\s*=\s*([^\s]+)/;
const DATA_URL_RE = /^data:[^;]+(?:;charset=[^;]+)?;base64,(.*)/;

export default class JSAsset extends Asset {
    constructor(name, options) {
        super(name, options);
        this.type = 'js';
        this.globals = new Map();
        this.isAstDirty = false;
        this.isES6Module = false;
        this.outputCode = null;
        this.cacheData.env = {};
        this.rendition = options.rendition;
        this.sourceMap = this.rendition ? this.rendition.sourceMap : null;
    }

    shouldInvalidate(cacheData) {
        for (let key in cacheData.env) {
            if (cacheData.env[key] !== process.env[key]) {
                return true;
            }
        }

        return false;
    }

    mightHaveDependencies() {
        return (
            this.isAstDirty ||
            !/.js$/.test(this.name) ||
            IMPORT_RE.test(this.contents) ||
            GLOBAL_RE.test(this.contents) ||
            SW_RE.test(this.contents) ||
            WORKER_RE.test(this.contents)
        );
    }

    async getParserOptions() {
        // Babylon options. We enable a few plugins by default.
        const options = {
            filename: this.name,
            allowReturnOutsideFunction: true,
            allowHashBang: true,
            ecmaVersion: Infinity,
            strictMode: false,
            sourceType: 'module',
            locations: true,
            plugins: ['exportExtensions', 'dynamicImport']
        };

        // Check if there is a babel config file. If so, determine which parser plugins to enable
        this.babelConfig = await babel.getConfig(this);
        if (this.babelConfig) {
            const file = new BabelFile(this.babelConfig);
            options.plugins.push(...file.parserOpts.plugins);
        }

        return options;
    }

    async parse(code) {
        const options = await this.getParserOptions();
        return babylon.parse(code, options);
    }

    traverse(visitor) {
        // Create a babel File object if one hasn't been created yet.
        // This is needed so that cached NodePath objects get a `hub` object on them.
        // Plugins like babel-minify depend on this to get the original source code string.
        if (!this.babelFile) {
            this.babelFile = new BabelFile(this.babelConfig || {});
            this.babelFile.addCode(this.contents);
            this.babelFile.addAst(this.ast);
        }

        return traverse(this.ast, visitor, null, this);
    }

    traverseFast(visitor) {
        return walk.simple(this.ast, visitor, this);
    }

    collectDependencies() {
        walk.ancestor(this.ast, collectDependencies, this);
    }

    async loadSourceMap() {
        // Get original sourcemap if there is any
        let match = this.contents.match(SOURCEMAP_RE);
        if (match) {
            this.contents = this.contents.replace(SOURCEMAP_RE, '');

            let url = match[1];
            let dataURLMatch = url.match(DATA_URL_RE);

            try {
                let json, filename;
                if (dataURLMatch) {
                    filename = this.name;
                    json = new Buffer(dataURLMatch[1], 'base64').toString();
                } else {
                    filename = path.join(path.dirname(this.name), url);
                    json = await fs.readFile(filename, 'utf8');

                    // Add as a dep so we watch the source map for changes.
                    this.addDependency(filename, {includedInParent: true});
                }

                this.sourceMap = JSON.parse(json);

                // Attempt to read missing source contents
                if (!this.sourceMap.sourcesContent) {
                    this.sourceMap.sourcesContent = [];
                }

                let missingSources = this.sourceMap.sources.slice(
                    this.sourceMap.sourcesContent.length
                );
                if (missingSources.length) {
                    let contents = await Promise.all(
                        missingSources.map(async source => {
                            try {
                                let sourceFile = path.join(
                                    path.dirname(filename),
                                    this.sourceMap.sourceRoot || '',
                                    source
                                );
                                let result = await fs.readFile(sourceFile, 'utf8');
                                this.addDependency(sourceFile, {includedInParent: true});
                                return result;
                            } catch (err) {
                                logger.warn(
                                    `Could not load source file "${source}" in source map of "${
                                        this.relativeName
                                    }".`
                                );
                            }
                        })
                    );

                    this.sourceMap.sourcesContent = this.sourceMap.sourcesContent.concat(
                        contents
                    );
                }
            } catch (e) {
                logger.warn(
                    `Could not load existing sourcemap of "${this.relativeName}".`
                );
            }
        }
    }

    async pretransform() {
        await this.loadSourceMap();
        await babel(this);

        // Inline environment variables
        if (this.options.target === 'browser' && ENV_RE.test(this.contents)) {
            await this.parseIfNeeded();
            this.traverseFast(envVisitor);
        }
    }

    async transform() {
        if (this.options.target === 'browser') {
            if (this.dependencies.has('fs') && FS_RE.test(this.contents)) {
                // Check if we should ignore fs calls
                // See https://github.com/defunctzombie/node-browser-resolve#skip
                let pkg = await this.getPackage();
                let ignore = pkg && pkg.browser && pkg.browser.fs === false;

                if (!ignore) {
                    await this.parseIfNeeded();
                    this.traverse(fsVisitor);
                }
            }

            if (GLOBAL_RE.test(this.contents)) {
                await this.parseIfNeeded();
                walk.ancestor(this.ast, insertGlobals, this);
            }
        }

        if (this.options.scopeHoist) {
            await this.parseIfNeeded();
            await this.getPackage();

            this.traverse(hoist);
            this.isAstDirty = true;
        } else {
            if (this.isES6Module) {
                await babel(this);
            }
        }

        if (this.options.minify) {
            await terser(this);
        }
    }

    async generate() {
        let enableSourceMaps =
            this.options.sourceMaps &&
            (!this.rendition || !!this.rendition.sourceMap);
        let code;
        if (this.isAstDirty) {
            let opts = {
                sourceMaps: this.options.sourceMaps,
                sourceFileName: this.relativeName
            };

            let generated = generate(this.ast, opts, this.contents);

            if (enableSourceMaps && generated.rawMappings) {
                let rawMap = new SourceMap(generated.rawMappings, {
                    [this.relativeName]: this.contents
                });

                // Check if we already have a source map (e.g. from TypeScript or CoffeeScript)
                // In that case, we need to map the original source map to the babel generated one.
                if (this.sourceMap) {
                    this.sourceMap = await new SourceMap().extendSourceMap(
                        this.sourceMap,
                        rawMap
                    );
                } else {
                    this.sourceMap = rawMap;
                }
            }

            code = generated.code;
        } else {
            code = this.outputCode != null ? this.outputCode : this.contents;
        }

        if (enableSourceMaps && !this.sourceMap) {
            this.sourceMap = new SourceMap().generateEmptyMap(
                this.relativeName,
                this.contents
            );
        }

        if (this.globals.size > 0) {
            code = Array.from(this.globals.values()).join('\n') + '\n' + code;
            if (enableSourceMaps) {
                if (!(this.sourceMap instanceof SourceMap)) {
                    this.sourceMap = await new SourceMap().addMap(this.sourceMap);
                }

                this.sourceMap.offset(this.globals.size);
            }
        }

        return {
            js: code,
            map: this.sourceMap
        };
    }

    generateErrorMessage(err) {
        const loc = err.loc;
        if (loc) {
            err.codeFrame = codeFrame(this.contents, loc.line, loc.column + 1);
            err.highlightedCodeFrame = codeFrame(
                this.contents,
                loc.line,
                loc.column + 1,
                {highlightCode: true}
            );
        }

        return err;
    }
}
