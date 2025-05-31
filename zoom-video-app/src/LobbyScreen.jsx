// src/LobbyScreen.jsx
import React, { useState, useEffect } from 'react';
import Store from 'electron-store';
import ReservationModal from './ReservationModal';
import CalendarView from './CalendarView'; // 간단한 버전으로 우선 구현

const store = new Store(); // 예약 데이터 저장을 위해

function LobbyScreen({ onJoinMeeting }) {
    const [newSessionName, setNewSessionName] = useState('');
    const [joinSessionName, setJoinSessionName] = useState('');
    const [userName, setUserName] = useState(`User-${Math.floor(Math.random() * 10000)}`);
    const [isReservationModalOpen, setIsReservationModalOpen] = useState(false);
    const [reservations, setReservations] = useState([]);
    const [currentDate, setCurrentDate] = useState(new Date().toLocaleDateString('ko-KR'));

    useEffect(() => {
        const intervalId = setInterval(() => {
            setCurrentDate(new Date().toLocaleDateString('ko-KR'));
        }, 1000 * 60); // 1분마다 날짜 업데이트 (필요시 조정)
        loadReservations();
        return () => clearInterval(intervalId);
    }, []);

    const loadReservations = () => {
        const savedReservations = store.get('reservations', []);
        // 오늘 날짜에 해당하는 예약만 필터링 (예시)
        const today = new Date().toISOString().split('T')[0];
        const todayReservations = savedReservations.filter(res => res.date === today);
        setReservations(todayReservations);
    };

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
        loadReservations(); // 모달 닫을 때 예약 목록 새로고침
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
                            readOnly // 생성 시 입력한 사용자 이름을 그대로 사용하거나, 별도 입력 필드 제공
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
                                    <li key={index}>
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
                    store={store}
                />
            )}
            {/* <CalendarView reservations={store.get('reservations', [])} /> */}
        </div>
    );
}

export default LobbyScreen;
