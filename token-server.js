require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const SDK_KEY = process.env.ZOOM_SDK_KEY;
const SDK_SECRET = process.env.ZOOM_SDK_SECRET;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseRestUrl = supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/rest/v1` : null;

if (!supabaseRestUrl || !supabaseServiceRoleKey) {
    console.warn('[backend] Supabase URL or service role key is missing. Calendar endpoints will be disabled.');
}

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

app.listen(port, () => {
    console.log(`Token & meeting server listening at http://localhost:${port}`);
});
