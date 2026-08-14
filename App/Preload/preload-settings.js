// 系统设置窗口专属 preload：只暴露配置读写给本地设置页面
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshSettings', {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (cfg) => ipcRenderer.invoke('settings:save', cfg),
});
