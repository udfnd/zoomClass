const SDK_VERSION = '3.10.1';
const SDK_CDN_ROOT = 'https://source.zoom.us/meetingsdk';
const SDK_VERSION_BASE = `${SDK_CDN_ROOT}/${SDK_VERSION}`;
const SDK_LIB_BASE = `${SDK_VERSION_BASE}/lib`;
const SDK_CSS_BASE = `${SDK_VERSION_BASE}/css`;

export const ZOOM_SDK_VERSION = SDK_VERSION;
export const ZOOM_SDK_CDN_BASE = SDK_LIB_BASE;

const SCRIPT_SOURCES = [
    `${SDK_LIB_BASE}/vendor/react.min.js`,
    `${SDK_LIB_BASE}/vendor/react-dom.min.js`,
    `${SDK_LIB_BASE}/vendor/redux.min.js`,
    `${SDK_LIB_BASE}/vendor/redux-thunk.min.js`,
    `${SDK_LIB_BASE}/vendor/lodash.min.js`,
    `${SDK_LIB_BASE}/av/av.min.js`,
    `${SDK_LIB_BASE}/zoom-meeting-embedded-${SDK_VERSION}.min.js`,
];

const CSS_SOURCES = [
    `${SDK_CSS_BASE}/bootstrap.css`,
    `${SDK_CSS_BASE}/react-select.css`,
    `${SDK_CSS_BASE}/zoom-meeting-embedded.css`,
];

let loadingPromise = null;

function appendStylesheet(href) {
    if (typeof document === 'undefined') {
        return;
    }

    if (document.querySelector(`link[data-zoom-sdk="${href}"]`)) {
        return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.zoomSdk = href;
    document.head.appendChild(link);
}

function appendScript(src) {
    if (typeof document === 'undefined') {
        return Promise.reject(new Error('document is not available'));
    }

    const existing = document.querySelector(`script[data-zoom-sdk="${src}"]`);
    if (existing) {
        if (existing.dataset.loaded === 'true') {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', (event) => reject(event?.error || new Error(`Failed to load ${src}`)));
        });
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.dataset.zoomSdk = src;
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.onload = () => {
            script.dataset.loaded = 'true';
            resolve();
        };
        script.onerror = (event) => {
            reject(event?.error || new Error(`Failed to load ${src}`));
        };
        document.head.appendChild(script);
    });
}

function ensureSdkPrepared(ZoomMtgEmbedded) {
    const tasks = [];
    if (ZoomMtgEmbedded?.setZoomJSLib) {
        try {
            ZoomMtgEmbedded.setZoomJSLib(SDK_LIB_BASE, '/av');
        } catch (error) {
            console.warn('[zoomSdkLoader] Failed to set Zoom JS lib:', error);
        }
    }
    if (ZoomMtgEmbedded?.preLoadWasm) {
        tasks.push(Promise.resolve(ZoomMtgEmbedded.preLoadWasm()));
    }
    if (ZoomMtgEmbedded?.prepareWebSDK) {
        tasks.push(
            Promise.resolve(
                ZoomMtgEmbedded.prepareWebSDK({
                    webComponent: false,
                    language: 'ko-KR',
                }),
            ),
        );
    }

    return Promise.all(tasks)
        .then(() => {
            if (ZoomMtgEmbedded?.i18n) {
                try {
                    ZoomMtgEmbedded.i18n.load('ko-KR');
                    ZoomMtgEmbedded.i18n.reload('ko-KR');
                } catch (error) {
                    console.warn('[zoomSdkLoader] Failed to prepare localization:', error);
                }
            }
        })
        .then(() => ZoomMtgEmbedded);
}

export function loadZoomEmbeddedSdk() {
    if (typeof window !== 'undefined' && window.ZoomMtgEmbedded) {
        CSS_SOURCES.forEach(appendStylesheet);
        return ensureSdkPrepared(window.ZoomMtgEmbedded);
    }

    if (!loadingPromise) {
        CSS_SOURCES.forEach(appendStylesheet);
        loadingPromise = SCRIPT_SOURCES.reduce(
            (promise, src) => promise.then(() => appendScript(src)),
            Promise.resolve(),
        )
            .then(() => {
                if (typeof window === 'undefined' || !window.ZoomMtgEmbedded) {
                    throw new Error('Zoom Meeting SDK를 불러오지 못했습니다.');
                }
                return window.ZoomMtgEmbedded;
            })
            .then(ensureSdkPrepared)
            .catch((error) => {
                loadingPromise = null;
                throw error;
            });
    }

    return loadingPromise;
}
