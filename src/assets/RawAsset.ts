import Asset from '../Asset';
import urlJoin from '../utils/urlJoin';
import md5 from '../utils/md5';

class RawAsset extends Asset {
    // Don't load raw assets. They will be copied by the RawPackager directly.
    async load() {}

    async generate() {
        // Don't return a URL to the JS bundle if there is a bundle loader defined for this asset type.
        // This will cause the actual asset to be automatically preloaded prior to the JS bundle running.
        if (this.options.bundleLoaders[this.type]) {
            return {};
        }

        const pathToAsset = urlJoin(
            this.options.publicURL,
            this.generateBundleName()
        );

        return [
            {
                type: 'js',
                value: `module.exports=${JSON.stringify(pathToAsset)};`
            }
        ];
    }

    async generateHash() {
        return await md5.file(this.name);
    }
}

module.exports = RawAsset;
