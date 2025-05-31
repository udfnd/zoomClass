// src/ReservationModal.jsx
import React, { useState } from 'react';

function ReservationModal({ isOpen, onClose, store }) {
    const [sessionName, setSessionName] = useState('');
    const [userName, setUserName] = useState(`ReservedUser-${Math.floor(Math.random() * 1000)}`);
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]); // YYYY-MM-DD
    const [time, setTime] = useState('10:00');

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!sessionName.trim() || !date || !time) {
            alert('수업 이름, 날짜, 시간을 모두 입력해주세요.');
            return;
        }
        const newReservation = { sessionName, userName, date, time, id: Date.now() };
        const existingReservations = store.get('reservations', []);
        store.set('reservations', [...existingReservations, newReservation]);
        alert('수업이 예약되었습니다.');
        onClose();
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>수업 예약</h2>
                <form onSubmit={handleSubmit}>
                    <div>
                        <label htmlFor="res-session-name">수업 이름:</label>
                        <input
                            id="res-session-name"
                            type="text"
                            value={sessionName}
                            onChange={(e) => setSessionName(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="res-user-name">사용자 이름:</label>
                        <input
                            id="res-user-name"
                            type="text"
                            value={userName}
                            onChange={(e) => setUserName(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="res-date">날짜:</label>
                        <input
                            id="res-date"
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="res-time">시간:</label>
                        <input
                            id="res-time"
                            type="time"
                            value={time}
                            onChange={(e) => setTime(e.target.value)}
                            required
                        />
                    </div>
                    <div className="modal-actions">
                        <button type="submit">예약하기</button>
                        <button type="button" onClick={onClose}>닫기</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default ReservationModal;
