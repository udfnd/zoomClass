// src/utils/zoomSdkLoader.js
const SDK_VERSION = '3.11.0';
const isProd = process.env.NODE_ENV === 'production';

const LOCAL_ASSET_BASE = isProd
    ? `./zoomlib/${SDK_VERSION}/lib/av`
    : `/zoomlib/${SDK_VERSION}/lib/av`;

let activeAssetBase = LOCAL_ASSET_BASE;
let loadingPromise = null;

export function getZoomSdkAssetBase() {
    return activeAssetBase;
}

export async function loadZoomEmbeddedSdk() {
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async () => {
        const client = (await import('@zoom/meetingsdk/embedded')).default.createClient();
        return { client };
    })();
    return loadingPromise;
}
