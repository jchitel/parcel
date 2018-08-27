import * as config from './config';
import dotenv from 'dotenv';

export default async function loadEnv(filepath) {
    const NODE_ENV = process.env.NODE_ENV || 'development';
    const dotenvFiles = [
        `.env.${NODE_ENV}.local`,
        `.env.${NODE_ENV}`,
        // Don't include `.env.local` for `test` environment
        // since normally you expect tests to produce the same
        // results for everyone
        NODE_ENV !== 'test' && '.env.local',
        '.env'
    ].filter(Boolean);

    await Promise.all(
        dotenvFiles.map(async dotenvFile => {
            const envPath = await config.resolve(filepath, [dotenvFile]);
            if (envPath) {
                dotenv.config({path: envPath});
            }
        })
    );
}
