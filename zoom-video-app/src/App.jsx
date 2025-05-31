// src/App.jsx
import React, { useState, useCallback } from 'react';
import LobbyScreen from './LobbyScreen';
import MeetingScreen from './MeetingScreen';

const APP_KEY = process.env.ZOOM_SDK_KEY; // Webpack DefinePlugin을 통해 주입됨

function App() {
    const [isInMeeting, setIsInMeeting] = useState(false);
    const [sessionName, setSessionName] = useState('');
    const [userName, setUserName] = useState(`User-${Math.floor(Math.random() * 10000)}`); // 임시 사용자 이름

    const joinMeeting = useCallback((name, user) => {
        if (!name || !user) {
            alert('세션 이름과 사용자 이름을 입력해주세요.');
            return;
        }
        setSessionName(name);
        setUserName(user);
        setIsInMeeting(true);
    }, []);

    const leaveMeeting = useCallback(async () => {
        setIsInMeeting(false);
        setSessionName('');
        // MeetingScreen 내부에서 client.leave()가 호출될 것이므로 여기서는 상태만 변경
    }, []);

    if (!APP_KEY) {
        return (
            <div style={{ padding: '20px', textAlign: 'center', color: 'red', fontSize: '18px' }}>
                <strong>에러:</strong> ZOOM_SDK_KEY가 설정되지 않았습니다. <code>.env</code> 파일을 확인하고 Webpack 설정을 점검해주세요.
            </div>
        );
    }

    return (
        <div className="app-container">
            {!isInMeeting ? (
                <LobbyScreen onJoinMeeting={joinMeeting} />
            ) : (
                <MeetingScreen
                    sessionName={sessionName}
                    userName={userName}
                    onLeaveMeeting={leaveMeeting}
                />
            )}
        </div>
    );
}

export default App;
