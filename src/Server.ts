import http from 'http';
import https from 'https';
import serveStatic from 'serve-static';
import getPort from 'get-port';
import { serverErrors } from './utils/customErrors';
import generateCertificate from './utils/generateCertificate';
import getCertificate, { CertificateOptions } from './utils/getCertificate';
import prettyError, { ParcelError } from './utils/prettyError';
import AnsiToHtml from 'ansi-to-html';
import logger from './Logger';
import path from 'path';
import url from 'url';
import * as express from "express-serve-static-core";
import Bundler from './Bundler';
import { AddressInfo } from 'net';

const ansiToHtml = new AnsiToHtml({newline: true});

serveStatic.mime.define({
    'application/wasm': ['wasm']
});

function setHeaders(res: express.Response) {
    enableCors(res);
}

function enableCors(res: express.Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, HEAD, PUT, PATCH, POST, DELETE'
    );
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Origin, X-Requested-With, Content-Type, Accept, Content-Type'
    );
}

export function middleware(bundler: Bundler) {
    const serve = serveStatic(bundler.options.outDir, {
        index: false,
        redirect: false,
        setHeaders: setHeaders
    });

    return function(req: http.IncomingMessage, res: http.ServerResponse, next?: () => void): void {
        // Wait for the bundler to finish bundling if needed
        if (bundler.pending) {
            bundler.once('bundled', respond);
        } else {
            respond();
        }

        function respond() {
            let {pathname} = url.parse(req.url!);
            if (bundler.error) {
                return send500(bundler.error);
            } else if (
                !pathname!.startsWith(bundler.options.publicURL) ||
                path.extname(pathname!) === ''
            ) {
                // If the URL doesn't start with the public path, or the URL doesn't
                // have a file extension, send the main HTML bundle.
                return sendIndex();
            } else {
                // Otherwise, serve the file from the dist folder
                req.url = pathname!.slice(bundler.options.publicURL.length);
                return serve(req as express.Request, res as express.Response, send404);
            }
        }

        function sendIndex() {
            // If the main asset is an HTML file, serve it
            if (bundler.mainBundle!.type === 'html') {
                req.url = `/${path.basename(bundler.mainBundle!.name)}`;
                serve(req as express.Request, res as express.Response, send404);
            } else {
                send404();
            }
        }

        function send500(error: string | ParcelError) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.writeHead(500);
            let errorMesssge = '<h1>🚨 Build Error</h1>';
            if (process.env.NODE_ENV === 'production') {
                errorMesssge += '<p><b>Check the console for details.</b></p>';
            } else {
                const {message, stack} = prettyError(error, {color: true});
                errorMesssge += `<p><b>${message}</b></p>`;
                if (stack) {
                    errorMesssge += `<div style="background: black; padding: 1rem;">${ansiToHtml.toHtml(
                        stack
                    )}</div>`;
                }
            }
            res.end(
                [
                    `<!doctype html>`,
                    `<head><title>🚨 Build Error</title></head>`,
                    `<body style="font-family: monospace; white-space: pre;">${errorMesssge}</body>`
                ].join('')
            );
        }

        function send404() {
            if (next) {
                return next();
            }

            res.writeHead(404);
            res.end();
        }
    };
}

export async function serve(bundler: Bundler, port?: number, useHTTPS: boolean | CertificateOptions = false) {
    let handler = middleware(bundler);
    let server: http.Server | https.Server;
    if (!useHTTPS) {
        server = http.createServer(handler);
    } else if (typeof useHTTPS === 'boolean') {
        server = https.createServer(generateCertificate(bundler.options), handler);
    } else {
        server = https.createServer(await getCertificate(useHTTPS), handler);
    }

    let freePort = await getPort({port});
    server.listen(freePort);

    return new Promise((resolve, reject) => {
        server.on('error', err => {
            logger.error(new Error(serverErrors(err, (server.address() as AddressInfo).port)));
            reject(err);
        });

        server.once('listening', () => {
            let addon =
                (server.address() as AddressInfo).port !== port
                    ? `- ${logger.chalk.yellow(
                            `configured port ${port} could not be used.`
                        )}`
                    : '';

            logger.persistent(
                `Server running at ${logger.chalk.cyan(
                    `${useHTTPS ? 'https' : 'http'}://localhost:${(server.address() as AddressInfo).port}`
                )} ${addon}`
            );

            resolve(server);
        });
    });
}
