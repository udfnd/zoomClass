// src/MeetingScreen.jsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import ZoomVideo from '@zoom/videosdk';

const APP_KEY = process.env.ZOOM_SDK_KEY;

function MeetingScreen({ sessionName, userName, onLeaveMeeting }) {
    const videoRef = useRef(null);
    const client = useRef(null);
    const [isClientInited, setIsClientInited] = useState(false);
    const [isJoined, setIsJoined] = useState(false);
    const [currentStream, setCurrentStream] = useState(null);
    const [remoteUsers, setRemoteUsers] = useState([]);

    const initClient = useCallback(async () => {
        if (!APP_KEY) {
            console.error('Zoom SDK Key is missing.');
            alert('Zoom SDK Key가 설정되지 않았습니다. 애플리케이션 설정을 확인해주세요.');
            onLeaveMeeting();
            return;
        }

        if (client.current) { // 이미 초기화된 경우 중복 실행 방지
            console.log('Zoom SDK already initialized or in progress.');
            // setIsClientInited(true); // 이미 true일 수 있음
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
        if (isJoined) { // 이미 참여한 경우 중복 실행 방지
            console.log('Already joined the session.');
            return;
        }

        console.log(`Joining session: ${sessionName} as ${userName}`);
        try {
            const tokenBaseUrl = await window.electronAPI.getTokenUrl();
            if (!tokenBaseUrl) {
                throw new Error('Token server URL is not configured.');
            }

            const queryParams = new URLSearchParams({
                sessionName: sessionName,
                userId: userName,
                // role: 1 // token-server.js는 role을 query로 받지 않고, JWT 생성 시 고정값으로 사용합니다.
            }).toString();

            const tokenEndpoint = `${tokenBaseUrl}/generate-token?${queryParams}`; // 경로와 쿼리 파라미터 조합

            const response = await fetch(tokenEndpoint, { // GET 요청
                method: 'GET',
            });

            if (!response.ok) {
                let errorData;
                try {
                    errorData = await response.json();
                } catch (e) {
                    // 응답이 JSON이 아닐 경우를 대비
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
                // 비디오 스트림은 있지만 videoRef가 없는 경우 (이론적으로 발생하기 어려움)
                console.warn("Video stream is available but no video element to render to. Starting audio only.");
                await stream.startAudio();
            }

        } catch (error) {
            console.error('Error joining session:', error);
            alert(`세션 참여에 실패했습니다: ${error.message}`);
            onLeaveMeeting();
        }
    }, [client, isClientInited, isJoined, sessionName, userName, onLeaveMeeting]);

    useEffect(() => {
        initClient();
        // 컴포넌트 언마운트 시 클라이언트 정리 (필요한 경우, 현재는 leaveCurrentSession에서 처리)
        // return () => {
        //     if (client.current && client.current.isInitialized()) {
        //         // client.current.destroy(); // Video SDK에 destroy 메소드가 있는지 확인 필요
        //     }
        // };
    }, [initClient]);

    useEffect(() => {
        if (isClientInited && sessionName && userName && !isJoined) {
            joinSession();
        }
    }, [isClientInited, sessionName, userName, isJoined, joinSession]);


    const leaveCurrentSession = useCallback(async () => {
        if (client.current && isJoined) {
            try {
                console.log('Attempting to leave session...');
                if (currentStream) {
                    if (currentStream.isCapturingVideo()) {
                        await currentStream.stopVideo().catch(e => console.error("Error stopping video:", e));
                        console.log('Local video stopped.');
                    }
                    if (currentStream.isCapturingAudio()) {
                        await currentStream.stopAudio().catch(e => console.error("Error stopping audio:", e));
                        console.log('Local audio stopped.');
                    }
                }
                await client.current.leave(true); // true: end meeting for all if host, false: leave as participant
                console.log('Left session successfully.');
            } catch (error) {
                console.error('Error leaving session:', error);
            }
        }
        // 상태 초기화는 onLeaveMeeting 콜백 이후 또는 여기서 수행
        setIsJoined(false);
        setCurrentStream(null);
        setRemoteUsers([]);
        // setIsClientInited(false); // SDK를 재사용할 수 있으므로 false로 설정하지 않을 수 있음
        // client.current = null; // SDK 인스턴스 정리 (필요시)

        if (onLeaveMeeting) {
            onLeaveMeeting();
        }
    }, [client, isJoined, currentStream, onLeaveMeeting]);


    useEffect(() => {
        if (!client.current || !isJoined) return;

        const participantList = client.current.getAllUser();
        setRemoteUsers(participantList); // 초기 참여자 목록 설정
        console.log('Initial remote users:', participantList);

        const handleUserJoined = (payload) => {
            console.log('user-joined event:', payload);
            setRemoteUsers(client.current.getAllUser());
        };
        const handleUserLeft = (payload) => {
            console.log('user-left event:', payload);
            setRemoteUsers(client.current.getAllUser());
        };
        const handleStreamAdded = async (stream) => { // stream-added 이벤트는 Zoom Video SDK에서 원격 사용자의 스트림에 대한 것
            console.log('Stream added:', stream);
            const remoteUserId = stream.userId;
            const remoteVideoElement = document.getElementById(`video-user-${remoteUserId}`); // 동적으로 생성된 비디오 요소

            if (remoteVideoElement) {
                if (!stream.isAudioOnly()) {
                    await stream.startVideo({ videoElement: remoteVideoElement });
                    console.log(`Started video for remote user ${remoteUserId}`);
                } else {
                    await stream.startAudio();
                    console.log(`Started audio for remote user ${remoteUserId} (audio only)`);
                }
            } else {
                console.warn(`Video element for user ${remoteUserId} not found.`);
                // 오디오만이라도 시작 시도
                if (stream.isAudioOnly() || !stream.isCapturingVideo()) {
                    await stream.startAudio();
                }
            }
        };
        const handleStreamRemoved = (stream) => {
            console.log('Stream removed:', stream);
            // 해당 스트림을 사용하던 비디오 요소 정리 로직이 필요할 수 있음
            // 예: stream.stopVideo(), stream.stopAudio() 등. SDK가 자동으로 처리할 수도 있음.
        };
        const handlePeerVideoStateChanged = (payload) => {
            console.log('peer-video-state-changed:', payload);
            // payload: {action: 'Start' | 'Stop', userId: number}
            // 필요에 따라 원격 사용자 비디오 렌더링을 여기서도 관리할 수 있음
        };


        client.current.on('user-joined', handleUserJoined);
        client.current.on('user-left', handleUserLeft);
        client.current.on('stream-added', handleStreamAdded); // 원격 사용자 스트림 추가
        client.current.on('stream-removed', handleStreamRemoved); // 원격 사용자 스트림 제거
        client.current.on('peer-video-state-changed', handlePeerVideoStateChanged);


        return () => {
            if (client.current) {
                client.current.off('user-joined', handleUserJoined);
                client.current.off('user-left', handleUserLeft);
                client.current.off('stream-added', handleStreamAdded);
                client.current.off('stream-removed', handleStreamRemoved);
                client.current.off('peer-video-state-changed', handlePeerVideoStateChanged);

            }
        };
    }, [client, isJoined]);


    return (
        <div className="meeting-screen">
            <div className="header">English Class - {sessionName} (사용자: {userName})</div>
            <div className="video-container">
                <video ref={videoRef} id="self-view-video" muted playsInline style={{ width: '320px', height: '240px', border: '1px solid #ccc', margin: '5px' }}></video>
                {remoteUsers.filter(user => user.userId !== client.current?.getCurrentUserInfo()?.userId).map(user => (
                    <div key={user.userId} className="remote-video-container" style={{margin: '5px'}}>
                        <video id={`video-user-${user.userId}`} playsInline style={{ width: '240px', height: '180px', border: '1px solid #555', backgroundColor: '#222' }}></video>
                        <p style={{color: 'white', textAlign: 'center', fontSize: '12px'}}>{user.displayName}</p>
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
