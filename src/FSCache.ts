import * as fs from './utils/fs';
import path from 'path';
import md5 from './utils/md5';
import objectHash from './utils/objectHash';
const pkg = require('../package.json');
import logger from './Logger';
import glob from 'fast-glob';
import isGlob from 'is-glob';

// These keys can affect the output, so if they differ, the cache should not match
const OPTION_KEYS: Array<keyof FSCacheOptions> = ['publicURL', 'minify', 'hmr', 'target', 'scopeHoist'];

export interface FSCacheOptions {
    cacheDir?: string;
    publicURL?: string;
    minify?: boolean;
    hmr?: boolean;
    target?: string;
    scopeHoist?: boolean;
}

export default class FSCache {
    dir: string;
    dirExists: boolean;
    invalidated: Set<string>;
    optionsHash: string;

    constructor(options: FSCacheOptions) {
        this.dir = path.resolve(options.cacheDir || '.cache');
        this.dirExists = false;
        this.invalidated = new Set();
        this.optionsHash = objectHash(
            OPTION_KEYS.reduce<FSCacheOptions & { version: string }>((p, k) => ((p[k] = options[k]), p), {
                version: pkg.version
            })
        );
    }

    async ensureDirExists(): Promise<void> {
        if (this.dirExists) {
            return;
        }

        await fs.mkdirp(this.dir);

        // Create sub-directories for every possible hex value
        // This speeds up large caches on many file systems since there are fewer files in a single directory.
        for (let i = 0; i < 256; i++) {
            await fs.mkdirp(path.join(this.dir, ('00' + i.toString(16)).slice(-2)));
        }

        this.dirExists = true;
    }

    getCacheFile(filename: string): string {
        let hash = md5(this.optionsHash + filename);
        return path.join(this.dir, hash.slice(0, 2), hash.slice(2) + '.json');
    }

    async getLastModified(filename: string): Promise<number> {
        if (isGlob(filename)) {
            let files = await glob(filename, {
                onlyFiles: true
            }) as string[];

            return (await Promise.all(
                files.map(file => fs.stat(file).then(({mtime}) => mtime.getTime()))
            )).reduce((a, b) => Math.max(a, b), 0);
        }
        return (await fs.stat(filename)).mtime.getTime();
    }

    async writeDepMtimes(data: none): Promise<void> {
        // Write mtimes for each dependent file that is already compiled into this asset
        for (let dep of data.dependencies) {
            if (dep.includedInParent) {
                dep.mtime = await this.getLastModified(dep.name);
            }
        }
    }

    async write(filename: string, data: none): Promise<void> {
        try {
            await this.ensureDirExists();
            await this.writeDepMtimes(data);
            await fs.writeFile(this.getCacheFile(filename), JSON.stringify(data));
            this.invalidated.delete(filename);
        } catch (err) {
            logger.error(`Error writing to cache: ${err.message}`);
        }
    }

    async checkDepMtimes(data: none): Promise<boolean> {
        // Check mtimes for files that are already compiled into this asset
        // If any of them changed, invalidate.
        for (let dep of data.dependencies) {
            if (dep.includedInParent) {
                if ((await this.getLastModified(dep.name)) > dep.mtime) {
                    return false;
                }
            }
        }

        return true;
    }

    async read(filename: string): Promise<unknown> {
        if (this.invalidated.has(filename)) {
            return null;
        }

        let cacheFile = this.getCacheFile(filename);

        try {
            let stats = await fs.stat(filename);
            let cacheStats = await fs.stat(cacheFile);

            if (stats.mtime > cacheStats.mtime) {
                return null;
            }

            let json = await fs.readFile(cacheFile) as string;
            let data = JSON.parse(json);
            if (!(await this.checkDepMtimes(data))) {
                return null;
            }

            return data;
        } catch (err) {
            return null;
        }
    }

    invalidate(filename: string): void {
        this.invalidated.add(filename);
    }

    async delete(filename: string): Promise<void> {
        try {
            await fs.unlink(this.getCacheFile(filename));
            this.invalidated.delete(filename);
        } catch (err) {
            // Fail silently
        }
    }
}
