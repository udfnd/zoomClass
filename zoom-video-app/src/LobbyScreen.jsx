import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReservationModal from './ReservationModal';
import CalendarView from './CalendarView';
import { getBackendLabel, normalizeBackendUrl, parseJoinLink } from './utils/backend';

function LobbyScreen({
    backendUrl,
    backendConfigured,
    defaultBackendUrl,
    onJoinMeeting,
    onUpdateBackendUrl,
    onResetBackendUrl,
}) {
    const [newSessionName, setNewSessionName] = useState('');
    const [joinSessionName, setJoinSessionName] = useState('');
    const [userName, setUserName] = useState(`User-${Math.floor(Math.random() * 10000)}`);
    const [isReservationModalOpen, setIsReservationModalOpen] = useState(false);
    const [reservations, setReservations] = useState([]);
    const [upcomingReservations, setUpcomingReservations] = useState([]);
    const [isLoadingReservations, setIsLoadingReservations] = useState(false);
    const [reservationError, setReservationError] = useState('');
    const [currentDate, setCurrentDate] = useState(new Date().toLocaleDateString('ko-KR'));

    const [backendInput, setBackendInput] = useState(backendUrl);
    const [backendMessage, setBackendMessage] = useState('');

    useEffect(() => {
        setBackendInput(backendUrl);
    }, [backendUrl]);

    useEffect(() => {
        setBackendMessage('');
    }, [backendUrl]);

    const sanitizedBackendUrl = useMemo(() => normalizeBackendUrl(backendUrl), [backendUrl]);

    const backendLabel = useMemo(() => {
        if (!backendUrl) return '구성 필요';
        return getBackendLabel(backendUrl) || '구성 필요';
    }, [backendUrl]);

    const joinLinkInfo = useMemo(() => parseJoinLink(joinSessionName), [joinSessionName]);

    const canJoinWithLinkBackend = useMemo(() => {
        if (!joinLinkInfo || !joinLinkInfo.meetingNumber) {
            return false;
        }

        if (joinLinkInfo.backendUrl) {
            return true;
        }

        return Boolean(sanitizedBackendUrl);
    }, [joinLinkInfo, sanitizedBackendUrl]);

    const fetchMeetings = useCallback(async (endpoint) => {
        if (!sanitizedBackendUrl) {
            throw new Error('Backend URL is not configured.');
        }

        const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        const response = await fetch(`${sanitizedBackendUrl}${normalizedEndpoint}`);
        if (!response.ok) {
            const bodyText = await response.text();
            throw new Error(bodyText || response.statusText);
        }
        const data = await response.json();
        return (data.meetings || []).map((meeting) => ({
            id: meeting.id,
            sessionName: meeting.session_name,
            userName: meeting.host_name,
            startTime: meeting.start_time,
        }));
    }, [sanitizedBackendUrl]);

    const loadReservations = useCallback(async () => {
        if (!sanitizedBackendUrl) {
            return;
        }
        setIsLoadingReservations(true);
        try {
            const today = new Date().toISOString().split('T')[0];
            const todays = await fetchMeetings(`/meetings?date=${today}`);
            setReservations(todays);
            setReservationError('');
        } catch (error) {
            console.error('Failed to load reservations:', error);
            setReservationError('오늘 예약된 수업을 불러오지 못했습니다.');
            setReservations([]);
        }
        setIsLoadingReservations(false);
    }, [fetchMeetings, sanitizedBackendUrl]);

    const loadUpcomingReservations = useCallback(async () => {
        if (!sanitizedBackendUrl) {
            return;
        }
        try {
            const upcoming = await fetchMeetings('/meetings?range=upcoming');
            setUpcomingReservations(upcoming);
        } catch (error) {
            console.error('Failed to load upcoming reservations:', error);
            setUpcomingReservations([]);
        }
    }, [fetchMeetings, sanitizedBackendUrl]);

    useEffect(() => {
        const intervalId = setInterval(() => {
            setCurrentDate(new Date().toLocaleDateString('ko-KR'));
        }, 1000 * 60);
        loadReservations();
        loadUpcomingReservations();
        return () => clearInterval(intervalId);
    }, [loadReservations, loadUpcomingReservations]);

    const handleCreateSession = async () => {
        if (!newSessionName.trim()) {
            alert('새로운 수업 이름을 입력해주세요.');
            return;
        }
        if (!sanitizedBackendUrl) {
            alert('백엔드 URL이 구성되지 않았습니다. 환경 변수를 확인해주세요.');
            return;
        }

        const trimmedSession = newSessionName.trim();
        const resolvedUser = userName.trim() || `User-${Math.floor(Math.random() * 10000)}`;

        try {
            const response = await fetch(`${sanitizedBackendUrl}/meeting/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic: trimmedSession,
                    hostName: resolvedUser,
                }),
            });

            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
                const detailMessage = payload.details ? ` (${payload.details})` : '';
                throw new Error(
                    (payload.error || payload.message || '수업 생성 요청이 실패했습니다.') + detailMessage,
                );
            }

            const meeting = payload.meeting || payload;
            const warnings = Array.isArray(payload.warnings)
                ? payload.warnings
                : Array.isArray(meeting.warnings)
                ? meeting.warnings
                : [];

            if (warnings.length > 0) {
                warnings.forEach((warning) => {
                    const typeLabel = warning?.type ? `[${warning.type}]` : '[warning]';
                    const message = warning?.message || '백엔드에서 경고가 전달되었습니다.';
                    const details = warning?.details ? ` (${warning.details})` : '';
                    console.warn(`${typeLabel} ${message}${details}`);
                });
            }

            if (payload.zoomMeetingCreated === false) {
                const fatalWarning =
                    warnings.find((warning) => warning?.type === 'zoom_meeting_creation') ||
                    warnings.find((warning) => warning?.type === 'zoom_api_configuration');
                const message =
                    fatalWarning?.message || 'Zoom 회의를 생성하지 못했습니다. 서버 구성을 확인해주세요.';
                const details = fatalWarning?.details ? ` (${fatalWarning.details})` : '';
                throw new Error(`${message}${details}`);
            }

            const meetingNumber = meeting.meetingNumber || meeting.meeting_id || meeting.id;
            const sdkKey = payload.sdkKey || meeting.sdkKey || '';
            const signature = meeting.signature || meeting.hostSignature;
            const zak = meeting.zak || meeting.hostZak || payload.zak || '';
            const hostEmail = payload.hostEmail || meeting.hostEmail || '';

            let resolvedSignature = signature;
            let resolvedZak = zak;
            let resolvedRole = 1;
            let resolvedHostEmail = hostEmail;
            let fallbackNotice = '';

            if (!resolvedZak || !resolvedHostEmail) {
                try {
                    const fallbackResponse = await fetch(`${sanitizedBackendUrl}/meeting/signature`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ meetingNumber, role: 0 }),
                    });

                    const fallbackPayload = await fallbackResponse.json().catch(() => ({}));

                    if (!fallbackResponse.ok) {
                        throw new Error(
                            fallbackPayload.error || fallbackPayload.message || '참가자용 회의 서명 요청이 실패했습니다.',
                        );
                    }

                    if (!fallbackPayload.signature) {
                        throw new Error('참가자용 회의 서명을 발급받지 못했습니다.');
                    }

                    resolvedSignature = fallbackPayload.signature;
                    resolvedZak = fallbackPayload.zak || '';
                    resolvedRole = 0;
                    resolvedHostEmail = '';
                    fallbackNotice =
                        '백엔드에서 호스트용 세션 정보가 완전하지 않아 참가자 권한으로 수업에 입장합니다. ' +
                        '서버에 ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET 값을 추가해 Zoom Server-to-Server OAuth를 구성하거나 ' +
                        'ZOOM_API_KEY, ZOOM_API_SECRET(더 이상 권장되지 않음)을 설정한 뒤 백엔드를 재시작하면 호스트로 입장할 수 있습니다.';
                    if (!hostEmail) {
                        fallbackNotice +=
                            '\n(참고: Zoom 호스트 이메일을 가져오지 못했습니다. Zoom API 권한 meeting:read:admin, user:read:admin 등이 부여되어 있는지 확인해주세요.)';
                    }
                } catch (fallbackError) {
                    console.warn('Failed to fallback to participant signature:', fallbackError);
                }
            }

            if (!meetingNumber || !resolvedSignature || !sdkKey) {
                throw new Error('백엔드에서 필요한 회의 정보를 받지 못했습니다.');
            }

            await loadReservations();
            await loadUpcomingReservations();

            onJoinMeeting(
                {
                    topic: meeting.topic || trimmedSession,
                    hostName: meeting.hostName || resolvedUser,
                    userName: resolvedUser,
                    meetingNumber: `${meetingNumber}`,
                    passcode: meeting.passcode || meeting.password || '',
                    signature: resolvedSignature,
                    sdkKey,
                    joinUrl: meeting.joinUrl || meeting.join_url || '',
                    shareLink: meeting.shareLink || meeting.share_link || meeting.joinHelperUrl || payload.shareLink,
                    startUrl: meeting.startUrl || meeting.start_url || '',
                    zak: resolvedZak,
                    role: resolvedRole,
                    hostEmail: resolvedHostEmail,
                    userEmail: resolvedHostEmail,
                },
                sanitizedBackendUrl,
            );

            if (fallbackNotice) {
                alert(fallbackNotice);
            }
        } catch (error) {
            console.error('Failed to create meeting:', error);
            alert(`수업 생성에 실패했습니다: ${error.message}`);
        }
    };

    const handleJoinSession = useCallback(async () => {
        if (!joinSessionName.trim()) {
            alert('참여할 수업 링크를 입력해주세요.');
            return;
        }

        if (!joinLinkInfo) {
            alert('올바른 초대 링크 형식이 아닙니다. 수업 생성 시 제공된 링크를 입력해주세요.');
            return;
        }

        if (!joinLinkInfo.meetingNumber) {
            alert('초대 링크에 회의 번호가 없습니다. 링크를 다시 확인해주세요.');
            return;
        }

        let backendForJoin = joinLinkInfo.backendUrl || sanitizedBackendUrl;

        if (!backendForJoin) {
            alert('백엔드 URL이 구성되지 않았습니다. 먼저 연결 설정을 완료해주세요.');
            return;
        }

        if (onUpdateBackendUrl && backendForJoin !== sanitizedBackendUrl) {
            try {
                backendForJoin = await onUpdateBackendUrl(backendForJoin);
            } catch (error) {
                console.error('Failed to update backend URL from join link:', error);
                alert(`링크에서 백엔드 주소를 적용하지 못했습니다: ${error.message}`);
                return;
            }
        }

        const resolvedUser = userName.trim() || `User-${Math.floor(Math.random() * 10000)}`;

        try {
            const response = await fetch(`${backendForJoin}/meeting/signature`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    meetingNumber: joinLinkInfo.meetingNumber,
                    role: 0,
                }),
            });

            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(payload.error || payload.message || '참여용 토큰을 가져오지 못했습니다.');
            }

            const signature = payload.signature || payload.participantSignature;
            if (!signature || !payload.sdkKey) {
                throw new Error('회의 참가에 필요한 정보를 받지 못했습니다.');
            }

            onJoinMeeting(
                {
                    topic: joinLinkInfo.topic || joinLinkInfo.sessionName,
                    hostName: joinLinkInfo.hostName || '',
                    userName: resolvedUser,
                    meetingNumber: `${joinLinkInfo.meetingNumber}`,
                    passcode: joinLinkInfo.passcode || '',
                    signature,
                    sdkKey: payload.sdkKey,
                    joinUrl: joinLinkInfo.joinUrl,
                    shareLink: joinLinkInfo.joinUrl,
                    zak: payload.zak || '',
                    role: 0,
                    hostEmail: payload.hostEmail || '',
                    userEmail: '',
                },
                backendForJoin,
            );
        } catch (error) {
            console.error('Failed to join meeting:', error);
            alert(`수업 참여에 실패했습니다: ${error.message}`);
        }
    }, [joinSessionName, joinLinkInfo, sanitizedBackendUrl, onUpdateBackendUrl, onJoinMeeting, userName]);

    const handleBackendSubmit = async (event) => {
        event.preventDefault();
        const normalized = normalizeBackendUrl(backendInput);
        if (!normalized) {
            setBackendMessage('올바른 형식의 주소를 입력해주세요. 예: http://192.168.0.10:4000');
            return;
        }

        if (onUpdateBackendUrl) {
            try {
                const applied = await onUpdateBackendUrl(normalized);
                setBackendInput(applied);
                setBackendMessage('백엔드 주소가 업데이트되었습니다.');
            } catch (error) {
                console.error('Failed to update backend URL:', error);
                setBackendMessage(error.message || '백엔드 주소를 업데이트하지 못했습니다.');
            }
        }
    };

    const handleBackendReset = async () => {
        if (!onResetBackendUrl) {
            return;
        }
        try {
            const restored = await onResetBackendUrl();
            setBackendInput(restored || '');
            if (!restored) {
                setBackendMessage('기본 백엔드 주소가 설정되어 있지 않습니다. 수동으로 입력해주세요.');
            } else {
                setBackendMessage('기본 백엔드 주소로 복원되었습니다.');
            }
        } catch (error) {
            console.error('Failed to reset backend URL:', error);
            setBackendMessage('백엔드 주소를 복원하지 못했습니다.');
        }
    };

    const handleOpenReservationModal = () => {
        setIsReservationModalOpen(true);
    };

    const handleCloseReservationModal = () => {
        setIsReservationModalOpen(false);
    };

    const renderReservationTime = (isoString) => {
        if (!isoString) return '시간 미정';
        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) {
            return '시간 미정';
        }
        return `${date.toLocaleDateString('ko-KR')} ${date.toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
        })}`;
    };

    return (
        <div className="lobby-screen">
            <header className="lobby-header">
                <div className="lobby-title">
                    <h1>Zoom English Class</h1>
                    <p>실시간 영어 수업을 위한 맞춤형 화상 강의실</p>
                </div>
                <div className="lobby-connection" title={backendUrl || '백엔드 설정 필요'}>
                    <span className="status-dot" aria-hidden="true" />
                    <span className="status-text">백엔드 연결</span>
                    <span className="status-detail">{backendLabel}</span>
                </div>
            </header>
            <main className="lobby-main">
                <section className="connection-settings">
                    <div className="control-card">
                        <div className="control-card__header">
                            <h2>백엔드 연결 설정</h2>
                            <p>
                                토큰 서버가 실행 중인 컴퓨터의 주소를 입력하면 여러 사람이 같은 회의에 참여할 수 있습니다. 예:{' '}
                                <code>http://192.168.0.10:4000</code>
                            </p>
                        </div>
                        <form className="form-field" onSubmit={handleBackendSubmit}>
                            <label htmlFor="backend-url">토큰 서버 주소</label>
                            <input
                                id="backend-url"
                                type="text"
                                placeholder="http://호스트-IP:4000"
                                value={backendInput || ''}
                                onChange={(e) => setBackendInput(e.target.value)}
                            />
                            <p className="backend-help-text">
                                동일한 네트워크의 다른 컴퓨터는 이 주소를 사용해 수업을 생성하고 참여할 수 있습니다.
                            </p>
                            <div className="control-card__actions">
                                <button type="submit" className="btn btn-primary">
                                    주소 적용
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-outline"
                                    onClick={handleBackendReset}
                                    disabled={!defaultBackendUrl}
                                >
                                    기본값으로 복원
                                </button>
                            </div>
                            {backendMessage && <p className="backend-status-message">{backendMessage}</p>}
                            {!backendConfigured && (
                                <p className="backend-warning">현재 백엔드가 연결되지 않았습니다. 주소를 입력해주세요.</p>
                            )}
                        </form>
                    </div>
                </section>
                <section className="session-controls">
                    <div className="control-card">
                        <div className="control-card__header">
                            <h2>새로운 수업 생성</h2>
                            <p>수업을 예약하지 않고 지금 바로 강의를 시작할 수 있어요.</p>
                        </div>
                        <div className="form-field">
                            <label htmlFor="create-session-name">수업 이름</label>
                            <input
                                id="create-session-name"
                                type="text"
                                placeholder="예: Intermediate Conversation"
                                value={newSessionName}
                                onChange={(e) => setNewSessionName(e.target.value)}
                            />
                        </div>
                        <div className="form-field">
                            <label htmlFor="create-user-name">사용자 이름</label>
                            <input
                                id="create-user-name"
                                type="text"
                                placeholder="기본값: 랜덤 생성"
                                value={userName}
                                onChange={(e) => setUserName(e.target.value)}
                            />
                        </div>
                        <div className="control-card__actions">
                            <button className="btn btn-primary" onClick={handleCreateSession} disabled={!backendConfigured}>
                                수업 생성
                            </button>
                        </div>
                    </div>
                    <div className="control-card">
                        <div className="control-card__header">
                            <h2>수업 참여</h2>
                            <p>이미 예약된 수업 이름을 입력하거나, 초대 링크를 붙여넣어 참여하세요.</p>
                        </div>
                        <div className="form-field">
                            <label htmlFor="join-session-name">참여할 수업 초대 링크</label>
                            <input
                                id="join-session-name"
                                type="text"
                                placeholder="예: http://.../join?meetingNumber=123456789&passcode=000000"
                                value={joinSessionName}
                                onChange={(e) => setJoinSessionName(e.target.value)}
                            />
                            {joinLinkInfo && (
                                <p className="form-helper-text">
                                    회의 번호 <strong>{joinLinkInfo.meetingNumber}</strong>
                                    {joinLinkInfo.topic && (
                                        <>
                                            {' '}• 수업 이름 <strong>{joinLinkInfo.topic}</strong>
                                        </>
                                    )}
                                    {joinLinkInfo.backendUrl && (
                                        <>
                                            {' '}• 백엔드 <strong>{getBackendLabel(joinLinkInfo.backendUrl)}</strong>
                                        </>
                                    )}
                                    {joinLinkInfo.passcode && (
                                        <>
                                            <br />회의 암호: <strong>{joinLinkInfo.passcode}</strong>
                                        </>
                                    )}
                                    {joinLinkInfo.displayName && (
                                        <>
                                            <br />추천 사용자 이름: <strong>{joinLinkInfo.displayName}</strong>
                                        </>
                                    )}
                                </p>
                            )}
                        </div>
                        <div className="form-field">
                            <label htmlFor="join-user-name">사용자 이름</label>
                            <input
                                id="join-user-name"
                                type="text"
                                placeholder="강사 또는 학생 이름"
                                value={userName}
                                onChange={(e) => setUserName(e.target.value)}
                            />
                        </div>
                        <div className="control-card__actions">
                            <button
                                className="btn btn-secondary"
                                onClick={handleJoinSession}
                                disabled={!backendConfigured && !canJoinWithLinkBackend}
                            >
                                수업 참여
                            </button>
                        </div>
                    </div>
                </section>
                <aside className="schedule-info">
                    <div className="schedule-header">
                        <div>
                            <p className="schedule-date">오늘 날짜 • {currentDate}</p>
                            <h3>오늘의 수업 현황</h3>
                        </div>
                        <button onClick={handleOpenReservationModal} className="btn btn-ghost">
                            📅 새 예약 만들기
                        </button>
                    </div>
                    <div className="reservation-list">
                        {isLoadingReservations ? (
                            <p className="loading-text">수업 정보를 불러오는 중입니다...</p>
                        ) : reservations.length > 0 ? (
                            reservations.map((res) => (
                                <div
                                    key={res.id || `${res.sessionName}-${res.startTime}`}
                                    className="reservation-item"
                                >
                                    <div>
                                        <p className="reservation-time">{renderReservationTime(res.startTime)}</p>
                                        <p className="reservation-meta">
                                            {res.sessionName} • {res.userName}
                                        </p>
                                    </div>
                                    <button
                                        className="btn btn-outline"
                                        onClick={() =>
                                            alert(
                                                [
                                                    '예약된 수업의 초대 링크를 사용해 참여해주세요.',
                                                    '수업 생성 시 안내된 링크를 입력하면 참가할 수 있습니다.',
                                                ].join(' '),
                                            )
                                        }
                                    >
                                        바로 참여
                                    </button>
                                </div>
                            ))
                        ) : reservationError ? (
                            <p className="error-text">{reservationError}</p>
                        ) : (
                            <div className="empty-state">
                                <h4>오늘 예약된 수업이 없어요</h4>
                                <p>오른쪽 상단의 예약 버튼을 눌러 새로운 수업을 예약해 보세요.</p>
                            </div>
                        )}
                    </div>
                </aside>
            </main>
            {isReservationModalOpen && (
                <ReservationModal
                    isOpen={isReservationModalOpen}
                    backendUrl={backendUrl}
                    onClose={handleCloseReservationModal}
                    onReservationCreated={() => {
                        loadReservations();
                        loadUpcomingReservations();
                    }}
                />
            )}
            <section className="calendar-section">
                <CalendarView reservations={upcomingReservations} />
            </section>
        </div>
    );
}

export default LobbyScreen;
