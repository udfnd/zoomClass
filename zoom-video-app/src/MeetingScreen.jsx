import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getZoomSdkAssetBase, loadZoomEmbeddedSdk } from './utils/zoomSdkLoader';

const STATUS_LABELS = {
    idle: '대기 중',
    preparing: 'Zoom SDK 준비 중…',
    joining: '회의 참가 중…',
    joined: '회의 참가 완료',
    error: '오류 발생',
    leaving: '회의 종료 중…',
};

const formatMeetingNumber = (value) => {
    if (!value) return '';
    const digits = `${value}`.replace(/[^\d]/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
    return `${digits.slice(0, 3)} ${digits.slice(3, 7)} ${digits.slice(7)}`;
};

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (error) {
        console.warn('Failed to copy to clipboard:', error);
        return false;
    }
}

export default function MeetingScreen({ meetingContext, onLeaveMeeting }) {
    const zoomRootRef = useRef(null);
    const clientRef = useRef(null);
    const hasInitRef = useRef(false);
    const [statusKey, setStatusKey] = useState('idle');
    const [error, setError] = useState('');
    const [copyMessage, setCopyMessage] = useState('');
    const [sdkReady, setSdkReady] = useState(false);

    const info = useMemo(() => {
        if (!meetingContext) {
            return {
                topic: '',
                hostName: '',
                meetingNumber: '',
                passcode: '',
                shareLink: '',
                joinUrl: '',
                role: 0,
                zak: '',
            };
        }

        return {
            topic: meetingContext.topic || meetingContext.sessionName || '',
            hostName: meetingContext.hostName || meetingContext.userName || '',
            meetingNumber: meetingContext.meetingNumber || '',
            passcode: meetingContext.passcode || '',
            shareLink: meetingContext.shareLink || '',
            joinUrl: meetingContext.joinUrl || '',
            role: meetingContext.role ?? 0,
            zak: meetingContext.zak || '',
        };
    }, [meetingContext]);

    useEffect(() => {
        let cancelled = false;

        setStatusKey((prev) => (prev === 'idle' ? 'preparing' : prev));

        loadZoomEmbeddedSdk()
            .then((ZoomMtgEmbedded) => {
                if (cancelled) {
                    return;
                }
                const client = ZoomMtgEmbedded.createClient();
                clientRef.current = client;
                setSdkReady(true);
            })
            .catch((loadError) => {
                if (cancelled) {
                    return;
                }
                console.error('[MeetingScreen] SDK load failed:', loadError);
                setError(loadError?.message || String(loadError));
                setStatusKey('error');
            });

        return () => {
            cancelled = true;
            (async () => {
                const client = clientRef.current;
                if (!client) {
                    return;
                }
                try {
                    await client.leave();
                } catch (leaveError) {
                    console.warn('[MeetingScreen] leave on unmount failed:', leaveError);
                }
                try {
                    client.destroy?.();
                } catch (destroyError) {
                    console.warn('[MeetingScreen] destroy on unmount failed:', destroyError);
                }
                clientRef.current = null;
                hasInitRef.current = false;
            })();
        };
    }, []);

    useEffect(() => {
        const context = meetingContext;
        if (!context || !clientRef.current || !zoomRootRef.current || !sdkReady) {
            return;
        }

        if (!context.signature || !context.sdkKey || !context.meetingNumber) {
            setError('회의 정보가 부족합니다. 백엔드 설정을 다시 확인해주세요.');
            setStatusKey('error');
            return;
        }

        if (context.role === 1 && !context.zak) {
            setError(
                '호스트로 참가하려면 Zoom OAuth로 발급된 ZAK 토큰이 필요합니다. 백엔드의 ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET 설정을 확인해주세요.',
            );
            setStatusKey('error');
            return;
        }

        let cancelled = false;

        const joinMeeting = async () => {
            setError('');
            setStatusKey('preparing');

            try {
                if (!hasInitRef.current) {
                    await clientRef.current.init({
                        zoomAppRoot: zoomRootRef.current,
                        language: 'ko-KR',
                        patchJsMedia: true,
                        assetPath: getZoomSdkAssetBase(),
                        customize: {
                            meetingInfo: ['topic', 'host', 'mn', 'pwd', 'participant'],
                            video: { isResizable: true },
                        },
                    });
                    hasInitRef.current = true;
                }

                if (cancelled) {
                    return;
                }

                setStatusKey('joining');
                const joinOptions = {
                    sdkKey: context.sdkKey,
                    signature: context.signature,
                    meetingNumber: context.meetingNumber,
                    password: context.passcode || '',
                    userName: context.userName,
                };

                if (context.role === 1 && context.zak) {
                    joinOptions.zak = context.zak;
                }

                await clientRef.current.join(joinOptions);

                if (cancelled) {
                    return;
                }

                setStatusKey('joined');
            } catch (joinError) {
                if (cancelled) {
                    return;
                }

                console.error('[MeetingScreen] Failed to join meeting:', joinError);
                setError(joinError?.message || String(joinError));
                setStatusKey('error');
            }
        };

        joinMeeting();

        return () => {
            cancelled = true;
        };
    }, [meetingContext, sdkReady]);

    const handleLeaveMeeting = useCallback(async () => {
        setStatusKey('leaving');
        try {
            await clientRef.current?.leave?.();
        } catch (leaveError) {
            console.warn('[MeetingScreen] leave failed:', leaveError);
        } finally {
            onLeaveMeeting?.();
        }
    }, [onLeaveMeeting]);

    const handleCopyShareLink = useCallback(async () => {
        if (!info.shareLink) {
            setCopyMessage('공유 링크가 없습니다.');
            return;
        }
        const ok = await copyToClipboard(info.shareLink);
        setCopyMessage(ok ? '공유 링크가 복사되었습니다.' : '클립보드 복사에 실패했습니다.');
        setTimeout(() => setCopyMessage(''), 3000);
    }, [info.shareLink]);

    const statusLabel = STATUS_LABELS[statusKey] || STATUS_LABELS.idle;

    return (
        <div className="meeting-screen" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <h2 style={{ margin: 0 }}>{info.topic || 'Zoom 수업'}</h2>
                    <p style={{ margin: '4px 0 0', color: '#4b5563' }}>담당 선생님: {info.hostName || '정보 없음'}</p>
                    <p style={{ margin: '4px 0 0', color: '#6b7280' }}>
                        회의 번호: <strong>{formatMeetingNumber(info.meetingNumber)}</strong>
                        {info.passcode ? (
                            <>
                                {' '}• 회의 암호: <strong>{info.passcode}</strong>
                            </>
                        ) : null}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={handleLeaveMeeting}
                    style={{
                        padding: '10px 18px',
                        backgroundColor: '#ef4444',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 8,
                        cursor: 'pointer',
                        fontWeight: 600,
                    }}
                >
                    회의 종료
                </button>
            </header>

            <section
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                    gap: 16,
                    backgroundColor: '#f9fafb',
                    borderRadius: 16,
                    padding: 16,
                }}
            >
                <div>
                    <h3 style={{ margin: '0 0 8px' }}>회의 상태</h3>
                    <p style={{ margin: 0, color: '#1f2937', fontWeight: 600 }}>{statusLabel}</p>
                    {error && (
                        <p style={{ margin: '8px 0 0', color: '#b91c1c', whiteSpace: 'pre-wrap' }}>{error}</p>
                    )}
                </div>
                <div>
                    <h3 style={{ margin: '0 0 8px' }}>공유 링크</h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input
                            type="text"
                            readOnly
                            value={info.shareLink || info.joinUrl || ''}
                            style={{
                                flex: 1,
                                padding: '10px 12px',
                                borderRadius: 8,
                                border: '1px solid #d1d5db',
                                backgroundColor: '#fff',
                            }}
                            onFocus={(event) => event.target.select()}
                        />
                        <button
                            type="button"
                            onClick={handleCopyShareLink}
                            style={{
                                padding: '10px 16px',
                                borderRadius: 8,
                                border: '1px solid #2563eb',
                                background: '#2563eb',
                                color: '#fff',
                                cursor: 'pointer',
                                fontWeight: 600,
                            }}
                        >
                            복사
                        </button>
                    </div>
                    {copyMessage && <p style={{ margin: '8px 0 0', color: '#2563eb' }}>{copyMessage}</p>}
                </div>
            </section>

            <section
                style={{
                    flex: 1,
                    minHeight: 480,
                    borderRadius: 16,
                    overflow: 'hidden',
                    boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18)',
                    backgroundColor: '#000',
                }}
            >
                <div ref={zoomRootRef} style={{ width: '100%', height: '100%' }} />
            </section>
        </div>
    );
}
