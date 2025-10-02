// src/main.js
require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
const Store = require('electron-store').default;
if (require('electron-squirrel-startup')) {
  app.quit();
}

const store = new Store();

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
  const base = process.env.BACKEND_BASE_URL || process.env.TOKEN_SERVER_URL || 'http://localhost:4000';
  if (!base) {
    console.error('No backend URL is configured. Set BACKEND_BASE_URL or TOKEN_SERVER_URL.');
  }
  return base;
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
  return true;
});

ipcMain.handle('electron-store-delete', async (event, key) => {
  if (!store) {
    console.error("Store is not available for 'delete' operation.");
    return false;
  }
  store.delete(key);
  return true;
});

ipcMain.handle('electron-store-clear', async () => {
  if (!store) {
    console.error("Store is not available for 'clear' operation.");
    return false;
  }
  store.clear();
  return true;
});
