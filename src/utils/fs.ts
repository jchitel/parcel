import promisify from './promisify';
import fs from 'fs';
import _mkdirp from 'mkdirp';

const _readFile = promisify(fs.readFile);
export async function readFile(name: string): Promise<Buffer>;
export async function readFile(name: string, encoding: string): Promise<Buffer>;
export async function readFile(...args: any[]): Promise<any> {
    return _readFile(...args);
}

const _writeFile = promisify(fs.writeFile);
export async function writeFile(): Promise<void> {
    _writeFile();
}

const _stat = promisify(fs.stat);
export async function stat(): Promise<fs.Stats> {
    return _stat();
}

const _readdir = promisify(fs.readdir);
export async function readdir(): Promise<string[]> {
    return _readdir();
}

const _unlink = promisify(fs.unlink);
export async function unlink(): Promise<void> {
    _unlink();
}

const _realpath = promisify(fs.realpath);
export async function realpath(path: string): Promise<string> {
    try {
        path = await _realpath(path);
    } catch (e) {
        // do nothing
    }
    return path;
};

const _lstat = promisify(fs.lstat);
export async function lstat(): Promise<fs.Stats> {
    return _lstat();
}

export async function exists(filename: string): Promise<boolean> {
    return new Promise<boolean>(resolve => {
        fs.exists(filename, resolve);
    });
};


const __mkdirp = promisify(_mkdirp);
export async function mkdirp(): Promise<_mkdirp.Made> {
    return __mkdirp();
}
