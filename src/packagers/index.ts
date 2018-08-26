import JSConcatPackager from './JSConcatPackager';
import JSPackager from './JSPackager';
import CSSPackager from './CSSPackager';
import HTMLPackager from './HTMLPackager';
import SourceMapPackager from './SourceMapPackager';
import RawPackager from './RawPackager';
import Packager from './Packager';
import Bundle from '../Bundle';
import Bundler from '../Bundler';


export interface PackagerRegistryOptions {
    scopeHoist?: boolean;
}

export type PackagerClass = { new(bundle: Bundle, bundler: Bundler): Packager };

export default class PackagerRegistry {
    packagers: Map<string, PackagerClass>;

    constructor(options: PackagerRegistryOptions) {
        this.packagers = new Map();

        this.add('css', CSSPackager);
        this.add('html', HTMLPackager);
        this.add('map', SourceMapPackager);
        this.add('js', options.scopeHoist ? JSConcatPackager : JSPackager);
    }

    add(type: string, packager: string | PackagerClass): void {
        if (typeof packager === 'string') {
            packager = require(packager) as PackagerClass;
        }

        this.packagers.set(type, packager);
    }

    has(type: string): boolean {
        return this.packagers.has(type);
    }

    get(type: string): PackagerClass {
        return this.packagers.get(type) || RawPackager;
    }
}
