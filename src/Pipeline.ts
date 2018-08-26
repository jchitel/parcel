import Parser from './Parser';
import path from 'path';
import md5 from './utils/md5';
import Asset, { AssetGeneration } from './Asset';


export interface PipelineProcessResult {
    id: string | null;
    dependencies: none[];
    generated: { [type: string]: string };
    hash: string | Buffer | null;
    cacheData: none;
}

export interface PipelineOptions {
    rootDir?: string;
    scopeHoist?: boolean;
    extensions?: { [ext: string]: string };
}

/**
 * A Pipeline composes multiple Asset types together.
 */
export default class Pipeline {
    options: PipelineOptions;
    parser: Parser;

    constructor(options: PipelineOptions) {
        this.options = options;
        this.parser = new Parser(options);
    }

    async process(path: string, isWarmUp: boolean): Promise<PipelineProcessResult> {
        let options = this.options;
        if (isWarmUp) {
            options = Object.assign({ isWarmUp }, options);
        }

        let asset = this.parser.getAsset(path, options);
        let generated = await this.processAsset(asset);
        let generatedMap: PipelineProcessResult['generated'] = {};
        for (let rendition of generated) {
            generatedMap[rendition.type] = rendition.value;
        }

        return {
            id: asset.id,
            dependencies: Array.from(asset.dependencies.values()),
            generated: generatedMap,
            hash: asset.hash,
            cacheData: asset.cacheData
        };
    }

    async processAsset(asset: Asset<unknown, unknown>) {
        try {
            await asset.process();
        } catch (err) {
            throw asset.generateErrorMessage(err);
        }

        let inputType = path.extname(asset.name).slice(1);
        let generated = [];

        for (let rendition of this.iterateRenditions(asset)) {
            let {type, value} = rendition;
            if (typeof value !== 'string' || rendition.final) {
                generated.push(rendition);
                continue;
            }

            // Find an asset type for the rendition type.
            // If the asset is not already an instance of this asset type, process it.
            let AssetType = this.parser.findParser(
                asset.name.slice(0, -inputType.length) + type,
                true
            );
            if (!(asset instanceof AssetType)) {
                let opts = Object.assign({}, asset.options, {rendition});
                let subAsset = new AssetType(asset.name, opts);
                subAsset.id = asset.id;
                subAsset.contents = value;
                subAsset.dependencies = asset.dependencies;
                subAsset.cacheData = Object.assign(asset.cacheData, subAsset.cacheData);

                let processed = await this.processAsset(subAsset);
                if (rendition.meta) {
                    for (let res of processed) {
                        res.meta = rendition.meta;
                    }
                }

                generated = generated.concat(processed);
                asset.hash = md5(asset.hash + subAsset.hash);
            } else {
                generated.push(rendition);
            }
        }

        // Post process. This allows assets a chance to modify the output produced by sub-asset types.
        asset.generated = generated;
        try {
            generated = await asset.postProcess(generated);
        } catch (err) {
            throw asset.generateErrorMessage(err);
        }

        return generated;
    }

    *iterateRenditions(asset: Asset<unknown, unknown>): Iterator<AssetGeneration> {
        if (Array.isArray(asset.generated)) {
            return yield* asset.generated;
        }

        if (typeof asset.generated === 'string') {
            return yield {
                type: asset.type!,
                value: asset.generated
            };
        }

        // Backward compatibility support for the old API.
        // Assume all renditions are final - don't compose asset types together.
        for (let type in asset.generated as Record<string, string>) {
            yield {
                type,
                value: (asset.generated as Record<string, string>)[type],
                // for scope hoisting, we need to post process all JS
                final: !(type === 'js' && this.options.scopeHoist)
            };
        }
    }
}
