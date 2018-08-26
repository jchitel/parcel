import * as nodeBuiltins from 'node-libs-browser';

type NodeBuiltinProperty = (keyof typeof nodeBuiltins);
type ParcelBuiltinProperty = NodeBuiltinProperty | '_bundle_loader' | '_css_loader';

const builtins: { [P in ParcelBuiltinProperty]: string } = Object.create(null);
for (const key of Object.keys(nodeBuiltins) as NodeBuiltinProperty[]) {
    builtins[key] = nodeBuiltins[key] == null
        ? require.resolve('./_empty.js')
        : nodeBuiltins[key] as string;
}

builtins['_bundle_loader'] = require.resolve('./bundle-loader.js');
builtins['_css_loader'] = require.resolve('./css-loader.js');

export default builtins;
