// src/App.jsx
import React, { useState, useCallback, useEffect } from 'react';
import LobbyScreen from './LobbyScreen';
import MeetingScreen from './MeetingScreen';
import { normalizeBackendUrl } from './utils/backend';

const APP_KEY = process.env.ZOOM_SDK_KEY; // Webpack DefinePlugin을 통해 주입됨

function App() {
    const [isInMeeting, setIsInMeeting] = useState(false);
    const [meetingContext, setMeetingContext] = useState(null);
    const [backendUrl, setBackendUrl] = useState('');
    const [defaultBackendUrl, setDefaultBackendUrl] = useState('');
    const [isBackendResolved, setIsBackendResolved] = useState(false);
    const [isBackendOverrideAllowed, setIsBackendOverrideAllowed] = useState(true);

    useEffect(() => {
        let isMounted = true;

        const resolveBackendUrl = async () => {
            let resolved = process.env.BACKEND_BASE_URL || process.env.TOKEN_SERVER_URL || '';
            let override = '';

            try {
                if (window?.electronAPI?.getBackendUrl) {
                    resolved = await window.electronAPI.getBackendUrl();
                } else if (!resolved && window?.electronAPI?.getTokenUrl) {
                    resolved = await window.electronAPI.getTokenUrl();
                }
            } catch (error) {
                console.error('Failed to resolve backend URL from Electron bridge:', error);
            }

            const normalizedDefault = normalizeBackendUrl(resolved);
            const overrideAllowed = !normalizedDefault;

            try {
                if (window?.electronAPI?.getStoreValue) {
                    override = await window.electronAPI.getStoreValue('backendUrlOverride', '');
                }
            } catch (error) {
                console.warn('Failed to load backend override from persistent storage:', error);
            }

            if (!override) {
                try {
                    override = window?.localStorage?.getItem('zoomClass.backendUrl') || '';
                } catch (error) {
                    console.warn('Failed to load backend override from localStorage:', error);
                }
            }

            const normalizedOverride = overrideAllowed ? normalizeBackendUrl(override) : '';
            const nextBackend = normalizedDefault || normalizedOverride;

            if (isMounted) {
                setDefaultBackendUrl(normalizedDefault);
                setIsBackendOverrideAllowed(overrideAllowed);
                setBackendUrl(nextBackend);
                setIsBackendResolved(true);
            }
        };

        resolveBackendUrl();

        return () => {
            isMounted = false;
        };
    }, []);

    const persistBackendOverride = useCallback(
        async (value) => {
            if (!isBackendOverrideAllowed) {
                return;
            }

            const normalized = normalizeBackendUrl(value);
            try {
                if (window?.electronAPI?.setStoreValue) {
                    await window.electronAPI.setStoreValue('backendUrlOverride', normalized);
                }
            } catch (error) {
                console.warn('Failed to persist backend override to persistent storage:', error);
            }

            try {
                if (normalized) {
                    window?.localStorage?.setItem('zoomClass.backendUrl', normalized);
                } else {
                    window?.localStorage?.removeItem('zoomClass.backendUrl');
                }
            } catch (error) {
                console.warn('Failed to persist backend override to localStorage:', error);
            }
        },
        [isBackendOverrideAllowed],
    );

    const clearBackendOverride = useCallback(async () => {
        if (!isBackendOverrideAllowed) {
            return;
        }

        try {
            if (window?.electronAPI?.deleteStoreValue) {
                await window.electronAPI.deleteStoreValue('backendUrlOverride');
            }
        } catch (error) {
            console.warn('Failed to remove backend override from persistent storage:', error);
        }

        try {
            window?.localStorage?.removeItem('zoomClass.backendUrl');
        } catch (error) {
            console.warn('Failed to remove backend override from localStorage:', error);
        }
    }, [isBackendOverrideAllowed]);

    const updateBackendUrl = useCallback(
        async (nextUrl) => {
            const normalized = normalizeBackendUrl(nextUrl);
            if (!normalized) {
                throw new Error('유효한 백엔드 주소가 필요합니다.');
            }

            if (!isBackendOverrideAllowed) {
                if (normalized !== defaultBackendUrl) {
                    throw new Error('이 앱은 현재 환경 변수에 설정된 토큰 서버만 사용할 수 있습니다.');
                }

                setBackendUrl(defaultBackendUrl);
                return defaultBackendUrl;
            }

            setBackendUrl(normalized);
            await persistBackendOverride(normalized);
            return normalized;
        },
        [defaultBackendUrl, isBackendOverrideAllowed, persistBackendOverride],
    );

    const resetBackendUrl = useCallback(async () => {
        if (isBackendOverrideAllowed) {
            await clearBackendOverride();
        }

        setBackendUrl(defaultBackendUrl);
        return defaultBackendUrl;
    }, [clearBackendOverride, defaultBackendUrl, isBackendOverrideAllowed]);

    const joinMeeting = useCallback(
        (context, backendOverride) => {
            const normalizedOverride = normalizeBackendUrl(backendOverride);
            const effectiveBackend =
                isBackendOverrideAllowed && normalizedOverride ? normalizedOverride : backendUrl;

            if (!effectiveBackend) {
                alert('백엔드 서버 주소가 구성되지 않았습니다. 먼저 연결 설정을 완료해주세요.');
                return;
            }

            if (!context || !context.meetingNumber || !context.signature || !context.sdkKey) {
                alert('회의에 참여하기 위한 필수 정보가 누락되었습니다. 다시 시도해주세요.');
                return;
            }

            if (isBackendOverrideAllowed && normalizedOverride && normalizedOverride !== backendUrl) {
                setBackendUrl(normalizedOverride);
            }

            setMeetingContext({ ...context, backendUrl: effectiveBackend });
            setIsInMeeting(true);
        },
        [backendUrl, isBackendOverrideAllowed],
    );

    const leaveMeeting = useCallback(async () => {
        setIsInMeeting(false);
        setMeetingContext(null);
        // MeetingScreen 내부에서 client.leave()가 호출될 것이므로 여기서는 상태만 변경
    }, []);

    if (!APP_KEY) {
        return (
            <div className="app-status-card app-status-card--error">
                <h2>환경 설정이 필요합니다</h2>
                <p>
                    <strong>ZOOM_SDK_KEY</strong>가 설정되지 않았습니다. <code>.env</code> 파일과 Webpack 설정을 다시 확인해 주세요.
                </p>
            </div>
        );
    }

    if (!isBackendResolved) {
        return (
            <div className="app-status-card">
                <div className="loader" aria-hidden="true" />
                <h2>백엔드 연결 확인 중</h2>
                <p>
                    환경 변수 <code>BACKEND_BASE_URL</code> 또는 <code>TOKEN_SERVER_URL</code>이 올바르게 설정되어 있는지 확인해
                    주세요.
                </p>
            </div>
        );
    }

    const isBackendConfigured = Boolean(normalizeBackendUrl(backendUrl));

    return (
        <div className="app-container">
            {!isInMeeting ? (
                <LobbyScreen
                    backendUrl={backendUrl}
                    backendConfigured={isBackendConfigured}
                    defaultBackendUrl={defaultBackendUrl}
                    backendOverrideAllowed={isBackendOverrideAllowed}
                    onJoinMeeting={joinMeeting}
                    onUpdateBackendUrl={updateBackendUrl}
                    onResetBackendUrl={resetBackendUrl}
                />
            ) : (
                <MeetingScreen meetingContext={meetingContext} onLeaveMeeting={leaveMeeting} />
            )}
        </div>
    );
}

export default App;
