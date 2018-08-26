import path from 'path';
import Packager from './Packager';
import SourceMap from '../SourceMap';
import Asset from '../Asset';

export default class SourceMapPackager extends Packager {
    sourceMap!: SourceMap;

    async start(): Promise<void> {
        this.sourceMap = new SourceMap();
    }

    async addAsset(asset: Asset<unknown, unknown>): Promise<void> {
        await this.sourceMap.addMap(
            asset.generated.map,
            this.bundle.parentBundle.getOffset(asset)
        );
    }

    async end() {
        let file = path.basename(this.bundle.name);

        await this.write(
            this.sourceMap.stringify(
                file,
                path.relative(this.options.outDir, this.options.rootDir)
            )
        );
        await super.end();
    }
}
