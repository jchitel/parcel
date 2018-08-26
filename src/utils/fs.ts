import promisify from './promisify';
import fs from 'fs';
import _mkdirp from 'mkdirp';

const _readFile = promisify(fs.readFile);
export async function readFile(name: string): Promise<Buffer | string>;
export async function readFile(name: string, encoding: string): Promise<Buffer | string>;
export async function readFile(...args: any[]): Promise<any> {
    return _readFile(...args);
}

const _writeFile = promisify(fs.writeFile);
export async function writeFile(path: string, data: any): Promise<void>
export async function writeFile(...args: any[]): Promise<void> {
    _writeFile(...args);
}

const _stat = promisify(fs.stat);
export async function stat(path: string): Promise<fs.Stats>;
export async function stat(...args: any[]): Promise<fs.Stats> {
    return _stat(...args);
}

const _readdir = promisify(fs.readdir);
export async function readdir(): Promise<string[]> {
    return _readdir();
}

const _unlink = promisify(fs.unlink);
export async function unlink(path: string): Promise<void>;
export async function unlink(...args: any[]): Promise<void> {
    _unlink(...args);
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
export async function mkdirp(dir: string): Promise<_mkdirp.Made>
export async function mkdirp(...args: any[]): Promise<_mkdirp.Made> {
    return __mkdirp(...args);
}
