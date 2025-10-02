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
            <section className="calendar-view">
                <div className="calendar-header">
                    <h2>다가오는 수업 일정</h2>
                    <p>표시할 예약된 수업이 없습니다.</p>
                </div>
            </section>
        );
    }

    return (
        <section className="calendar-view">
            <div className="calendar-header">
                <h2>다가오는 수업 일정</h2>
                <p>이번 주와 다음 주의 예약된 수업을 한눈에 확인하세요.</p>
            </div>
            <div className="calendar-grid">
                {[...groupedReservations.entries()].map(([dateKey, items]) => (
                    <article key={dateKey} className="calendar-day">
                        <header className="calendar-day__header">
                            <h3>{new Date(dateKey).toLocaleDateString('ko-KR')}</h3>
                            <span className="badge badge-light">{items.length}개 수업</span>
                        </header>
                        <ul className="calendar-day__list">
                            {items
                                .sort((a, b) => a.date - b.date)
                                .map((res) => (
                                    <li key={res.id || `${res.sessionName}-${res.startTime}`} className="calendar-entry">
                                        <span className="calendar-entry__time">
                                            {res.date.toLocaleTimeString('ko-KR', {
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </span>
                                        <div className="calendar-entry__meta">
                                            <p>{res.sessionName}</p>
                                            <span>{res.userName}</span>
                                        </div>
                                    </li>
                                ))}
                        </ul>
                    </article>
                ))}
            </div>
        </section>
    );
}

export default CalendarView;
