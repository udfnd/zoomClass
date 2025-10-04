// scripts/copy-zoom-assets.js
const fs = require('fs');
const path = require('path');

const SDK_VERSION = '3.11.0';
const srcRoot = path.resolve(__dirname, '..', 'node_modules', '@zoom', 'meetingsdk', 'dist');
const dstRoot = path.resolve(__dirname, '..', 'public', 'zoomlib', SDK_VERSION);

function copyDir(src, dst) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, e.name);
        const d = path.join(dst, e.name);
        e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
    }
}

copyDir(path.join(srcRoot, 'css'), path.join(dstRoot, 'css'));
copyDir(path.join(srcRoot, 'lib'), path.join(dstRoot, 'lib'));
console.log(`[zoom] Copied SDK assets → /public/zoomlib/${SDK_VERSION}/{css,lib}`);
console.log(`[zoom] Use assetPath: /zoomlib/${SDK_VERSION}/lib/av`);
