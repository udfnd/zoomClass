/* eslint-disable no-console */
/**
 * MeetingScreen.jsx
 *
 * 주요 변경점
 * 1) axios 제거 → fetch 사용
 * 2) import.meta 제거 → process.env.NODE_ENV 사용
 * 3) dependentAssets 소스별로 정확히 전달 (Global/CDN/CN/로컬)
 * 4) 로컬 에셋 경로 자동 탐지 및 폴백
 * 5) 에러 핸들링/로깅 강화
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import ZoomVideo from '@zoom/videosdk';

const NODE_ENV = typeof process !== 'undefined' && process.env && process.env.NODE_ENV
    ? process.env.NODE_ENV
    : 'production';

const isDev = NODE_ENV !== 'production';

/** 표준 fetch 래퍼: JSON 반환 & 에러 메시지 친절화 */
async function httpGetJson(url) {
    const res = await fetch(url, {
        // 같은 도메인(토큰 서버가 동일 호스트/포트) 쿠키를 쓰는 구성을 대비
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} for ${url}${text ? `: ${text}` : ''}`);
    }
    const data = await res.json();
    return data;
}

/**
 * 토큰 서버 엔드포인트 자동 탐색
 * - 환경변수 또는 여러 흔한 경로를 순차 시도
 * - Video SDK 토큰(JSON 키는 일반적으로 "token")
 */
async function fetchVideoSdkToken({ topic, userName }) {
    // 필요 시 .env에 ZOOM_VIDEO_TOKEN_ENDPOINT를 추가하세요 (예: http://localhost:4000/video/token)
    const envEndpoint = (typeof process !== 'undefined' && process.env && process.env.ZOOM_VIDEO_TOKEN_ENDPOINT)
        ? process.env.ZOOM_VIDEO_TOKEN_ENDPOINT
        : undefined;

    const candidates = [
        envEndpoint,
        '/video/token',
        '/api/video/token',
        '/meeting/token',           // 리포 별도 구현 대비
        'http://localhost:4000/video/token',
        'http://127.0.0.1:4000/video/token',
    ].filter(Boolean);

    let lastErr = null;
    for (const url of candidates) {
        try {
            console.log(`[Token] Trying endpoint: ${url}`);
            // 일반적으로 topic/username을 쿼리/바디로 보낼 수 있으나, 서버 구현이 달라도
            // 대부분은 서버 측에서 자체 생성하므로 파라미터 없이도 동작합니다.
            // 서버가 GET->POST JSON을 요구한다면 필요에 맞게 수정하세요.
            const data = await httpGetJson(url);
            const token = data.token || data.jwt || data.signature || data.access_token;
            if (!token) {
                throw new Error(`No token-like field in response from ${url}`);
            }
            console.log(`[Token] Success from: ${url}`);
            return token;
        } catch (e) {
            lastErr = e;
            console.warn(`[Token] Failed at ${url}:`, e?.message || e);
        }
    }
    throw new Error(`Failed to obtain Video SDK token from all candidates. Last error: ${lastErr?.message || lastErr}`);
}

/**
 * Electron Forge(Webpack) dev-server가 내보내는 정적 자산 위치를 추정
 * 빌드 로그상 main_window/lib 과 lib 모두 생성되므로 둘 다 시도
 */
function computeLocalLibCandidates() {
    // 현재 로드 경로 기준 상대 경로도 함께 검토
    const fromMainWindow = '/main_window/lib'; // electron-forge plugin-webpack가 흔히 쓰는 공개 경로
    const fromRoot = '/lib';
    const relative = 'lib';
    return [fromMainWindow, fromRoot, relative];
}

/**
 * 문서 기준 Zoom Video SDK init 시그니처:
 *   client.init(language: string, dependentAssets: 'Global'|'CDN'|'CN'|string, options?)
 * ref: https://marketplacefront.zoom.us/sdk/custom/web/modules/VideoClient.html (2.2.0)
 */
async function initZoomClientWithFallback(client) {
    // 시도 순서: Global → CDN → 로컬(main_window/lib, lib, ./lib) → CN
    // 문서상의 dependentAssets 값과 우리가 로드하려는 소스가 반드시 일치해야 함.
    const attempts = [
        { label: 'Zoom Global',      dependent: 'Global',    url: 'https://source.zoom.us/videosdk/{version}/lib' },
        { label: 'Zoom Global CDN',  dependent: 'CDN',       url: 'https://dmogdx0jrul3u.cloudfront.net/videosdk/{version}/lib' },
        // 로컬 번들: 문자열 경로 전달
        ...computeLocalLibCandidates().map(p => ({ label: `Bundled local assets (${p})`, dependent: p, url: p })),
        { label: 'Zoom China CDN',   dependent: 'CN',        url: 'https://jssdk.zoomus.cn/videosdk/{version}/lib' },
    ];

    let lastErr = null;
    for (const a of attempts) {
        try {
            console.log(`[SDK] Attempting init using ${a.label} (${a.url}) with dependentAssets=${a.dependent}`);
            await client.init('en-US', a.dependent, {
                patchJsMedia: true,           // 권장 옵션(성능/호환성)
                enforceMultipleVideos: true,  // 예시 옵션(다중 비디오 스트림)
            });
            console.log(`[SDK] Initialized successfully via ${a.label}`);
            return a; // 성공한 경로 반환
        } catch (e) {
            lastErr = e;
            console.warn(`[SDK] Failed to init via ${a.label}: ${e?.message || e}`);
        }
    }
    throw new Error(`Zoom SDK init failed for all sources. Last error: ${lastErr?.message || lastErr}`);
}

export default function MeetingScreen() {
    const clientRef = useRef(ZoomVideo.createClient());
    const [status, setStatus] = useState('대기 중');
    const [joined, setJoined] = useState(false);
    const [lastInitSource, setLastInitSource] = useState(null);
    const [error, setError] = useState(null);

    const topic = useMemo(() => 'zoom-class-session', []);
    const userName = useMemo(() => 'Teacher', []);
    const password = ''; // 필요시 세팅

    const startClass = useCallback(async () => {
        setError(null);
        setStatus('토큰 요청 중…');

        try {
            // 1) 서버에서 Video SDK 토큰 발급 받기
            const token = await fetchVideoSdkToken({ topic, userName });

            // 2) SDK 초기화 (폴백 포함)
            setStatus('Zoom SDK 초기화 중…');
            const initUsed = await initZoomClientWithFallback(clientRef.current);
            setLastInitSource(initUsed);

            // 3) 세션 조인
            setStatus('세션 참가 중…');
            await clientRef.current.join(topic, token, userName, password);
            setJoined(true);
            setStatus(`세션 참가 완료 (via ${initUsed.label})`);
            console.log('[Join] Success', { topic, userName });

            // 비디오/오디오 시작 (권한 허용 후)
            const mediaStream = clientRef.current.getMediaStream();
            try {
                await mediaStream.startVideo();
            } catch (e) {
                console.warn('[Video] startVideo failed:', e?.message || e);
            }
            try {
                await mediaStream.startAudio();
            } catch (e) {
                console.warn('[Audio] startAudio failed:', e?.message || e);
            }
        } catch (e) {
            console.error('[StartClass] Error:', e);
            setError(e?.message || String(e));
            setStatus('오류 발생');
        }
    }, [topic, userName]);

    const leaveClass = useCallback(async () => {
        try {
            await clientRef.current.leave(false);
        } catch {}
        setJoined(false);
        setStatus('대기 중');
    }, []);

    return (
        <div style={{ padding: 16 }}>
            <h2 style={{ margin: 0 }}>새로운 수업</h2>
            <p style={{ marginTop: 8, color: '#666' }}>
                환경: <strong>{NODE_ENV}</strong>
            </p>

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {!joined ? (
                    <button onClick={startClass} style={{ padding: '8px 12px', cursor: 'pointer' }}>
                        새로운 수업 생성
                    </button>
                ) : (
                    <button onClick={leaveClass} style={{ padding: '8px 12px', cursor: 'pointer' }}>
                        수업 종료
                    </button>
                )}
            </div>

            <div style={{ marginTop: 12 }}>
                <div><strong>상태:</strong> {status}</div>
                {lastInitSource && (
                    <div style={{ marginTop: 4 }}>
                        <strong>에셋 경로:</strong> {lastInitSource.label} ({lastInitSource.url})
                    </div>
                )}
                {error && (
                    <pre
                        style={{
                            marginTop: 12,
                            background: '#2b2b2b',
                            color: '#eee',
                            padding: 12,
                            borderRadius: 8,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-all',
                        }}
                    >
            {error}
          </pre>
                )}
            </div>

            {/* 비디오 렌더 타겟 예시 */}
            <div id="video-root" style={{ width: '100%', height: 480, marginTop: 16, background: '#111', borderRadius: 8 }} />
        </div>
    );
}
