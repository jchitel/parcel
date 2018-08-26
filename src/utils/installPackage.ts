import * as config from './config';
import promisify from './promisify';
import _resolve from 'resolve';
const resolve = promisify(_resolve) as (id: string, opts?: _resolve.AsyncOpts) => Promise<string>;
import commandExists from 'command-exists';
import logger from '../Logger';
import pipeSpawn from './pipeSpawn';
import PromiseQueue from './PromiseQueue';
import path from 'path';
import * as fs from './fs';

async function install(modules, filepath, options = {}) {
    let {installPeers = true, saveDev = true, packageManager} = options;

    logger.progress(`Installing ${modules.join(', ')}...`);

    let packageLocation = await config.resolve(filepath, ['package.json']);
    let cwd = packageLocation ? path.dirname(packageLocation) : process.cwd();

    if (!packageManager) {
        packageManager = await determinePackageManager(filepath);
    }

    let commandToUse = packageManager === 'npm' ? 'install' : 'add';
    let args = [commandToUse, ...modules];
    if (saveDev) {
        args.push('-D');
    } else if (packageManager === 'npm') {
        args.push('--save');
    }

    // npm doesn't auto-create a package.json when installing,
    // so create an empty one if needed.
    if (packageManager === 'npm' && !packageLocation) {
        await fs.writeFile(path.join(cwd, 'package.json'), '{}');
    }

    try {
        await pipeSpawn(packageManager, args, {cwd});
    } catch (err) {
        throw new Error(`Failed to install ${modules.join(', ')}.`);
    }

    if (installPeers) {
        await Promise.all(
            modules.map(m => installPeerDependencies(filepath, m, options))
        );
    }
}

async function installPeerDependencies(filepath, name, options) {
    let basedir = path.dirname(filepath);
    const [resolved] = await resolve(name, {basedir});
    const pkg = await config.load(resolved, ['package.json']);
    const peers = pkg.peerDependencies || {};

    const modules = [];
    for (const peer in peers) {
        modules.push(`${peer}@${peers[peer]}`);
    }

    if (modules.length) {
        await install(
            modules,
            filepath,
            Object.assign({}, options, {installPeers: false})
        );
    }
}

async function determinePackageManager(filepath) {
    let configFile = await config.resolve(filepath, [
        'yarn.lock',
        'package-lock.json'
    ]);
    let hasYarn = await checkForYarnCommand();

    // If Yarn isn't available, or there is a package-lock.json file, use npm.
    let configName = configFile && path.basename(configFile);
    if (!hasYarn || configName === 'package-lock.json') {
        return 'npm';
    }

    return 'yarn';
}

let hasYarn = null;
async function checkForYarnCommand() {
    if (hasYarn != null) {
        return hasYarn;
    }

    try {
        hasYarn = await commandExists('yarn');
    } catch (err) {
        hasYarn = false;
    }

    return hasYarn;
}

let queue = new PromiseQueue(install, {maxConcurrent: 1, retry: false});
module.exports = function(...args) {
    queue.add(...args);
    return queue.run();
};
