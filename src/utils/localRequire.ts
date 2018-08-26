import { dirname } from 'path';
import promisify from '../utils/promisify';
import _resolve from 'resolve';
const resolve = promisify(_resolve) as (id: string, opts?: _resolve.AsyncOpts) => Promise<string>;
import WorkerFarm from '../workerfarm/WorkerFarm';

const cache = new Map();

export default async function localRequire<T>(name: string, path: string, triedInstall: boolean = false): Promise<T> {
    let basedir = dirname(path);
    let key = basedir + ':' + name;
    let resolved = cache.get(key);
    if (!resolved) {
        try {
            resolved = await resolve(name, {basedir}).then(([name]) => name);
        } catch (e) {
            if (e.code === 'MODULE_NOT_FOUND' && !triedInstall) {
                await WorkerFarm.callMaster({
                    location: require.resolve('./installPackage.js'),
                    args: [[name], path]
                });
                return localRequire(name, path, true);
            }
            throw e;
        }
        cache.set(key, resolved);
    }

    return require(resolved);
}
