import React, { useState, useEffect, useCallback } from 'react';
import ReservationModal from './ReservationModal';
// import CalendarView from './CalendarView';

function LobbyScreen({ onJoinMeeting }) {
    const [newSessionName, setNewSessionName] = useState('');
    const [joinSessionName, setJoinSessionName] = useState('');
    const [userName, setUserName] = useState(`User-${Math.floor(Math.random() * 10000)}`);
    const [isReservationModalOpen, setIsReservationModalOpen] = useState(false);
    const [reservations, setReservations] = useState([]);
    const [currentDate, setCurrentDate] = useState(new Date().toLocaleDateString('ko-KR'));

    const loadReservations = useCallback(async () => {
        try {
            const savedReservations = await window.electronAPI.getStoreValue('reservations', []);
            const today = new Date().toISOString().split('T')[0];
            const todayReservations = savedReservations.filter(res => res.date === today);
            setReservations(todayReservations);
        } catch (error) {
            console.error('Failed to load reservations:', error);
        }
    }, []);

    useEffect(() => {
        const intervalId = setInterval(() => {
            setCurrentDate(new Date().toLocaleDateString('ko-KR'));
        }, 1000 * 60);
        loadReservations();
        return () => clearInterval(intervalId);
    }, [loadReservations]);


    const handleCreateSession = () => {
        if (!newSessionName.trim()) {
            alert('새로운 수업 이름을 입력해주세요.');
            return;
        }
        onJoinMeeting(newSessionName.trim(), userName.trim() || `User-${Math.floor(Math.random() * 10000)}`);
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
        loadReservations(); // 모달이 닫힐 때 예약 목록을 다시 로드
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
                            // 생성 시 입력한 사용자 이름을 참여 시에도 사용하려면 readOnly 또는 다른 방식 고려
                            // 현재는 동일한 userName 상태를 공유
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
                        {reservations.length > 0 ? (
                            <ul>
                                {reservations.map((res, index) => (
                                    <li key={res.id || index}> {/* 고유한 id가 있다면 id 사용 */}
                                        {res.time} - {res.sessionName} ({res.userName})
                                        <button onClick={() => onJoinMeeting(res.sessionName, res.userName)} style={{marginLeft: '10px'}}>바로 참여</button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p>오늘 예약된 수업이 없습니다.</p>
                        )}
                    </div>
                </aside>
            </main>
            {isReservationModalOpen && (
                <ReservationModal
                    isOpen={isReservationModalOpen}
                    onClose={handleCloseReservationModal}
                    // store prop 제거 (내부에서 window.electronAPI 사용)
                />
            )}
            {/* <CalendarView reservations={await window.electronAPI.getStoreValue('reservations', [])} /> */}
            {/* CalendarView를 직접 사용하려면, 비동기 데이터를 처리하도록 수정하거나 reservations 상태를 prop으로 전달해야 합니다. */}
            {/* 현재 LobbyScreen에서 예약 목록을 직접 표시하므로 CalendarView는 주석 처리된 대로 유지합니다. */}
        </div>
    );
}

export default LobbyScreen;
