import fs from 'fs';


export interface IExistingFileContents {
    source: string;
    minified: string;
}

/**
 * Creates an object that contains both source and minified (using the source as a fallback).
 * e.g. builtins.min.js and builtins.js.
 */
const getExisting = (minifiedPath: string, sourcePath: string): IExistingFileContents => {
    let source = fs.readFileSync(sourcePath, 'utf8').trim();
    return {
        source,
        minified: fs.existsSync(minifiedPath)
            ? fs
                    .readFileSync(minifiedPath, 'utf8')
                    .trim()
                    .replace(/;$/, '')
            : source
    };
};
export default getExisting;
