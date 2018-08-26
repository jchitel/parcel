import Path from 'path';
import crypto from 'crypto';
import Asset from './Asset';
import Bundler from './Bundler';
import Packager from './packagers/Packager';


export interface BundleOptions {
    isolated?: boolean;
}

/**
 * A Bundle represents an output file, containing multiple assets. Bundles can have
 * child bundles, which are bundles that are loaded dynamically from this bundle.
 * Child bundles are also produced when importing an asset of a different type from
 * the bundle, e.g. importing a CSS file from JS.
 */
export default class Bundle {
    type: string | null;
    name: string;
    parentBundle: Bundle;
    entryAsset: Asset<unknown, unknown> | null;
    assets: Set<Asset<unknown, unknown>>;
    childBundles: Set<Bundle>;
    siblingBundles: Set<Bundle>;
    siblingBundlesMap: Map<string, Bundle>;
    offsets: Map<Asset<unknown, unknown>, number>;
    totalSize: number;
    bundleTime: number;
    isolated: boolean | undefined;

    constructor(type: string | null, name: string, parent: Bundle, options: BundleOptions = {}) {
        this.type = type;
        this.name = name;
        this.parentBundle = parent;
        this.entryAsset = null;
        this.assets = new Set();
        this.childBundles = new Set();
        this.siblingBundles = new Set();
        this.siblingBundlesMap = new Map();
        this.offsets = new Map();
        this.totalSize = 0;
        this.bundleTime = 0;
        this.isolated = options.isolated;
    }

    static createWithAsset(asset: Asset<unknown, unknown>, parentBundle: Bundle, options: BundleOptions): Bundle {
        let bundle = new Bundle(
            asset.type,
            Path.join(asset.options.outDir, asset.generateBundleName()),
            parentBundle,
            options
        );

        bundle.entryAsset = asset;
        bundle.addAsset(asset);
        return bundle;
    }

    addAsset(asset: Asset<unknown, unknown>): void {
        asset.bundles.add(this);
        this.assets.add(asset);
    }

    removeAsset(asset: Asset<unknown, unknown>): void {
        asset.bundles.delete(this);
        this.assets.delete(asset);
    }

    addOffset(asset: Asset<unknown, unknown>, line: number): void {
        this.offsets.set(asset, line);
    }

    getOffset(asset: Asset<unknown, unknown>): number {
        return this.offsets.get(asset) || 0;
    }

    getSiblingBundle(type: string | null): Bundle {
        if (!type || type === this.type) {
            return this;
        }

        if (!this.siblingBundlesMap.has(type)) {
            let bundle = new Bundle(
                type,
                Path.join(
                    Path.dirname(this.name),
                    Path.basename(this.name, Path.extname(this.name)) + '.' + type
                ),
                this
            );

            this.childBundles.add(bundle);
            this.siblingBundles.add(bundle);
            this.siblingBundlesMap.set(type, bundle);
        }

        return this.siblingBundlesMap.get(type)!;
    }

    createChildBundle(entryAsset: Asset<unknown, unknown>, options: BundleOptions = {}): Bundle {
        let bundle = Bundle.createWithAsset(entryAsset, this, options);
        this.childBundles.add(bundle);
        return bundle;
    }

    createSiblingBundle(entryAsset: Asset<unknown, unknown>, options: BundleOptions = {}): Bundle {
        let bundle = this.createChildBundle(entryAsset, options);
        this.siblingBundles.add(bundle);
        return bundle;
    }

    get isEmpty(): boolean {
        return this.assets.size === 0;
    }

    getBundleNameMap(contentHash: boolean, hashes: Map<string, string> = new Map()): Map<string, string> {
        if (this.name) {
            let hashedName = this.getHashedBundleName(contentHash);
            hashes.set(Path.basename(this.name), hashedName);
            this.name = Path.join(Path.dirname(this.name), hashedName);
        }

        for (let child of this.childBundles.values()) {
            child.getBundleNameMap(contentHash, hashes);
        }

        return hashes;
    }

    getHashedBundleName(contentHash: boolean): string {
        // If content hashing is enabled, generate a hash from all assets in the bundle.
        // Otherwise, use a hash of the filename so it remains consistent across builds.
        let ext = Path.extname(this.name);
        let hash = (contentHash
            ? this.getHash()
            : Path.basename(this.name, ext)
        ).slice(-8);
        let entryAsset = this.entryAsset || this.parentBundle.entryAsset!;
        let name = Path.basename(entryAsset.name, Path.extname(entryAsset.name));
        let isMainEntry = entryAsset.options.entryFiles[0] === entryAsset.name;
        let isEntry =
            entryAsset.options.entryFiles.includes(entryAsset.name) ||
            Array.from(entryAsset.parentDeps).some(dep => dep.entry);

        // If this is the main entry file, use the output file option as the name if provided.
        if (isMainEntry && entryAsset.options.outFile) {
            let extname = Path.extname(entryAsset.options.outFile);
            if (extname) {
                ext = this.entryAsset ? extname : ext;
                name = Path.basename(entryAsset.options.outFile, extname);
            } else {
                name = entryAsset.options.outFile;
            }
        }

        // If this is an entry asset, don't hash. Return a relative path
        // from the main file so we keep the original file paths.
        if (isEntry) {
            return Path.join(
                Path.relative(
                    entryAsset.options.rootDir,
                    Path.dirname(entryAsset.name)
                ),
                name + ext
            ).replace(/\.\.(\/|\\)/g, '__$1');
        }

        // If this is an index file, use the parent directory name instead
        // which is probably more descriptive.
        if (name === 'index') {
            name = Path.basename(Path.dirname(entryAsset.name));
        }

        // Add the content hash and extension.
        return name + '.' + hash + ext;
    }

    async package(bundler: Bundler, oldHashes: Map<string, string>, newHashes: Map<string, string> = new Map()): Promise<Map<string, string>> {
        let promises: Array<Promise<unknown>> = [];
        let mappings = [];

        if (!this.isEmpty) {
            let hash = this.getHash();
            newHashes.set(this.name, hash);

            if (!oldHashes || oldHashes.get(this.name) !== hash) {
                promises.push(this._package(bundler));
            }
        }

        for (let bundle of this.childBundles.values()) {
            if (bundle.type === 'map') {
                mappings.push(bundle);
            } else {
                promises.push(bundle.package(bundler, oldHashes, newHashes));
            }
        }

        await Promise.all(promises);
        for (let bundle of mappings) {
            await bundle.package(bundler, oldHashes, newHashes);
        }
        return newHashes;
    }

    async _package(bundler: Bundler): Promise<void> {
        let Packager = bundler.packagers.get(this.type);
        let packager = new Packager(this, bundler);

        let startTime = Date.now();
        await packager.setup();
        await packager.start();

        let included = new Set();
        for (let asset of this.assets) {
            await this._addDeps(asset, packager, included);
        }

        await packager.end();

        this.totalSize = packager.getSize();

        let assetArray = Array.from(this.assets);
        let assetStartTime =
            this.type === 'map'
                ? 0
                : assetArray.sort((a, b) => a.startTime - b.startTime)[0].startTime;
        let assetEndTime =
            this.type === 'map'
                ? 0
                : assetArray.sort((a, b) => b.endTime - a.endTime)[0].endTime;
        let packagingTime = Date.now() - startTime;
        this.bundleTime = assetEndTime - assetStartTime + packagingTime;
    }

    async _addDeps(asset: Asset<unknown, unknown>, packager: Packager, included: Set<Asset<unknown, unknown>>): Promise<void> {
        if (!this.assets.has(asset) || included.has(asset)) {
            return;
        }

        included.add(asset);

        for (let depAsset of asset.depAssets.values()) {
            await this._addDeps(depAsset, packager, included);
        }

        await packager.addAsset(asset);

        const assetSize = packager.getSize() - this.totalSize;
        if (assetSize > 0) {
            this.addAssetSize(asset, assetSize);
        }
    }

    addAssetSize(asset: Asset<unknown, unknown>, size: number): void {
        asset.bundledSize = size;
        this.totalSize += size;
    }

    getParents(): Bundle[] {
        let parents = [];
        let bundle: Bundle = this;

        while (bundle) {
            parents.push(bundle);
            bundle = bundle.parentBundle;
        }

        return parents;
    }

    findCommonAncestor(bundle: Bundle): Bundle | undefined {
        // Get a list of parent bundles going up to the root
        let ourParents = this.getParents();
        let theirParents = bundle.getParents();

        // Start from the root bundle, and find the first bundle that's different
        let a = ourParents.pop();
        let b = theirParents.pop();
        let last;
        while (a === b && ourParents.length > 0 && theirParents.length > 0) {
            last = a;
            a = ourParents.pop();
            b = theirParents.pop();
        }

        if (a === b) {
            // One bundle descended from the other
            return a;
        }

        return last;
    }

    getHash(): string {
        let hash = crypto.createHash('md5');
        for (let asset of this.assets) {
            hash.update(asset.hash!);
        }

        return hash.digest('hex');
    }
}
