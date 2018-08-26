import { WorkerProcessOptions } from '../worker';
import { ParcelError } from '../utils/prettyError';
import { LogTableColumn } from '../Logger';
import { PipelineProcessResult } from '../Pipeline';


// Explanation:
// Parcel has a really cool Worker Farm system that uses multiple processes to parallelize work.
// In order for it to be useful, it requires an IPC (Inter-Process Communication) system
// that operates on top of Node's primitive IPC system.
// The Master process has the ability to send requests to the worker process and get responses back,
// and vice versa.
// This is done using a lot of reflection-like operations, because any information passed between
// processes has to be JSON-serialized.
// In TypeScript, it is useful to restrict the types of messages that can be passed,
// which is where this module comes in.
// This module exports the set of callable operations on both the master side and the worker side.
// Each set is represented conveniently by an interface.
// The module also exports mapped types for the the argument and return types of the operations.
// It also exports the interop types used by the IPC mechanism.

type ArgsOf<T extends Function> = T extends (...args: infer A) => any ? A : never;
type ReturnTypeOf<T extends Function> = T extends (...args: any[]) => infer R ? R : never;

// #region Worker operations

/**
 * Operations available on the worker process.
 */
export interface WorkerOperations {
    /**
     * Initializes the Worker instance in the worker process (see Child.childInit())
     */
    childInit: (module: string) => void;
    /**
     * Initializes the worker in the worker process (see init() in ../worker)
     */
    init: (options?: WorkerProcessOptions) => void;
    /**
     * Starts the work assigned to the worker in the worker process (see run() in ../worker)
     */
    run: (path: string, isWarmUp?: boolean) => PipelineProcessResult;
}

/**
 * Names of available worker process operations.
 */
export type WorkerOperationName = keyof WorkerOperations;

/**
 * Arguments type corresponding to a specific worker operation.
 */
export type WorkerOperationArgs<N extends WorkerOperationName> = ArgsOf<WorkerOperations[N]>;

/**
 * Return type corresponding to a specific worker operation.
 */
export type WorkerOperationReturnValue<N extends WorkerOperationName> = ReturnTypeOf<WorkerOperations[N]>;

// #endregion

// #region Master operations

/**
 * Operations available on the master process.
 * As of now, these are just the Logger operations.
 * When a worker process calls the logger, it actually calls into
 * a proxy that forwards the call to the master process.
 */
export interface MasterOperations {
    countLines(message: string): number;
    writeRaw(message: string): void;
    write(message: string, persistent?: boolean): void;
    log(message: string): void;
    persistent(message: string): void;
    warn(err: string | ParcelError): void;
    error(err: string | ParcelError): void;
    success(message: string): void;
    clear(): void;
    progress(message: string): void;
    stopSpinner(): void;
    table(columns: Array<LogTableColumn>, table: string[][]): void;
    installPackage()
}

/**
 * Names of available master process operations.
 */
export type MasterOperationName = keyof MasterOperations;

/**
 * Arguments type corresponding to a specific master operation.
 */
export type MasterOperationArgs<N extends MasterOperationName> = ArgsOf<MasterOperations[N]>;

/**
 * Return type corresponding to a specific master operation.
 */
export type MasterOperationReturnValue<N extends MasterOperationName> = ReturnTypeOf<MasterOperations[N]>;

// #endregion

// #region IPC types

/**
 * A call to an operation in the worker process.
 * This type is used in calls to Worker.call().
 */
export interface WorkerCall<N extends WorkerOperationName = WorkerOperationName> {
    method: N;
    args: WorkerOperationArgs<N>;
    retries: number;
    resolve: (result: WorkerOperationReturnValue<N>) => void;
    reject: (err: any) => void;
}

/**
 * A call to an operation in the master process.
 * This type is used in calls to WorkerFarm.callMaster() (isomorphic) and Child.addCall() (only in worker process).
 * It's weird because this type is apparently interchangeable with MasterRequest:
 * calling WorkerFarm.callMaster() on the master process will call WorkerFarm.processRequest(), which expects a MasterRequest.
 */
export interface MasterCall<N extends MasterOperationName = MasterOperationName> {
    method?: N;
    args: MasterOperationArgs<N>;
    /** The full path of the module containing the implementation of the method */
    location: string;
}

/**
 * Request object to be sent to the worker process via IPC.
 * The 'type' property is a discriminant to differentiate it from a response object.
 * This is used in calls to Child.handleRequest().
 */
export interface WorkerRequest<N extends WorkerOperationName = WorkerOperationName> {
    type: 'request';
    idx: number;
    child: number;
    method: N;
    args: WorkerOperationArgs<N>;
}

/**
 * Request object to be sent to the master process via IPC.
 * This is used in calls to WorkerFarm.processRequest().
 * This is slightly misleading because even though this is what is sent over the wire,
 * it is also what holds the resolve/reject functions on the worker side.
 * The types of Call/Request objects are not particularly well-defined.
 */
export interface MasterRequest<N extends MasterOperationName = MasterOperationName> {
    type: 'request';
    idx: number;
    child: number;
    method: N;
    args: MasterOperationArgs<N>;
    /** The full path of the module containing the implementation of the method */
    location: string;
    awaitResponse?: boolean;
    resolve: (result: MasterOperationReturnValue<N>) => void;
    reject: (err: any) => void;
}

/**
 * Response object to be sent from the worker process via IPC.
 * The 'type' property is a discriminant to differentiate
 * it from a request object.
 * This specific type is for successful responses (contentType = 'data').
 */
export interface WorkerResponse<N extends WorkerOperationName = WorkerOperationName> {
    type: 'response';
    idx: number;
    child: number;
    contentType: 'data';
    content: WorkerOperationReturnValue<N>;
}

export interface MasterResponse<N extends MasterOperationName = MasterOperationName> {
    type: 'response';
    idx: number;
    contentType: 'data';
    content: MasterOperationReturnValue<N>;
}

/**
 * Corresponding response type for error responses (contentType = 'error').
 */
export interface WorkerErrorResponse {
    type: 'response';
    idx: number;
    child: number;
    contentType: 'error';
    content: Error;
}

/**
 * Corresponding response type for error responses (contentType = 'error').
 */
export interface MasterErrorResponse {
    type: 'response';
    idx: number;
    contentType: 'error';
    content: Error;
}

/**
 * Union type for any message that can be sent to the worker process (worker requests and master responses).
 */
export type WorkerMessage = WorkerRequest | MasterResponse | MasterErrorResponse;

/**
 * Union type for an message that can be sent to the master process (master requests and worker responses).
 */
export type MasterMessage = MasterRequest | WorkerResponse | WorkerErrorResponse;

// #endregion
