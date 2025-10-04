require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const os = require('os');

const app = express();
const port = process.env.PORT || 4000;
const host = process.env.HOST || '0.0.0.0';

app.use(cors());
app.use(express.json());

const SDK_KEY = process.env.ZOOM_SDK_KEY;
const SDK_SECRET = process.env.ZOOM_SDK_SECRET;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseRestUrl = supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/rest/v1` : null;

const zoomAccountId = process.env.ZOOM_ACCOUNT_ID;
const zoomClientId = process.env.ZOOM_CLIENT_ID;
const zoomClientSecret = process.env.ZOOM_CLIENT_SECRET;

const isZoomOAuthConfigured = () => Boolean(zoomAccountId && zoomClientId && zoomClientSecret);

if (!supabaseRestUrl || !supabaseServiceRoleKey) {
    console.warn('[backend] Supabase URL or service role key is missing. Calendar endpoints will be disabled.');
}

const escapeHtml = (value = '') =>
    `${value}`
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const ensureSupabaseConfigured = (res) => {
    if (!supabaseRestUrl || !supabaseServiceRoleKey) {
        res.status(500).json({ error: 'Supabase is not configured on the backend. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' });
        return false;
    }
    return true;
};

const supabaseRequest = async (path, options = {}) => {
    if (!supabaseRestUrl || !supabaseServiceRoleKey) {
        throw new Error('Supabase is not configured.');
    }

    const headers = {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        ...options.headers,
    };

    const response = await fetch(`${supabaseRestUrl}/${path}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Supabase request failed: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    return response;
};

const ensureMeetingSdkConfigured = () => {
    if (!SDK_KEY || !SDK_SECRET) {
        throw new Error('ZOOM_SDK_KEY 또는 ZOOM_SDK_SECRET 환경 변수가 필요합니다.');
    }
};

const ensureZoomOAuthConfigured = () => {
    if (!isZoomOAuthConfigured()) {
        throw new Error('ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET 환경 변수를 설정해주세요.');
    }
};

const generateMeetingSdkSignature = ({ meetingNumber, role }) => {
    ensureMeetingSdkConfigured();

    const normalizedMeetingNumber = `${meetingNumber}`.trim();
    if (!normalizedMeetingNumber) {
        throw new Error('회의 번호가 필요합니다.');
    }

    const normalizedRole = Number(role) === 1 ? 1 : 0;
    const timestamp = Date.now() - 30000;
    const message = Buffer.from(`${SDK_KEY}${normalizedMeetingNumber}${timestamp}${normalizedRole}`).toString('base64');
    const hash = crypto.createHmac('sha256', SDK_SECRET).update(message).digest('base64');
    const signature = Buffer.from(
        `${SDK_KEY}.${normalizedMeetingNumber}.${timestamp}.${normalizedRole}.${hash}`,
    ).toString('base64');
    return signature;
};

const fetchZoomAccessToken = async () => {
    ensureZoomOAuthConfigured();

    const basicAuth = Buffer.from(`${zoomClientId}:${zoomClientSecret}`).toString('base64');
    const response = await fetch(
        `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(zoomAccountId)}`,
        {
            method: 'POST',
            headers: {
                Authorization: `Basic ${basicAuth}`,
            },
        },
    );

    if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(`Zoom OAuth 토큰 발급 실패: ${response.status} ${response.statusText} - ${bodyText}`);
    }

    const data = await response.json();
    if (!data.access_token) {
        throw new Error('Zoom OAuth 응답에 access_token이 없습니다.');
    }
    return data.access_token;
};

const fetchZoomZakToken = async (accessToken) => {
    ensureZoomOAuthConfigured();

    if (!accessToken) {
        accessToken = await fetchZoomAccessToken();
    }

    const response = await fetch('https://api.zoom.us/v2/users/me/token?type=zak', {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(`Zoom ZAK 토큰 발급 실패: ${response.status} ${response.statusText} - ${bodyText}`);
    }

    const data = await response.json();
    if (!data || !data.token) {
        throw new Error('Zoom ZAK 응답에 token 필드가 없습니다.');
    }

    return {
        zak: data.token,
        expiresIn: data.expires_in || null,
    };
};

const createZoomMeeting = async ({ topic, hostName }) => {
    const accessToken = await fetchZoomAccessToken();

    const payload = {
        topic: topic || 'ZoomClass Session',
        type: 1,
        agenda: hostName ? `Host: ${hostName}` : undefined,
        settings: {
            host_video: true,
            participant_video: true,
            join_before_host: false,
            waiting_room: false,
        },
    };

    const response = await fetch('https://api.zoom.us/v2/users/me/meetings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(`Zoom 회의 생성 실패: ${response.status} ${response.statusText} - ${bodyText}`);
    }

    const data = await response.json();
    if (!data || !data.id) {
        throw new Error('Zoom 회의 생성 응답에 회의 ID가 없습니다.');
    }

    let zakInfo = null;
    try {
        zakInfo = await fetchZoomZakToken(accessToken);
    } catch (zakError) {
        console.warn('[backend] Failed to issue ZAK token for host session:', zakError);
    }

    return {
        meeting: data,
        zak: zakInfo?.zak || '',
        zakExpiresIn: zakInfo?.expiresIn || null,
    };
};

const buildJoinHelperUrl = (req, { meetingNumber, passcode, topic, hostName, backendBase }) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    const basePath = req.baseUrl ? req.baseUrl.replace(/\/$/, '') : '';
    const joinUrl = new URL(`${origin}${basePath}/join`);
    joinUrl.searchParams.set('meetingNumber', meetingNumber);
    if (passcode) {
        joinUrl.searchParams.set('passcode', passcode);
    }
    if (topic) {
        joinUrl.searchParams.set('topic', topic);
    }
    if (hostName) {
        joinUrl.searchParams.set('hostName', hostName);
    }
    if (backendBase) {
        joinUrl.searchParams.set('backendUrl', backendBase);
    }
    return joinUrl.toString();
};

const generateVideoSDKToken = (sdkKey, sdkSecret, sessionName, userId) => {
    const payload = {
        app_key: sdkKey,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 2,
        tpc: sessionName,
        user_identity: userId,
        session_key: sessionName,
        role_type: 1,
    };

    const header = { alg: 'HS256', typ: 'JWT' };
    const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', sdkSecret).update(`${base64Header}.${base64Payload}`).digest('base64url');

    return `${base64Header}.${base64Payload}.${signature}`;
};

app.get('/generate-token', (req, res) => {
    const sessionName = req.query.sessionName || 'DEFAULT_SESSION';
    const userId = req.query.userId || 'DEFAULT_USER';

    if (!SDK_KEY || !SDK_SECRET) {
        return res.status(500).json({ error: 'SDK Key or Secret not configured' });
    }

    try {
        const token = generateVideoSDKToken(SDK_KEY, SDK_SECRET, sessionName, userId);
        res.json({ token });
    } catch (error) {
        console.error('Error generating token:', error);
        res.status(500).json({ error: 'Failed to generate token', details: error.message });
    }
});

app.get('/join', (req, res) => {
    try {
        const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        const requestUrl = new URL(fullUrl);

        const rawMeetingNumber =
            (req.query.meetingNumber || req.query.mn || req.query.meeting || '').toString().trim();

        if (!rawMeetingNumber) {
            const message = 'meetingNumber query parameter is required.';
            if (req.accepts('html')) {
                return res.status(400).send(`<p>${escapeHtml(message)}</p>`);
            }
            return res.status(400).json({ error: message });
        }

        const rawTopic =
            (req.query.topic || req.query.sessionName || req.query.session || '').toString().trim();
        const rawPasscode = (req.query.passcode || req.query.pwd || req.query.password || '').toString().trim();

        const rawBackendParam = (req.query.backendUrl || req.query.backend || '').toString().trim();
        let backendBase = rawBackendParam.replace(/\/+$/, '');
        if (!backendBase) {
            const pathname = requestUrl.pathname.replace(/\/+$/, '');
            const basePath = pathname.replace(/\/join$/, '');
            backendBase = `${requestUrl.origin}${basePath}`.replace(/\/+$/, '');
        }

        const joinUrl = requestUrl.href;
        const acceptType = req.accepts(['html', 'json']);

        if (acceptType === 'json') {
            return res.json({
                meetingNumber: rawMeetingNumber,
                passcode: rawPasscode,
                topic: rawTopic,
                backendUrl: backendBase,
                joinUrl,
            });
        }

        const suggestedName = (req.query.userName || req.query.displayName || '').toString().trim();
        const hostName = (req.query.hostName || req.query.teacher || '').toString().trim();

        const html = `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="utf-8" />
    <title>ZoomClass 수업 참여 안내</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
        body {
            font-family: 'Noto Sans KR', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(160deg, #f5f7ff 0%, #dfe7ff 35%, #f1f5ff 100%);
            color: #1f2937;
            margin: 0;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .card {
            width: min(520px, 92vw);
            background: rgba(255, 255, 255, 0.92);
            backdrop-filter: blur(18px);
            border-radius: 24px;
            box-shadow: 0 24px 45px rgba(15, 23, 42, 0.18);
            padding: 36px 32px;
            display: flex;
            flex-direction: column;
            gap: 18px;
        }
        h1 {
            margin: 0;
            font-size: 24px;
            color: #1f2937;
        }
        p {
            margin: 0;
            line-height: 1.6;
        }
        .session-name {
            font-weight: 700;
            color: #364fc7;
        }
        code {
            background: rgba(15, 23, 42, 0.08);
            border-radius: 12px;
            padding: 12px;
            display: block;
            font-size: 14px;
            word-break: break-all;
        }
        .footer {
            font-size: 13px;
            color: #4b5563;
        }
        .steps {
            padding-left: 18px;
            margin: 0;
        }
        .steps li {
            margin: 4px 0;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>ZoomClass 수업 참여 안내</h1>
        <p><span class="session-name">${escapeHtml(rawTopic || rawMeetingNumber)}</span> 수업에 참여하려면 아래 순서를 따라주세요.</p>
        <p style="margin-top: 0; color: #475569;">회의 번호: <strong>${escapeHtml(rawMeetingNumber)}</strong>${
            rawPasscode ? ` • 회의 암호: <strong>${escapeHtml(rawPasscode)}</strong>` : ''
        }${hostName ? `<br />담당 선생님: <strong>${escapeHtml(hostName)}</strong>` : ''}</p>
        <ol class="steps">
            <li>ZoomClass 애플리케이션을 실행합니다.</li>
            <li>로비 화면의 <strong>수업 참여</strong> 영역에 이 페이지의 링크를 붙여넣습니다.</li>
            <li>사용자 이름을 입력한 뒤 참여 버튼을 누르면 수업에 입장할 수 있습니다.</li>
        </ol>
        <p>참여 링크:</p>
        <code>${escapeHtml(joinUrl)}</code>
        <p class="footer">
            ${backendBase ? `이 링크는 <strong>${escapeHtml(backendBase)}</strong> 백엔드 서버를 사용합니다.<br />` : ''}
            ${suggestedName ? `추천 사용자 이름: <strong>${escapeHtml(suggestedName)}</strong><br />` : ''}
            링크가 작동하지 않는 경우 관리자에게 문의해 주세요.
        </p>
    </div>
</body>
</html>`;
        return res.send(html);
    } catch (error) {
        console.error('[backend] Failed to render join helper:', error);
        return res.status(500).json({ error: 'Failed to render join helper.' });
    }
});

const generateFallbackMeetingNumber = () => {
    const base = `${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`;
    return base.slice(-11);
};

app.post('/meeting/create', async (req, res) => {
    const { topic, hostName } = req.body || {};

    if (!topic || !hostName) {
        return res.status(400).json({ error: 'topic and hostName are required.' });
    }

    try {
        let meeting = null;
        let meetingNumber = '';
        let passcode = '';
        let joinUrl = '';
        let startUrl = '';
        let hostZak = '';
        let hostZakExpiresIn = null;

        if (isZoomOAuthConfigured()) {
            const { meeting: createdMeeting, zak, zakExpiresIn } = await createZoomMeeting({ topic, hostName });
            meeting = createdMeeting;
            meetingNumber = `${createdMeeting.id}`;
            passcode = createdMeeting.password || createdMeeting.passcode || '';
            joinUrl = createdMeeting.join_url || '';
            startUrl = createdMeeting.start_url || '';
            hostZak = zak || '';
            hostZakExpiresIn = zakExpiresIn || null;
        } else {
            meetingNumber = generateFallbackMeetingNumber();
            passcode = '';
        }

        const signature = generateMeetingSdkSignature({ meetingNumber, role: 1 });

        const backendBase = `${req.protocol}://${req.get('host')}${req.baseUrl || ''}`.replace(/\/+$/, '');
        const shareLink = buildJoinHelperUrl(req, {
            meetingNumber,
            passcode,
            topic,
            hostName,
            backendBase,
        });

        if (supabaseRestUrl && supabaseServiceRoleKey) {
            try {
                await supabaseRequest('meetings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Prefer: 'return=representation',
                    },
                    body: JSON.stringify([
                        {
                            session_name: topic,
                            host_name: hostName,
                            start_time: new Date().toISOString(),
                        },
                    ]),
                });
            } catch (storeError) {
                console.warn('[backend] Failed to store meeting in Supabase:', storeError);
            }
        }

        return res.json({
            topic,
            hostName,
            meetingNumber,
            passcode,
            joinUrl,
            startUrl,
            sdkKey: SDK_KEY,
            signature,
            shareLink,
            isZoomOAuthMeeting: isZoomOAuthConfigured(),
            zak: hostZak,
            zakExpiresIn: hostZakExpiresIn,
        });
    } catch (error) {
        console.error('[backend] Failed to create Zoom meeting:', error);
        return res.status(500).json({ error: 'Failed to create Zoom meeting.', details: error.message });
    }
});

app.post('/meeting/signature', async (req, res) => {
    try {
        const { meetingNumber, role } = req.body || {};
        if (!meetingNumber) {
            return res.status(400).json({ error: 'meetingNumber is required.' });
        }

        const normalizedRole = Number(role) === 1 ? 1 : 0;

        if (normalizedRole === 1 && !isZoomOAuthConfigured()) {
            return res.status(400).json({
                error: '호스트 서명을 생성하려면 Zoom OAuth 자격 증명을 구성해야 합니다.',
            });
        }

        let hostZak = '';
        if (normalizedRole === 1) {
            try {
                const { zak } = await fetchZoomZakToken();
                hostZak = zak;
            } catch (zakError) {
                console.error('[backend] Failed to issue ZAK token for host signature:', zakError);
                return res.status(500).json({
                    error: 'Failed to issue host ZAK token. Zoom OAuth 설정을 확인해주세요.',
                    details: zakError.message,
                });
            }
        }

        const signature = generateMeetingSdkSignature({ meetingNumber, role: normalizedRole });
        return res.json({ signature, sdkKey: SDK_KEY, role: normalizedRole, zak: hostZak });
    } catch (error) {
        console.error('[backend] Failed to generate meeting signature:', error);
        return res.status(500).json({ error: 'Failed to generate meeting signature.', details: error.message });
    }
});

app.post('/meetings', async (req, res) => {
    if (!ensureSupabaseConfigured(res)) {
        return;
    }

    const { sessionName, hostName, startTime } = req.body || {};
    if (!sessionName || !hostName || !startTime) {
        return res.status(400).json({ error: 'sessionName, hostName, and startTime are required.' });
    }

    let startDate;
    try {
        startDate = new Date(startTime);
        if (Number.isNaN(startDate.getTime())) {
            throw new Error('Invalid date value');
        }
    } catch (error) {
        return res.status(400).json({ error: 'startTime must be a valid date string.' });
    }

    try {
        const response = await supabaseRequest('meetings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Prefer: 'return=representation',
            },
            body: JSON.stringify([
                {
                    session_name: sessionName,
                    host_name: hostName,
                    start_time: startDate.toISOString(),
                },
            ]),
        });

        const data = await response.json();
        const meeting = Array.isArray(data) ? data[0] : data;
        return res.status(201).json({ meeting });
    } catch (error) {
        console.error('[backend] Failed to store meeting:', error);
        return res.status(500).json({ error: 'Failed to store meeting in Supabase.' });
    }
});

app.get('/meetings', async (req, res) => {
    if (!ensureSupabaseConfigured(res)) {
        return;
    }

    const { date, range } = req.query;
    const params = new URLSearchParams({ select: '*', order: 'start_time.asc' });

    if (date) {
        const start = new Date(`${date}T00:00:00`);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        params.append('start_time', `gte.${start.toISOString()}`);
        params.append('start_time', `lt.${end.toISOString()}`);
    } else if (range === 'upcoming') {
        const now = new Date();
        params.append('start_time', `gte.${now.toISOString()}`);
    }

    try {
        const response = await supabaseRequest(`meetings?${params.toString()}`, {
            headers: {
                'Content-Type': 'application/json',
            },
        });
        const data = await response.json();
        return res.json({ meetings: data || [] });
    } catch (error) {
        console.error('[backend] Failed to fetch meetings:', error);
        return res.status(500).json({ error: 'Failed to fetch meetings from Supabase.' });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`Token & meeting server listening at http://${displayHost}:${port}`);

    const interfaces = os.networkInterfaces();
    const reachableAddresses = Object.values(interfaces)
        .flat()
        .filter((iface) => iface && !iface.internal && iface.family === 'IPv4');

    if (reachableAddresses.length > 0) {
        console.log('Participants on the same network can connect using:');
        reachableAddresses.forEach((iface) => {
            console.log(`  -> http://${iface.address}:${port}`);
        });
    } else {
        console.log('No external IPv4 addresses detected. Ensure your network allows incoming connections.');
    }
});
