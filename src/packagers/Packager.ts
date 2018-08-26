import fs from 'fs';
import promisify from '../utils/promisify';
import path from 'path';
import { mkdirp } from '../utils/fs';
import Bundle from '../Bundle';
import Bundler, { BundlerOptions } from '../Bundler';
import Asset from '../Asset';
import * as t from 'babel-types';

/**
 * We need to use this instead of the standard fs.WriteStream because
 * the promisified write() and end() functions are incompatible with the existing ones.
 */
interface PromisifiedWriteStream {
    write(chunk: any): Promise<void>;
    write(chunk: any, encoding?: string | undefined): Promise<void>;
    end(): Promise<void>;
    end(chunk: any): Promise<void>;
    end(chunk: any, encoding?: string | undefined): Promise<void>;
    bytesWritten: number;
}

export default class Packager {
    bundle: Bundle;
    bundler: Bundler;
    options: BundlerOptions;
    dest!: PromisifiedWriteStream;

    constructor(bundle: Bundle, bundler: Bundler) {
        this.bundle = bundle;
        this.bundler = bundler;
        this.options = bundler.options;
    }

    static shouldAddAsset() {
        return true;
    }

    async setup() {
        // Create sub-directories if needed
        if (this.bundle.name.includes(path.sep)) {
            await mkdirp(path.dirname(this.bundle.name));
        }

        this.dest = fs.createWriteStream(this.bundle.name) as any as PromisifiedWriteStream; // unfortunately yes...
        this.dest.write = promisify(this.dest.write.bind(this.dest));
        this.dest.end = promisify(this.dest.end.bind(this.dest));
    }

    async write(string: string) {
        await this.dest.write(string);
    }

    async start() {}

    // eslint-disable-next-line no-unused-vars
    async addAsset(asset: Asset<unknown, unknown>) {
        throw new Error('Must be implemented by subclasses');
    }

    getSize() {
        return this.dest.bytesWritten;
    }

    async end() {
        await this.dest.end();
    }
}
