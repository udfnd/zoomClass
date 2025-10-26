// src/main.js
require('dotenv').config();
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { createPersistentStore } = require('./utils/simpleStore');
const {
  DEFAULT_BACKEND_FALLBACK,
  normalizeBackendUrl,
  getBackendOrigin,
} = require('../config/backend-url');
const { buildZoomSdkHeaderValues } = require('../config/zoom-sdk');
const { buildConnectSrcValues } = require('../config/connect-src');
const { buildCspString } = require('../config/csp');
if (require('electron-squirrel-startup')) {
  app.quit();
}

let store;
let overrideBackendUrl = '';

const initializePersistentStore = () => {
  if (store) {
    return store;
  }

  if (!app.isReady()) {
    return null;
  }

  store = createPersistentStore({ fileName: 'settings.json' });

  if (!store) {
    console.error('Failed to initialize persistent store.');
  }

  return store;
};

const readStoreBackendOverride = () => {
  if (!store) {
    return overrideBackendUrl || '';
  }

  try {
    return normalizeBackendUrl(store.get('backendUrlOverride', ''));
  } catch (error) {
    console.warn('Failed to read backend override from persistent store:', error);
    return '';
  }
};

const readEnvBackendUrl = () =>
  normalizeBackendUrl(
    process.env.BACKEND_BASE_URL || process.env.TOKEN_SERVER_URL || DEFAULT_BACKEND_FALLBACK,
  );

let envBackendUrl = readEnvBackendUrl();

const computeConnectSrcAllowlist = () => {
  const additions = [];

  const envOrigin = getBackendOrigin(envBackendUrl);
  if (envOrigin) {
    additions.push(envOrigin);
  } else if (envBackendUrl) {
    additions.push(envBackendUrl);
  }

  const overrideOrigin = getBackendOrigin(overrideBackendUrl);
  if (overrideOrigin) {
    additions.push(overrideOrigin);
  } else if (overrideBackendUrl) {
    additions.push(overrideBackendUrl);
  }

  return Array.from(buildConnectSrcValues(...additions));
};

let connectSrcAllowlist = computeConnectSrcAllowlist();

const ZOOM_CDN_HOSTS = [
  'https://source.zoom.us',
  'https://zoom.us',
  'https://*.zoom.us',
  'https://*.zoomgov.com',
  'https://dmogdx0jrul3u.cloudfront.net',
];

const ZOOM_ASSET_HOSTS = [...ZOOM_CDN_HOSTS];

const ZOOM_REQUEST_PATTERNS = [
  '*://zoom.us/*',
  '*://source.zoom.us/*',
  '*://*.zoom.us/sdk/*',
  '*://*.zoom.us/meetingsdk/*',
  '*://dmogdx0jrul3u.cloudfront.net/*',
];

const { origin: ZOOM_ORIGIN, referer: ZOOM_REFERER } = buildZoomSdkHeaderValues();

const FONT_HOSTS = ['https://fonts.gstatic.com'];
const STYLE_HOSTS = ['https://fonts.googleapis.com'];

const uniqueTokens = (values = []) =>
  Array.from(new Set(values.filter(Boolean)));

const buildCspHeaderValue = () => {
  const directives = {
    'default-src': uniqueTokens([
      "'self'",
      "'unsafe-inline'",
      'data:',
      'blob:',
      ...ZOOM_ASSET_HOSTS,
    ]),
    'script-src': uniqueTokens([
      "'self'",
      "'unsafe-eval'",
      "'unsafe-inline'",
      'data:',
      'blob:',
      ...ZOOM_CDN_HOSTS,
    ]),
    'script-src-elem': uniqueTokens([
      "'self'",
      "'unsafe-eval'",
      "'unsafe-inline'",
      'data:',
      'blob:',
      ...ZOOM_CDN_HOSTS,
    ]),
    'style-src': uniqueTokens([
      "'self'",
      "'unsafe-inline'",
      ...STYLE_HOSTS,
      ...ZOOM_ASSET_HOSTS,
    ]),
    'style-src-elem': uniqueTokens([
      "'self'",
      "'unsafe-inline'",
      ...STYLE_HOSTS,
      ...ZOOM_ASSET_HOSTS,
    ]),
    'img-src': uniqueTokens([
      "'self'",
      'data:',
      'blob:',
      ...ZOOM_ASSET_HOSTS,
    ]),
    'font-src': uniqueTokens([
      "'self'",
      'data:',
      ...FONT_HOSTS,
      ...ZOOM_ASSET_HOSTS,
    ]),
    'frame-src': uniqueTokens([
      "'self'",
      'https://zoom.us',
      'https://*.zoom.us',
      'https://*.zoomgov.com',
    ]),
    'media-src': uniqueTokens([
      "'self'",
      'blob:',
      'data:',
    ]),
    'connect-src': uniqueTokens([
      ...Array.from(connectSrcAllowlist),
      'http:',
      'https:',
      'ws:',
      'wss:',
    ]),
    'worker-src': uniqueTokens([
      "'self'",
      'blob:',
      'data:',
    ]),
  };

  return `${Object.entries(directives)
    .map(([directive, tokens]) => `${directive} ${tokens.join(' ')}`)
    .join('; ')};`;
};

const updateOverrideBackendUrl = (value) => {
  overrideBackendUrl = normalizeBackendUrl(value);
  connectSrcAllowlist = computeConnectSrcAllowlist();
};

const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

const applyHeaderValue = (responseHeaders, key, value) => {
  const existingKey = Object.keys(responseHeaders || {}).find(
    (headerKey) => headerKey.toLowerCase() === key.toLowerCase(),
  );

  if (existingKey) {
    responseHeaders[existingKey] = [value];
  } else {
    responseHeaders[key] = [value];
  }
};

const installCspAllowlist = () => {
  const activeSession = session.defaultSession;
  if (!activeSession) {
    return;
  }

  activeSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'mainFrame') {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    const responseHeaders = details.responseHeaders || {};
    const cspValue = buildCspHeaderValue();
    applyHeaderValue(responseHeaders, 'Content-Security-Policy', cspValue);

    Object.entries(CROSS_ORIGIN_ISOLATION_HEADERS).forEach(([header, value]) => {
      applyHeaderValue(responseHeaders, header, value);
    });

    callback({ responseHeaders });
  });
};

const installZoomRequestHardening = () => {
  const activeSession = session.defaultSession;
  if (!activeSession) {
    return;
  }

  console.info('[zoom-sdk] Enforcing Zoom Meeting SDK headers with origin:', ZOOM_ORIGIN);

  activeSession.webRequest.onBeforeSendHeaders(
    { urls: ZOOM_REQUEST_PATTERNS },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      headers.Origin = ZOOM_ORIGIN;
      headers.Referer = ZOOM_REFERER;
      if (headers.Pragma) {
        delete headers.Pragma;
      }
      callback({ requestHeaders: headers });
    },
  );
};

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  win.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  win.webContents.on('did-finish-load', () => {
    if (process.env.NODE_ENV === 'development') { //
      win.webContents.openDevTools(); //
    }
  });
}

app.whenReady().then(() => {
  initializePersistentStore();
  if (store) {
    overrideBackendUrl = readStoreBackendOverride();
    connectSrcAllowlist = computeConnectSrcAllowlist();
    store.onDidChange('backendUrlOverride', (newValue) => {
      updateOverrideBackendUrl(newValue);
    });
  }

  installCspAllowlist();
  installZoomRequestHardening();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { //
    app.quit(); //
  }
});

const resolveBackendUrl = () => {
  const override = readStoreBackendOverride();
  if (override) {
    updateOverrideBackendUrl(override);
    return override;
  }

  envBackendUrl = envBackendUrl || readEnvBackendUrl();
  if (!envBackendUrl) {
    console.error('No backend URL is configured. Set BACKEND_BASE_URL or TOKEN_SERVER_URL.');
  }
  connectSrcAllowlist = computeConnectSrcAllowlist();
  return envBackendUrl;
};

ipcMain.handle('get-token-url', async () => {
  return resolveBackendUrl();
});

ipcMain.handle('get-backend-url', async () => {
  return resolveBackendUrl();
});

// Persistent store IPC handlers (guarded so they only run when the store is ready)
ipcMain.handle('electron-store-get', async (event, key, defaultValue) => {
  if (!store) {
    initializePersistentStore();
  }

  if (!store) {
    console.error("Store is not available for 'get' operation.");
    return defaultValue;
  }

  return store.get(key, defaultValue);
});

ipcMain.handle('electron-store-set', async (event, key, value) => {
  if (!store) {
    initializePersistentStore();
  }

  if (!store) {
    console.error("Store is not available for 'set' operation.");
    return false;
  }

  store.set(key, value);
  if (key === 'backendUrlOverride') {
    updateOverrideBackendUrl(value);
  }
  return true;
});

ipcMain.handle('electron-store-delete', async (event, key) => {
  if (!store) {
    initializePersistentStore();
  }

  if (!store) {
    console.error("Store is not available for 'delete' operation.");
    return false;
  }

  store.delete(key);
  if (key === 'backendUrlOverride') {
    updateOverrideBackendUrl('');
  }
  return true;
});

ipcMain.handle('electron-store-clear', async () => {
  if (!store) {
    initializePersistentStore();
  }

  if (!store) {
    console.error("Store is not available for 'clear' operation.");
    return false;
  }

  store.clear();
  updateOverrideBackendUrl('');
  return true;
});
