import * as fs from './fs';
import { CertificateResult } from './generateCertificate';


export interface CertificateOptions {
    cert: string;
    key: string;
}

export default async function getCertificate(options: CertificateOptions): Promise<CertificateResult> {
    try {
        let cert = await fs.readFile(options.cert);
        let key = await fs.readFile(options.key);
        return {key, cert};
    } catch (err) {
        throw new Error('Certificate and/or key not found');
    }
}
