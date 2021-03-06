import URL from 'url';
import path from 'path';
import clone from 'clone';
import * as fs from './utils/fs';
import objectHash from './utils/objectHash';
import md5 from './utils/md5';
import isURL from './utils/is-url';
import * as config from './utils/config';
import syncPromise from './utils/syncPromise';
import logger from './Logger';
import Resolver, { PackageJson } from './Resolver';
import Parser from './Parser';


export interface AssetOptions {
    rootDir: string;
    rendition?: none;
    parser: Parser;
    production?: boolean;
    scopeHoist?: boolean;
    bundleLoaders: { [type: string]: none };
    publicURL: string;
    outDir: string;
    entryFiles: string[];
    outFile: string;
}

export type AssetGeneration = { type?: string, value?: string, final?: boolean };

/**
 * Most assets should return this from generate().
 */
export type StandardAssetGeneration = AssetGeneration | AssetGeneration[];

export type AssetClass<Contents, Generated> = { new (name: string, options: AssetOptions): Asset<Contents, Generated> };

/**
 * An Asset represents a file in the dependency tree. Assets can have multiple
 * parents that depend on it, and can be added to multiple output bundles.
 * The base Asset class doesn't do much by itself, but sets up an interface
 * for subclasses to implement.
 */
export default class Asset<Contents, Generated> {
    id: string | null;
    name: string;
    basename: string;
    relativeName: string;
    options: AssetOptions;
    encoding: string;
    type: string | null;
    processed: boolean;
    contents: Contents | null;
    ast: none | null;
    generated: Generated | null;
    hash: string | Buffer | null;
    parentDeps: Set<none>;
    dependencies: Map<string, none>;
    depAssets: Map<none, none>;
    parentBundle: none | null;
    bundles: Set<none>;
    cacheData: none;
    startTime: number;
    endTime: number;
    buildTime: number;
    bundledSize: number;
    resolver: Resolver;

    usedExports?: Set<none>;

    private _package?: PackageJson;

    constructor(name: string, options: AssetOptions) {
        this.id = null;
        this.name = name;
        this.basename = path.basename(this.name);
        this.relativeName = path.relative(options.rootDir, this.name);
        this.options = options;
        this.encoding = 'utf8';
        this.type = path.extname(this.name).slice(1);

        this.processed = false;
        this.contents = options.rendition ? options.rendition.value : null;
        this.ast = null;
        this.generated = null;
        this.hash = null;
        this.parentDeps = new Set();
        this.dependencies = new Map();
        this.depAssets = new Map();
        this.parentBundle = null;
        this.bundles = new Set();
        this.cacheData = {};
        this.startTime = 0;
        this.endTime = 0;
        this.buildTime = 0;
        this.bundledSize = 0;
        this.resolver = new Resolver(options);
    }

    shouldInvalidate(): boolean {
        return false;
    }

    async loadIfNeeded(): Promise<void> {
        if (this.contents == null) {
            this.contents = await this.load();
        }
    }

    async parseIfNeeded(): Promise<void> {
        await this.loadIfNeeded();
        if (!this.ast) {
            this.ast = await this.parse(this.contents!);
        }
    }

    async getDependencies(): Promise<void> {
        if (
            this.options.rendition &&
            this.options.rendition.hasDependencies === false
        ) {
            return;
        }

        await this.loadIfNeeded();

        if (this.contents && this.mightHaveDependencies()) {
            await this.parseIfNeeded();
            await this.collectDependencies();
        }
    }

    addDependency(name: string, opts?: none): void {
        this.dependencies.set(name, Object.assign({ name }, opts));
    }

    addURLDependency(url: string, from: string = this.name, opts: none): string {
        if (!url || isURL(url)) {
            return url;
        }

        if (typeof from === 'object') {
            opts = from;
            from = this.name;
        }

        const parsed = URL.parse(url);
        let depName;
        let resolved;
        let dir = path.dirname(from);
        const filename = decodeURIComponent(parsed.pathname!);

        if (filename[0] === '~' || filename[0] === '/') {
            if (dir === '.') {
                dir = this.options.rootDir;
            }
            depName = resolved = this.resolver.resolveFilename(filename, dir);
        } else {
            resolved = path.resolve(dir, filename);
            depName = './' + path.relative(path.dirname(this.name), resolved);
        }

        this.addDependency(depName, Object.assign({dynamic: true}, opts));

        parsed.pathname = this.options.parser
            .getAsset(resolved, this.options)
            .generateBundleName();

        return URL.format(parsed);
    }

    get package(): PackageJson | undefined {
        logger.warn(
            '`asset.package` is deprecated. Please use `await asset.getPackage()` instead.'
        );
        return syncPromise(this.getPackage());
    }

    async getPackage(): Promise<PackageJson | undefined> {
        if (!this._package) {
            this._package = await this.resolver.findPackage(path.dirname(this.name));
        }

        return this._package;
    }

    async getConfig(filenames: string[], opts: { packageKey?: keyof PackageJson, path?: string, load?: boolean } = {}): Promise<unknown> {
        if (opts.packageKey) {
            let pkg = await this.getPackage();
            if (pkg && pkg[opts.packageKey]) {
                return clone(pkg[opts.packageKey]);
            }
        }

        // Resolve the config file
        let conf = await config.resolve(opts.path || this.name, filenames);
        if (conf) {
            // Add as a dependency so it is added to the watcher and invalidates
            // this asset when the config changes.
            this.addDependency(conf, {includedInParent: true});
            if (opts.load === false) {
                return conf;
            }

            return await config.load(opts.path || this.name, filenames);
        }

        return null;
    }

    mightHaveDependencies() {
        return true;
    }

    async load(): Promise<Contents> {
        return await fs.readFile(this.name, this.encoding) as any; // this is the base, an asset loads the file as a string
    }

    parse(_contents?: Contents) {
        // do nothing by default
    }

    collectDependencies() {
        // do nothing by default
    }

    async pretransform() {
        // do nothing by default
    }

    async transform() {
        // do nothing by default
    }

    async generate(): Promise<Generated> {
        return {
            [this.type as string]: this.contents
        } as any; // default implementation
    }

    async process() {
        // Generate the id for this asset, unless it has already been set.
        // We do this here rather than in the constructor to avoid unnecessary work in the main process.
        // In development, the id is just the relative path to the file, for easy debugging and performance.
        // In production, we use a short hash of the relative path.
        if (!this.id) {
            this.id =
                this.options.production || this.options.scopeHoist
                    ? md5(this.relativeName, 'base64').slice(0, 4)
                    : this.relativeName;
        }

        if (!this.generated) {
            await this.loadIfNeeded();
            await this.pretransform();
            await this.getDependencies();
            await this.transform();
            this.generated = await this.generate();
            this.hash = await this.generateHash();
        }

        return this.generated;
    }

    async postProcess(generated: Generated): Promise<Generated> {
        return generated;
    }

    async generateHash(): Promise<string | Buffer> {
        return objectHash(this.generated);
    }

    invalidate() {
        this.processed = false;
        this.contents = null;
        this.ast = null;
        this.generated = null;
        this.hash = null;
        this.dependencies.clear();
        this.depAssets.clear();
    }

    invalidateBundle() {
        this.parentBundle = null;
        this.bundles.clear();
        this.parentDeps.clear();
    }

    generateBundleName() {
        // Generate a unique name. This will be replaced with a nicer
        // name later as part of content hashing.
        return md5(this.name) + '.' + this.type;
    }

    replaceBundleNames(bundleNameMap: Map<string, none>) {
        let copied = false;
        for (let key in this.generated!) {
            let value = this.generated![key];
            if (typeof value === 'string') {
                // Replace temporary bundle names in the output with the final content-hashed names.
                let newValue: string = value;
                for (let [name, map] of bundleNameMap) {
                    newValue = newValue.split(name).join(map);
                }

                // Copy `this.generated` on write so we don't end up writing the final names to the cache.
                if (newValue !== value && !copied) {
                    this.generated = Object.assign({}, this.generated);
                    copied = true;
                }

                this.generated![key] = newValue;
            }
        }
    }

    generateErrorMessage(err: none): none {
        return err;
    }
}
