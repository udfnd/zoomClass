const SDK_VERSION = '3.10.1';

const SCRIPT_SOURCES = [
    `https://source.zoom.us/${SDK_VERSION}/lib/vendor/react.min.js`,
    `https://source.zoom.us/${SDK_VERSION}/lib/vendor/react-dom.min.js`,
    `https://source.zoom.us/${SDK_VERSION}/lib/vendor/redux.min.js`,
    `https://source.zoom.us/${SDK_VERSION}/lib/vendor/redux-thunk.min.js`,
    `https://source.zoom.us/${SDK_VERSION}/lib/vendor/lodash.min.js`,
    `https://source.zoom.us/${SDK_VERSION}/lib/av/av.min.js`,
    `https://source.zoom.us/${SDK_VERSION}/lib/zoom-meeting-embedded-${SDK_VERSION}.min.js`,
];

const CSS_SOURCES = [
    `https://source.zoom.us/${SDK_VERSION}/css/bootstrap.css`,
    `https://source.zoom.us/${SDK_VERSION}/css/react-select.css`,
    `https://source.zoom.us/${SDK_VERSION}/css/zoom-meeting-embedded.css`,
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

export function loadZoomEmbeddedSdk() {
    if (typeof window !== 'undefined' && window.ZoomMtgEmbedded) {
        CSS_SOURCES.forEach(appendStylesheet);
        return Promise.resolve(window.ZoomMtgEmbedded);
    }

    if (!loadingPromise) {
        CSS_SOURCES.forEach(appendStylesheet);
        loadingPromise = SCRIPT_SOURCES.reduce(
            (promise, src) => promise.then(() => appendScript(src)),
            Promise.resolve(),
        ).then(() => {
            if (typeof window === 'undefined' || !window.ZoomMtgEmbedded) {
                throw new Error('Zoom Meeting SDK를 불러오지 못했습니다.');
            }
            return window.ZoomMtgEmbedded;
        });
    }

    return loadingPromise;
}
