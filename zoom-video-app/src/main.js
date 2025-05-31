// src/main.js
require('dotenv').config();
const { app, BrowserWindow, ipcMain } = require('electron');
if (require('electron-squirrel-startup')) {
  app.quit();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    }
  });

  win.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('get-token-url', () => {
  if (!process.env.TOKEN_SERVER_URL) {
    console.error('TOKEN_SERVER_URL is not defined in .env file');
    return null;
  }
  return process.env.TOKEN_SERVER_URL;
});
