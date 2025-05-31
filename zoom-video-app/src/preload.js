const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getTokenUrl: () => ipcRenderer.invoke('get-token-url'),
    openExternal: (url) => shell.openExternal(url),
});
