// zoom-video-app/src/utils/zoomSdkLoader.js
/**
 * Zoom Meeting SDK 로더
 * - npm 패키지 임포트 + 로컬 정적자산만 사용(CDN 비활성)
 * - dev(webpack-dev-server)와 prod(file://)에서 자산 경로를 자동 분기
 */

const SDK_VERSION = '3.11.0';
const isProd = process.env.NODE_ENV === 'production';

// dev:  http://localhost:<port>/zoomlib/3.11.0/lib/av
// prod: file://.../.webpack/renderer/main_window/zoomlib/3.11.0/lib/av
export const LOCAL_ASSET_BASE = isProd
    ? `./zoomlib/${SDK_VERSION}/lib/av`  // file:// 상대경로 (HTML과 같은 폴더)
    : `/zoomlib/${SDK_VERSION}/lib/av`;  // dev-server 절대경로

let loadingPromise = null;

export function getZoomSdkAssetBase() {
    return LOCAL_ASSET_BASE;
}

export async function loadZoomEmbeddedSdk() {
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
        try {
            // ESM 동적 import (트리셰이킹 & 코드스플리팅)
            const embedded = (await import('@zoom/meetingsdk/embedded')).default;
            const client = embedded.createClient();
            return { client };
        } catch (e) {
            // 에러 메시지 보강
            console.error('[ZoomSDK] import error:', e);
            throw new Error(
                [
                    'Zoom Meeting SDK 모듈 로드 실패',
                    e?.message ?? String(e),
                    '확인하세요:',
                    `- @zoom/meetingsdk@${SDK_VERSION} 설치 여부`,
                    `- 정적자산 복사됨: zoomlib/${SDK_VERSION}/{css,lib}`,
                    `- client.init({ assetPath: "${getZoomSdkAssetBase()}" })`,
                ].join('\n'),
            );
        }
    })();

    return loadingPromise;
}
