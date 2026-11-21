const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  call: (op, params) => ipcRenderer.invoke('rpc:call', { op, params }),
  info: () => ipcRenderer.invoke('rpc:info'),
  readFile: (rel) => ipcRenderer.invoke('file:read', rel)
});
