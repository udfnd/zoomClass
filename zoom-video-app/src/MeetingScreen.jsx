import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import ZoomVideo, { SharePrivilege, VideoQuality } from '@zoom/videosdk';
import { normalizeBackendUrl } from './utils/backend';

const APP_KEY = process.env.ZOOM_SDK_KEY;

const normalizeDependentAssetsPath = (value) => {
    if (!value) {
        return 'Global';
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
        return 'Global';
    }

    const lowerCased = trimmedValue.toLowerCase();
    if (lowerCased === 'global') {
        return 'Global';
    }
    if (lowerCased === 'cdn') {
        return 'CDN';
    }
    if (lowerCased === 'cn') {
        return 'CN';
    }

    return trimmedValue.endsWith('/') ? trimmedValue : `${trimmedValue}/`;
};

const SDK_DEPENDENT_ASSETS = normalizeDependentAssetsPath(
    process.env.ZOOM_SDK_DEPENDENT_ASSETS || process.env.ZOOM_SDK_LIB_URL || '',
);
const DEFAULT_SHARE_DIMENSIONS = { width: 960, height: 540 };

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

        try {
            console.log('Initializing Zoom SDK...');
            if (typeof ZoomVideo.preloadDependentAssets === 'function') {
                try {
                    ZoomVideo.preloadDependentAssets(SDK_DEPENDENT_ASSETS);
                } catch (preloadError) {
                    console.warn('Failed to preload Zoom SDK dependent assets:', preloadError);
                }
            }
            client.current = ZoomVideo.createClient();
            const initResult = await client.current.init('en-US', SDK_DEPENDENT_ASSETS, { patchJsMedia: true });
            if (initResult && typeof initResult === 'object') {
                throw new Error(initResult.reason || 'Failed to initialize Zoom SDK');
            }
            console.log('Zoom SDK initialized successfully.');
            setIsClientInited(true);
        } catch (error) {
            console.error('Error initializing Zoom SDK:', error);
            alert('Zoom SDK 초기화에 실패했습니다: ' + error.message);
            onLeaveMeeting();
        }
    }, [onLeaveMeeting]);

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
