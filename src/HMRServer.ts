import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import prettyError, { ParcelError } from './utils/prettyError';
import generateCertificate from './utils/generateCertificate';
import getCertificate, { CertificateOptions } from './utils/getCertificate';
import logger from './Logger';
import Asset from './Asset';


export interface HMRServerOptions {
    https?: boolean | CertificateOptions;
    cacheDir: string;
    cache: boolean;
    hmrPort?: number;
}

interface UnresolvedError {
    type: 'error';
    error: {
        message: string;
        stack?: string;
    }
}

export default class HMRServer {
    server!: http.Server | https.Server;
    wss!: WebSocket.Server;
    unresolvedError?: UnresolvedError | null;

    async start(options: HMRServerOptions = {} as HMRServerOptions): Promise<number> {
        await new Promise(async resolve => {
            if (!options.https) {
                this.server = http.createServer();
            } else if (typeof options.https === 'boolean') {
                this.server = https.createServer(generateCertificate(options));
            } else {
                this.server = https.createServer(await getCertificate(options.https));
            }

            this.wss = new WebSocket.Server({server: this.server});
            this.server.listen(options.hmrPort, resolve);
        });

        this.wss.on('connection', ws => {
            ws.onerror = this.handleSocketError;
            if (this.unresolvedError) {
                ws.send(JSON.stringify(this.unresolvedError));
            }
        });

        this.wss.on('error', this.handleSocketError);

        return (this.wss as any)._server.address().port;
    }

    stop(): void {
        this.wss.close();
        this.server.close();
    }

    emitError(err: string | ParcelError): void {
        let {message, stack} = prettyError(err);

        // store the most recent error so we can notify new connections
        // and so we can broadcast when the error is resolved
        this.unresolvedError = {
            type: 'error',
            error: {
                message,
                stack
            }
        };

        this.broadcast(this.unresolvedError);
    }

    emitUpdate(assets: Array<Asset<unknown, unknown>>): void {
        if (this.unresolvedError) {
            this.unresolvedError = null;
            this.broadcast({
                type: 'error-resolved'
            });
        }

        const containsHtmlAsset = assets.some(asset => asset.type === 'html');
        if (containsHtmlAsset) {
            this.broadcast({
                type: 'reload'
            });
        } else {
            this.broadcast({
                type: 'update',
                assets: assets.map(asset => {
                    let deps = {};
                    for (let [dep, depAsset] of asset.depAssets) {
                        deps[dep.name] = depAsset.id;
                    }

                    return {
                        id: asset.id,
                        generated: asset.generated,
                        deps: deps
                    };
                })
            });
        }
    }

    handleSocketError(err: { error: any }): void {
        if (err.error.code === 'ECONNRESET') {
            // This gets triggered on page refresh, ignore this
            return;
        }
        logger.warn(err as any);
    }

    broadcast(msg: unknown): void {
        const json = JSON.stringify(msg);
        for (let ws of this.wss.clients) {
            ws.send(json);
        }
    }
}
