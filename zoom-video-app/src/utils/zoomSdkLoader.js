const SDK_VERSION = '3.10.1';

const CDN_SOURCES = [
    {
        assetPath: 'https://dmogdx0jrul3u.cloudfront.net/sdk',
        script: `https://dmogdx0jrul3u.cloudfront.net/sdk/zoom-meeting-embedded-${SDK_VERSION}.min.js`,
        styles: [
            'https://dmogdx0jrul3u.cloudfront.net/sdk/index.css',
            'https://dmogdx0jrul3u.cloudfront.net/sdk/embedded/index.css',
        ],
    },
    {
        assetPath: `https://source.zoom.us/meetingsdk/${SDK_VERSION}`,
        script: `https://source.zoom.us/meetingsdk/${SDK_VERSION}/lib/zoom-meeting-embedded.min.js`,
        styles: [
            `https://source.zoom.us/meetingsdk/${SDK_VERSION}/lib/zoom-meeting-embedded.min.css`,
            `https://source.zoom.us/meetingsdk/${SDK_VERSION}/lib/css/zoom-meeting-embedded.min.css`,
        ],
    },
    {
        assetPath: 'https://source.zoom.us/meetingsdk',
        script: `https://source.zoom.us/meetingsdk/zoom-meeting-embedded-${SDK_VERSION}.min.js`,
        styles: [
            'https://source.zoom.us/meetingsdk/index.css',
            'https://source.zoom.us/meetingsdk/embedded/index.css',
        ],
    },
    {
        assetPath: 'https://source.zoom.us/sdk',
        script: `https://source.zoom.us/sdk/zoom-meeting-embedded-${SDK_VERSION}.min.js`,
        styles: [
            'https://source.zoom.us/sdk/index.css',
            'https://source.zoom.us/sdk/embedded/index.css',
        ],
    },
];

export const ZOOM_SDK_VERSION = SDK_VERSION;

let activeCdn = CDN_SOURCES[0];
let loadingPromise = null;

export function getZoomSdkAssetBase() {
    return activeCdn.assetPath;
}

function appendStylesheet(href) {
    if (typeof document === 'undefined') {
        return null;
    }

    const existing = document.querySelector(`link[data-zoom-sdk="${href}"]`);
    if (existing) {
        existing.dataset.loaded = 'true';
        return existing;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.zoomSdk = href;
    link.crossOrigin = 'anonymous';
    link.referrerPolicy = 'no-referrer';
    link.onload = () => {
        link.dataset.loaded = 'true';
    };
    link.onerror = () => {
        link.remove();
    };
    document.head.appendChild(link);
    return link;
}

function appendScript(src) {
    if (typeof document === 'undefined') {
        return Promise.reject(new Error('document is not available'));
    }

    const existing = document.querySelector(`script[data-zoom-sdk="${src}"]`);
    if (existing) {
        if (existing.dataset.loaded === 'true') {
            return Promise.resolve(existing);
        }
        return new Promise((resolve, reject) => {
            const handleLoad = () => {
                cleanup();
                resolve(existing);
            };
            const handleError = (event) => {
                cleanup();
                reject(event?.error || new Error(`Failed to load ${src}`));
            };
            const cleanup = () => {
                existing.removeEventListener('load', handleLoad);
                existing.removeEventListener('error', handleError);
            };
            existing.addEventListener('load', handleLoad);
            existing.addEventListener('error', handleError);
        });
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.dataset.zoomSdk = src;
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.referrerPolicy = 'no-referrer';
        script.onload = () => {
            script.dataset.loaded = 'true';
            resolve(script);
        };
        script.onerror = (event) => {
            script.remove();
            reject(event?.error || new Error(`Failed to load ${src}`));
        };
        document.head.appendChild(script);
    });
}

function ensureSdkPrepared(ZoomMtgEmbedded) {
    const tasks = [];
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

function tryLoadSdk(candidateIndex, previousErrors) {
    if (candidateIndex >= CDN_SOURCES.length) {
        const details = previousErrors
            .map((entry) => ` - ${entry.src}: ${entry.error?.message || entry.error}`)
            .join('\n');
        const error = new Error(
            previousErrors.length
                ? `Zoom Meeting SDK를 불러오지 못했습니다. 시도한 경로:\n${details}`
                : 'Zoom Meeting SDK를 불러오지 못했습니다.',
        );
        error.attemptErrors = previousErrors;
        throw error;
    }

    const candidate = CDN_SOURCES[candidateIndex];

    return appendScript(candidate.script)
        .then(() => {
            if (typeof window === 'undefined' || !window.ZoomMtgEmbedded) {
                throw new Error('Zoom Meeting SDK 전역 객체가 존재하지 않습니다.');
            }

            candidate.styles.forEach((href) => appendStylesheet(href));
            activeCdn = candidate;
            return window.ZoomMtgEmbedded;
        })
        .catch((error) => {
            const attempts = previousErrors.concat({ src: candidate.script, error });
            return tryLoadSdk(candidateIndex + 1, attempts);
        });
}

export function loadZoomEmbeddedSdk() {
    if (typeof window !== 'undefined' && window.ZoomMtgEmbedded) {
        activeCdn.styles?.forEach?.((href) => appendStylesheet(href));
        return ensureSdkPrepared(window.ZoomMtgEmbedded);
    }

    if (!loadingPromise) {
        loadingPromise = tryLoadSdk(0, [])
            .then(ensureSdkPrepared)
            .catch((error) => {
                loadingPromise = null;
                throw error;
            });
    }

    return loadingPromise;
}
