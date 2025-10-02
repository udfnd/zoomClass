// src/CalendarView.jsx
import React, { useMemo } from 'react';

function CalendarView({ reservations }) {
    const groupedReservations = useMemo(() => {
        if (!reservations || reservations.length === 0) {
            return new Map();
        }
        const map = new Map();
        reservations.forEach((res) => {
            const date = res.startTime ? new Date(res.startTime) : null;
            if (!date || Number.isNaN(date.getTime())) {
                return;
            }
            const key = date.toISOString().split('T')[0];
            if (!map.has(key)) {
                map.set(key, []);
            }
            map.get(key).push({ ...res, date });
        });

        return new Map(
            Array.from(map.entries()).sort(([a], [b]) => (a < b ? -1 : 1))
        );
    }, [reservations]);

    if (!reservations || reservations.length === 0) {
        return (
            <div className="calendar-view">
                <h4>다가오는 수업 일정</h4>
                <p>표시할 예약된 수업이 없습니다.</p>
            </div>
        );
    }

    return (
        <div className="calendar-view">
            <h4>다가오는 수업 일정</h4>
            {[...groupedReservations.entries()].map(([dateKey, items]) => (
                <div key={dateKey} className="calendar-day">
                    <h5>{new Date(dateKey).toLocaleDateString('ko-KR')}</h5>
                    <ul>
                        {items
                            .sort((a, b) => a.date - b.date)
                            .map((res) => (
                                <li key={res.id || `${res.sessionName}-${res.startTime}`}>
                                    {res.date.toLocaleTimeString('ko-KR', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    })}
                                    {' '}- {res.sessionName} ({res.userName})
                                </li>
                            ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}

export default CalendarView;
