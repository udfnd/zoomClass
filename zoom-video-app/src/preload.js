// src/preload.js
const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getTokenUrl: () => ipcRenderer.invoke('get-token-url'),
    getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),
    openExternal: (url) => shell.openExternal(url),

    getStoreValue: (key, defaultValue) => ipcRenderer.invoke('electron-store-get', key, defaultValue),
    setStoreValue: (key, value) => ipcRenderer.invoke('electron-store-set', key, value),
    deleteStoreValue: (key) => ipcRenderer.invoke('electron-store-delete', key),
    clearStore: () => ipcRenderer.invoke('electron-store-clear'),
});
