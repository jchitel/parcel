import Packager from './Packager';
import path from 'path';
import * as fs from '../utils/fs';
import Asset from '../Asset';

export default class RawPackager extends Packager {
    size!: number;

    static shouldAddAsset() {
        // We cannot combine multiple raw assets together - they should be written as separate bundles.
        return false;
    }

    // Override so we don't create a file for this bundle.
    // Each asset will be emitted as a separate file instead.
    async setup() {}

    async addAsset(asset: Asset<unknown, unknown>) {
        let contents = asset.generated[this.bundle.type];
        if (!contents || (contents && contents.path)) {
            contents = await fs.readFile(contents ? contents.path : asset.name);
        }

        // Create sub-directories if needed
        if (this.bundle.name.includes(path.sep)) {
            await fs.mkdirp(path.dirname(this.bundle.name));
        }

        this.size = contents.length;
        await fs.writeFile(this.bundle.name, contents);
    }

    getSize() {
        return this.size || 0;
    }

    async end() {}
}
