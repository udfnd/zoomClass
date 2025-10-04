import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getZoomSdkAssetBase, loadZoomEmbeddedSdk } from './utils/zoomSdkLoader';

import '@zoom/meetingsdk/dist/css/bootstrap.css';
import '@zoom/meetingsdk/dist/css/react-select.css';

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

const PARTICIPANT_ID_KEYS = ['userId', 'userID', 'id', 'participantId', 'accountId', 'user_id'];
const PARTICIPANT_NAME_KEYS = ['userName', 'displayName', 'name'];

const getInitials = (name) => {
    if (!name) return '??';
    const tokens = `${name}`
        .split(/[\s\-]+/)
        .filter(Boolean)
        .slice(0, 2);
    if (tokens.length === 0) {
        return `${name}`.slice(0, 2).toUpperCase();
    }
    return tokens
        .map((token) => token.charAt(0).toUpperCase())
        .join('');
};

const resolveParticipantId = (participant) => {
    if (!participant || typeof participant !== 'object') {
        return null;
    }

    for (const key of PARTICIPANT_ID_KEYS) {
        if (participant[key] !== undefined && participant[key] !== null) {
            const value = participant[key];
            if (typeof value === 'number' && Number.isFinite(value)) {
                return value;
            }
            const parsed = Number.parseInt(value, 10);
            if (!Number.isNaN(parsed)) {
                return parsed;
            }
            return value;
        }
    }

    return null;
};

const resolveParticipantName = (participant) => {
    if (!participant || typeof participant !== 'object') {
        return '';
    }

    for (const key of PARTICIPANT_NAME_KEYS) {
        if (participant[key] && typeof participant[key] === 'string') {
            return participant[key];
        }
    }

    if (participant.user_name && typeof participant.user_name === 'string') {
        return participant.user_name;
    }

    return '';
};

const resolveAudioMuted = (participant) => {
    const status =
        participant?.audioStatus ??
        participant?.audio ??
        participant?.muted ??
        participant?.isAudioMuted ??
        participant?.isMuted;

    if (typeof status === 'boolean') {
        return status;
    }

    if (typeof status === 'string') {
        const normalized = status.trim().toLowerCase();
        return ['muted', 'off', 'mute', 'disabled', 'true'].includes(normalized);
    }

    if (status && typeof status === 'object') {
        if (typeof status.muted === 'boolean') return status.muted;
        if (typeof status.isMuted === 'boolean') return status.isMuted;
        if (typeof status.mute === 'boolean') return status.mute;
        if (typeof status.status === 'string') {
            const normalized = status.status.trim().toLowerCase();
            return ['muted', 'off', 'mute', 'disabled', 'true'].includes(normalized);
        }
    }

    return false;
};

const resolveVideoOn = (participant) => {
    const status =
        participant?.bVideoOn ??
        participant?.videoOn ??
        participant?.isVideoOn ??
        participant?.video ??
        participant?.videoStatus ??
        participant?.isVideoEnabled;

    if (typeof status === 'boolean') {
        return status;
    }

    if (typeof status === 'number') {
        return status === 1;
    }

    if (typeof status === 'string') {
        const normalized = status.trim().toLowerCase();
        return ['on', 'true', 'started', 'start', 'enabled'].includes(normalized);
    }

    if (status && typeof status === 'object') {
        if (typeof status.on === 'boolean') return status.on;
        if (typeof status.isOn === 'boolean') return status.isOn;
        if (typeof status.started === 'boolean') return status.started;
    }

    return false;
};

const resolveSharing = (participant) => {
    const status =
        participant?.shareStatus ??
        participant?.isSharing ??
        participant?.isShareOn ??
        participant?.share ??
        participant?.sharing ??
        participant?.share_info;

    if (typeof status === 'boolean') {
        return status;
    }

    if (typeof status === 'number') {
        return status === 1 || status === 2;
    }

    if (typeof status === 'string') {
        const normalized = status.trim().toLowerCase();
        return ['on', 'true', 'sharing', 'started', 'start', 'active'].includes(normalized);
    }

    if (status && typeof status === 'object') {
        if (typeof status.isSharing === 'boolean') return status.isSharing;
        if (typeof status.sharing === 'boolean') return status.sharing;
        if (typeof status.active === 'boolean') return status.active;
        if (typeof status.state === 'string') {
            const normalized = status.state.trim().toLowerCase();
            return ['sharing', 'start', 'started', 'active'].includes(normalized);
        }
    }

    return false;
};

const normalizeParticipant = (participant, localUserId, fallbackName = '') => {
    const rawId = resolveParticipantId(participant);
    const id = rawId != null ? `${rawId}` : null;
    const videoUserId = rawId != null && Number.isFinite(Number(rawId)) ? Number(rawId) : rawId ?? id;
    const name = resolveParticipantName(participant) || fallbackName || (id ? `참가자 ${id}` : '참가자');
    const isMuted = resolveAudioMuted(participant);
    const isVideoOn = resolveVideoOn(participant);
    const isSharing = resolveSharing(participant);
    const isSelfCandidate = Boolean(
        participant?.isMe ||
            participant?.isSelf ||
            participant?.self ||
            participant?.isHostCurrentUser ||
            (localUserId != null && (rawId === localUserId || `${rawId}` === `${localUserId}`)),
    );

    return {
        id,
        videoUserId,
        name,
        isMuted,
        isVideoOn,
        isSharing,
        isSelf: isSelfCandidate,
        raw: participant,
    };
};

const fetchParticipants = async (client) => {
    const candidateFns = [
        () => client?.getParticipantsList?.(),
        () => client?.getAttendeeslist?.(),
        () => client?.getParticipantslist?.(),
        () => client?.getAllUser?.(),
    ];

    for (const getter of candidateFns) {
        if (typeof getter !== 'function') {
            continue;
        }
        try {
            const result = getter();
            const list = result && typeof result.then === 'function' ? await result : result;
            if (Array.isArray(list)) {
                return list;
            }
            if (list && Array.isArray(list.participants)) {
                return list.participants;
            }
        } catch (error) {
            console.warn('[MeetingScreen] Failed to fetch participants:', error);
        }
    }

    return [];
};

const castUserIdForMediaStream = (value) => {
    if (value == null) {
        return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
        return parsed;
    }
    return value;
};

const MEDIA_STREAM_METHOD_CANDIDATES = {
    startVideo: ['startVideo', 'resumeVideo', 'unmuteVideo', 'startCamera', 'startVideoTrack'],
    stopVideo: ['stopVideo', 'muteVideo', 'pauseVideo', 'stopCamera', 'stopVideoTrack'],
};

const invokeMediaStreamMethod = async (stream, methodNames, args = []) => {
    if (!stream || !Array.isArray(methodNames) || methodNames.length === 0) {
        return { ok: false, errors: [] };
    }

    const errors = [];

    for (const name of methodNames) {
        const candidate = stream?.[name];
        if (typeof candidate !== 'function') {
            continue;
        }

        try {
            const result = candidate.apply(stream, args);
            const awaited = result && typeof result.then === 'function' ? await result : result;
            return { ok: true, method: name, result: awaited };
        } catch (error) {
            errors.push({ name, error });
        }
    }

    return { ok: false, errors };
};

export default function MeetingScreen({ meetingContext, onLeaveMeeting }) {
    const zoomRootRef = useRef(null);
    const clientRef = useRef(null);
    const hasInitRef = useRef(false);
    const mediaStreamRef = useRef(null);
    const canvasRefs = useRef(new Map());
    const shareCanvasRef = useRef(null);
    const participantPollRef = useRef(null);
    const controlMessageTimerRef = useRef(null);
    const localUserIdRef = useRef(null);
    const previousParticipantIdsRef = useRef(new Set());

    const [statusKey, setStatusKey] = useState('idle');
    const [error, setError] = useState('');
    const [copyMessage, setCopyMessage] = useState('');
    const [sdkReady, setSdkReady] = useState(false);
    const [participants, setParticipants] = useState([]);
    const [isAudioMuted, setIsAudioMuted] = useState(false);
    const [isVideoOn, setIsVideoOn] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [isMediaReady, setIsMediaReady] = useState(false);
    const [controlMessage, setControlMessage] = useState('');
    const [controlMessageType, setControlMessageType] = useState('info');
    const [sharingParticipant, setSharingParticipant] = useState(null);
    const [isZoomPanelVisible, setIsZoomPanelVisible] = useState(false);

    const isMountedRef = useRef(true);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const safeSetMediaReady = useCallback((nextValue) => {
        if (isMountedRef.current) {
            setIsMediaReady(nextValue);
        }
    }, []);

    const tryAcquireMediaStream = useCallback(async () => {
        const client = clientRef.current;
        if (!client) {
            mediaStreamRef.current = null;
            safeSetMediaReady(false);
            return null;
        }

        let stream = null;

        try {
            const candidate = client.getMediaStream?.();
            stream = candidate && typeof candidate.then === 'function' ? await candidate : candidate;
        } catch (mediaStreamError) {
            console.warn('[MeetingScreen] Failed to obtain media stream from client:', mediaStreamError);
        }

        if (!stream && client.mediaStream) {
            stream = client.mediaStream;
        }

        if (!stream) {
            safeSetMediaReady(false);
            return null;
        }

        mediaStreamRef.current = stream;
        safeSetMediaReady(true);
        return stream;
    }, [safeSetMediaReady]);

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
                hostEmail: '',
                userEmail: '',
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
            hostEmail: meetingContext.hostEmail || meetingContext.userEmail || '',
            userEmail: meetingContext.userEmail || '',
        };
    }, [meetingContext]);

    const showControlFeedback = useCallback((type, message) => {
        if (controlMessageTimerRef.current) {
            clearTimeout(controlMessageTimerRef.current);
            controlMessageTimerRef.current = null;
        }
        setControlMessageType(type);
        setControlMessage(message);
        if (message) {
            controlMessageTimerRef.current = window.setTimeout(() => {
                setControlMessage('');
            }, 4000);
        }
    }, []);

    const renderVideoForParticipant = useCallback((participant) => {
        if (!participant?.id) {
            return;
        }
        const stream = mediaStreamRef.current;
        if (!stream) {
            return;
        }
        const canvas = canvasRefs.current.get(participant.id);
        if (!canvas || !participant.isVideoOn) {
            return;
        }
        const width = canvas.clientWidth || canvas.offsetWidth || 320;
        const height = canvas.clientHeight || canvas.offsetHeight || 180;
        if (width > 0 && height > 0) {
            if (canvas.width !== width) {
                canvas.width = width;
            }
            if (canvas.height !== height) {
                canvas.height = height;
            }
        }
        try {
            stream.renderVideo?.(canvas, castUserIdForMediaStream(participant.videoUserId ?? participant.id), width, height, 0, 0, 2);
        } catch (renderError) {
            console.warn(`[MeetingScreen] renderVideo failed for participant ${participant.id}:`, renderError);
        }
    }, []);

    const stopVideoForParticipant = useCallback((participant) => {
        if (!participant?.id) {
            return;
        }
        const stream = mediaStreamRef.current;
        const canvas = canvasRefs.current.get(participant.id);
        if (!stream || !canvas) {
            return;
        }
        try {
            stream.stopRenderVideo?.(canvas, castUserIdForMediaStream(participant.videoUserId ?? participant.id));
        } catch (stopError) {
            console.warn(`[MeetingScreen] stopRenderVideo failed for participant ${participant.id}:`, stopError);
        }
        const ctx = canvas.getContext?.('2d');
        if (ctx) {
            ctx.clearRect(0, 0, canvas.width || 0, canvas.height || 0);
        }
    }, []);

    const renderShareCanvas = useCallback(() => {
        const stream = mediaStreamRef.current;
        const canvas = shareCanvasRef.current;
        if (!stream || !canvas) {
            return;
        }

        const width = canvas.clientWidth || canvas.offsetWidth || 640;
        const height = canvas.clientHeight || canvas.offsetHeight || 360;
        if (canvas.width !== width) {
            canvas.width = width;
        }
        if (canvas.height !== height) {
            canvas.height = height;
        }

        try {
            if (typeof stream.renderShare === 'function') {
                stream.renderShare(canvas, width, height, 0, 0, 2);
            } else if (typeof stream.renderShareCanvas === 'function') {
                stream.renderShareCanvas(canvas, width, height, 0, 0);
            } else if (typeof stream.startShareRender === 'function') {
                stream.startShareRender(canvas, width, height, 0, 0);
            }
        } catch (renderError) {
            console.warn('[MeetingScreen] renderShare failed:', renderError);
        }
    }, []);

    const stopShareCanvas = useCallback(() => {
        const stream = mediaStreamRef.current;
        const canvas = shareCanvasRef.current;
        if (!stream || !canvas) {
            return;
        }
        try {
            stream.stopRenderShare?.(canvas);
        } catch (stopError) {
            console.warn('[MeetingScreen] stopRenderShare failed:', stopError);
        }
        const ctx = canvas.getContext?.('2d');
        if (ctx) {
            ctx.clearRect(0, 0, canvas.width || 0, canvas.height || 0);
        }
    }, []);

    const updateParticipantsList = useCallback(async () => {
        const client = clientRef.current;
        if (!client) {
            mediaStreamRef.current = null;
            safeSetMediaReady(false);
            return;
        }

        if (!mediaStreamRef.current) {
            await tryAcquireMediaStream();
        }

        const rawList = await fetchParticipants(client);
        const normalized = rawList
            .map((participant) => normalizeParticipant(participant, localUserIdRef.current, info.userName))
            .filter((participant) => participant.id != null);

        if (!localUserIdRef.current) {
            const selfCandidate =
                normalized.find((participant) => participant.isSelf) ||
                normalized.find((participant) => participant.name === info.userName);
            if (selfCandidate?.videoUserId != null) {
                localUserIdRef.current = selfCandidate.videoUserId;
                normalized.forEach((participant) => {
                    if (participant.videoUserId === localUserIdRef.current || participant.id === `${localUserIdRef.current}`) {
                        participant.isSelf = true;
                    }
                });
            }
        }

        setParticipants(normalized);

        const me = normalized.find((participant) => participant.isSelf);
        if (me) {
            setIsAudioMuted(Boolean(me.isMuted));
            setIsVideoOn(Boolean(me.isVideoOn));
        }

        const activeShare = normalized.find((participant) => participant.isSharing);
        setSharingParticipant(activeShare || null);
        setIsScreenSharing(Boolean(activeShare?.isSelf));
    }, [info.userName, safeSetMediaReady, tryAcquireMediaStream]);

    const scheduleParticipantPolling = useCallback(() => {
        if (participantPollRef.current) {
            clearTimeout(participantPollRef.current);
            participantPollRef.current = null;
        }

        const poll = async () => {
            await updateParticipantsList();
            participantPollRef.current = window.setTimeout(poll, 3000);
        };

        participantPollRef.current = window.setTimeout(poll, 500);
    }, [updateParticipantsList]);

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
            if (participantPollRef.current) {
                clearTimeout(participantPollRef.current);
                participantPollRef.current = null;
            }
            if (controlMessageTimerRef.current) {
                clearTimeout(controlMessageTimerRef.current);
                controlMessageTimerRef.current = null;
            }
            safeSetMediaReady(false);
            canvasRefs.current.forEach((canvas, participantId) => {
                const stream = mediaStreamRef.current;
                if (!stream) {
                    return;
                }
                try {
                    stream.stopRenderVideo?.(canvas, castUserIdForMediaStream(participantId));
                } catch (renderError) {
                    console.warn('[MeetingScreen] stopRenderVideo cleanup failed:', renderError);
                }
            });
            canvasRefs.current.clear();
            if (mediaStreamRef.current) {
                try {
                    const shareCanvas = shareCanvasRef.current;
                    if (shareCanvas) {
                        mediaStreamRef.current.stopRenderShare?.(shareCanvas);
                    }
                } catch (shareError) {
                    console.warn('[MeetingScreen] stopRenderShare cleanup failed:', shareError);
                }
            }
            (async () => {
                const client = clientRef.current;
                if (!client) {
                    return;
                }
                try {
                    await client.leave?.();
                } catch (leaveError) {
                    console.warn('[MeetingScreen] leave on unmount failed:', leaveError);
                }
                try {
                    client.destroy?.();
                } catch (destroyError) {
                    console.warn('[MeetingScreen] destroy on unmount failed:', destroyError);
                }
                clientRef.current = null;
                mediaStreamRef.current = null;
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
                '호스트로 참가하려면 Zoom에서 발급된 ZAK 토큰이 필요합니다. 백엔드에 ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET 또는 ZOOM_API_KEY, ZOOM_API_SECRET을 설정했는지 확인해주세요.',
            );
            setStatusKey('error');
            return;
        }

        if (context.role === 1 && !context.hostEmail) {
            setError(
                '호스트 계정 이메일 정보를 찾지 못했습니다. Zoom Server-to-Server OAuth 권한이 meeting:read:admin, user:read:admin 등을 포함하는지 확인해주세요.',
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

                if (context.role === 1) {
                    if (context.zak) {
                        joinOptions.zak = context.zak;
                    }
                    if (context.hostEmail) {
                        joinOptions.userEmail = context.hostEmail;
                    }
                } else if (context.userEmail) {
                    joinOptions.userEmail = context.userEmail;
                }

                await clientRef.current.join(joinOptions);

                if (cancelled) {
                    return;
                }

                setStatusKey('joined');

                const stream = await tryAcquireMediaStream();
                if (!stream) {
                    console.warn('[MeetingScreen] Media stream not immediately available after joining; will retry.');
                }

                try {
                    const currentUser =
                        clientRef.current?.getCurrentUser?.() ||
                        clientRef.current?.getCurrentUserInfo?.();
                    const resolvedId = resolveParticipantId(currentUser);
                    if (resolvedId != null) {
                        localUserIdRef.current = resolvedId;
                    }
                } catch (currentUserError) {
                    console.warn('[MeetingScreen] Failed to resolve current user info:', currentUserError);
                }

                if (clientRef.current?.getMeetingUIControllers) {
                    try {
                        const controller = clientRef.current.getMeetingUIControllers();
                        controller?.showMeetingHeader?.();
                        controller?.showToolBar?.();
                        controller?.showMiniZoomWindow?.(false);
                        controller?.setGalleryViewLayout?.({ view: 'gallery' });
                    } catch (controllerError) {
                        console.warn('[MeetingScreen] Failed to configure meeting UI controllers:', controllerError);
                    }
                }

                updateParticipantsList();
                scheduleParticipantPolling();
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
    }, [meetingContext, sdkReady, scheduleParticipantPolling, tryAcquireMediaStream, updateParticipantsList]);

    useEffect(() => {
        participants.forEach((participant) => {
            if (participant.isVideoOn) {
                renderVideoForParticipant(participant);
            } else {
                stopVideoForParticipant(participant);
            }
        });

        const currentIds = new Set(participants.map((participant) => participant.id));
        previousParticipantIdsRef.current.forEach((participantId) => {
            if (!currentIds.has(participantId)) {
                const participant = { id: participantId };
                stopVideoForParticipant(participant);
                canvasRefs.current.delete(participantId);
            }
        });
        previousParticipantIdsRef.current = currentIds;
    }, [participants, renderVideoForParticipant, stopVideoForParticipant]);

    useEffect(() => {
        if (sharingParticipant) {
            renderShareCanvas();
        } else {
            stopShareCanvas();
        }
    }, [sharingParticipant, renderShareCanvas, stopShareCanvas]);

    useEffect(() => {
        const handleResize = () => {
            participants.forEach((participant) => {
                if (participant.isVideoOn) {
                    renderVideoForParticipant(participant);
                }
            });
            if (sharingParticipant) {
                renderShareCanvas();
            }
        };

        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
        };
    }, [participants, sharingParticipant, renderShareCanvas, renderVideoForParticipant]);

    const handleLeaveMeeting = useCallback(async () => {
        setStatusKey('leaving');
        try {
            await clientRef.current?.leave?.();
        } catch (leaveError) {
            console.warn('[MeetingScreen] leave failed:', leaveError);
        } finally {
            mediaStreamRef.current = null;
            safeSetMediaReady(false);
            onLeaveMeeting?.();
        }
    }, [onLeaveMeeting, safeSetMediaReady]);

    const handleCopyShareLink = useCallback(async () => {
        const linkToCopy = info.shareLink || info.joinUrl;
        if (!linkToCopy) {
            setCopyMessage('공유 가능한 링크가 없습니다.');
            return;
        }
        const ok = await copyToClipboard(linkToCopy);
        setCopyMessage(ok ? '공유 링크가 복사되었습니다.' : '클립보드 복사에 실패했습니다.');
        setTimeout(() => setCopyMessage(''), 3000);
    }, [info.joinUrl, info.shareLink]);

    const handleToggleAudio = useCallback(async () => {
        let stream = mediaStreamRef.current;
        if (!stream) {
            stream = await tryAcquireMediaStream();
        }
        if (!stream) {
            showControlFeedback('error', '오디오 스트림을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.');
            return;
        }
        try {
            if (isAudioMuted) {
                await stream.unmuteAudio?.();
                setIsAudioMuted(false);
                showControlFeedback('success', '마이크가 켜졌습니다.');
            } else {
                await stream.muteAudio?.();
                setIsAudioMuted(true);
                showControlFeedback('success', '마이크가 음소거되었습니다.');
            }
        } catch (toggleError) {
            console.error('[MeetingScreen] toggle audio failed:', toggleError);
            showControlFeedback('error', '마이크 상태를 변경하지 못했습니다.');
        }
    }, [isAudioMuted, showControlFeedback, tryAcquireMediaStream]);

    const handleToggleVideo = useCallback(async () => {
        let stream = mediaStreamRef.current;
        if (!stream) {
            stream = await tryAcquireMediaStream();
        }
        if (!stream) {
            showControlFeedback('error', '비디오 스트림을 사용할 수 없습니다. 잠시 후 다시 시도해주세요.');
            return;
        }

        try {
            if (isVideoOn) {
                const result = await invokeMediaStreamMethod(stream, MEDIA_STREAM_METHOD_CANDIDATES.stopVideo);
                if (!result.ok) {
                    const firstError =
                        result.errors?.[0]?.error || new Error('지원 가능한 비디오 중지 메서드를 찾을 수 없습니다.');
                    console.error('[MeetingScreen] toggle video failed: stop method unavailable', firstError);
                    showControlFeedback('error', '카메라 상태를 변경하지 못했습니다.');
                    return;
                }
                setIsVideoOn(false);
                showControlFeedback('success', '카메라가 꺼졌습니다.');
            } else {
                const result = await invokeMediaStreamMethod(stream, MEDIA_STREAM_METHOD_CANDIDATES.startVideo);
                if (!result.ok) {
                    const firstError =
                        result.errors?.[0]?.error || new Error('지원 가능한 비디오 시작 메서드를 찾을 수 없습니다.');
                    console.error('[MeetingScreen] toggle video failed: start method unavailable', firstError);
                    showControlFeedback('error', '카메라 상태를 변경하지 못했습니다.');
                    return;
                }
                setIsVideoOn(true);
                showControlFeedback('success', '카메라가 켜졌습니다.');
            }
        } catch (toggleError) {
            console.error('[MeetingScreen] toggle video failed:', toggleError);
            showControlFeedback('error', '카메라 상태를 변경하지 못했습니다.');
        }
    }, [isVideoOn, showControlFeedback, tryAcquireMediaStream]);

    const handleToggleScreenShare = useCallback(async () => {
        let stream = mediaStreamRef.current;
        if (!stream) {
            stream = await tryAcquireMediaStream();
        }
        if (!stream) {
            showControlFeedback('error', '화면 공유를 사용할 수 없습니다. 잠시 후 다시 시도해주세요.');
            return;
        }

        if (!isScreenSharing && sharingParticipant && !sharingParticipant.isSelf) {
            showControlFeedback('error', `${sharingParticipant.name} 님이 이미 화면을 공유 중입니다.`);
            return;
        }

        try {
            if (isScreenSharing) {
                await stream.stopShareScreen?.();
                setIsScreenSharing(false);
                showControlFeedback('success', '화면 공유를 종료했습니다.');
            } else {
                await stream.startShareScreen?.();
                setIsScreenSharing(true);
                showControlFeedback('success', '화면 공유를 시작했습니다.');
            }
        } catch (toggleError) {
            console.error('[MeetingScreen] toggle screen share failed:', toggleError);
            showControlFeedback('error', '화면 공유 상태를 변경하지 못했습니다.');
        }
    }, [isScreenSharing, sharingParticipant, showControlFeedback, tryAcquireMediaStream]);

    const attachParticipantCanvas = useCallback(
        (participant) => (node) => {
            if (!participant?.id) {
                return;
            }
            if (node) {
                canvasRefs.current.set(participant.id, node);
                if (participant.isVideoOn) {
                    requestAnimationFrame(() => renderVideoForParticipant(participant));
                }
            } else {
                const existing = canvasRefs.current.get(participant.id);
                if (existing) {
                    stopVideoForParticipant(participant);
                    canvasRefs.current.delete(participant.id);
                }
            }
        },
        [renderVideoForParticipant, stopVideoForParticipant],
    );

    const toggleZoomPanel = useCallback(() => {
        setIsZoomPanelVisible((prev) => !prev);
    }, []);

    const statusLabel = STATUS_LABELS[statusKey] || STATUS_LABELS.idle;

    const participantCount = participants.length;
    const shareStatusText = sharingParticipant
        ? sharingParticipant.isSelf
            ? '내 화면을 공유 중입니다.'
            : `${sharingParticipant.name} 님이 화면을 공유 중입니다.`
        : '현재 공유 중인 화면이 없습니다.';

    return (
        <div className="meeting-screen">
            <header className="meeting-header">
                <div>
                    <div className="meeting-status">
                        <span className="badge badge-live">LIVE</span>
                        <span>{statusLabel}</span>
                    </div>
                    <h1 style={{ margin: '8px 0 0' }}>{info.topic || 'Zoom 수업'}</h1>
                    <p style={{ margin: '6px 0 0', color: 'rgba(226, 232, 255, 0.75)' }}>
                        담당 선생님: <strong>{info.hostName || '정보 없음'}</strong>
                    </p>
                    <p style={{ margin: '6px 0 0', color: 'rgba(226, 232, 255, 0.65)' }}>
                        회의 번호: <strong>{formatMeetingNumber(info.meetingNumber)}</strong>
                        {info.passcode ? (
                            <>
                                {' '}• 회의 암호: <strong>{info.passcode}</strong>
                            </>
                        ) : null}
                    </p>
                </div>
                <div className="control-bar">
                    <button type="button" className="btn btn-ghost" onClick={handleToggleAudio} disabled={!isMediaReady}>
                        {isAudioMuted ? '음소거 해제' : '음소거'}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={handleToggleVideo} disabled={!isMediaReady}>
                        {isVideoOn ? '비디오 중지' : '비디오 시작'}
                    </button>
                    <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleToggleScreenShare}
                        disabled={!isMediaReady || (!isScreenSharing && sharingParticipant && !sharingParticipant.isSelf)}
                    >
                        {isScreenSharing ? '공유 중지' : '화면 공유'}
                    </button>
                    <button type="button" className="btn btn-danger" onClick={handleLeaveMeeting}>
                        회의 종료
                    </button>
                </div>
            </header>

            {error ? (
                <div className="share-link-status share-link-status--error" style={{ marginTop: -12 }}>
                    {error}
                </div>
            ) : null}

            {controlMessage ? (
                <div
                    className={`share-link-status ${
                        controlMessageType === 'error' ? 'share-link-status--error' : 'share-link-status--success'
                    }`}
                    style={{ marginTop: error ? 8 : 0 }}
                >
                    {controlMessage}
                </div>
            ) : null}

            <div className="meeting-content">
                <section className="video-section">
                    <div className="meeting-status" style={{ justifyContent: 'space-between' }}>
                        <h2 className="section-title" style={{ margin: 0 }}>
                            참가자 영상
                        </h2>
                        <span className="badge badge-share">{participantCount}명 참여</span>
                    </div>
                    <div className="video-grid">
                        {participants.length === 0 ? (
                            <div
                                style={{
                                    gridColumn: '1 / -1',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    minHeight: 220,
                                    color: 'rgba(226, 232, 255, 0.6)',
                                    border: '1px dashed rgba(148, 163, 184, 0.3)',
                                    borderRadius: 20,
                                    padding: 24,
                                }}
                            >
                                아직 참가자가 없습니다.
                            </div>
                        ) : (
                            participants.map((participant) => (
                                <div
                                    key={participant.id}
                                    className={`video-tile${participant.isSelf ? ' video-tile--local' : ''}`}
                                >
                                    <canvas className="video-tile__canvas" ref={attachParticipantCanvas(participant)} />
                                    {!participant.isVideoOn ? (
                                        <div className="video-avatar">
                                            <span>{getInitials(participant.name)}</span>
                                        </div>
                                    ) : null}
                                    <div className="nameplate">
                                        <span>{participant.name}</span>
                                        <span style={{ marginLeft: 8, opacity: 0.7 }}>
                                            {participant.isMuted ? '음소거됨' : '마이크 켜짐'}
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </section>

                <aside className="share-section">
                    <div className="share-link-panel">
                        <h2 className="section-title" style={{ margin: 0 }}>
                            회의 링크 공유
                        </h2>
                        <p className="share-link-description">참가자는 아래 링크 또는 회의 정보를 통해 입장할 수 있습니다.</p>
                        <div className="share-link-input">
                            <input
                                type="text"
                                readOnly
                                value={info.shareLink || info.joinUrl || ''}
                                onFocus={(event) => event.target.select()}
                                placeholder="공유 링크가 없습니다"
                            />
                            <button type="button" className="btn btn-outline" onClick={handleCopyShareLink}>
                                링크 복사
                            </button>
                        </div>
                        {copyMessage ? (
                            <p
                                className={`share-link-status ${
                                    copyMessage.includes('실패') ? 'share-link-status--error' : 'share-link-status--success'
                                }`}
                                style={{ margin: '8px 0 0' }}
                            >
                                {copyMessage}
                            </p>
                        ) : null}
                    </div>

                    <div className="share-link-panel" style={{ gap: 16 }}>
                        <h2 className="section-title" style={{ margin: 0 }}>
                            화면 공유 미리보기
                        </h2>
                        <div className="share-canvas-wrapper">
                            <canvas ref={shareCanvasRef} />
                        </div>
                        <p className="share-status-text">{shareStatusText}</p>
                    </div>

                    <button type="button" className="btn btn-ghost" onClick={toggleZoomPanel}>
                        {isZoomPanelVisible ? 'Zoom 패널 닫기' : 'Zoom 패널 열기'}
                    </button>
                </aside>
            </div>

            <div className="zoom-overlay" data-open={isZoomPanelVisible ? 'true' : 'false'}>
                <div className="zoom-overlay__backdrop" onClick={toggleZoomPanel} aria-hidden="true" />
                <div className="zoom-overlay__content">
                    <div className="zoom-overlay__header">
                        <h2>Zoom 기본 패널</h2>
                        <button type="button" className="btn btn-outline zoom-overlay__close" onClick={toggleZoomPanel}>
                            닫기
                        </button>
                    </div>
                    <div className="zoom-overlay__body" ref={zoomRootRef} />
                </div>
            </div>
        </div>
    );
}
