export type PromiseQueueCallback<T, A extends any[] = []> = (job: T, ...args: A) => Promise<void>;

export interface IPromiseQueueOptions {
    maxConcurrent?: number;
    retry?: false;
}

export default class PromiseQueue<T, A extends any[] = []> {
    process: PromiseQueueCallback<T, A>;
    maxConcurrent: number;
    retry: boolean;
    queue: Array<[T, A]>;
    processing: Set<T>;
    processed: Set<T>;
    numRunning: number;
    runPromise: Promise<Set<T>> | null;
    resolve: ((processed: Set<T>) => void) | null;
    reject: ((err: any) => void) | null;

    constructor(callback: PromiseQueueCallback<T, A>, options: IPromiseQueueOptions = {}) {
        this.process = callback;
        this.maxConcurrent = options.maxConcurrent || Infinity;
        this.retry = options.retry !== false;
        this.queue = [];
        this.processing = new Set();
        this.processed = new Set();
        this.numRunning = 0;
        this.runPromise = null;
        this.resolve = null;
        this.reject = null;
    }

    add(job: T, ...args: A): void {
        if (this.processing.has(job)) {
            return;
        }

        if (this.runPromise && this.numRunning < this.maxConcurrent) {
            this._runJob(job, args);
        } else {
            this.queue.push([job, args]);
        }

        this.processing.add(job);
    }

    run(): Promise<Set<T>> {
        if (this.runPromise) {
            return this.runPromise;
        }

        const runPromise = new Promise<Set<T>>((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });

        this.runPromise = runPromise;
        this._next();

        return runPromise;
    }

    private async _runJob(job: T, args: A): Promise<void> {
        try {
            this.numRunning++;
            await this.process(job, ...args);
            this.processing.delete(job);
            this.processed.add(job);
            this.numRunning--;
            this._next();
        } catch (err) {
            this.numRunning--;
            if (this.retry) {
                this.queue.push([job, args]);
            } else {
                this.processing.delete(job);
            }

            if (this.reject) {
                this.reject(err);
            }

            this._reset();
        }
    }

    private _next(): void {
        if (!this.runPromise) {
            return;
        }

        if (this.queue.length > 0) {
            while (this.queue.length > 0 && this.numRunning < this.maxConcurrent) {
                this._runJob(...this.queue.shift()!);
            }
        } else if (this.processing.size === 0) {
            this.resolve!(this.processed);
            this._reset();
        }
    }

    private _reset(): void {
        this.processed = new Set();
        this.runPromise = null;
        this.resolve = null;
        this.reject = null;
    }
}
