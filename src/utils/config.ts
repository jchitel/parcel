import * as fs from './fs';
import path from 'path';
import clone from 'clone';
import { parse as parseJson } from 'json5';
import { parse as parseToml } from 'toml';

const PARSERS: { [ext: string]: (text: string) => any } = {
    json: parseJson,
    toml: parseToml
};

const existsCache = new Map();

export async function resolve(filepath: string, filenames: string[], root: string = path.parse(filepath).root): Promise<string | null> {
    filepath = path.dirname(filepath);

    // Don't traverse above the module root
    if (filepath === root || path.basename(filepath) === 'node_modules') {
        return null;
    }

    for (const filename of filenames) {
        let file = path.join(filepath, filename);
        let exists = existsCache.has(file)
            ? existsCache.get(file)
            : await fs.exists(file);
        if (exists) {
            existsCache.set(file, true);
            return file;
        }
    }

    return resolve(filepath, filenames, root);
}

export async function load(filepath: string, filenames: string[], root: string = path.parse(filepath).root): Promise<any> {
    let configFile = await resolve(filepath, filenames, root);
    if (configFile) {
        try {
            let extname = path.extname(configFile).slice(1);
            if (extname === 'js') {
                return clone(require(configFile));
            }

            let configContent = (await fs.readFile(configFile)).toString();
            let parse = PARSERS[extname] || PARSERS.json;
            return configContent ? parse(configContent) : null;
        } catch (err) {
            if (err.code === 'MODULE_NOT_FOUND' || err.code === 'ENOENT') {
                existsCache.delete(configFile);
                return null;
            }

            throw err;
        }
    }

    return null;
}
