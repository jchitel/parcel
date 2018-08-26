import Packager from './Packager';
import posthtml from 'posthtml';
import path from 'path';
import urlJoin from '../utils/urlJoin';
import Asset from '../Asset';
import Bundle from '../Bundle';

// https://www.w3.org/TR/html5/dom.html#metadata-content-2
const metadataContent = new Set([
    'base',
    'link',
    'meta',
    'noscript',
    'script',
    'style',
    'template',
    'title'
]);

export default class HTMLPackager extends Packager {
    static shouldAddAsset() {
        // We cannot combine multiple HTML files together - they should be written as separate bundles.
        return false;
    }

    async addAsset(asset: Asset<unknown, unknown>) {
        let html = asset.generated.html || '';

        // Find child bundles that have JS or CSS sibling bundles,
        // add them to the head so they are loaded immediately.
        let siblingBundles = Array.from(this.bundle.childBundles)
            .reduce<Bundle[]>((p, b) => p.concat([...b.siblingBundles.values()]), [])
            .filter(b => b.type === 'css' || b.type === 'js');

        if (siblingBundles.length > 0) {
            html = posthtml(
                this.insertSiblingBundles.bind(this, siblingBundles)
            ).process(html, {sync: true}).html;
        }

        await this.write(html);
    }

    addBundlesToTree(bundles: HtmlNode[], tree: HtmlNode) {
        const head = find(tree, 'head');
        if (head) {
            const content = head.content || (head.content = []);
            content.push(...bundles);
            return;
        }

        const html = find(tree, 'html');
        const content = html ? html.content || (html.content = []) : tree as any as HtmlNode[]; // this is dumb...
        const index = findBundleInsertIndex(content);

        content.splice(index, 0, ...bundles);
    }

    insertSiblingBundles(siblingBundles: Bundle[], tree: HtmlNode) {
        const bundles: HtmlNode[] = [];

        for (let bundle of siblingBundles) {
            if (bundle.type === 'css') {
                bundles.push({
                    tag: 'link',
                    attrs: {
                        rel: 'stylesheet',
                        href: urlJoin(this.options.publicURL, path.basename(bundle.name))
                    }
                });
            } else if (bundle.type === 'js') {
                bundles.push({
                    tag: 'script',
                    attrs: {
                        src: urlJoin(this.options.publicURL, path.basename(bundle.name))
                    }
                });
            }
        }

        this.addBundlesToTree(bundles, tree);
    }
}

interface HtmlNode {
    match?(config: { tag: string }, fn: (node: HtmlNode) => HtmlNode): void;
    tag: string;
    attrs: { [name: string]: string };
    content?: HtmlNode[];
}

function find(tree: HtmlNode, tag: string): HtmlNode | undefined {
    let res: HtmlNode | undefined = undefined;
    tree.match!({tag}, node => {
        res = node;
        return node;
    });

    return res;
}

function findBundleInsertIndex(content: HtmlNode[]): number {
    for (let index = 0; index < content.length; index++) {
        const node = content[index];
        if (node && node.tag && !metadataContent.has(node.tag)) {
            return index;
        }
    }

    return 0;
}
