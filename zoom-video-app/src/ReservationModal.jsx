// src/ReservationModal.jsx
import React, { useState } from 'react';

function ReservationModal({ backendUrl, isOpen, onClose, onReservationCreated }) {
    const [sessionName, setSessionName] = useState('');
    const [userName, setUserName] = useState(`ReservedUser-${Math.floor(Math.random() * 1000)}`);
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [time, setTime] = useState('10:00');
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!sessionName.trim() || !date || !time) {
            alert('수업 이름, 날짜, 시간을 모두 입력해주세요.');
            return;
        }
        if (!backendUrl) {
            alert('백엔드 URL이 구성되지 않았습니다. 환경 변수를 확인해주세요.');
            return;
        }

        const scheduledDate = new Date(`${date}T${time}`);
        if (Number.isNaN(scheduledDate.getTime())) {
            alert('유효한 날짜와 시간을 입력해주세요.');
            return;
        }

        setIsSubmitting(true);
        try {
            const sanitizedBase = backendUrl.replace(/\/$/, '');
            const response = await fetch(`${sanitizedBase}/meetings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionName: sessionName.trim(),
                    hostName: userName.trim() || `ReservedUser-${Math.floor(Math.random() * 1000)}`,
                    startTime: scheduledDate.toISOString(),
                }),
            });

            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                throw new Error(errorBody.error || errorBody.message || response.statusText);
            }

            const { meeting } = await response.json();
            if (typeof onReservationCreated === 'function') {
                onReservationCreated(meeting);
            }
            alert('수업이 예약되었습니다.');
            setSessionName('');
            setUserName(`ReservedUser-${Math.floor(Math.random() * 1000)}`);
            setDate(new Date().toISOString().split('T')[0]);
            setTime('10:00');
            onClose();
        } catch (error) {
            console.error('Failed to save reservation:', error);
            alert(`예약 저장에 실패했습니다: ${error.message}`);
        } finally {
            setIsSubmitting(false);
        }
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
                        <button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? '예약 중...' : '예약하기'}
                        </button>
                        <button type="button" onClick={onClose} disabled={isSubmitting}>
                            닫기
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default ReservationModal;
