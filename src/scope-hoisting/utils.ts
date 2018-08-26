import t from 'babel-types';
import Asset from '../Asset';

export function getName(asset: Asset<unknown, unknown>, type: string, ...rest: string[]) {
    return (
        '$' +
        (t as any).toIdentifier(asset.id) + // types are wrong...
        '$' +
        type +
        (rest.length
            ? '$' +
                rest
                    .map(name => (name === 'default' ? name : (t as any).toIdentifier(name))) // types are wrong...
                    .join('$')
            : '')
    );
}

export function getIdentifier(asset: Asset<unknown, unknown>, type: string, ...rest: string[]) {
    return t.identifier(getName(asset, type, ...rest));
}

export function getExportIdentifier(asset: Asset<unknown, unknown>, name: string) {
    return getIdentifier(asset, 'export', name);
}
