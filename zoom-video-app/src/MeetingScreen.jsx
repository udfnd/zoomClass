// src/MeetingScreen.jsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import ZoomVideo from '@zoom/videosdk';

// APP_KEY와 APP_SECRET은 .env 파일과 Webpack DefinePlugin을 통해 관리되어야 합니다.
// 직접 코드에 노출하는 것은 보안상 위험합니다.
// 이 예제에서는 process.env를 사용하지만, 실제 빌드 과정에서 DefinePlugin 등으로 주입되어야 합니다.
const APP_KEY    = process.env.ZOOM_SDK_KEY;

function MeetingScreen({ sessionName, userName, onLeaveMeeting }) {
    const videoRef = useRef(null);
    const client   = useRef(null);
    const [isClientInited, setIsClientInited] = useState(false);
    const [isJoined, setIsJoined] = useState(false);
    const [currentStream, setCurrentStream] = useState(null);
    const [remoteUsers, setRemoteUsers] = useState([]); // 원격 사용자 목록 상태

    const initClient = useCallback(async () => {
        if (!APP_KEY) {
            console.error('Zoom SDK Key is missing.');
            alert('Zoom SDK Key가 설정되지 않았습니다. 애플리케이션 설정을 확인해주세요.');
            onLeaveMeeting(); // SDK 키 없으면 미팅 화면 종료
            return;
        }

        client.current = ZoomVideo.createClient();
        try {
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
        console.log(`Joining session: ${sessionName} as ${userName}`);
        try {
            const tokenUrl = await window.electronAPI.getTokenUrl();
            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionName: sessionName,
                    role: 1, // 1 for host, 0 for participant (예시)
                    userIdentity: userName,
                }),
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Failed to get token: ${errorData.message || response.statusText}`);
            }
            const { token } = await response.json();

            await client.current.join(sessionName, token, userName);
            setIsJoined(true);
            console.log('Joined session successfully.');

            const stream = client.current.getMediaStream();
            setCurrentStream(stream);
            // 로컬 비디오 렌더링
            if (videoRef.current && !stream.isAudioOnly()) {
                await stream.startVideo({ videoElement: videoRef.current });
            } else {
                await stream.startAudio();
            }


        } catch (error) {
            console.error('Error joining session:', error);
            alert(`세션 참여에 실패했습니다: ${error.message}`);
            onLeaveMeeting();
        }
    }, [client, isClientInited, sessionName, userName, onLeaveMeeting]);

    useEffect(() => {
        initClient();
        return () => {
            // 컴포넌트 언마운트 시 정리 로직은 leaveCurrentSession에서 처리
        };
    }, [initClient]);

    useEffect(() => {
        if (isClientInited && sessionName && userName) {
            joinSession();
        }
    }, [isClientInited, sessionName, userName, joinSession]);


    const leaveCurrentSession = useCallback(async () => {
        if (client.current && isJoined) {
            try {
                if (currentStream) {
                    if (currentStream.isCapturingVideo()) {
                        await currentStream.stopVideo();
                    }
                    if (currentStream.isCapturingAudio()) {
                        await currentStream.stopAudio();
                    }
                }
                await client.current.leave();
                console.log('Left session.');
            } catch (error) {
                console.error('Error leaving session:', error);
            }
        }
        setIsJoined(false);
        setCurrentStream(null);
        setRemoteUsers([]);
        if (onLeaveMeeting) {
            onLeaveMeeting();
        }
    }, [client, isJoined, currentStream, onLeaveMeeting]);


    useEffect(() => {
        if (!client.current || !isJoined) return;

        const handleUserJoined = (payload) => {
            console.log('user-joined', payload);
            setRemoteUsers(client.current.getAllUser());
        };
        const handleUserLeft = (payload) => {
            console.log('user-left', payload);
            setRemoteUsers(client.current.getAllUser());
        };
        const handleStreamAdded = async (stream) => {
            console.log('Stream added:', stream);
            if (videoRef.current && !stream.isAudioOnly()) {
                // 원격 사용자 비디오를 렌더링할 별도의 video 요소를 동적으로 생성하거나 관리해야 합니다.
                // 이 예제에서는 단순화를 위해 주석 처리합니다.
                // await stream.startVideo({ videoElement: videoRef.current }); // 로컬 비디오와 겹칠 수 있음
                console.log(`Attempting to render video for user ${stream.userId}`);
                // 실제 구현에서는 각 원격 사용자를 위한 video 요소를 별도로 만들어야 합니다.
            } else {
                await stream.startAudio();
            }
        };
        const handleStreamRemoved = (stream) => {
            console.log('Stream removed:', stream);
            if (stream.isCapturingVideo()) {
                // stream.stopVideo(); // SDK가 자동으로 처리할 수 있음
            }
        };

        client.current.on('user-joined', handleUserJoined);
        client.current.on('user-left', handleUserLeft);
        client.current.on('stream-added', handleStreamAdded);
        client.current.on('stream-removed', handleStreamRemoved);
        // ... 기타 필요한 이벤트 핸들러

        return () => {
            if (client.current) {
                client.current.off('user-joined', handleUserJoined);
                client.current.off('user-left', handleUserLeft);
                client.current.off('stream-added', handleStreamAdded);
                client.current.off('stream-removed', handleStreamRemoved);
            }
        };
    }, [client, isJoined]);


    return (
        <div className="meeting-screen">
            <div className="header">English Class - {sessionName} (사용자: {userName})</div>
            <div className="video-container">
                {/* 로컬 비디오 영역 */}
                <video ref={videoRef} id="self-view-video" muted playsInline style={{ width: '320px', height: '240px', border: '1px solid #ccc' }}></video>
                {/* 원격 비디오 영역 (동적으로 추가/제거 필요) */}
                {remoteUsers.filter(user => user.userId !== client.current?.getCurrentUserInfo()?.userId).map(user => (
                    <div key={user.userId} id={`video-user-${user.userId}`} className="remote-video-placeholder">
                        {/* 여기에 각 원격 사용자의 비디오를 렌더링합니다. SDK의 renderVideo 또는 유사한 기능을 사용 */}
                        User: {user.displayName} (ID: {user.userId})
                    </div>
                ))}
            </div>
            <div className="controls">
                <button onClick={leaveCurrentSession} disabled={!isJoined}>Leave</button>
            </div>
        </div>
    );
}

export default MeetingScreen;
