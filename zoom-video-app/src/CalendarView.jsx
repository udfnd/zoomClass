// src/CalendarView.jsx
import React from 'react';

function CalendarView({ reservations }) {
    // 이 컴포넌트는 추후 실제 캘린더 라이브러리와 연동하여 확장될 수 있습니다.
    // 현재는 LobbyScreen에서 직접 예약 목록을 표시하므로, 이 파일은 예시로 남겨둡니다.
    if (!reservations || reservations.length === 0) {
        return <p>표시할 예약된 수업이 없습니다.</p>;
    }

    return (
        <div className="calendar-view">
            <h4>전체 예약 목록 (참고용)</h4>
            <ul>
                {reservations.map(res => (
                    <li key={res.id}>
                        {res.date} {res.time} - {res.sessionName} (참여자: {res.userName})
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default CalendarView;
