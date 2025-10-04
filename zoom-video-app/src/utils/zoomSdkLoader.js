// src/utils/zoomSdkLoader.js
/**
 * Zoom Meeting SDK 로더 – npm 임포트 + 로컬 자산만 사용 (CDN 비활성)
 * 이렇게 하면 source.zoom.us 차단/403/버전불일치 영향을 받지 않습니다.
 */
const SDK_VERSION = '3.11.0';
const LOCAL_ASSET_BASE = `/zoomlib/${SDK_VERSION}/lib/av`;

let activeAssetBase = LOCAL_ASSET_BASE;
let loadingPromise = null;

export function getZoomSdkAssetBase() {
    return activeAssetBase;
}

export async function loadZoomEmbeddedSdk() {
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
        try {
            // 1) npm 임포트 (권장 경로)
            const mod = await import('@zoom/meetingsdk/embedded');
            const ZoomMtgEmbedded = mod?.default || mod;
            if (!ZoomMtgEmbedded?.createClient) {
                throw new Error('Invalid @zoom/meetingsdk module export');
            }
            // 2) 자산 경로를 로컬로 고정
            activeAssetBase = LOCAL_ASSET_BASE;
            return ZoomMtgEmbedded;
        } catch (e) {
            // CDN 폴백을 쓰지 않음: 오류 메시지로 바로 안내
            throw new Error(
                [
                    'Zoom Meeting SDK 모듈 로드 실패:',
                    e?.message || String(e),
                    '→ 다음을 확인하세요:',
                    '  - npm 설치: npm i @zoom/meetingsdk@3.11.0',
                    '  - postinstall로 /public/zoomlib/3.11.0/{css,lib} 복사됨',
                    '  - client.init({ assetPath: "/zoomlib/3.11.0/lib/av" }) 경로 사용',
                ].join('\n')
            );
        }
    })();

    return loadingPromise;
}
