import Asset, { AssetOptions } from '../Asset';
import glob from 'fast-glob';
import micromatch from 'micromatch';
import path from 'path';


type DeepObject = {
    [key: string]: string | DeepObject
};

type GlobGenerated = Array<{ type: string, value: string }>;

export default class GlobAsset extends Asset<DeepObject, GlobGenerated> {
    type: null;

    constructor(name: string, options: AssetOptions) {
        super(name, options);
        this.type = null; // allows this asset to be included in any type bundle
    }

    async load(): Promise<DeepObject> {
        let regularExpressionSafeName = this.name;
        if (process.platform === 'win32')
            regularExpressionSafeName = regularExpressionSafeName.replace(/\\/g, '/');

        let files = await glob(regularExpressionSafeName, {
            onlyFiles: true
        }) as string[];
        let re = micromatch.makeRe(regularExpressionSafeName, { capture: true } as any); // types are wrong?
        let matches = {};

        for (let file of files) {
            let match = file.match(re)!;
            let parts = match
                .slice(1)
                .filter(Boolean)
                .reduce((a, p) => a.concat(p.split('/')), [] as string[]);
            let relative =
                './' + path.relative(path.dirname(this.name), file.normalize('NFC'));
            set(matches, parts, relative);
            this.addDependency(relative);
        }

        return matches;
    }

    async generate(): Promise<GlobGenerated> {
        return [
            {
                type: 'js',
                value: 'module.exports = ' + generate(this.contents!) + ';'
            }
        ];
    }
}

function generate(matches: DeepObject | string, indent: string = '') {
    if (typeof matches === 'string') {
        return `require(${JSON.stringify(matches)})`;
    }

    let res = indent + '{';

    let first = true;
    for (let key in matches) {
        if (!first) {
            res += ',';
        }

        res += `\n${indent}  ${JSON.stringify(key)}: ${generate(
            matches[key],
            indent + '  '
        )}`;
        first = false;
    }

    res += '\n' + indent + '}';
    return res;
}

function set(obj: DeepObject, path: string[], value: string) {
    for (let i = 0; i < path.length - 1; i++) {
        let part = path[i];

        if (obj[part] == null) {
            obj[part] = {};
        }

        obj = obj[part] as DeepObject;
    }

    obj[path[path.length - 1]] = value;
}

