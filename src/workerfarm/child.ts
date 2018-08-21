import * as errorUtils from './errorUtils';
import { MasterMessage, WorkerErrorResponse, WorkerResponse, WorkerOperations, WorkerMessage, WorkerRequest, WorkerOperationReturnValue, MasterResponse, MasterOperationName, MasterRequest, MasterErrorResponse, MasterCall } from './ipcTypes';

type IChild = Child;
export { IChild as Child };

class Child {
    module: {
        run: WorkerOperations['run'],
        init: WorkerOperations['init']
    } | undefined;
    childId: number | undefined;
    callQueue: Array<MasterRequest>;
    responseQueue: Map<number, MasterRequest>;
    responseId: number;
    maxConcurrentCalls: number;

    constructor() {
        if (!process.send) {
            throw new Error('Only create Child instances in a worker!');
        }

        this.module = undefined;
        this.childId = undefined;

        this.callQueue = [];
        this.responseQueue = new Map();
        this.responseId = 0;
        this.maxConcurrentCalls = 10;
    }

    messageListener(data: 'die' | WorkerMessage) {
        if (data === 'die') {
            return this.end();
        }

        if (data.type === 'response') {
            return this.handleResponse(data);
        } else if (data.type === 'request') {
            return this.handleRequest(data);
        }
    }

    async send(data: MasterMessage) {
        process.send!(data, (err: any) => {
            if (err && err instanceof Error) {
                if ((err as any).code === 'ERR_IPC_CHANNEL_CLOSED') {
                    // IPC connection closed
                    // no need to keep the worker running if it can't send or receive data
                    return this.end();
                }
            }
        });
    }

    childInit(module: string, childId: number) {
        this.module = require(module);
        this.childId = childId;
    }

    async handleRequest(data: WorkerRequest) {
        let idx = data.idx;
        let child = data.child;

        try {
            const success = { idx, child, type: 'response', contentType: 'data' } as WorkerResponse;
            if (this.isChildInitRequest(data)) {
                success.content = this.childInit(data.args[0], child);
            } else {
                // This SHOULD work if typescript wasn't such a little bitch.
                // Here are the problems:
                // - even though the type of data is supposed to be narrowed by the call to isChildInitRequest, it's not here for some reason...
                // - the type of the method is a union of functions, which is not callable even if the argument type matches the type of the arguments...
                const _data = data as WorkerRequest<'run' | 'init'>;
                const method = this.module![_data.method] as (...args: any[]) => WorkerOperationReturnValue<'run' | 'init'>;
                success.content = await method(...args);
            }
            this.send(success);
        } catch (e) {
            const error: WorkerErrorResponse = { idx, child, type: 'response', contentType: 'error', content: errorUtils.errorToJson(e)! };
            this.send(error);
        }
    }

    private isChildInitRequest(request: WorkerRequest): request is WorkerRequest<'childInit'> {
        return request.method === 'childInit';
    }

    async handleResponse(data: MasterResponse | MasterErrorResponse) {
        let idx = data.idx;
        let call = this.responseQueue.get(idx)!;

        if (data.contentType === 'error') {
            call.reject!(errorUtils.jsonToError(data.content));
        } else {
            call.resolve!(data.content);
        }

        this.responseQueue.delete(idx);

        // Process the next call
        this.processQueue();
    }

    // Keep in mind to make sure responses to these calls are JSON.Stringify safe
    async addCall<N extends MasterOperationName>(request: MasterCall<N>, awaitResponse: boolean = true) {
        let call = request as MasterRequest<N>;
        call.type = 'request';
        call.child = this.childId!;
        call.awaitResponse = awaitResponse;

        let promise;
        if (awaitResponse) {
            promise = new Promise((resolve, reject) => {
                call.resolve = resolve;
                call.reject = reject;
            });
        }

        this.callQueue.push(call);
        this.processQueue();

        return promise;
    }

    async sendRequest<N extends MasterOperationName>(call: MasterRequest<N>) {
        let idx;
        if (call.awaitResponse) {
            idx = this.responseId++;
            this.responseQueue.set(idx, call);
        }
        this.send({
            idx: idx,
            child: call.child,
            type: call.type,
            location: call.location,
            method: call.method,
            args: call.args,
            awaitResponse: call.awaitResponse
        } as MasterRequest<N>);
    }

    async processQueue() {
        if (!this.callQueue.length) {
            return;
        }

        if (this.responseQueue.size < this.maxConcurrentCalls) {
            this.sendRequest(this.callQueue.shift()!);
        }
    }

    end() {
        process.exit();
    }
}

let child = new Child();
process.on('message', child.messageListener.bind(child));
export default child;
