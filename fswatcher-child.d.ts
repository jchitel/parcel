declare module 'fswatcher-child' {
    import { EventEmitter } from 'events';

    export interface FSWatcherOptions {
        useFsEvents?: boolean;
        ignoreInitial?: boolean;
        ignorePermissionErrors?: boolean;
        ignored?: RegExp;
    }

    export default class FSWatcher extends EventEmitter {
        constructor(options?: FSWatcherOptions);
        _closePath(dir: string): void;
        add(dir: string): void;
        unwatch(dir: string): void;
        close(): void;
    }
}