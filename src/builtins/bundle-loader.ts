import { getBundleURL } from './bundle-url';

export default function loadBundlesLazy(bundles) {
    if (!Array.isArray(bundles)) {
        bundles = [bundles]
    }

    var id = bundles[bundles.length - 1];

    try {
        return Promise.resolve(require(id));
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
            return new LazyPromise(function (resolve, reject) {
                loadBundles(bundles.slice(0, -1))
                    .then(function () {
                        return require(id);
                    })
                    .then(resolve, reject);
            });
        }

        throw err;
    }
}

function loadBundles(bundles) {
    return Promise.all(bundles.map(loadBundle));
}

var bundleLoaders = {};
function registerBundleLoader(type, loader) {
    bundleLoaders[type] = loader;
}

export {
    loadBundles as load,
    registerBundleLoader as register
};

var bundles = {};
function loadBundle(bundle) {
    var id;
    if (Array.isArray(bundle)) {
        id = bundle[1];
        bundle = bundle[0];
    }

    if (bundles[bundle]) {
        return bundles[bundle];
    }

    var type = (bundle.substring(bundle.lastIndexOf('.') + 1, bundle.length) || bundle).toLowerCase();
    var bundleLoader = bundleLoaders[type];
    if (bundleLoader) {
        return bundles[bundle] = bundleLoader(getBundleURL() + bundle)
            .then(function (resolved) {
                if (resolved) {
                    module.bundle.register(id, resolved);
                }

                return resolved;
            });
    }
}

class LazyPromise<T> {
    executor: (resolve: (value?: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void;
    promise: Promise<T> | null;

    constructor(executor: (resolve: (value?: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void) {
        this.executor = executor;
        this.promise = null;
    }

    then<OnResolved, OnError>(onSuccess: (value?: T) => OnResolved | PromiseLike<OnResolved>, onError?: (reason?: any) => OnError | PromiseLike<OnError>) {
        if (this.promise === null) this.promise = new Promise(this.executor);
        return this.promise.then(onSuccess, onError);
    }

    catch<OnError>(onError: (reason?: any) => OnError | PromiseLike<OnError>) {
        if (this.promise === null) this.promise = new Promise(this.executor);
        return this.promise.catch(onError);
    }
}
