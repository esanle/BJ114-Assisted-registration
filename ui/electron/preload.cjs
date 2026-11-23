const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  call: (op, params) => ipcRenderer.invoke('rpc:call', { op, params }),
  info: () => ipcRenderer.invoke('rpc:info'),
  readFile: (rel) => ipcRenderer.invoke('file:read', rel),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  notify: (payload) => ipcRenderer.invoke('notify', payload),
  playAlarm: (times) => ipcRenderer.invoke('play-alarm', times)
});
