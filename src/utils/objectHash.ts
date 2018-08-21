import crypto from 'crypto';

export default function objectHash<T>(object: T) {
    let hash = crypto.createHash('md5');
    for (let key of Object.keys(object).sort() as Array<keyof T>) {
        let val = object[key];
        if (typeof val === 'object' && val) {
            hash.update(key + objectHash(val));
        } else {
            hash.update(key + val);
        }
    }

    return hash.digest('hex');
}
