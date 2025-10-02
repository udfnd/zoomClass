import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReservationModal from './ReservationModal';
import CalendarView from './CalendarView';

function LobbyScreen({ backendUrl, onJoinMeeting }) {
    const [newSessionName, setNewSessionName] = useState('');
    const [joinSessionName, setJoinSessionName] = useState('');
    const [userName, setUserName] = useState(`User-${Math.floor(Math.random() * 10000)}`);
    const [isReservationModalOpen, setIsReservationModalOpen] = useState(false);
    const [reservations, setReservations] = useState([]);
    const [upcomingReservations, setUpcomingReservations] = useState([]);
    const [isLoadingReservations, setIsLoadingReservations] = useState(false);
    const [reservationError, setReservationError] = useState('');
    const [currentDate, setCurrentDate] = useState(new Date().toLocaleDateString('ko-KR'));

    const backendLabel = useMemo(() => {
        if (!backendUrl) return '구성 필요';
        return backendUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    }, [backendUrl]);

    const fetchMeetings = useCallback(async (endpoint) => {
        if (!backendUrl) {
            throw new Error('Backend URL is not configured.');
        }

        const sanitizedBase = backendUrl.replace(/\/$/, '');
        const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        const response = await fetch(`${sanitizedBase}${normalizedEndpoint}`);
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
    }, [backendUrl]);

    const loadReservations = useCallback(async () => {
        if (!backendUrl) {
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
    }, [backendUrl, fetchMeetings]);

    const loadUpcomingReservations = useCallback(async () => {
        if (!backendUrl) {
            return;
        }
        try {
            const upcoming = await fetchMeetings('/meetings?range=upcoming');
            setUpcomingReservations(upcoming);
        } catch (error) {
            console.error('Failed to load upcoming reservations:', error);
            setUpcomingReservations([]);
        }
    }, [backendUrl, fetchMeetings]);

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
        if (!backendUrl) {
            alert('백엔드 URL이 구성되지 않았습니다. 환경 변수를 확인해주세요.');
            return;
        }

        const trimmedSession = newSessionName.trim();
        const resolvedUser = userName.trim() || `User-${Math.floor(Math.random() * 10000)}`;
        const startTime = new Date().toISOString();

        try {
            const response = await fetch(`${backendUrl}/meetings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionName: trimmedSession,
                    hostName: resolvedUser,
                    startTime,
                }),
            });

            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                throw new Error(errorBody.error || errorBody.message || response.statusText);
            }

            await loadReservations();
            await loadUpcomingReservations();
            onJoinMeeting(trimmedSession, resolvedUser);
        } catch (error) {
            console.error('Failed to create meeting:', error);
            alert(`수업 생성에 실패했습니다: ${error.message}`);
        }
    };

    const handleJoinSession = () => {
        if (!joinSessionName.trim()) {
            alert('참여할 수업 이름을 입력해주세요.');
            return;
        }
        onJoinMeeting(joinSessionName.trim(), userName.trim() || `User-${Math.floor(Math.random() * 10000)}`);
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
                            <button className="btn btn-primary" onClick={handleCreateSession}>
                                수업 생성
                            </button>
                        </div>
                    </div>
                    <div className="control-card">
                        <div className="control-card__header">
                            <h2>수업 참여</h2>
                            <p>이미 예약된 수업이나 초대받은 세션 이름으로 참여하세요.</p>
                        </div>
                        <div className="form-field">
                            <label htmlFor="join-session-name">참여할 수업 이름</label>
                            <input
                                id="join-session-name"
                                type="text"
                                placeholder="예: Advanced Listening"
                                value={joinSessionName}
                                onChange={(e) => setJoinSessionName(e.target.value)}
                            />
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
                            <button className="btn btn-secondary" onClick={handleJoinSession}>
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
                                        onClick={() => onJoinMeeting(res.sessionName, res.userName)}
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
