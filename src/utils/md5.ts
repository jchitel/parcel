import crypto from 'crypto';
import fs from 'fs';

function md5(string: string, encoding: crypto.HexBase64Latin1Encoding = 'hex') {
    return crypto
        .createHash('md5')
        .update(string)
        .digest(encoding);
}

namespace md5 {
    export async function file(filename: string): Promise<string | Buffer> {
        return new Promise<string | Buffer>((resolve, reject) => {
            fs.createReadStream(filename)
                .pipe(crypto.createHash('md5').setEncoding('hex'))
                .on('finish', function(this: NodeJS.ReadableStream) {
                    resolve(this.read());
                })
                .on('error', reject);
        });
    }
}

export default md5;
