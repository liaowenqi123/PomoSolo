const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  testConnection: () => ipcRenderer.invoke('test-connection'),
  getSession: () => ipcRenderer.invoke('get-session'),
  login: (credentials) => ipcRenderer.invoke('login', credentials),
  logout: () => ipcRenderer.invoke('logout'),
  registerUser: (userData) => ipcRenderer.invoke('register-user', userData)
});