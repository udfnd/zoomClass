require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const port = 4000;

app.use(cors());
app.use(express.json());

const SDK_KEY = process.env.ZOOM_SDK_KEY;
const SDK_SECRET = process.env.ZOOM_SDK_SECRET;

const generateVideoSDKToken = (sdkKey, sdkSecret, sessionName, userId) => {
    const payload = {
        app_key: sdkKey,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 2, // Token valid for 2 hours
        tpc: sessionName,
        user_identity: userId,
        session_key: sessionName,
        role_type: 1 // 1 for host, 0 for participant
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
        console.error("Error generating token:", error);
        res.status(500).json({ error: 'Failed to generate token', details: error.message });
    }
});

app.listen(port, () => {
    console.log(`Token server listening at http://localhost:${port}`);
});
