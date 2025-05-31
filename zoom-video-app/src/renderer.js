// src/renderer.jsx
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import ZoomVideo from '@zoom/videosdk';
import './index.css';

const APP_KEY    = process.env.ZOOM_SDK_KEY;
const APP_SECRET = process.env.ZOOM_SDK_SECRET;

function App() {
    const videoRef = useRef(null);
    const client   = useRef(null);
    const [joined, setJoined] = useState(false);

    useEffect(() => {
        (async () => {
            client.current = ZoomVideo.createClient();
            await client.current.init('en-US', null, { patchJsMedia: true });

            const tokenUrl = await window.electronAPI.getTokenUrl();
            const { token } = await fetch(tokenUrl).then(r => r.json());

            await client.current.join('SESSION_NAME', 'USER_NAME', token, '');
            setJoined(true);

            client.current.on('stream-added', ({ stream }) => {
                client.current.renderVideo(
                    videoRef.current,
                    stream.getMediaStreamTrack(),
                    stream.getUserId()
                );
            });
        })();

        return () => {
            if (joined) client.current.leave();
        };
    }, []);

    return (
        <div className="app">
            <div className="header">English Class</div>
            <div className="video-area" ref={videoRef}></div>
            <div className="controls">
                <button onClick={() => client.current?.leave()}>Leave</button>
            </div>
        </div>
    );
}

ReactDOM.render(<App />, document.getElementById('root'));
