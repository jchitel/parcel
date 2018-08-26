export interface ParcelError extends Error {
    fileName?: string;
    loc?: { line: number, column: number };
    codeFrame?: string;
    highlightedCodeFrame?: string;
    stack?: string;
}

export interface PrettyErrorOptions {
    color?: boolean;
}

export interface PrettyError {
    message: string;
    stack?: string;
}

export default function(err: string | ParcelError, opts: PrettyErrorOptions = {}): PrettyError {
    let message = typeof err === 'string' ? err : err.message;
    if (!message) {
        message = 'Unknown error';
    }
    const errObj = err as ParcelError;

    if (errObj.fileName) {
        let fileName = errObj.fileName;
        if (errObj.loc) {
            fileName += `:${errObj.loc.line}:${errObj.loc.column}`;
        }

        message = `${fileName}: ${message}`;
    }

    let stack: string | undefined = undefined;
    if (errObj.codeFrame) {
        stack = (opts.color && errObj.highlightedCodeFrame) || errObj.codeFrame;
    } else if (errObj.stack) {
        stack = errObj.stack.slice(errObj.stack.indexOf('\n') + 1);
    }

    return { message, stack };
};
