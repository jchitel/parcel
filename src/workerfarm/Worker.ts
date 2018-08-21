import childProcess from 'child_process';
import { EventEmitter } from 'events';
import * as errorUtils from './errorUtils';
import { WorkerCall, WorkerResponse, WorkerErrorResponse, WorkerOperationName, WorkerMessage, MasterMessage, MasterRequest } from './ipcTypes';
import { WorkerProcessOptions } from '../worker';

const childModule =
    parseInt(process.versions.node, 10) < 8
        ? require.resolve('../../lib/workerfarm/child')
        : require.resolve('../../src/workerfarm/child');

let WORKER_ID = 0;

/**
 * Configuration options for a Worker instance
 */
export interface WorkerOptions {
    /** Number of ms to wait before forcing the child process to kill */
    forcedKillTime: number;
}

/**
 * Controls a single worker process in the worker farm.
 * This class is responsible for all IPC between the main process
 * and its corresponding worker process.
 */
export default class Worker extends EventEmitter {
    /** Configuration options for this instance */
    options: WorkerOptions;
    /** Globally unique worker id */
    id: number;
    /** Queue to hold onto requests when the IPC channel is being throttled */
    sendQueue: Array<WorkerMessage>;
    /** Flag to indicate whether requests should be queued or sent directly to the child process */
    processQueue: boolean;
    /** Stores calls while they are waiting for a response */
    calls: Map<number, WorkerCall> | null;
    /** When the child process exits, its exit code is placed here */
    exitCode: number | null;
    /** Internal incrementing identifier for calls to match responses with their corresponding requests */
    callId: number;
    /** Flag indicating whether the child process is ready to perform work */
    ready: boolean;
    /** Flag indicating whether the child process is dead and can't receive any more calls */
    stopped: boolean;
    /** Flag indicating whether the child process is in the process of stopping (never set to true, probably a bug) */
    isStopping: boolean;
    /** Reference to the node ChildProcess instance for IPC and process control */
    child?: childProcess.ChildProcess;

    constructor(options: WorkerOptions) {
        super();

        this.options = options;
        this.id = WORKER_ID++;

        this.sendQueue = [];
        this.processQueue = true;

        this.calls = new Map();
        this.exitCode = null;
        this.callId = 0;

        this.ready = false;
        this.stopped = false;
        this.isStopping = false;
    }

    emit(event: 'request', request: MasterRequest): boolean;
    emit(event: 'response', response: WorkerResponse | WorkerErrorResponse): boolean;
    emit(event: 'ready'): boolean;
    emit(event: 'exit', code: number): boolean;
    emit(event: 'error', err: Error): boolean;
    emit(event: string, ...args: any[]): boolean {
        return super.emit(event, ...args);
    }

    on(event: 'request', listener: (request: MasterRequest) => void): this;
    on(event: 'response', listener: (response: WorkerResponse | WorkerErrorResponse) => void): this;
    on(event: 'ready', listener: () => void): this;
    on(event: 'exit', listener: (code: number) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    once(event: 'request', listener: (request: MasterRequest) => void): this;
    once(event: 'response', listener: (response: WorkerResponse | WorkerErrorResponse) => void): this;
    once(event: 'ready', listener: () => void): this;
    once(event: 'exit', listener: (code: number) => void): this;
    once(event: 'error', listener: (err: Error) => void): this;
    once(event: string, listener: (...args: any[]) => void): this {
        return super.once(event, listener);
    }

    /**
     * Creates and bootstraps the child process, calling 'childInit' and then 'init'.
     * @param forkModule The path of the module containing the worker operations ('init' and 'run') to be invoked by the child process
     * @param bundlerOptions Options to pass to the child process to initialize the work
     */
    async fork(forkModule: string, bundlerOptions: WorkerProcessOptions): Promise<void> {
        let filteredArgs = process.execArgv.filter(
            v => !/^--(debug|inspect)/.test(v)
        );

        let options = {
            execArgv: filteredArgs,
            env: process.env,
            cwd: process.cwd()
        };

        this.child = childProcess.fork(childModule, process.argv, options);

        this.child.on('message', this.receive.bind(this));

        this.child.once('exit', code => {
            this.exitCode = code;
            this.emit('exit', code);
        });

        this.child.on('error', err => {
            this.emit('error', err);
        });

        await new Promise<void>((resolve, reject) => {
            this.call({
                method: 'childInit',
                args: [forkModule],
                retries: 0,
                resolve,
                reject
            });
        });

        await this.init(bundlerOptions);
    }

    /**
     * Initializes the child worker
     * @param bundlerOptions set of configuration options passed to the worker
     */
    async init(bundlerOptions?: WorkerProcessOptions): Promise<void> {
        this.ready = false;

        return new Promise<void>((resolve, reject) => {
            this.call({
                method: 'init',
                args: [bundlerOptions],
                retries: 0,
                resolve: () => {
                    this.ready = true;
                    this.emit('ready');
                    resolve();
                },
                reject
            });
        });
    }

    /**
     * Internal method that sends a request to 
     * @param data 
     */
    send(data: WorkerMessage): void {
        if (!this.processQueue) {
            this.sendQueue.push(data);
            return;
        }

        let result = this.child!.send(data, error => {
            if (error && error instanceof Error) {
                // Ignore this, the workerfarm handles child errors
                return;
            }

            this.processQueue = true;

            if (this.sendQueue.length > 0) {
                let queueCopy = this.sendQueue.slice(0);
                this.sendQueue = [];
                queueCopy.forEach(entry => this.send(entry));
            }
        });

        if (!result || /^win/.test(process.platform)) {
            // Queue is handling too much messages throttle it
            this.processQueue = false;
        }
    }

    call<N extends WorkerOperationName>(call: WorkerCall<N>) {
        if (this.stopped || this.isStopping) {
            return;
        }

        let idx = this.callId++;
        this.calls!.set(idx, call as WorkerCall<any>); // this is unfortunately required because M can't be cast to WorkerRequestMethods for some reason

        this.send({
            type: 'request',
            idx: idx,
            child: this.id,
            method: call.method,
            args: call.args
        });
    }

    receive(data: MasterMessage): void {
        if (this.stopped || this.isStopping) {
            return;
        }

        let idx = data.idx;

        if (data.type === 'request') {
            this.emit('request', data);
        } else if (data.type === 'response') {
            let call = this.calls!.get(idx!);
            if (!call) {
                // Return for unknown calls, these might accur if a third party process uses workers
                return;
            }

            if (data.contentType === 'error') {
                call.reject(errorUtils.jsonToError(data.content));
            } else {
                call.resolve(data.content);
            }

            this.calls!.delete(idx!);
            this.emit('response', data);
        }
    }

    async stop(): Promise<void> {
        if (!this.stopped) {
            this.stopped = true;

            if (this.child) {
                this.child.send('die');

                let forceKill = setTimeout(
                    () => this.child!.kill('SIGINT'),
                    this.options.forcedKillTime
                );
                await new Promise(resolve => {
                    this.child!.once('exit', resolve);
                });

                clearTimeout(forceKill);
            }
        }
    }
}

module.exports = Worker;
