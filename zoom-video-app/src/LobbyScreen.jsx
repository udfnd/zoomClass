import React, { useState, useEffect, useCallback } from 'react';
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
                <h1>Zoom English Class</h1>
            </header>
            <main className="lobby-main">
                <section className="session-controls">
                    <div className="control-group">
                        <h2>새로운 수업 생성</h2>
                        <input
                            type="text"
                            placeholder="수업 이름"
                            value={newSessionName}
                            onChange={(e) => setNewSessionName(e.target.value)}
                        />
                        <input
                            type="text"
                            placeholder="사용자 이름 (기본값: 랜덤)"
                            value={userName}
                            onChange={(e) => setUserName(e.target.value)}
                        />
                        <button onClick={handleCreateSession}>생성</button>
                    </div>
                    <div className="control-group">
                        <h2>수업 참여</h2>
                        <input
                            type="text"
                            placeholder="참여할 수업 이름"
                            value={joinSessionName}
                            onChange={(e) => setJoinSessionName(e.target.value)}
                        />
                        <input
                            type="text"
                            placeholder="사용자 이름 (위와 동일)"
                            value={userName}
                            onChange={(e) => setUserName(e.target.value)}
                        />
                        <button onClick={handleJoinSession}>참여</button>
                    </div>
                </section>
                <aside className="schedule-info">
                    <div className="current-date-time">
                        <p>오늘 날짜: {currentDate}</p>
                        <button onClick={handleOpenReservationModal} className="calendar-button">
                            📅 수업 예약
                        </button>
                    </div>
                    <div className="todays-reservations">
                        <h3>오늘 예약된 수업</h3>
                        {isLoadingReservations ? (
                            <p>불러오는 중...</p>
                        ) : reservations.length > 0 ? (
                            <ul>
                                {reservations.map((res) => (
                                    <li key={res.id || `${res.sessionName}-${res.startTime}`}>
                                        {renderReservationTime(res.startTime)} - {res.sessionName} ({res.userName})
                                        <button
                                            onClick={() => onJoinMeeting(res.sessionName, res.userName)}
                                            style={{ marginLeft: '10px' }}
                                        >
                                            바로 참여
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : reservationError ? (
                            <p>{reservationError}</p>
                        ) : (
                            <p>오늘 예약된 수업이 없습니다.</p>
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
            <div style={{ padding: '0 20px 20px' }}>
                <CalendarView reservations={upcomingReservations} />
            </div>
        </div>
    );
}

export default LobbyScreen;
