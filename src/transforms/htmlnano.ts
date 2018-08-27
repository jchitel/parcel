import posthtml from 'posthtml';
import htmlnano from 'htmlnano';

export default async function(asset) {
    await asset.parseIfNeeded();

    let htmlNanoConfig = Object.assign(
        {},
        await asset.getConfig(['.htmlnanorc', '.htmlnanorc.js'], {
            packageKey: 'htmlnano'
        }),
        {
            minifyCss: false,
            minifyJs: false
        }
    );

    let res = await posthtml([htmlnano(htmlNanoConfig)]).process(asset.ast, {
        skipParse: true
    });

    asset.ast = res.tree;
    asset.isAstDirty = true;
};
