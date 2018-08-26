import { EventEmitter } from 'events';
import os from 'os';
import * as errorUtils from './errorUtils';
import Worker from './Worker';
import { WorkerProcessOptions } from '../worker';
import { WorkerOperationName, WorkerOperationArgs, WorkerOperationReturnValue, MasterRequest, MasterResponse, MasterOperations, MasterErrorResponse, WorkerOperations, WorkerCall, MasterCall } from './ipcTypes';
import { Child } from './child';


/**
 * Configuration options for a WorkerFarm instance
 */
export interface WorkerFarmOptions {
    maxConcurrentWorkers: number;
    maxConcurrentCallsPerWorker: number;
    forcedKillTime: number;
    warmWorkers: boolean;
    useLocalWorker: boolean;
    workerPath: string;
}

let shared: WorkerFarm | null = null;
export default class WorkerFarm extends EventEmitter {
    options: WorkerFarmOptions;
    warmWorkers: number;
    workers: Map<number, Worker>;
    callQueue: Array<WorkerCall>;
    localWorker: {
        run: WorkerOperations['run'],
        init: WorkerOperations['init']
    };
    run: WorkerOperations['run'];
    ending?: boolean;
    bundlerOptions?: WorkerProcessOptions;

    constructor(options?: WorkerProcessOptions, farmOptions: Partial<WorkerFarmOptions> = {}) {
        super();
        this.options = Object.assign(
            {
                maxConcurrentWorkers: WorkerFarm.getNumWorkers(),
                maxConcurrentCallsPerWorker: WorkerFarm.getConcurrentCallsPerWorker(),
                forcedKillTime: 500,
                warmWorkers: true,
                useLocalWorker: true,
                workerPath: '../worker'
            },
            farmOptions
        );

        this.warmWorkers = 0;
        this.workers = new Map();
        this.callQueue = [];

        this.localWorker = require(this.options.workerPath);
        this.run = this.mkhandle('run');

        this.init(options);
    }

    warmupWorker(method: 'run', args: WorkerOperationArgs<'run'>): void {
        // Workers are already stopping
        if (this.ending) {
            return;
        }

        // Workers are not warmed up yet.
        // Send the job to a remote worker in the background,
        // but use the result from the local worker - it will be faster.
        args = [args[0], typeof args[1] === 'boolean' ? args[1] : true];
        let promise = this.addCall(method, args);
        if (promise) {
            promise
                .then(() => {
                    this.warmWorkers++;
                    if (this.warmWorkers >= this.workers.size) {
                        this.emit('warmedup');
                    }
                })
                .catch(() => {});
        }
    }

    shouldStartRemoteWorkers(): boolean {
        return (
            this.options.maxConcurrentWorkers > 1 ||
            process.env.NODE_ENV === 'test' ||
            !this.options.useLocalWorker
        );
    }

    mkhandle(method: 'run') {
        return function(this: WorkerFarm, ...args: WorkerOperationArgs<'run'>) {
            // run() takes one required arg and one optional arg.
            // if the optional arg isn't required, we want to default it to false.
            // we do this up here because TS doesn't like it when we do it inline.
            args = [args[0], typeof args[1] === 'boolean' ? args[1] : false];
            // Child process workers are slow to start (~600ms).
            // While we're waiting, just run on the main thread.
            // This significantly speeds up startup time.
            if (this.shouldUseRemoteWorkers()) {
                return this.addCall(method, args);
            } else {
                if (this.options.warmWorkers && this.shouldStartRemoteWorkers()) {
                    this.warmupWorker(method, args);
                }

                return this.localWorker[method](...args);
            }
        }.bind(this);
    }

    onError(error: Error, worker: Worker): Promise<void> | undefined {
        // Handle ipc errors
        if ((error as any).code === 'ERR_IPC_CHANNEL_CLOSED') {
            return this.stopWorker(worker);
        }
    }

    startChild() {
        let worker = new Worker(this.options);

        worker.fork(this.options.workerPath, this.bundlerOptions!);

        worker.on('request', data => this.processRequest(data, worker));

        worker.on('ready', () => this.processQueue());
        worker.on('response', () => this.processQueue());

        worker.on('error', err => this.onError(err, worker));
        worker.once('exit', () => this.stopWorker(worker));

        this.workers.set(worker.id, worker);
    }

    async stopWorker(worker: Worker) {
        if (!worker.stopped) {
            this.workers.delete(worker.id);

            worker.isStopping = true;

            if (worker.calls!.size) {
                for (let call of worker.calls!.values()) {
                    call.retries++;
                    this.callQueue.unshift(call);
                }
            }

            worker.calls = null;

            await worker.stop();

            // Process any requests that failed and start a new worker
            this.processQueue();
        }
    }

    async processQueue() {
        if (this.ending || !this.callQueue.length) return;

        if (this.workers.size < this.options.maxConcurrentWorkers) {
            this.startChild();
        }

        for (let worker of this.workers.values()) {
            if (!this.callQueue.length) {
                break;
            }

            if (!worker.ready || worker.stopped || worker.isStopping) {
                continue;
            }

            if (worker.calls!.size < this.options.maxConcurrentCallsPerWorker) {
                worker.call(this.callQueue.shift()!);
            }
        }
    }

    async processRequest(data: MasterRequest, worker: Worker | false = false) {
        if (!location) {
            throw new Error('Unknown request');
        }

        let result: MasterResponse | MasterErrorResponse;
        const mod = require(data.location) as MasterOperations;
        try {
           result = { idx: data.idx, type: 'response', contentType: 'data' } as MasterResponse;
            if (data.method) {
                // see ./child:Child.processRequest() for why this sucks
                result.content = await (mod[data.method] as any)(...data.args);
            } else {
                result.content = await (mod as any)(...args);
            }
        } catch (e) {
            result = { idx: data.idx, type: 'response', contentType: 'error', content: errorUtils.errorToJson(e) } as MasterErrorResponse;
        }

        if (data.awaitResponse) {
            if (worker) {
                worker.send(result);
            } else {
                return result;
            }
        }
    }

    addCall<N extends WorkerOperationName>(method: N, args: WorkerOperationArgs<N>): Promise<WorkerOperationReturnValue<N>> {
        if (this.ending) {
            throw new Error('Cannot add a worker call if workerfarm is ending.');
        }

        return new Promise<WorkerOperationReturnValue<N>>((resolve, reject) => {
            this.callQueue.push({
                method,
                args: args,
                retries: 0,
                resolve,
                reject
            } as WorkerCall<N>);
            this.processQueue();
        });
    }

    async end() {
        this.ending = true;
        await Promise.all(
            Array.from(this.workers.values()).map(worker => this.stopWorker(worker))
        );
        this.ending = false;
        shared = null;
    }

    init(bundlerOptions?: WorkerProcessOptions) {
        this.bundlerOptions = bundlerOptions;

        if (this.shouldStartRemoteWorkers()) {
            this.persistBundlerOptions();
        }

        this.localWorker.init(bundlerOptions);
        this.startMaxWorkers();
    }

    persistBundlerOptions() {
        for (let worker of this.workers.values()) {
            worker.init(this.bundlerOptions!);
        }
    }

    startMaxWorkers() {
        // Starts workers untill the maximum is reached
        if (this.workers.size < this.options.maxConcurrentWorkers) {
            for (
                let i = 0;
                i < this.options.maxConcurrentWorkers - this.workers.size;
                i++
            ) {
                this.startChild();
            }
        }
    }

    shouldUseRemoteWorkers() {
        return (
            !this.options.useLocalWorker ||
            (this.warmWorkers >= this.workers.size || !this.options.warmWorkers)
        );
    }

    static getShared(options?: WorkerProcessOptions) {
        if (!shared) {
            shared = new WorkerFarm(options);
        } else if (options) {
            shared.init(options);
        }

        if (!shared && !options) {
            throw new Error('Workerfarm should be initialised using options');
        }

        return shared;
    }

    static getNumWorkers() {
        if (process.env.PARCEL_WORKERS) {
            return parseInt(process.env.PARCEL_WORKERS, 10);
        }

        let cores;
        try {
            cores = require('physical-cpu-count');
        } catch (err) {
            cores = os.cpus().length;
        }
        return cores || 1;
    }

    static callMaster(request: MasterCall, awaitResponse: boolean = true) {
        if (WorkerFarm.isWorker()) {
            const child = require('./child') as Child;
            return child.addCall(request, awaitResponse);
        } else {
            return WorkerFarm.getShared().processRequest(request as MasterRequest);
        }
    }

    static isWorker() {
        return process.send && require.main!.filename === require.resolve('./child');
    }

    static getConcurrentCallsPerWorker() {
        return parseInt(process.env.PARCEL_MAX_CONCURRENT_CALLS!) || 5;
    }
}
