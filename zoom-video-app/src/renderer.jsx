// src/renderer.jsx
import React from 'react';
import ReactDOM from 'react-dom/client'; // React 18의 새로운 Root API 사용
import App from './App';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
