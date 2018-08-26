import path from 'path';
import RawAsset from './assets/RawAsset';
import GlobAsset from './assets/GlobAsset';
import isGlob from 'is-glob';
import Asset, { AssetClass, AssetOptions } from './Asset';


export interface ParserOptions {
    extensions?: { [ext: string]: string };
}

export interface ParserGetAssetOptions {
    rootDir: string;
    rendition?: none;
    production?: boolean;
    scopeHoist?: boolean;
    bundleLoaders: { [type: string]: none };
    publicURL: string;
}

export default class Parser {
    extensions: { [ext: string]: string | AssetClass<unknown, unknown> };

    constructor(options: ParserOptions = {}) {
        this.extensions = {};

        this.registerExtension('js', './assets/JSAsset');
        this.registerExtension('jsx', './assets/JSAsset');
        this.registerExtension('es6', './assets/JSAsset');
        this.registerExtension('jsm', './assets/JSAsset');
        this.registerExtension('mjs', './assets/JSAsset');
        this.registerExtension('ml', './assets/ReasonAsset');
        this.registerExtension('re', './assets/ReasonAsset');
        this.registerExtension('ts', './assets/TypeScriptAsset');
        this.registerExtension('tsx', './assets/TypeScriptAsset');
        this.registerExtension('coffee', './assets/CoffeeScriptAsset');
        this.registerExtension('vue', './assets/VueAsset');
        this.registerExtension('json', './assets/JSONAsset');
        this.registerExtension('json5', './assets/JSONAsset');
        this.registerExtension('yaml', './assets/YAMLAsset');
        this.registerExtension('yml', './assets/YAMLAsset');
        this.registerExtension('toml', './assets/TOMLAsset');
        this.registerExtension('gql', './assets/GraphqlAsset');
        this.registerExtension('graphql', './assets/GraphqlAsset');

        this.registerExtension('css', './assets/CSSAsset');
        this.registerExtension('pcss', './assets/CSSAsset');
        this.registerExtension('postcss', './assets/CSSAsset');
        this.registerExtension('styl', './assets/StylusAsset');
        this.registerExtension('stylus', './assets/StylusAsset');
        this.registerExtension('less', './assets/LESSAsset');
        this.registerExtension('sass', './assets/SASSAsset');
        this.registerExtension('scss', './assets/SASSAsset');

        this.registerExtension('html', './assets/HTMLAsset');
        this.registerExtension('htm', './assets/HTMLAsset');
        this.registerExtension('rs', './assets/RustAsset');

        this.registerExtension('webmanifest', './assets/WebManifestAsset');

        this.registerExtension('glsl', './assets/GLSLAsset');
        this.registerExtension('vert', './assets/GLSLAsset');
        this.registerExtension('frag', './assets/GLSLAsset');

        this.registerExtension('jade', './assets/PugAsset');
        this.registerExtension('pug', './assets/PugAsset');

        let extensions = options.extensions || {};
        for (let ext in extensions) {
            this.registerExtension(ext, extensions[ext]);
        }
    }

    registerExtension(ext: string, parser: string): void {
        if (!ext.startsWith('.')) {
            ext = '.' + ext;
        }

        this.extensions[ext.toLowerCase()] = parser;
    }

    findParser(filename: string, fromPipeline?: boolean): AssetClass<unknown, unknown> {
        if (!fromPipeline && isGlob(filename)) {
            return GlobAsset;
        }

        let extension = path.extname(filename).toLowerCase();
        let parser = this.extensions[extension] || RawAsset;
        if (typeof parser === 'string') {
            parser = this.extensions[extension] = require(parser) as typeof Asset;
        }

        return parser;
    }

    getAsset(filename: string, options: ParserGetAssetOptions = {} as ParserGetAssetOptions): Asset<unknown, unknown> {
        let Asset = this.findParser(filename);
        return new Asset(filename, { ...options, parser: this });
    }
}
