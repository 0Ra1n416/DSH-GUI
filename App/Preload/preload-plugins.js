// 插件管理器窗口专属 preload：只把管理 API 暴露给本地管理器页面
// （主窗口的 preload 保持空白，远程 DSH 页面拿不到任何管理权限）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshPluginManager', {
    list: () => ipcRenderer.invoke('plugins:list'),
    install: (spec) => ipcRenderer.invoke('plugins:install', spec),
    remove: (pkg) => ipcRenderer.invoke('plugins:remove', pkg),
    setEnabled: (pkg, enabled) => ipcRenderer.invoke('plugins:set-enabled', pkg, enabled),
    pickDirectory: () => ipcRenderer.invoke('plugins:pick-directory'),
    restartBackend: () => ipcRenderer.invoke('plugins:restart-backend'),
    openProfileDir: () => ipcRenderer.invoke('plugins:open-profile-dir'),
    onCommandOutput: (cb) => {
        const listener = (_event, line) => cb(line);
        ipcRenderer.on('plugins:command-output', listener);
        return () => ipcRenderer.removeListener('plugins:command-output', listener);
    },
});
