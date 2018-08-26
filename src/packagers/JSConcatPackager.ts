import Packager from './Packager';
import path from 'path';
import concat from '../scope-hoisting/concat';
import urlJoin from '../utils/urlJoin';
import getExisting from '../utils/getExisting';
import walk from 'babylon-walk';
import babylon from 'babylon';
import t from 'babel-types';
import { getName, getIdentifier } from '../scope-hoisting/utils';
import Asset from '../Asset';
import Bundle from '../Bundle';

const prelude = getExisting(
    path.join(__dirname, '../builtins/prelude2.min.js'),
    path.join(__dirname, '../builtins/prelude2.js')
);

const helpers = getExisting(
    path.join(__dirname, '../builtins/helpers.min.js'),
    path.join(__dirname, '../builtins/helpers.js')
);

export default class JSConcatPackager extends Packager {
    addedAssets!: Set<Asset<unknown, unknown>>;
    assets!: Map<string, Asset<unknown, unknown>>;
    exposedModules!: Set<none>;
    externalModules!: Set<none>;
    size!: number;
    needsPrelude!: boolean;
    statements!: t.Statement[];
    assetPostludes!: Map<none, none>;

    async start() {
        this.addedAssets = new Set();
        this.assets = new Map();
        this.exposedModules = new Set();
        this.externalModules = new Set();
        this.size = 0;
        this.needsPrelude = false;
        this.statements = [];
        this.assetPostludes = new Map();

        for (let asset of this.bundle.assets) {
            // If this module is referenced by another JS bundle, it needs to be exposed externally.
            let isExposed = !Array.from(asset.parentDeps).every(dep => {
                let depAsset = this.bundler.loadedAssets.get(dep.parent);
                return this.bundle.assets.has(depAsset) || depAsset.type !== 'js';
            });

            if (
                isExposed ||
                (this.bundle.entryAsset === asset &&
                    this.bundle.parentBundle &&
                    this.bundle.parentBundle.childBundles.size !== 1)
            ) {
                this.exposedModules.add(asset);
                this.needsPrelude = true;
            }

            this.assets.set(asset.id!, asset);

            for (let mod of asset.depAssets.values()) {
                if (
                    !this.bundle.assets.has(mod) &&
                    this.options.bundleLoaders[asset.type!]
                ) {
                    this.needsPrelude = true;
                    break;
                }
            }
        }

        if (this.bundle.entryAsset) {
            this.markUsedExports(this.bundle.entryAsset);
        }

        if (this.needsPrelude) {
            if (
                this.bundle.entryAsset &&
                this.options.bundleLoaders[this.bundle.entryAsset.type!]
            ) {
                this.exposedModules.add(this.bundle.entryAsset);
            }
        }

        this.write(helpers.minified);
    }

    async write(string: string) {
        this.statements!.push(...this.parse(string));
    }

    getSize(): number {
        return this.size!;
    }

    markUsedExports(asset: Asset<unknown, unknown>) {
        if (asset.usedExports) {
            return;
        }

        asset.usedExports = new Set();

        for (let identifier in asset.cacheData.imports) {
            let [source, name] = asset.cacheData.imports[identifier];
            let dep = asset.depAssets.get(asset.dependencies.get(source));

            if (name === '*') {
                this.markUsedExports(dep);
            }

            this.markUsed(dep, name);
        }
    }

    markUsed(mod: none, name: string): void {
        let {id} = this.findExportModule(mod.id, name);
        mod = this.assets!.get(id);

        if (!mod) {
            return;
        }

        let exp = mod.cacheData.exports[name];
        if (Array.isArray(exp)) {
            let depMod = mod.depAssets.get(mod.dependencies.get(exp[0]));
            return this.markUsed(depMod, exp[1]);
        }

        this.markUsedExports(mod);
        mod.usedExports.add(name);
    }

    getExportIdentifier(asset: Asset<unknown, unknown>): string {
        let id = getName(asset, 'exports');
        if (this.shouldWrap(asset)) {
            return `(${getName(asset, 'init')}(), ${id})`;
        }

        return id;
    }

    async addAsset(asset: Asset<unknown, unknown>) {
        if (this.addedAssets!.has(asset)) {
            return;
        }
        this.addedAssets!.add(asset);
        let { js } = asset.generated;

        // If the asset has no side effects according to the its package's sideEffects flag,
        // and there are no used exports marked, exclude the asset from the bundle.
        if (
            asset.cacheData.sideEffects === false &&
            (!asset.usedExports || asset.usedExports.size === 0)
        ) {
            return;
        }

        for (let [dep, mod] of asset.depAssets) {
            if (dep.dynamic) {
                for (let child of mod.parentBundle.siblingBundles) {
                    if (!child.isEmpty) {
                        await this.addBundleLoader(child.type, asset);
                    }
                }

                await this.addBundleLoader(mod.type, asset, true);
            } else {
                // If the dep isn't in this bundle, add it to the list of external modules to preload.
                // Only do this if this is the root JS bundle, otherwise they will have already been
                // loaded in parallel with this bundle as part of a dynamic import.
                if (
                    !this.bundle.assets.has(mod) &&
                    (!this.bundle.parentBundle ||
                        this.bundle.parentBundle.type !== 'js') &&
                    this.options.bundleLoaders[mod.type]
                ) {
                    this.externalModules!.add(mod);
                    await this.addBundleLoader(mod.type, asset);
                }
            }
        }

        // if (this.bundle.entryAsset === asset && this.externalModules.size > 0) {
        //   js = `
        //     function $parcel$entry() {
        //       ${js.trim()}
        //     }
        //   `;
        // }

        // js = js.trim() + '\n';
        this.size += js.length;
    }

    shouldWrap(asset: Asset<unknown, unknown>): boolean {
        if (!asset) {
            return false;
        }

        if (asset.cacheData.shouldWrap != null) {
            return asset.cacheData.shouldWrap;
        }

        // Set to false initially so circular deps work
        asset.cacheData.shouldWrap = false;

        // We need to wrap if any of the deps are marked by the hoister, e.g.
        // when the dep is required inside a function or conditional.
        // We also need to wrap if any of the parents are wrapped - transitive requires
        // shouldn't be evaluated until their parents are.
        let shouldWrap = [...asset.parentDeps].some(
            dep =>
                dep.shouldWrap ||
                this.shouldWrap(this.bundler.loadedAssets.get(dep.parent))
        );

        asset.cacheData.shouldWrap = shouldWrap;
        return shouldWrap;
    }

    addDeps(asset: Asset<unknown, unknown>, included: Set<Asset<unknown, unknown>>): t.Statement[] {
        if (!this.bundle.assets.has(asset) || included.has(asset)) {
            return [];
        }

        included.add(asset);

        let depAsts = new Map();
        for (let depAsset of asset.depAssets.values()) {
            let depAst = this.addDeps(depAsset, included);
            depAsts.set(depAsset, depAst);
        }

        let statements: t.Statement[];
        if (
            asset.cacheData.sideEffects === false &&
            (!asset.usedExports || asset.usedExports.size === 0)
        ) {
            statements = [];
        } else {
            statements = this.parse(asset.generated.js, asset.name);
        }

        if (this.shouldWrap(asset)) {
            statements = this.wrapModule(asset, statements);
        }

        if (statements[0]) {
            if (!statements[0].leadingComments) {
                statements[0].leadingComments = [];
            }
            statements[0].leadingComments!.push({
                type: 'CommentLine',
                value: ` ASSET: ${path.relative(this.options.rootDir, asset.name)}`
            } as t.CommentLine);
        }

        let statementIndices = new Map<Asset<unknown, unknown>, number>();
        for (let i = 0; i < statements.length; i++) {
            let statement = statements[i];
            if (t.isExpressionStatement(statement)) {
                for (let depAsset of this.findRequires(asset, statement)) {
                    if (!statementIndices.has(depAsset)) {
                        statementIndices.set(depAsset, i);
                    }
                }
            }
        }

        let reverseDeps = [...asset.depAssets.values()].reverse();
        for (let dep of reverseDeps) {
            let index = statementIndices.has(dep) ? statementIndices.get(dep)! : 0;
            statements.splice(index, 0, ...depAsts.get(dep));
        }

        if (this.assetPostludes!.has(asset)) {
            statements.push(...this.parse(this.assetPostludes!.get(asset)));
        }

        return statements;
    }

    wrapModule(asset: Asset<unknown, unknown>, statements: t.Statement[]): t.Statement[] {
        let body = [];
        let decls = [];
        let fns = [];
        for (let node of statements) {
            // Hoist all declarations out of the function wrapper
            // so that they can be referenced by other modules directly.
            if (t.isVariableDeclaration(node)) {
                for (let decl of node.declarations) {
                    decls.push(t.variableDeclarator(decl.id));
                    if (decl.init) {
                        body.push(
                            t.expressionStatement(
                                t.assignmentExpression(
                                    '=',
                                    t.identifier((decl.id as t.Identifier).name),
                                    decl.init
                                )
                            )
                        );
                    }
                }
            } else if (t.isFunctionDeclaration(node)) {
                // Function declarations can be hoisted out of the module initialization function
                fns.push(node);
            } else if (t.isClassDeclaration(node)) {
                // Class declarations are not hoisted. We declare a variable outside the
                // function convert to a class expression assignment.
                decls.push(t.variableDeclarator(t.identifier(node.id.name)));
                body.push(
                    t.expressionStatement(
                        t.assignmentExpression(
                            '=',
                            t.identifier(node.id.name),
                            (t as any).toExpression(node) // types are wrong...
                        )
                    )
                );
            } else {
                body.push(node);
            }
        }

        let executed = getName(asset, 'executed');
        decls.push(
            t.variableDeclarator(t.identifier(executed), t.booleanLiteral(false))
        );

        let init = t.functionDeclaration(
            getIdentifier(asset, 'init'),
            [],
            t.blockStatement([
                t.ifStatement(t.identifier(executed), t.returnStatement()),
                t.expressionStatement(
                    t.assignmentExpression(
                        '=',
                        t.identifier(executed),
                        t.booleanLiteral(true)
                    )
                ),
                ...body
            ])
        );

        return [t.variableDeclaration('var', decls), ...fns, init];
    }

    parse(code: string, filename?: string) {
        let ast = babylon.parse(code, {
            sourceFilename: filename,
            allowReturnOutsideFunction: true
        });

        return ast.program.body;
    }

    findRequires(asset: Asset<unknown, unknown>, ast: walk.NodeTypes): Asset<unknown, unknown>[] {
        let result: Asset<unknown, unknown>[] = [];
        walk.simple(ast, {
            CallExpression(node) {
                let {arguments: args, callee} = node as t.CallExpression;

                if (!t.isIdentifier(callee)) {
                    return;
                }

                if (callee.name === '$parcel$require') {
                    result.push(
                        asset.depAssets.get(asset.dependencies.get((args[1] as { value: any }).value))
                    );
                }
            }
        }, undefined);

        return result;
    }

    getBundleSpecifier(bundle: Bundle): string | [string, string] {
        let name = path.basename(bundle.name);
        if (bundle.entryAsset) {
            return [name, bundle.entryAsset.id!];
        }

        return name;
    }

    async addAssetToBundle(asset: Asset<unknown, unknown>): Promise<void> {
        if (this.bundle.assets.has(asset)) {
            return;
        }
        this.bundle.addAsset(asset);
        if (!asset.parentBundle) {
            asset.parentBundle = this.bundle;
        }

        // Add all dependencies as well
        for (let child of asset.depAssets.values()) {
            await this.addAssetToBundle(child);
        }

        await this.addAsset(asset);
    }

    async addBundleLoader(bundleType: string, parentAsset: Asset<unknown, unknown>, dynamic?: boolean): Promise<void> {
        let loader = this.options.bundleLoaders[bundleType];
        if (!loader) {
            return;
        }

        let bundleLoader = this.bundler.loadedAssets.get(
            require.resolve('../builtins/bundle-loader')
        );
        if (!bundleLoader && !dynamic) {
            bundleLoader = await this.bundler.getAsset('_bundle_loader');
        }

        if (bundleLoader) {
            // parentAsset.depAssets.set({name: '_bundle_loader'}, bundleLoader);
            await this.addAssetToBundle(bundleLoader);
        } else {
            return;
        }

        let target = this.options.target === 'node' ? 'node' : 'browser';
        let asset = await this.bundler.getAsset(loader[target]);
        if (!this.bundle.assets.has(asset)) {
            let dep = {name: asset.name};
            asset.parentDeps.add(dep);
            parentAsset.dependencies.set(dep.name, dep);
            parentAsset.depAssets.set(dep, asset);
            this.assetPostludes!.set(
                asset,
                `${this.getExportIdentifier(bundleLoader)}.register(${JSON.stringify(
                    bundleType
                )},${this.getExportIdentifier(asset)});\n`
            );

            await this.addAssetToBundle(asset);
        }
    }

    async end() {
        let included = new Set();
        for (let asset of this.bundle.assets) {
            this.statements!.push(...this.addDeps(asset, included));
        }

        // Preload external modules before running entry point if needed
        if (this.externalModules!.size > 0) {
            let bundleLoader = this.bundler.loadedAssets.get(
                require.resolve('../builtins/bundle-loader')
            );

            let preload = [];
            for (let mod of this.externalModules!) {
                // Find the bundle that has the module as its entry point
                let bundle = Array.from(mod.bundles).find(b => b.entryAsset === mod);
                if (bundle) {
                    preload.push([path.basename(bundle.name), mod.id]);
                }
            }

            let loads = `${this.getExportIdentifier(
                bundleLoader
            )}.load(${JSON.stringify(preload)})`;
            if (this.bundle.entryAsset) {
                loads += '.then($parcel$entry)';
            }

            loads += ';';
            this.write(loads);
        }

        let entryExports =
            this.bundle.entryAsset &&
            this.getExportIdentifier(this.bundle.entryAsset);
        if (
            entryExports &&
            this.bundle.entryAsset!.generated.js.includes(entryExports)
        ) {
            this.write(`
                if (typeof exports === "object" && typeof module !== "undefined") {
                    // CommonJS
                    module.exports = ${entryExports};
                } else if (typeof define === "function" && define.amd) {
                    // RequireJS
                    define(function () {
                        return ${entryExports};
                    });
                } ${
                    this.options.global
                        ? `else {
                    // <script>
                    this[${JSON.stringify(this.options.global)}] = ${entryExports};
                }`
                        : ''
                }
            `);
        }

        if (this.needsPrelude) {
            let exposed = [];
            let prepareModule = [];
            for (let m of this.exposedModules!) {
                if (m.cacheData.isES6Module) {
                    prepareModule.push(
                        `${this.getExportIdentifier(m)}.__esModule = true;`
                    );
                }

                exposed.push(`"${m.id}": ${this.getExportIdentifier(m)}`);
            }

            this.write(`
                ${prepareModule.join('\n')}
                return {${exposed.join(', ')}};
            `);
        }

        let ast = t.file(t.program(this.statements));
        let {code: output} = concat(this, ast);

        if (!this.options.minify) {
            output = '\n' + output + '\n';
        }

        let preludeCode = this.options.minify ? prelude.minified : prelude.source;
        if (this.needsPrelude) {
            output = preludeCode + '(function (require) {' + output + '});';
        } else {
            output = '(function () {' + output + '})();';
        }

        this.size = output.length;

        let {sourceMaps} = this.options;
        if (sourceMaps) {
            // Add source map url if a map bundle exists
            let mapBundle = this.bundle.siblingBundlesMap.get('map');
            if (mapBundle) {
                output += `\n//# sourceMappingURL=${urlJoin(
                    this.options.publicURL,
                    path.basename(mapBundle.name)
                )}`;
            }
        }

        await super.write(output);
    }

    resolveModule(id: string, name: string) {
        let module = this.assets!.get(id)!;
        return module.depAssets.get(module.dependencies.get(name));
    }

    findExportModule(id: string, name: string, replacements?: Map<string, string>): ExportModule {
        let asset = this.assets!.get(id);
        let exp: string =
            asset &&
            Object.prototype.hasOwnProperty.call(asset.cacheData.exports, name)
                ? asset.cacheData.exports[name]
                : null;

        // If this is a re-export, find the original module.
        if (Array.isArray(exp)) {
            let mod = this.resolveModule(id, exp[0]);
            return this.findExportModule(mod.id, exp[1], replacements);
        }

        // If this module exports wildcards, resolve the original module.
        // Default exports are excluded from wildcard exports.
        let wildcards = asset && asset.cacheData.wildcards;
        if (wildcards && name !== 'default' && name !== '*') {
            for (let source of wildcards) {
                let mod = this.resolveModule(id, source);
                let m = this.findExportModule(mod.id, name, replacements);
                if (m.identifier) {
                    return m;
                }
            }
        }

        // If this is a wildcard import, resolve to the exports object.
        if (asset && name === '*') {
            exp = getName(asset, 'exports');
        }

        if (replacements && replacements.has(exp)) {
            exp = replacements.get(exp)!;
        }

        return {
            identifier: exp,
            name,
            id
        };
    }
}

interface ExportModule {
    identifier: string;
    name: string;
    id: string;
}
