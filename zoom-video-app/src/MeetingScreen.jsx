import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import ZoomVideo, { SharePrivilege, VideoQuality } from '@zoom/videosdk';
import zoomVideoSdkPackage from '@zoom/videosdk/package.json';
import { normalizeBackendUrl } from './utils/backend';

const APP_KEY = process.env.ZOOM_SDK_KEY;

const sanitizeString = (value) => {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim();
};

const removeTrailingSlash = (value) => {
    if (!value) {
        return value;
    }

    return value.replace(/\/+$/, '');
};

const SDK_PACKAGE_VERSION = sanitizeString(zoomVideoSdkPackage?.version);

const collectSdkVersions = () => {
    const versions = [];
    const addUniqueVersion = (version, { prioritize = false } = {}) => {
        const sanitizedVersion = sanitizeString(version);
        if (!sanitizedVersion) {
            return;
        }

        const alreadyIncluded = versions.includes(sanitizedVersion);
        if (alreadyIncluded) {
            return;
        }

        if (prioritize) {
            versions.unshift(sanitizedVersion);
        } else {
            versions.push(sanitizedVersion);
        }
    };

    addUniqueVersion(SDK_PACKAGE_VERSION, { prioritize: true });
    addUniqueVersion(ZoomVideo?.VERSION);
    addUniqueVersion(ZoomVideo?.version);

    const envConfiguredVersion =
        sanitizeString(process.env.ZOOM_SDK_VERSION) ||
        sanitizeString(process.env.ZOOM_SDK_LIB_VERSION);
    if (
        envConfiguredVersion &&
        SDK_PACKAGE_VERSION &&
        envConfiguredVersion !== SDK_PACKAGE_VERSION
    ) {
        console.warn(
            `Configured Zoom SDK version (${envConfiguredVersion}) differs from the installed package version (${SDK_PACKAGE_VERSION}). Attempting both to maximise compatibility.`,
        );
    }
    addUniqueVersion(envConfiguredVersion);

    if (versions.length === 0) {
        versions.push('latest');
    }

    return versions;
};

const normalizeDependentAssetsValue = (value) => {
    const trimmedValue = sanitizeString(value);
    if (!trimmedValue) {
        return '';
    }

    const lowerCased = trimmedValue.toLowerCase();
    if (lowerCased === 'global') {
        return 'Global';
    }
    if (lowerCased === 'cdn') {
        return 'CDN';
    }
    if (lowerCased === 'cn' || lowerCased === 'china') {
        return 'CN';
    }
    if (lowerCased === 'local') {
        return 'Local';
    }

    return '';
};

const SDK_DEPENDENT_ASSETS = normalizeDependentAssetsValue(process.env.ZOOM_SDK_DEPENDENT_ASSETS);
const SDK_CUSTOM_LIB_ROOT = removeTrailingSlash(sanitizeString(process.env.ZOOM_SDK_LIB_URL));
const SDK_CUSTOM_WASM_PATH = sanitizeString(process.env.ZOOM_SDK_WASM_PATH);

const DEFAULT_SHARE_DIMENSIONS = { width: 960, height: 540 };
const DEFAULT_LOCAL_ASSET_PATH = 'lib';
const ABSOLUTE_URL_REGEX = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

const ensureLeadingSlash = (value) => {
    const sanitized = sanitizeString(value);
    if (!sanitized) {
        return '/lib';
    }

    if (sanitized.startsWith('/')) {
        return sanitized;
    }

    return `/${sanitized.replace(/^\/+/, '')}`;
};

const resolveJsLibRootForRuntime = (root) => {
    const sanitized = sanitizeString(root);
    if (!sanitized) {
        return '';
    }

    if (ABSOLUTE_URL_REGEX.test(sanitized) || sanitized.startsWith('//')) {
        return removeTrailingSlash(sanitized);
    }

    if (typeof window === 'undefined') {
        return removeTrailingSlash(sanitized);
    }

    try {
        const normalized = sanitized.replace(/^\/+/, '');
        const resolvedUrl = new URL(normalized || '.', window.location.href);
        return removeTrailingSlash(resolvedUrl.toString());
    } catch (error) {
        console.warn('Failed to resolve Zoom SDK asset root path:', error);
        return removeTrailingSlash(sanitized);
    }
};

const resolveCandidateForRuntime = (candidate) => {
    if (!candidate) {
        return candidate;
    }

    let resolvedRoot = resolveJsLibRootForRuntime(candidate.jsLibRoot);
    let resolvedWasmPath =
        candidate.wasmPath === null ? null : ensureLeadingSlash(candidate.wasmPath || '/lib');

    if (candidate.isLocal) {
        const localRoot = resolveLocalLibRoot(candidate.jsLibRoot);
        resolvedRoot = removeTrailingSlash(localRoot);
        if (resolvedWasmPath !== null) {
            resolvedWasmPath = ensureLeadingSlash(candidate.wasmPath || localRoot);
        }
    }

    return {
        ...candidate,
        jsLibRoot: resolvedRoot,
        wasmPath: resolvedWasmPath,
    };
};

const validateSdkEnvironment = () => {
    if (typeof window === 'undefined') {
        return;
    }

    if (!window.isSecureContext) {
        throw new Error(
            'Zoom SDK는 보안 컨텍스트(HTTPS 또는 localhost)에서만 실행할 수 있습니다.',
        );
    }

    if (window.crossOriginIsolated !== true) {
        throw new Error(
            'Zoom SDK는 cross-origin isolation이 활성화된 환경을 필요로 합니다. 브라우저 창이 COOP 및 COEP 헤더로 격리되었는지 확인해주세요.',
        );
    }

    if (typeof window.SharedArrayBuffer !== 'function') {
        throw new Error(
            'SharedArrayBuffer를 사용할 수 없어 Zoom SDK 리소스를 불러올 수 없습니다. 브라우저 설정과 보안 헤더 구성을 확인해주세요.',
        );
    }
};

const describeCompatibilityIssues = (compatibility) => {
    if (!compatibility || typeof compatibility !== 'object') {
        return '';
    }

    const unsupported = [];
    if (compatibility.audio === false) {
        unsupported.push('오디오');
    }
    if (compatibility.video === false) {
        unsupported.push('비디오');
    }
    if (compatibility.screen === false) {
        unsupported.push('화면 공유');
    }

    return unsupported.join(', ');
};

const createAssetCandidate = (
    label,
    dependentAssets,
    jsLibRoot,
    wasmPath = '/lib',
    options = {},
) => ({
    label,
    dependentAssets,
    jsLibRoot: removeTrailingSlash(jsLibRoot),
    wasmPath,
    ...options,
});

const createVersionedCdnCandidates = (version, labelSuffix = '') => [
    createAssetCandidate(
        `Zoom Global CDN${labelSuffix}`,
        'Global',
        `https://source.zoom.us/videosdk/${version}/lib`,
    ),
    createAssetCandidate(
        `Zoom Global CDN (Backup)${labelSuffix}`,
        'Global',
        `https://dmogdx0jrul3u.cloudfront.net/videosdk/${version}/lib`,
    ),
    createAssetCandidate(
        `Zoom China CDN${labelSuffix}`,
        'CN',
        `https://jssdk.zoomus.cn/videosdk/${version}/lib`,
    ),
];

const LOCAL_ZOOM_ASSET_CANDIDATE = createAssetCandidate(
    'Bundled local assets',
    'Global',
    DEFAULT_LOCAL_ASSET_PATH,
    '/lib',
    { isLocal: true },
);

const isRunningInElectron = () => {
    if (typeof window === 'undefined') {
        return false;
    }

    try {
        return Boolean(window?.process?.versions?.electron);
    } catch (error) {
        console.warn('Failed to detect Electron environment:', error);
        return false;
    }
};

const getCspDirectiveValue = (directive) => {
    if (typeof document === 'undefined') {
        return '';
    }

    try {
        const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        const content = sanitizeString(meta?.getAttribute('content'));
        if (!content) {
            return '';
        }

        const lowerDirective = sanitizeString(directive).toLowerCase();
        if (!lowerDirective) {
            return '';
        }

        const directives = content
            .split(';')
            .map((value) => sanitizeString(value))
            .filter(Boolean);

        const matched = directives.find((entry) =>
            entry.toLowerCase().startsWith(`${lowerDirective} `),
        );

        return matched || '';
    } catch (error) {
        console.warn('Failed to inspect Content Security Policy meta tag:', error);
        return '';
    }
};

const shouldPrioritizeLocalAssets = () => {
    if (SDK_DEPENDENT_ASSETS === 'Local') {
        return true;
    }

    if (isRunningInElectron()) {
        return true;
    }

    const scriptSrcDirective = getCspDirectiveValue('script-src');
    if (!scriptSrcDirective) {
        return false;
    }

    const sources = scriptSrcDirective
        .split(/\s+/)
        .map((value) => sanitizeString(value))
        .filter(Boolean)
        .slice(1);

    if (sources.length === 0) {
        return false;
    }

    const allowsRemote = sources.some((value) => {
        if (value === '*' || value === 'https:' || value === 'data:' || value === 'blob:') {
            return true;
        }

        return /zoom(us|gov)?\.cn|zoom(us|gov)?\.com|zoom\.us|zoomgov\.com|https:\/\//i.test(value);
    });

    return !allowsRemote;
};

const resolveLocalLibRoot = (root) => {
    const sanitizedRoot = sanitizeString(root) || DEFAULT_LOCAL_ASSET_PATH;

    if (typeof window === 'undefined') {
        return removeTrailingSlash(sanitizedRoot);
    }

    const normalizedRoot = sanitizedRoot.replace(/^\/+/, '');

    try {
        if (window.location.protocol === 'file:') {
            const resolvedUrl = new URL(normalizedRoot || '.', window.location.href);
            return removeTrailingSlash(resolvedUrl.toString());
        }

        const currentPath = sanitizeString(window.location.pathname) || '';
        const cleanedPath = currentPath.replace(/\\+/g, '/');
        const segments = cleanedPath
            .split('/')
            .map((value) => sanitizeString(value))
            .filter(Boolean);

        if (segments.length > 0 && segments[segments.length - 1]?.includes('.')) {
            segments.pop();
        }

        const basePath = segments.length > 0 ? `/${segments.join('/')}` : '';
        const combinedPath = `${basePath ? `${basePath}/` : '/'}${normalizedRoot}`;
        return removeTrailingSlash(combinedPath);
    } catch (error) {
        console.warn('Failed to resolve local Zoom SDK asset root:', error);
        return removeTrailingSlash(sanitizedRoot);
    }
};

const reorderCandidatesByPreference = (candidates) => {
    if (!SDK_DEPENDENT_ASSETS || SDK_DEPENDENT_ASSETS === 'Local') {
        return candidates;
    }

    const preferred = [];
    const others = [];

    candidates.forEach((candidate) => {
        let isPreferred = false;
        if (SDK_DEPENDENT_ASSETS === 'CDN') {
            isPreferred = candidate.jsLibRoot.includes('cloudfront.net');
        } else if (SDK_DEPENDENT_ASSETS === 'Global') {
            isPreferred = candidate.jsLibRoot.includes('source.zoom.us');
        } else {
            isPreferred = candidate.dependentAssets === SDK_DEPENDENT_ASSETS;
        }

        if (isPreferred) {
            preferred.push(candidate);
        } else {
            others.push(candidate);
        }
    });

    return [...preferred, ...others];
};

const buildZoomAssetCandidates = () => {
    const candidates = [];
    const seen = new Set();

    const addCandidate = (candidate) => {
        if (!candidate || !candidate.jsLibRoot) {
            return;
        }

        const key = `${candidate.dependentAssets || 'Global'}|${candidate.jsLibRoot}|${
            candidate.wasmPath ?? 'null'
        }`;

        if (seen.has(key)) {
            return;
        }

        seen.add(key);
        candidates.push(candidate);
    };

    const prioritizeLocal = shouldPrioritizeLocalAssets();

    if (prioritizeLocal) {
        addCandidate({ ...LOCAL_ZOOM_ASSET_CANDIDATE });
    }

    if (SDK_CUSTOM_LIB_ROOT) {
        addCandidate(
            createAssetCandidate(
                'Env configured custom assets',
                SDK_DEPENDENT_ASSETS || 'Global',
                SDK_CUSTOM_LIB_ROOT,
                SDK_CUSTOM_WASM_PATH || '/lib',
            ),
        );
    }

    const versionsToTry = collectSdkVersions();
    versionsToTry.forEach((version) => {
        const versionLabelSuffix = versionsToTry.length > 1 ? ` (v${version})` : '';
        const versionedCandidates = createVersionedCdnCandidates(version, versionLabelSuffix);
        reorderCandidatesByPreference(versionedCandidates).forEach(addCandidate);
    });

    if (SDK_DEPENDENT_ASSETS === 'Local') {
        addCandidate({ ...LOCAL_ZOOM_ASSET_CANDIDATE, label: 'Env configured local assets' });
    }

    if (!prioritizeLocal) {
        addCandidate(LOCAL_ZOOM_ASSET_CANDIDATE);
    }

    return candidates;
};

function MeetingScreen({ sessionName, userName, backendUrl, onLeaveMeeting }) {
    const videoRef = useRef(null);
    const shareCanvasRef = useRef(null);
    const client = useRef(null);
    const renderedRemoteVideos = useRef(new Map());
    const hasLeftRef = useRef(false);
    const [isClientInited, setIsClientInited] = useState(false);
    const [isJoined, setIsJoined] = useState(false);
    const [currentStream, setCurrentStream] = useState(null);
    const [remoteUsers, setRemoteUsers] = useState([]);
    const [isSharing, setIsSharing] = useState(false);
    const [activeShareUserId, setActiveShareUserId] = useState(null);
    const [copyStatus, setCopyStatus] = useState('');
    const [copyStatusTone, setCopyStatusTone] = useState('success');

    const sanitizedBackendUrl = useMemo(() => normalizeBackendUrl(backendUrl), [backendUrl]);
    const assetCandidates = useMemo(buildZoomAssetCandidates, []);

    const shareableLink = useMemo(() => {
        if (!sanitizedBackendUrl || !sessionName) {
            return '';
        }

        const query = new URLSearchParams({ sessionName }).toString();
        return `${sanitizedBackendUrl}/join?${query}`;
    }, [sanitizedBackendUrl, sessionName]);

    const initClient = useCallback(async () => {
        if (!APP_KEY) {
            console.error('Zoom SDK Key is missing.');
            alert('Zoom SDK Key가 설정되지 않았습니다. 애플리케이션 설정을 확인해주세요.');
            onLeaveMeeting();
            return;
        }

        if (client.current) {
            console.log('Zoom SDK already initialized or in progress.');
            return;
        }

        let lastError = null;

        try {
            console.log('Initializing Zoom SDK...');
            setIsClientInited(false);

            try {
                validateSdkEnvironment();
            } catch (environmentError) {
                console.error('Zoom SDK environment validation failed:', environmentError);
                alert('Zoom SDK 실행 환경이 올바르게 구성되지 않았습니다: ' + environmentError.message);
                onLeaveMeeting();
                return;
            }

            const compatibility =
                typeof ZoomVideo.checkSystemRequirements === 'function'
                    ? ZoomVideo.checkSystemRequirements()
                    : null;
            const unsupportedFeatures = describeCompatibilityIssues(compatibility);
            if (unsupportedFeatures) {
                const message =
                    '현재 사용 중인 브라우저에서는 다음 기능을 지원하지 않아 Zoom SDK를 실행할 수 없습니다: ' +
                    unsupportedFeatures;
                console.error(message, compatibility);
                alert(message);
                onLeaveMeeting();
                return;
            }

            for (const candidate of assetCandidates) {
                const runtimeCandidate = resolveCandidateForRuntime(candidate);
                if (!runtimeCandidate || !runtimeCandidate.jsLibRoot) {
                    continue;
                }
                try {
                    const dependentAssetsValue = runtimeCandidate.dependentAssets || 'Global';
                    console.log(
                        `Attempting Zoom SDK initialization using ${runtimeCandidate.label} (${runtimeCandidate.jsLibRoot}) with dependentAssets=${dependentAssetsValue}.`,
                    );
                    if (typeof ZoomVideo.destroyClient === 'function') {
                        try {
                            await ZoomVideo.destroyClient();
                        } catch (destroyBeforeInitError) {
                            console.warn(
                                'Failed to destroy existing Zoom SDK client before init attempt:',
                                destroyBeforeInitError,
                            );
                        }
                    }

                    if (typeof ZoomVideo.setZoomJSLib === 'function') {
                        if (runtimeCandidate.wasmPath === null) {
                            ZoomVideo.setZoomJSLib(runtimeCandidate.jsLibRoot);
                        } else if (runtimeCandidate.wasmPath) {
                            ZoomVideo.setZoomJSLib(
                                runtimeCandidate.jsLibRoot,
                                runtimeCandidate.wasmPath,
                            );
                        } else {
                            ZoomVideo.setZoomJSLib(runtimeCandidate.jsLibRoot);
                        }
                    }

                    let preloadErrorToReport = null;
                    if (typeof ZoomVideo.preloadDependentAssets === 'function') {
                        try {
                            await ZoomVideo.preloadDependentAssets(runtimeCandidate.jsLibRoot);
                        } catch (preloadError) {
                            preloadErrorToReport =
                                preloadError instanceof Error
                                    ? preloadError
                                    : new Error(
                                          preloadError?.message ||
                                              'Unknown error occurred while preloading Zoom SDK assets.',
                                      );
                            console.warn(
                                `Failed to preload Zoom SDK dependent assets from ${runtimeCandidate.label}:`,
                                preloadErrorToReport,
                            );
                        }
                    }

                    if (preloadErrorToReport) {
                        throw preloadErrorToReport;
                    }

                    const createdClient = ZoomVideo.createClient();
                    const initResult = await createdClient.init('en-US', dependentAssetsValue, {
                        patchJsMedia: true,
                    });

                    if (initResult && typeof initResult === 'object') {
                        throw new Error(initResult.reason || 'Failed to initialize Zoom SDK');
                    }

                    client.current = createdClient;
                    console.log(
                        `Zoom SDK initialized successfully using ${runtimeCandidate.label} (${runtimeCandidate.jsLibRoot}).`,
                    );
                    setIsClientInited(true);
                    return;
                } catch (candidateError) {
                    lastError = candidateError;
                    console.error(
                        `Zoom SDK initialization failed for ${runtimeCandidate.label} (${runtimeCandidate.jsLibRoot}):`,
                        candidateError,
                    );
                    if (typeof ZoomVideo.destroyClient === 'function') {
                        try {
                            await ZoomVideo.destroyClient();
                        } catch (destroyError) {
                            console.warn(
                                'Failed to destroy Zoom SDK client after candidate failure:',
                                destroyError,
                            );
                        }
                    }
                    client.current = null;
                }
            }

            if (lastError) {
                throw lastError;
            }

            throw new Error('Failed to initialize Zoom SDK with any configured asset sources.');
        } catch (error) {
            console.error('Error initializing Zoom SDK:', error);
            if (typeof ZoomVideo.destroyClient === 'function') {
                try {
                    await ZoomVideo.destroyClient();
                } catch (destroyError) {
                    console.warn('Failed to destroy Zoom SDK client after init error:', destroyError);
                }
            }
            client.current = null;
            alert('Zoom SDK 초기화에 실패했습니다: ' + error.message);
            onLeaveMeeting();
        }
    }, [assetCandidates, onLeaveMeeting]);

    const joinSession = useCallback(async () => {
        if (!client.current || !isClientInited) {
            console.log('Client not initialized yet or initialization failed.');
            return;
        }
        if (isJoined) {
            console.log('Already joined the session.');
            return;
        }
        if (!sanitizedBackendUrl) {
            alert('토큰 서버 주소를 찾을 수 없습니다. BACKEND_BASE_URL 구성을 확인해주세요.');
            onLeaveMeeting();
            return;
        }

        console.log(`Joining session: ${sessionName} as ${userName}`);
        try {
            const queryParams = new URLSearchParams({
                sessionName: sessionName,
                userId: userName,
            }).toString();

            const tokenEndpoint = `${sanitizedBackendUrl}/generate-token?${queryParams}`;
            const response = await fetch(tokenEndpoint, { method: 'GET' });

            if (!response.ok) {
                let errorData;
                try {
                    errorData = await response.json();
                } catch (e) {
                    errorData = { message: await response.text() || response.statusText };
                }
                throw new Error(`Failed to get token: ${errorData.message || response.statusText} (Status: ${response.status})`);
            }
            const { token } = await response.json();

            if (!token) {
                throw new Error('Received an empty token.');
            }

            hasLeftRef.current = false;
            await client.current.join(sessionName, token, userName);
            setIsJoined(true);
            console.log('Joined session successfully.');

            const stream = client.current.getMediaStream();
            setCurrentStream(stream);

            if (videoRef.current && !stream.isAudioOnly()) {
                const startVideoResult = await stream.startVideo({ videoElement: videoRef.current });
                if (startVideoResult && typeof startVideoResult === 'object') {
                    throw new Error(startVideoResult.reason || 'Failed to start local video');
                }
                console.log('Local video started.');
                try {
                    const startAudioResult = await stream.startAudio();
                    if (startAudioResult && typeof startAudioResult === 'object') {
                        throw new Error(startAudioResult.reason || 'Failed to start local audio');
                    }
                    console.log('Local audio started alongside video.');
                } catch (audioError) {
                    console.error('Unable to start local audio:', audioError);
                    alert(`오디오 시작에 실패했습니다: ${audioError.message}`);
                }
            } else if (stream.isAudioOnly()) {
                const startAudioResult = await stream.startAudio();
                if (startAudioResult && typeof startAudioResult === 'object') {
                    throw new Error(startAudioResult.reason || 'Failed to start local audio');
                }
                console.log('Local audio started (audio only).');
            } else {
                console.warn('Video stream is available but no video element to render to. Starting audio only.');
                const startAudioResult = await stream.startAudio();
                if (startAudioResult && typeof startAudioResult === 'object') {
                    throw new Error(startAudioResult.reason || 'Failed to start local audio');
                }
            }
        } catch (error) {
            console.error('Error joining session:', error);
            alert(`세션 참여에 실패했습니다: ${error.message}`);
            onLeaveMeeting();
        }
    }, [sanitizedBackendUrl, client, isClientInited, isJoined, sessionName, userName, onLeaveMeeting]);

    const handleCopyLink = useCallback(async () => {
        if (!shareableLink) {
            return;
        }

        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(shareableLink);
            } else {
                const helper = document.createElement('textarea');
                helper.value = shareableLink;
                helper.setAttribute('readonly', '');
                helper.style.position = 'fixed';
                helper.style.left = '-9999px';
                document.body.appendChild(helper);
                helper.focus();
                helper.select();
                const success = document.execCommand('copy');
                document.body.removeChild(helper);
                if (!success) {
                    throw new Error('Copy command was not successful');
                }
            }
            setCopyStatusTone('success');
            setCopyStatus('링크가 복사되었습니다. 참가자에게 전달해주세요.');
        } catch (error) {
            console.error('Failed to copy share link:', error);
            setCopyStatusTone('error');
            setCopyStatus('클립보드 복사에 실패했습니다. 링크를 직접 선택해 복사해주세요.');
        }
    }, [shareableLink]);

    useEffect(() => {
        initClient();
    }, [initClient]);

    useEffect(() => {
        if (isClientInited && sessionName && userName && !isJoined) {
            joinSession();
        }
    }, [isClientInited, sessionName, userName, isJoined, joinSession]);

    useEffect(() => {
        if (!copyStatus) {
            return;
        }
        const timeoutId = setTimeout(() => {
            setCopyStatus('');
        }, 4000);
        return () => clearTimeout(timeoutId);
    }, [copyStatus]);

    useEffect(() => {
        setCopyStatus('');
        setCopyStatusTone('success');
    }, [shareableLink]);

    const cleanupRemoteVideos = useCallback(async () => {
        if (!currentStream) {
            renderedRemoteVideos.current.clear();
            return;
        }

        const stream = currentStream;
        const stopTasks = [];
        renderedRemoteVideos.current.forEach((canvas, userId) => {
            if (!canvas) {
                renderedRemoteVideos.current.delete(userId);
                return;
            }
            stopTasks.push(
                stream
                    .stopRenderVideo(canvas, userId)
                    .catch((error) => console.warn('Failed to stop remote video render:', error))
                    .finally(() => {
                        renderedRemoteVideos.current.delete(userId);
                    }),
            );
        });

        if (stopTasks.length > 0) {
            await Promise.allSettled(stopTasks);
        }
    }, [currentStream]);

    const cleanupShare = useCallback(async () => {
        if (currentStream) {
            if (typeof currentStream.stopShareView === 'function') {
                try {
                    const stopViewResult = await currentStream.stopShareView();
                    if (stopViewResult && typeof stopViewResult === 'object') {
                        console.warn('Stop share view returned warning:', stopViewResult);
                    }
                } catch (error) {
                    console.warn('Failed to stop share view:', error);
                }
            }

            if (typeof currentStream.stopShareScreen === 'function') {
                try {
                    const stopShareResult = await currentStream.stopShareScreen();
                    if (stopShareResult && typeof stopShareResult === 'object') {
                        console.warn('Stop share screen returned warning:', stopShareResult);
                    }
                } catch (error) {
                    console.warn('Failed to stop local share screen:', error);
                }
            }
        }

        setIsSharing(false);
        setActiveShareUserId(null);

        if (shareCanvasRef.current) {
            const canvas = shareCanvasRef.current;
            try {
                const context = canvas.getContext('2d');
                if (context) {
                    context.clearRect(0, 0, canvas.width, canvas.height);
                }
            } catch (error) {
                console.warn('Failed to clear share canvas:', error);
            }
            canvas.width = DEFAULT_SHARE_DIMENSIONS.width;
            canvas.height = DEFAULT_SHARE_DIMENSIONS.height;
        }
    }, [currentStream]);

    const leaveCurrentSession = useCallback(async () => {
        if (hasLeftRef.current) {
            return;
        }

        hasLeftRef.current = true;

        if (client.current && isJoined) {
            try {
                console.log('Attempting to leave session...');
                if (currentStream) {
                    await cleanupShare();
                    await cleanupRemoteVideos();
                    if (typeof currentStream.isCapturingVideo === 'function' && currentStream.isCapturingVideo()) {
                        try {
                            const stopVideoResult = await currentStream.stopVideo();
                            if (stopVideoResult && typeof stopVideoResult === 'object') {
                                console.warn('Stop video returned warning:', stopVideoResult);
                            }
                        } catch (e) {
                            console.error('Error stopping video:', e);
                        }
                        console.log('Local video stopped.');
                    }
                    if (typeof currentStream.isCapturingAudio === 'function' && currentStream.isCapturingAudio()) {
                        try {
                            const stopAudioResult = await currentStream.stopAudio();
                            if (stopAudioResult && typeof stopAudioResult === 'object') {
                                console.warn('Stop audio returned warning:', stopAudioResult);
                            }
                        } catch (e) {
                            console.error('Error stopping audio:', e);
                        }
                        console.log('Local audio stopped.');
                    }
                }
                await client.current.leave(true);
                console.log('Left session successfully.');
            } catch (error) {
                console.error('Error leaving session:', error);
            }
        }
        renderedRemoteVideos.current.clear();
        setIsJoined(false);
        setCurrentStream(null);
        setRemoteUsers([]);
        setIsSharing(false);
        setActiveShareUserId(null);

        if (onLeaveMeeting) {
            onLeaveMeeting();
        }
    }, [client, isJoined, currentStream, cleanupShare, cleanupRemoteVideos, onLeaveMeeting]);

    const toggleScreenShare = useCallback(async () => {
        if (!currentStream || !shareCanvasRef.current) {
            alert('화면 공유를 시작할 수 없습니다. 잠시 후 다시 시도해주세요.');
            return;
        }

        try {
            if (!isSharing) {
                const privilege = typeof currentStream.getSharePrivilege === 'function' ? currentStream.getSharePrivilege() : null;
                const isShareLocked = typeof currentStream.isShareLocked === 'function' ? currentStream.isShareLocked() : false;
                const currentUserInfo = client.current?.getCurrentUserInfo();
                const isPrivilegedUser = currentUserInfo?.isHost || currentUserInfo?.isManager;

                if (isShareLocked && !isPrivilegedUser) {
                    alert('호스트가 화면 공유를 잠궜습니다. 공유 권한을 요청하세요.');
                    return;
                }

                if (privilege === SharePrivilege.Locked && !isPrivilegedUser) {
                    alert('현재 역할로는 화면 공유를 시작할 수 없습니다.');
                    return;
                }
            }

            const currentUserId = client.current?.getCurrentUserInfo()?.userId ?? null;
            if (!isSharing) {
                const shareResult = await currentStream.startShareScreen(shareCanvasRef.current);
                if (shareResult && typeof shareResult === 'object') {
                    if (shareResult.reason === 'required extension') {
                        alert('Chrome 확장 프로그램 설치 후 다시 시도해주세요.');
                        return;
                    }
                    throw new Error(shareResult.reason || 'Failed to start screen share');
                }
                setIsSharing(true);
                setActiveShareUserId(currentUserId);
            } else {
                if (typeof currentStream.stopShareScreen === 'function') {
                    const stopResult = await currentStream.stopShareScreen();
                    if (stopResult && typeof stopResult === 'object') {
                        throw new Error(stopResult.reason || 'Failed to stop screen share');
                    }
                }
                setIsSharing(false);
                if (activeShareUserId === currentUserId) {
                    setActiveShareUserId(null);
                }
            }
        } catch (error) {
            console.error('Failed to toggle screen share:', error);
            alert(`화면 공유 중 오류가 발생했습니다: ${error.message}`);
        }
    }, [client, currentStream, isSharing, activeShareUserId]);

    useEffect(() => {
        if (!client.current || !isJoined) return;

        const participantList = client.current.getAllUser();
        setRemoteUsers(participantList);
        console.log('Initial remote users:', participantList);

        const handleUserJoined = () => {
            setRemoteUsers(client.current.getAllUser());
        };
        const handleUserLeft = () => {
            setRemoteUsers(client.current.getAllUser());
        };
        const handleStreamAdded = () => {
            setRemoteUsers(client.current.getAllUser());
        };
        const handleStreamRemoved = async (payload) => {
            const userId = payload?.userId ?? payload?.userID ?? payload?.user?.userId ?? null;
            if (userId != null) {
                const canvas = renderedRemoteVideos.current.get(userId);
                if (canvas && currentStream) {
                    try {
                        await currentStream.stopRenderVideo(canvas, userId);
                    } catch (error) {
                        console.warn('Failed to stop remote video after stream removal:', error);
                    }
                    renderedRemoteVideos.current.delete(userId);
                }
            }
            setRemoteUsers(client.current.getAllUser());
        };

        const handleShareState = async (payload) => {
            if (!currentStream) return;
            const eventState = payload?.state || payload?.action;
            const rawUserId =
                payload?.userId ??
                payload?.userID ??
                payload?.user?.userId ??
                payload?.activeUserId ??
                null;
            const userId =
                typeof rawUserId === 'number'
                    ? rawUserId
                    : typeof currentStream.getActiveShareUserId === 'function'
                    ? currentStream.getActiveShareUserId()
                    : null;

            if (!eventState) {
                return;
            }

            if (eventState === 'Start' || eventState === 'Active') {
                if (userId == null) {
                    return;
                }
                setActiveShareUserId(userId);
                const currentUserId = client.current?.getCurrentUserInfo()?.userId;
                if (userId === currentUserId) {
                    setIsSharing(true);
                    return;
                }
                if (shareCanvasRef.current && typeof currentStream.startShareView === 'function') {
                    try {
                        const startViewResult = await currentStream.startShareView(shareCanvasRef.current, userId);
                        if (startViewResult && typeof startViewResult === 'object') {
                            throw new Error(startViewResult.reason || 'Failed to start share view');
                        }
                    } catch (error) {
                        console.error('Failed to start share view:', error);
                    }
                }
            } else if (eventState === 'Stop' || eventState === 'Inactive') {
                const currentUserId = client.current?.getCurrentUserInfo()?.userId;
                if (userId != null && userId === currentUserId) {
                    setIsSharing(false);
                }
                setActiveShareUserId((prev) => (prev === userId || userId == null ? null : prev));
                if (typeof currentStream.stopShareView === 'function') {
                    try {
                        const stopViewResult = await currentStream.stopShareView();
                        if (stopViewResult && typeof stopViewResult === 'object') {
                            throw new Error(stopViewResult.reason || 'Failed to stop share view');
                        }
                    } catch (error) {
                        console.error('Failed to stop share view:', error);
                    }
                }
            }
        };

        const handlePassiveStopShare = async () => {
            await cleanupShare();
        };

        const handleShareDimensionChange = (payload) => {
            if (payload?.type !== 'received') {
                return;
            }
            if (!shareCanvasRef.current) {
                return;
            }
            if (typeof payload.width === 'number' && typeof payload.height === 'number') {
                shareCanvasRef.current.width = payload.width;
                shareCanvasRef.current.height = payload.height;
            }
        };

        const handlePeerVideoStateChange = async (payload) => {
            const { action, userId } = payload || {};
            if (typeof userId !== 'number') {
                return;
            }

            if (action === 'Stop' && currentStream) {
                const canvas = renderedRemoteVideos.current.get(userId);
                if (canvas) {
                    try {
                        const stopResult = await currentStream.stopRenderVideo(canvas, userId);
                        if (stopResult && typeof stopResult === 'object') {
                            console.warn('Stop remote video returned warning:', stopResult);
                        }
                    } catch (error) {
                        console.warn('Failed to stop remote video after peer state change:', error);
                    }
                    renderedRemoteVideos.current.delete(userId);
                }
            }

            setRemoteUsers(client.current.getAllUser());
        };

        const handleConnectionChange = async (payload) => {
            const state = payload?.state;
            if (!state) {
                return;
            }
            if ((state === 'Closed' || state === 'Fail') && !hasLeftRef.current) {
                console.warn('Connection state changed to', state, '- leaving session.');
                await leaveCurrentSession();
            }
        };

        client.current.on('user-joined', handleUserJoined);
        client.current.on('user-left', handleUserLeft);
        client.current.on('stream-added', handleStreamAdded);
        client.current.on('stream-removed', handleStreamRemoved);
        client.current.on('peer-share-state-change', handleShareState);
        client.current.on('active-share-change', handleShareState);
        client.current.on('passively-stop-share', handlePassiveStopShare);
        client.current.on('share-content-dimension-change', handleShareDimensionChange);
        client.current.on('peer-video-state-change', handlePeerVideoStateChange);
        client.current.on('connection-change', handleConnectionChange);

        return () => {
            if (client.current) {
                client.current.off('user-joined', handleUserJoined);
                client.current.off('user-left', handleUserLeft);
                client.current.off('stream-added', handleStreamAdded);
                client.current.off('stream-removed', handleStreamRemoved);
                client.current.off('peer-share-state-change', handleShareState);
                client.current.off('active-share-change', handleShareState);
                client.current.off('passively-stop-share', handlePassiveStopShare);
                client.current.off('share-content-dimension-change', handleShareDimensionChange);
                client.current.off('peer-video-state-change', handlePeerVideoStateChange);
                client.current.off('connection-change', handleConnectionChange);
            }
        };
    }, [client, currentStream, isJoined, cleanupShare, leaveCurrentSession]);

    useEffect(() => {
        if (!currentStream || !isJoined) {
            return;
        }

        const stream = currentStream;
        const currentUserId = client.current?.getCurrentUserInfo()?.userId ?? null;
        const activeRemoteIds = new Set();

        const isUserVideoOn = (user) => {
            if (!user) return false;
            if (typeof user.bVideoOn === 'boolean') {
                return user.bVideoOn;
            }
            if (user.videoStatus && typeof user.videoStatus.isOn === 'boolean') {
                return user.videoStatus.isOn;
            }
            return false;
        };

        remoteUsers.forEach((user) => {
            if (user.userId === currentUserId) {
                return;
            }
            const canvas = document.getElementById(`video-user-${user.userId}`);
            if (!canvas) {
                renderedRemoteVideos.current.delete(user.userId);
                return;
            }

            if (!isUserVideoOn(user)) {
                const existingCanvas = renderedRemoteVideos.current.get(user.userId);
                if (existingCanvas && currentStream) {
                    stream
                        .stopRenderVideo(existingCanvas, user.userId)
                        .catch((error) => console.warn('Failed to stop remote video render for muted user:', error))
                        .finally(() => {
                            renderedRemoteVideos.current.delete(user.userId);
                        });
                }
                return;
            }

            activeRemoteIds.add(user.userId);

            const existingCanvas = renderedRemoteVideos.current.get(user.userId);
            if (existingCanvas === canvas) {
                return;
            }

            stream
                .renderVideo(
                    canvas,
                    user.userId,
                    canvas.width || canvas.clientWidth || 640,
                    canvas.height || canvas.clientHeight || 360,
                    0,
                    0,
                    VideoQuality.Video_360P,
                )
                .then((result) => {
                    if (result && typeof result === 'object') {
                        throw new Error(result.reason || 'Remote render failed');
                    }
                    renderedRemoteVideos.current.set(user.userId, canvas);
                })
                .catch((error) => {
                    console.error('Failed to render remote video:', error);
                });
        });

        renderedRemoteVideos.current.forEach((canvas, userId) => {
            if (!activeRemoteIds.has(userId)) {
                stream
                    .stopRenderVideo(canvas, userId)
                    .catch((error) => console.warn('Failed to stop remote video render:', error))
                    .finally(() => {
                        renderedRemoteVideos.current.delete(userId);
                    });
            }
        });
    }, [remoteUsers, currentStream, isJoined]);

    useEffect(() => {
        return () => {
            cleanupRemoteVideos();
        };
    }, [cleanupRemoteVideos]);

    useEffect(() => {
        return () => {
            leaveCurrentSession();
        };
    }, [leaveCurrentSession]);

    const activeShareUserName = (() => {
        if (!activeShareUserId) return null;
        const currentUserId = client.current?.getCurrentUserInfo()?.userId;
        if (activeShareUserId === currentUserId) {
            return userName;
        }
        const remoteUser = remoteUsers.find((user) => user.userId === activeShareUserId);
        return remoteUser?.displayName || `사용자 ${activeShareUserId}`;
    })();

    return (
        <div className="meeting-screen">
            <header className="meeting-header">
                <div>
                    <h1>{sessionName}</h1>
                    <p>{userName}로 참여 중</p>
                </div>
                <div className="meeting-status">
                    <span className="badge badge-live">LIVE</span>
                    {activeShareUserName && <span className="badge badge-share">화면 공유: {activeShareUserName}</span>}
                </div>
            </header>
            {shareableLink && (
                <section className="share-link-panel" aria-label="수업 공유 링크">
                    <h2 className="section-title">참여 링크 공유</h2>
                    <div className="share-link-input">
                        <input
                            type="text"
                            value={shareableLink}
                            readOnly
                            onFocus={(event) => event.target.select()}
                            onClick={(event) => event.currentTarget.select()}
                            aria-label="현재 수업 참여 링크"
                        />
                        <button type="button" className="btn btn-outline" onClick={handleCopyLink} disabled={!shareableLink}>
                            링크 복사
                        </button>
                    </div>
                    <p className="share-link-description">
                        링크를 복사해 참가자에게 전달하거나, 로비 화면의 ‘수업 참여’ 입력란에 붙여넣으면 바로 참여할 수 있습니다.
                    </p>
                    {copyStatus && (
                        <p className={`share-link-status share-link-status--${copyStatusTone}`} role="status">
                            {copyStatus}
                        </p>
                    )}
                </section>
            )}
            <div className="meeting-content">
                <section className="video-section">
                    <h2 className="section-title">참가자 비디오</h2>
                    <div className="video-grid">
                        <div className="video-tile video-tile--local">
                            <video ref={videoRef} id="self-view-video" muted playsInline />
                            <span className="nameplate">나 ({userName})</span>
                        </div>
                        {remoteUsers
                            .filter((user) => user.userId !== client.current?.getCurrentUserInfo()?.userId)
                            .map((user) => (
                                <div key={user.userId} className="video-tile">
                                    <canvas id={`video-user-${user.userId}`} width={320} height={180} />
                                    <span className="nameplate">{user.displayName}</span>
                                </div>
                            ))}
                    </div>
                </section>
                <section className="share-section">
                    <div className="share-canvas-wrapper">
                        <canvas ref={shareCanvasRef} id="share-canvas" width={960} height={540} />
                    </div>
                    <p className="share-status-text">
                        {activeShareUserName ? `화면 공유 중: ${activeShareUserName}` : '현재 화면 공유가 없습니다.'}
                    </p>
                </section>
            </div>
            <div className="control-bar">
                <button
                    className="btn btn-primary"
                    onClick={toggleScreenShare}
                    disabled={!isJoined || !currentStream}
                    aria-pressed={isSharing}
                >
                    {isSharing ? '화면 공유 중지' : '화면 공유 시작'}
                </button>
                <button className="btn btn-danger" onClick={leaveCurrentSession} disabled={!isJoined}>
                    회의 종료
                </button>
            </div>
        </div>
    );
}

export default MeetingScreen;
