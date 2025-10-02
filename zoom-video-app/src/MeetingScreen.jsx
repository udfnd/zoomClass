import React, { useEffect, useRef, useState, useCallback } from 'react';
import ZoomVideo from '@zoom/videosdk';

const APP_KEY = process.env.ZOOM_SDK_KEY;

function MeetingScreen({ sessionName, userName, backendUrl, onLeaveMeeting }) {
    const videoRef = useRef(null);
    const shareCanvasRef = useRef(null);
    const client = useRef(null);
    const [isClientInited, setIsClientInited] = useState(false);
    const [isJoined, setIsJoined] = useState(false);
    const [currentStream, setCurrentStream] = useState(null);
    const [remoteUsers, setRemoteUsers] = useState([]);
    const [isSharing, setIsSharing] = useState(false);
    const [activeShareUserId, setActiveShareUserId] = useState(null);

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
            client.current = ZoomVideo.createClient();
            await client.current.init('en-US', `${window.location.origin}/lib`, { patchJsMedia: true });
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
        if (!backendUrl) {
            alert('토큰 서버 주소를 찾을 수 없습니다. BACKEND_BASE_URL 구성을 확인해주세요.');
            onLeaveMeeting();
            return;
        }

        console.log(`Joining session: ${sessionName} as ${userName}`);
        try {
            const sanitizedBase = backendUrl.replace(/\/$/, '');
            const queryParams = new URLSearchParams({
                sessionName: sessionName,
                userId: userName,
            }).toString();

            const tokenEndpoint = `${sanitizedBase}/generate-token?${queryParams}`;
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

            await client.current.join(sessionName, token, userName);
            setIsJoined(true);
            console.log('Joined session successfully.');

            const stream = client.current.getMediaStream();
            setCurrentStream(stream);

            if (videoRef.current && !stream.isAudioOnly()) {
                await stream.startVideo({ videoElement: videoRef.current });
                console.log('Local video started.');
            } else if (stream.isAudioOnly()) {
                await stream.startAudio();
                console.log('Local audio started (audio only).');
            } else {
                console.warn('Video stream is available but no video element to render to. Starting audio only.');
                await stream.startAudio();
            }
        } catch (error) {
            console.error('Error joining session:', error);
            alert(`세션 참여에 실패했습니다: ${error.message}`);
            onLeaveMeeting();
        }
    }, [backendUrl, client, isClientInited, isJoined, sessionName, userName, onLeaveMeeting]);

    useEffect(() => {
        initClient();
    }, [initClient]);

    useEffect(() => {
        if (isClientInited && sessionName && userName && !isJoined) {
            joinSession();
        }
    }, [isClientInited, sessionName, userName, isJoined, joinSession]);

    const cleanupShare = useCallback(async () => {
        if (!currentStream) {
            return;
        }
        if (typeof currentStream.stopShareScreen === 'function') {
            try {
                await currentStream.stopShareScreen();
            } catch (error) {
                console.warn('Failed to stop local share screen:', error);
            }
        }
        if (typeof currentStream.stopShareView === 'function') {
            try {
                await currentStream.stopShareView();
            } catch (error) {
                console.warn('Failed to stop share view:', error);
            }
        }
        setIsSharing(false);
        setActiveShareUserId(null);
    }, [currentStream]);

    const leaveCurrentSession = useCallback(async () => {
        if (client.current && isJoined) {
            try {
                console.log('Attempting to leave session...');
                if (currentStream) {
                    await cleanupShare();
                    if (typeof currentStream.isCapturingVideo === 'function' && currentStream.isCapturingVideo()) {
                        await currentStream.stopVideo().catch((e) => console.error('Error stopping video:', e));
                        console.log('Local video stopped.');
                    }
                    if (typeof currentStream.isCapturingAudio === 'function' && currentStream.isCapturingAudio()) {
                        await currentStream.stopAudio().catch((e) => console.error('Error stopping audio:', e));
                        console.log('Local audio stopped.');
                    }
                }
                await client.current.leave(true);
                console.log('Left session successfully.');
            } catch (error) {
                console.error('Error leaving session:', error);
            }
        }
        setIsJoined(false);
        setCurrentStream(null);
        setRemoteUsers([]);
        setIsSharing(false);
        setActiveShareUserId(null);

        if (onLeaveMeeting) {
            onLeaveMeeting();
        }
    }, [client, isJoined, currentStream, cleanupShare, onLeaveMeeting]);

    const toggleScreenShare = useCallback(async () => {
        if (!currentStream || !shareCanvasRef.current) {
            alert('화면 공유를 시작할 수 없습니다. 잠시 후 다시 시도해주세요.');
            return;
        }

        try {
            const currentUserId = client.current?.getCurrentUserInfo()?.userId ?? null;
            if (!isSharing) {
                await currentStream.startShareScreen(shareCanvasRef.current);
                setIsSharing(true);
                setActiveShareUserId(currentUserId);
            } else {
                if (typeof currentStream.stopShareScreen === 'function') {
                    await currentStream.stopShareScreen();
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
    }, [currentStream, isSharing, activeShareUserId]);

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
        const handleStreamAdded = async (stream) => {
            if (!stream) return;
            const remoteUserId = stream.userId;
            const remoteVideoElement = document.getElementById(`video-user-${remoteUserId}`);

            try {
                if (remoteVideoElement && typeof stream.startVideo === 'function' && !stream.isAudioOnly()) {
                    await stream.startVideo({ videoElement: remoteVideoElement });
                } else if (typeof stream.startAudio === 'function') {
                    await stream.startAudio();
                }
            } catch (error) {
                console.error('Failed to render remote stream:', error);
            }
        };
        const handleStreamRemoved = (stream) => {
            console.log('Stream removed:', stream);
        };

        const handleShareState = async (payload) => {
            if (!currentStream) return;
            const eventState = payload?.state || payload?.action;
            const userId = payload?.userId ?? payload?.userID ?? payload?.user?.userId ?? null;

            if (!eventState) {
                return;
            }

            if (eventState === 'Start') {
                setActiveShareUserId(userId);
                if (userId === client.current?.getCurrentUserInfo()?.userId) {
                    setIsSharing(true);
                    return;
                }
                if (shareCanvasRef.current && typeof currentStream.startShareView === 'function') {
                    try {
                        await currentStream.startShareView({
                            userId,
                            shareCanvas: shareCanvasRef.current,
                        });
                    } catch (error) {
                        console.error('Failed to start share view:', error);
                    }
                }
            } else if (eventState === 'Stop') {
                if (userId === client.current?.getCurrentUserInfo()?.userId) {
                    setIsSharing(false);
                }
                setActiveShareUserId((prev) => (prev === userId ? null : prev));
                if (typeof currentStream.stopShareView === 'function') {
                    try {
                        await currentStream.stopShareView();
                    } catch (error) {
                        console.error('Failed to stop share view:', error);
                    }
                }
            }
        };

        client.current.on('user-joined', handleUserJoined);
        client.current.on('user-left', handleUserLeft);
        client.current.on('stream-added', handleStreamAdded);
        client.current.on('stream-removed', handleStreamRemoved);
        client.current.on('peer-share-state-change', handleShareState);
        client.current.on('active-share-change', handleShareState);

        return () => {
            if (client.current) {
                client.current.off('user-joined', handleUserJoined);
                client.current.off('user-left', handleUserLeft);
                client.current.off('stream-added', handleStreamAdded);
                client.current.off('stream-removed', handleStreamRemoved);
                client.current.off('peer-share-state-change', handleShareState);
                client.current.off('active-share-change', handleShareState);
            }
        };
    }, [client, currentStream, isJoined]);

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
                                    <video id={`video-user-${user.userId}`} playsInline />
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
