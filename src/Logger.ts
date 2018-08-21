import chalk, { Chalk } from 'chalk';
import readline from 'readline';
import prettyError, { ParcelError } from './utils/prettyError';
import * as emoji from './utils/emoji';
import { countBreaks } from 'grapheme-breaker';
import stripAnsi from 'strip-ansi';
import ora from 'ora';
import WorkerFarm from './workerfarm/WorkerFarm';
import { MasterOperationName, MasterOperationArgs, MasterOperations, MasterOperationReturnValue } from './workerfarm/ipcTypes';


/**
 * So, the actual class type of 'ora' is not actually exported...
 */
type Ora = (typeof ora) extends (...args: any[]) => infer R ? R : never;

export enum LogLevel {
    None = 0,
    Errors = 1,
    Warnings = 2,
    All = 3
}

export interface LoggerOptions {
    logLevel?: LogLevel;
    color?: boolean;
    isTest?: boolean;
}

class Logger {
    lines: number;
    spinner: Ora | null;
    logLevel!: LogLevel;
    color!: boolean;
    chalk!: Chalk;
    isTest!: boolean;

    constructor(options?: LoggerOptions) {
        this.lines = 0;
        this.spinner = null;
        this.setOptions(options);
    }

    setOptions(options?: LoggerOptions): void {
        this.logLevel =
            options && isNaN(options.logLevel!) === false
                ? Number(options.logLevel)
                : 3;
        this.color =
            options && typeof options.color === 'boolean'
                ? options.color
                : !!chalk.supportsColor;
        this.chalk = new chalk.constructor({enabled: this.color});
        this.isTest =
            options && typeof options.isTest === 'boolean'
                ? options.isTest
                : process.env.NODE_ENV === 'test';
    }

    countLines(message: string): number {
        return stripAnsi(message)
            .split('\n')
            .reduce((p, line) => {
                if (process.stdout.columns) {
                    return p + Math.ceil((line.length || 1) / process.stdout.columns);
                }

                return p + 1;
            }, 0);
    }

    writeRaw(message: string) {
        this.stopSpinner();

        this.lines += this.countLines(message) - 1;
        process.stdout.write(message);
    }

    write(message: string, persistent = false) {
        if (!persistent) {
            this.lines += this.countLines(message);
        }

        this.stopSpinner();
        this._log(message);
    }

    log(message: string) {
        if (this.logLevel < 3) {
            return;
        }

        this.write(message);
    }

    persistent(message: string) {
        if (this.logLevel < 3) {
            return;
        }

        this.write(this.chalk.bold(message), true);
    }

    warn(err: string | ParcelError) {
        if (this.logLevel < 2) {
            return;
        }

        this._writeError(err, emoji.warning, this.chalk.yellow);
    }

    error(err: string | ParcelError) {
        if (this.logLevel < 1) {
            return;
        }

        this._writeError(err, emoji.error, this.chalk.red.bold);
    }

    success(message: string) {
        this.log(`${emoji.success}  ${this.chalk.green.bold(message)}`);
    }

    private _writeError(err: string | ParcelError, emoji: string, color: (msg: string) => string) {
        let { message, stack } = prettyError(err, {color: this.color});
        this.write(color(`${emoji}  ${message}`));
        if (stack) {
            this.write(stack);
        }
    }

    clear() {
        if (!this.color || this.isTest) {
            return;
        }

        while (this.lines > 0) {
            readline.clearLine(process.stdout, 0);
            readline.moveCursor(process.stdout, 0, -1);
            this.lines--;
        }

        readline.cursorTo(process.stdout, 0);
        this.stopSpinner();
    }

    progress(message: string) {
        if (this.logLevel < 3) {
            return;
        }

        let styledMessage = this.chalk.gray.bold(message);
        if (!this.spinner) {
            this.spinner = ora({
                text: styledMessage,
                stream: process.stdout,
                enabled: this.isTest ? false : undefined // fall back to ora default unless we need to explicitly disable it.
            }).start();
        } else {
            this.spinner.text = styledMessage;
        }
    }

    stopSpinner() {
        if (this.spinner) {
            this.spinner.stop();
            this.spinner = null;
        }
    }

    handleMessage<N extends MasterOperationName>(options: { method: N, args: MasterOperationArgs<N> }) {
        const method = this[options.method].bind(this) as (...args: MasterOperationArgs<N>) => MasterOperationReturnValue<N>;
        method(...options.args);
    }

    private _log(message: string) {
        console.log(message);
    }

    table(columns: Array<LogTableColumn>, table: string[][]): void {
        // Measure column widths
        let colWidths: number[] = [];
        for (let row of table) {
            let i = 0;
            for (let item of row) {
                colWidths[i] = Math.max(colWidths[i] || 0, stringWidth(item));
                i++;
            }
        }

        // Render rows
        for (let row of table) {
            let items = row.map((item, i) => {
                // Add padding between columns unless the alignment is the opposite to the
                // next column and pad to the column width.
                let padding =
                    !columns[i + 1] || columns[i + 1].align === columns[i].align ? 4 : 0;
                return pad(item, colWidths[i] + padding, columns[i].align);
            });

            this.log(items.join(''));
        }
    }
}

export interface LogTableColumn {
    align?: LogTableAlignment;
}

export type LogTableAlignment = 'left' | 'right';

// Pad a string with spaces on either side
function pad(text: string, length: number, align: LogTableAlignment = 'left') {
    let pad = ' '.repeat(length - stringWidth(text));
    if (align === 'right') {
        return pad + text;
    }

    return text + pad;
}

// Count visible characters in a string
function stringWidth(string: string) {
    return countBreaks(stripAnsi('' + string));
}

let logger: Logger;

// If we are in a worker, make a proxy class which will
// send the logger calls to the main process via IPC.
// These are handled in WorkerFarm and directed to handleMessage above.
if (WorkerFarm.isWorker()) {
    class LoggerProxy extends Logger {}
    for (let method of Object.getOwnPropertyNames(Logger.prototype) as MasterOperationName[]) {
        LoggerProxy.prototype[method] = <N extends MasterOperationName>(...args: MasterOperationArgs<N>) => {
            WorkerFarm.callMaster(
                {
                    location: __filename,
                    method,
                    args
                },
                false
            );
        };
    }

    logger = new LoggerProxy() as Logger;
} else {
    logger = new Logger();
}

export default logger;
