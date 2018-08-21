/**
 * This function is a piece of shit to type, even with TS 3.0.
 * I was able to type this with overloads (1 for each argument length)
 * but each overload had to have another one for the multi-arg result case,
 * and that one would clobber the single-argument one, so I would have to
 * specify one overload for each combination of arg lengths and result lengths.
 * That really sucks...
 * Each promisified function will thus just have to explicitly declare its type.
 */
export default function promisify(fn: (...args: any[]) => void): (...args: any[]) => Promise<any> {
    return function(...args: any[]) {
        return new Promise(function(resolve, reject) {
            fn(...args, function(err: any, ...res: any[]) {
                if (err) return reject(err);

                if (res.length === 1) return resolve(res[0]);

                resolve(res);
            });
        });
    };
};
