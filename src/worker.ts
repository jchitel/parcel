import 'v8-compile-cache';
import Pipeline from './Pipeline';

let pipeline: Pipeline;

/**
 * Subset of Bundler options used to initialize a worker.
 */
export interface WorkerProcessOptions {
    env?: NodeJS.ProcessEnv;
    hmrPort?: number;
    hmrHostname?: string;
}

export function init(options: WorkerProcessOptions): void {
    pipeline = new Pipeline(options || {});
    Object.assign(process.env, options.env || {});
    process.env.HMR_PORT = typeof options.hmrPort === 'number' ? options.hmrPort.toString() : options.hmrPort;
    process.env.HMR_HOSTNAME = options.hmrHostname;
}

export async function run(path: string, isWarmUp: boolean = false): none {
    try {
        return await pipeline.process(path, isWarmUp);
    } catch (e) {
        e.fileName = path;
        throw e;
    }
}
