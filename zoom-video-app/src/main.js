// src/main.js
require('dotenv').config();
const { app, BrowserWindow, ipcMain, session } = require('electron');
const Store = require('electron-store').default;
const {
  DEFAULT_BACKEND_FALLBACK,
  normalizeBackendUrl,
  getBackendOrigin,
} = require('../config/backend-url');
const { buildConnectSrcValues } = require('../config/connect-src');
const { buildCspString } = require('../config/csp');
if (require('electron-squirrel-startup')) {
  app.quit();
}

const store = new Store();

const readStoreBackendOverride = () => {
  if (!store) {
    return '';
  }

  try {
    return normalizeBackendUrl(store.get('backendUrlOverride', ''));
  } catch (error) {
    console.warn('Failed to read backend override from electron-store:', error);
    return '';
  }
};

const readEnvBackendUrl = () =>
  normalizeBackendUrl(
    process.env.BACKEND_BASE_URL || process.env.TOKEN_SERVER_URL || DEFAULT_BACKEND_FALLBACK,
  );

let envBackendUrl = readEnvBackendUrl();
let overrideBackendUrl = readStoreBackendOverride();

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

const buildCspHeaderValue = () => `${buildCspString({ connectSrc: Array.from(connectSrcAllowlist) })};`;

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
  if (!store) {
    console.error("ElectronStore was not initialized. Aborting window creation.");
    app.quit(); // store가 없으면 앱 실행 불가
    return;
  }

  installCspAllowlist();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (store) { // activate 시점에도 store 확인
        createWindow();
      }
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

// electron-store IPC 핸들러 (store 변수가 유효할 때만 작동하도록 방어 코드 추가)
ipcMain.handle('electron-store-get', async (event, key, defaultValue) => {
  if (!store) {
    console.error("Store is not available for 'get' operation.");
    return defaultValue; // 또는 적절한 오류/기본값 반환
  }
  return store.get(key, defaultValue);
});

ipcMain.handle('electron-store-set', async (event, key, value) => {
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
    console.error("Store is not available for 'clear' operation.");
    return false;
  }
  store.clear();
  updateOverrideBackendUrl('');
  return true;
});

if (store?.onDidChange) {
  store.onDidChange('backendUrlOverride', (newValue) => {
    updateOverrideBackendUrl(newValue);
  });
}
