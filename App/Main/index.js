const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, screen, shell, Tray } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const pluginManager = require('./plugin-manager');
const settings = require('./settings');

// 配置读取统一走 settings 模块（Config/config.json 的读写、校验、设置窗口 IPC 都在那里）
const codeDir = path.join(__dirname, '..', '..');
const loadConfig = settings.loadConfig;

// 读取"实际"后端地址：dsh web 在端口被占用/系统保留时会回退端口，
// 并把实际端口写回 Config/config.json —— 每次使用时重新读取，紧跟实际状态
function loadDshUrl() {
    const cfg = loadConfig();
    return `http://${cfg.host}:${cfg.port}/`;
}

// 全局状态
let backendProcess = null;
let splashWindow = null;      // 启动动画窗口
let mainWindow = null;        // 主窗口
let tray = null;              // 系统托盘（必须持有引用，否则会被 GC 回收）
let pluginManagerWindow = null; // 插件管理器窗口
let settingsWindow = null;    // 系统设置窗口
let isQuitting = false;       // 是否正在真正退出（用于"关闭到托盘"判断）
let restartDialogOpen = false;// 后端异常对话框防重入
let zoomLevel = 0;            // 页面缩放级别
let logStream = null;         // 日志文件流
let announcedUrl = null;      // 后端 stdout 公告的实际地址（"dsh web: http://..."，端口 0 时唯一来源）

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock();

// Windows 任务栏分组 / 通知标识
app.setAppUserModelId('DSH-GUI');

// 日志目录（userData = %APPDATA%\DSH-GUI）
const logDir = path.join(app.getPath('userData'), 'logs');

// 日志：终端 + 文件
function initLogStream() {
    try {
        fs.mkdirSync(logDir, { recursive: true });
        const logFile = path.join(logDir, 'backend.log');
        // 超过 1MB 轮转，最多保留 5 份历史
        try {
            const st = fs.statSync(logFile);
            if (st.size > 1024 * 1024) {
                fs.renameSync(logFile, path.join(logDir, `backend-${Date.now()}.log`));
                const olds = fs.readdirSync(logDir).filter((n) => n.startsWith('backend-')).sort();
                while (olds.length > 5) fs.unlinkSync(path.join(logDir, olds.shift()));
            }
        } catch (e) { /* 文件不存在等情况，忽略 */ }
        logStream = fs.createWriteStream(logFile, { flags: 'a' });
    } catch (err) {
        console.error('[log] init failed:', err.message);
    }
}

function appLog(tag, text) {
    console.log(`[${tag}]`, text);
    try {
        if (!logStream) initLogStream();
        logStream.write(`[${new Date().toISOString()}] [${tag}] ${text}\n`);
    } catch (e) { /* 日志写失败不影响主流程 */ }
}

// 窗口状态记忆
function loadWindowState() {
    try {
        const p = path.join(app.getPath('userData'), 'window-state.json');
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) { /* 文件损坏则回退默认 */ }
    return { bounds: null, isMaximized: false, zoomLevel: 0 };
}

function saveWindowState(win) {
    try {
        const state = {
            bounds: win.getNormalBounds(),
            isMaximized: win.isMaximized(),
            zoomLevel: zoomLevel,
        };
        fs.writeFileSync(path.join(app.getPath('userData'), 'window-state.json'), JSON.stringify(state));
    } catch (e) { /* 忽略 */ }
}

// 上次窗口位置是否仍落在某个显示器内（防止副屏移除后窗口跑到屏幕外）
function isOnScreen(b) {
    if (!b) return false;
    return screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
    });
}

// 后端异常处理（弹窗：重启 / 退出）
function handleBackendDown(reason) {
    if (isQuitting || restartDialogOpen) return;
    restartDialogOpen = true;
    const parent = (mainWindow && !mainWindow.isDestroyed())
        ? mainWindow
        : (splashWindow && !splashWindow.isDestroyed() ? splashWindow : undefined);
    dialog.showMessageBox(parent, {
        type: 'error',
        title: 'DeepSeek Harness',
        message: 'DSH 后端已停止',
        detail: reason + '\n\n可以立即重启后端，或退出应用。',
        buttons: ['重启后端', '退出'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
    }).then(({ response }) => {
        restartDialogOpen = false;
        if (response === 0) {
            try {
                backendProcess = startBackend();
                appLog('backend', 'Restarted.');
                reloadMainWindowWhenReady();
            } catch (err) {
                appLog('backend', 'Restart failed: ' + err.message);
                handleBackendDown('重启失败：' + err.message);
            }
        } else {
            isQuitting = true;
            app.quit();
        }
    }).catch(() => { restartDialogOpen = false; });
}

// 启动 DSH 服务
function startBackend() {
    let cmd, cwd;

    if (app.isPackaged) {
        // 生产模式下启动（打包发布前需要实现）
        throw new Error('Packaged mode is not implemented yet.');
    } else {
        // 开发模式下直接启动
        cmd = path.join(codeDir, 'Code', 'start-dsh.cmd');
        cwd = codeDir;
    }

    // 命令行参数：插件管理器覆盖层 --patch 必须排在 host / port 之前，
    // 再附上 config.json 里的 host / port（每次启动都重新读取，跟上回退后的端口）
    const cfg = loadConfig();
    const dshArgs = [];
    dshArgs.push(...pluginManager.getManagerPatchArgs());
    // 注意端口 0 是合法值（系统随机分配），不能用 truthiness 判断丢弃
    if (cfg.host !== undefined && cfg.host !== null) dshArgs.push('--host', cfg.host);
    if (cfg.port !== undefined && cfg.port !== null) dshArgs.push('--port', String(cfg.port));

    const backend = spawn(
        'cmd.exe',
        ['/c', `"${cmd}" ${dshArgs.join(' ')}`],
        {
            cwd: cwd,
            windowsHide: true,   // 隐藏命令行黑窗口
            // stdin 置为 ignore：让 start-dsh.cmd 末尾的 pause 读到 EOF 立即返回，
            // 避免后端退出后留下隐藏的 cmd 残留进程
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsVerbatimArguments: true,
        }
    );

    const pid = backend.pid;
    // 把后端的日志转发到 Electron 的终端和日志文件
    announcedUrl = null;   // 每次启动都重置，等待新的公告
    backend.stdout.on('data', (d) => {
        const text = d.toString().trim();
        appLog('backend', text);
        // 捕获后端公告的实际地址：配置端口为 0（系统随机分配）时，
        // 这是应用唯一能得知真实端口的途径
        const m = /dsh web:\s+(https?:\/\/[^\s]+)/.exec(text);
        if (m) announcedUrl = m[1].replace(/\/+$/, '');
    });
    backend.stderr.on('data', (d) => appLog('backend', d.toString().trim()));
    backend.on('exit', (code) => {
        // 已重启出新进程时，旧进程的退出事件直接忽略
        if (!backendProcess || backendProcess.pid !== pid) return;
        appLog('backend', 'Exit, code = ' + code);
        if (isQuitting) return;
        if (code !== 0) {
            // 检查后端端口是否已被另一个 DSH 占用
            fetch(loadDshUrl()).then((res) => {
                if (res.ok) {
                    appLog('backend', `Exited early, but ${loadConfig().port} is already serving - will connect to the existing instance.`);
                } else {
                    handleBackendDown('后端异常退出（code=' + code + '）。');
                }
            }).catch(() => handleBackendDown('后端异常退出（code=' + code + '）。'));
        }
    });
    backend.on('error', (err) => {
        if (!backendProcess || backendProcess.pid !== pid) return;
        appLog('backend', 'Failed to start: ' + err.message);
        backendProcess = null;
        handleBackendDown('后端启动失败：' + err.message);
    });

    return backend;
}

// 等后端就绪后刷新主窗口：后端重启后已加载的页面还停留在旧插件树/旧外观上，
// 必须重新拉取一次页面。注意端口可能变化（随机端口/改配置），地址不同时
// 必须用 loadURL 换地址，reload() 只会重试当前 URL
async function reloadMainWindowWhenReady(timeoutMs = 600000) {
    const ready = await waitForBackend(timeoutMs);
    if (!ready.ok) {
        appLog('window', 'Backend not ready after restart, skip window reload.');
        return false;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        const current = mainWindow.webContents.getURL().replace(/\/+$/, '');
        if (current === ready.url) {
            mainWindow.webContents.reload();
        } else {
            mainWindow.loadURL(ready.url)
                .catch((err) => appLog('web', 'loadURL failed: ' + err.message));
        }
        appLog('window', `Backend ready after restart, main window ${current === ready.url ? 'reloaded' : 'navigated to ' + ready.url}.`);
    }
    return true;
}

// 手动重启后端（托盘菜单 / 插件管理器）
function restartBackend() {
    if (backendProcess) {
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/pid', String(backendProcess.pid), '/T', '/F']);
        } else {
            backendProcess.kill();
        }
    }
    try {
        backendProcess = startBackend();
        appLog('backend', 'Manually restarted.');
        reloadMainWindowWhenReady();
    } catch (err) {
        appLog('backend', 'Restart failed: ' + err.message);
        handleBackendDown('重启失败：' + err.message);
    }
}

// 系统托盘
function showMainFromTray() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    } else if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.focus();
    }
}

function setAutoLaunch(enabled) {
    if (app.isPackaged) {
        app.setLoginItemSettings({ openAtLogin: enabled });
    } else {
        // 开发模式：注册 electron.exe + 项目目录（项目移动后需重新开关一次）
        app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: [app.getAppPath()] });
    }
}

function createTray() {
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'Assets', 'dsh.ico'));
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('DeepSeek Harness');
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: '显示主窗口', click: showMainFromTray },
        { label: '插件管理', click: openPluginManager },
        { label: '系统设置', click: openSettings },
        { label: '重启后端', click: restartBackend },
        { label: '打开日志文件夹', click: () => shell.openPath(logDir) },
        { type: 'separator' },
        {
            label: '开机自启',
            type: 'checkbox',
            checked: app.getLoginItemSettings().openAtLogin,
            click: (item) => setAutoLaunch(item.checked),
        },
        { type: 'separator' },
        { label: '退出 DeepSeek Harness', click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.on('click', showMainFromTray);
    appLog('app', 'Tray created.');
}

// 打开插件管理器窗口（本地页面，使用专属 preload，与远程 DSH 页面权限隔离）
function openPluginManager() {
    if (pluginManagerWindow && !pluginManagerWindow.isDestroyed()) {
        pluginManagerWindow.show();
        pluginManagerWindow.focus();
        return;
    }
    pluginManagerWindow = new BrowserWindow({
        width: 880,
        height: 620,
        title: '插件管理 - DeepSeek Harness',
        icon: path.join(__dirname, '..', 'Assets', 'dsh.ico'),
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0e16' : '#f4f6fb',
        webPreferences: {
            preload: path.join(__dirname, '..', 'Preload', 'preload-plugins.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    pluginManagerWindow.removeMenu();
    // 管理器窗口自己的快捷键：Ctrl+R/F5 刷新、F12 开发者工具
    pluginManagerWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        const mod = input.control || input.meta;
        const key = (input.key || '').toLowerCase();
        if ((mod && key === 'r') || input.key === 'F5') {
            event.preventDefault();
            pluginManagerWindow.webContents.reload();
        } else if (input.key === 'F12') {
            event.preventDefault();
            if (pluginManagerWindow.webContents.isDevToolsOpened()) pluginManagerWindow.webContents.closeDevTools();
            else pluginManagerWindow.webContents.openDevTools();
        }
    });
    pluginManagerWindow.loadFile(path.join(__dirname, '..', 'Pages', 'plugins.html'))
        .catch((err) => appLog('window', 'Failed to load plugin manager: ' + err.message));
    pluginManagerWindow.on('closed', () => { pluginManagerWindow = null; });
    appLog('window', 'Plugin manager opened.');
}

// 打开系统设置窗口（本地页面，使用专属 preload）
function openSettings() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.show();
        settingsWindow.focus();
        return;
    }
    settingsWindow = new BrowserWindow({
        width: 420,
        height: 400,
        title: '系统设置 - DeepSeek Harness',
        icon: path.join(__dirname, '..', 'Assets', 'dsh.ico'),
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0e16' : '#f4f6fb',
        webPreferences: {
            preload: path.join(__dirname, '..', 'Preload', 'preload-settings.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    settingsWindow.removeMenu();
    settingsWindow.loadFile(path.join(__dirname, '..', 'Pages', 'settings.html'))
        .catch((err) => appLog('window', 'Failed to load settings: ' + err.message));
    settingsWindow.on('closed', () => { settingsWindow = null; });
    appLog('window', 'Settings opened.');
}

// 启动动画（Splash）窗口
function createSplash() {
    splashWindow = new BrowserWindow({
        width: 460,   // 比卡片大一圈，给 CSS 阴影留出绘制空间
        height: 420,
        frame: false,             // 无边框
        transparent: true,        // 透明背景，配合 CSS 圆角
        resizable: false,
        movable: false,
        alwaysOnTop: true,
        skipTaskbar: true,        // 不出现在任务栏
        center: true,             // 屏幕居中
        hasShadow: false,         // 阴影交给 CSS 绘制，避免方形系统阴影
        backgroundColor: '#00000000',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    splashWindow.setAlwaysOnTop(true, 'screen-saver');
    splashWindow.loadFile(path.join(__dirname, '..', 'Pages', 'splash.html'))
        .catch((err) => appLog('window', 'Failed to load splash: ' + err.message));
    splashWindow.on('closed', () => { splashWindow = null; });
    appLog('window', 'Splash shown.');
}

// 轮询等待就绪：每次轮询重新读取 Config/config.json（dsh web 回退端口时写回该文件），
// 同时优先采用后端 stdout 公告的实际地址（配置端口为 0 = 系统随机分配时，这是唯一来源）
async function waitForBackend(timeoutMs = 600000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const url = announcedUrl || loadDshUrl();
        try {
            const res = await fetch(url);
            if (res.ok) {
                appLog('backend', `Ready at ${url}`);
                return { ok: true, url };
            }
        } catch (e) {
            // 还没就绪，继续等待
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    return { ok: false, url: announcedUrl || loadDshUrl() };
}

// 主窗口
async function createWindow() {
    const ready = await waitForBackend();
    if (!ready.ok) {
        appLog('backend', 'Start Timeout.');
        if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
        dialog.showErrorBox('Error', 'Failed to start DSH. Please check the logs.');
        isQuitting = true;
        app.quit();
        return;
    }

    // 后端实际就绪的地址（可能因端口回退而不同于 Config 里的原值）
    const dshUrl = ready.url;
    const DSH_ORIGIN = new URL(dshUrl).origin;   // 本窗口实际加载的源（外链判断用）

    // 恢复上次的窗口位置、大小与缩放
    const st = loadWindowState();
    const useBounds = isOnScreen(st.bounds);

    // 创建一个浏览器窗口（先隐藏，等页面渲染完成再显示，避免白屏）
    mainWindow = new BrowserWindow({
        width: useBounds ? st.bounds.width : 1600,
        height: useBounds ? st.bounds.height : 900,
        x: useBounds ? st.bounds.x : undefined,
        y: useBounds ? st.bounds.y : undefined,
        show: false,
        icon: path.join(__dirname, '..', 'Assets', 'dsh.ico'),
        backgroundColor: '#0b0e16',   // 与 DSH 深色主题一致，防止加载时白闪
        webPreferences: {
            // 指定预加载脚本
            preload: path.join(__dirname, '..', 'Preload', 'preload.js'),

            nodeIntegration: false,
            contextIsolation: true,
        }
    });
    // 去掉Menu
    mainWindow.removeMenu();
    if (st.isMaximized) mainWindow.maximize();
    if (st.zoomLevel) {
        zoomLevel = st.zoomLevel;
        mainWindow.webContents.setZoomLevel(zoomLevel);
    }

    // 关闭 → 最小化到托盘；真正退出时 isQuitting 为 true
    mainWindow.on('close', (e) => {
        saveWindowState(mainWindow);
        if (!isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });
    mainWindow.on('closed', () => { mainWindow = null; });

    // 外链与 window.open：交给系统浏览器，防止应用窗口被"劫持"
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
        let origin;
        try { origin = new URL(url).origin; } catch (err) { return; }
        if (origin !== DSH_ORIGIN) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    // 快捷键：Ctrl+R 刷新 / Ctrl+Shift+R 强制刷新 / F11 全屏 / F12 开发者工具 / Ctrl+=,-,0 缩放
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        const mod = input.control || input.meta;
        const key = (input.key || '').toLowerCase();
        const setZoom = (z) => {
            zoomLevel = Math.max(-2, Math.min(2, z));
            mainWindow.webContents.setZoomLevel(zoomLevel);
        };
        if (mod && key === 'r') {
            event.preventDefault();
            if (input.shift) mainWindow.webContents.reloadIgnoringCache();
            else mainWindow.webContents.reload();
        } else if (input.key === 'F11') {
            event.preventDefault();
            mainWindow.setFullScreen(!mainWindow.isFullScreen());
        } else if (input.key === 'F12') {
            event.preventDefault();
            if (mainWindow.webContents.isDevToolsOpened()) mainWindow.webContents.closeDevTools();
            else mainWindow.webContents.openDevTools();
        } else if (mod && (key === '=' || key === '+')) {
            event.preventDefault();
            setZoom(zoomLevel + 0.1);
        } else if (mod && key === '-') {
            event.preventDefault();
            setZoom(zoomLevel - 0.1);
        } else if (mod && key === '0') {
            event.preventDefault();
            setZoom(0);
        }
    });

    // 页面渲染完成：显示主窗口并关闭启动动画
    let shown = false;
    const showMainWindow = () => {
        if (shown || mainWindow.isDestroyed()) return;
        shown = true;
        mainWindow.show();
        if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
        appLog('window', 'DSH ready, main window shown.');
    };
    mainWindow.once('ready-to-show', showMainWindow);
    // 兜底：万一 ready-to-show 不触发，加载完成后稍等片刻也关闭启动动画
    mainWindow.webContents.once('did-finish-load', () => setTimeout(showMainWindow, 200));

    // 加载失败时给出明确提示
    mainWindow.webContents.on('did-fail-load', (_event, code, desc, url, isMainFrame) => {
        if (!isMainFrame || code === -3) return;  // -3 = ERR_ABORTED，忽略
        appLog('web', `Failed to load: ${code} ${desc} ${url}`);

        // 连接类失败（-102 拒绝连接 / -105 域名解析 / -106 网络不可达）：
        // 常见于后端重启或端口迁移的窗口期，等后端就绪后自动加载实际地址，
        // 而不是直接退出应用
        if (code === -102 || code === -105 || code === -106) {
            reloadMainWindowWhenReady(30000).then((ok) => {
                if (!ok && mainWindow && !mainWindow.isDestroyed()) {
                    dialog.showErrorBox('Error', `Failed to load DSH: ${desc} (${code})`);
                    isQuitting = true;
                    app.quit();
                }
            });
            return;
        }

        if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
        dialog.showErrorBox('Error', `Failed to load DSH: ${desc} (${code})`);
        isQuitting = true;
        app.quit();
    });

    // 加载应用的URL
    mainWindow.loadURL(dshUrl)  // DSH Web 入口
        .catch((err) => appLog('web', 'loadURL failed: ' + err.message));
}

// 生命周期
if (!gotTheLock) {
    // 已有实例在运行：直接退出（会触发已有实例的 second-instance 事件）
    app.quit();
} else {
    app.on('second-instance', () => {
        // 重复启动时聚焦已有窗口
        const win = (mainWindow && !mainWindow.isDestroyed())
            ? mainWindow
            : BrowserWindow.getAllWindows()[0];
        if (win) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
        }
    });

    app.whenReady().then(async () => {
        createSplash();   // 先显示启动动画
        createTray();     // 系统托盘
        pluginManager.initPluginManager({ ipcMain, restartBackend, appLog, shell });
        settings.initSettings({ ipcMain, restartBackend, appLog });

        try {
            backendProcess = startBackend();  // 启动DSH
        } catch (err) {
            appLog('backend', err.message);
            if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
            dialog.showErrorBox('Error', err.message);
            isQuitting = true;
            app.quit();
            return;
        }

        await createWindow();  // 等就绪后再建窗口

        // macOS 特定：当点击 dock 图标且没有窗口打开时，重新创建/恢复窗口
        app.on('activate', function () {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show();
                return;
            }
            if (BrowserWindow.getAllWindows().length === 0) {
                if (!splashWindow) createSplash();
                createWindow();
            }
        });
    });
}

// 当应用退出时，杀掉后端子进程
app.on('before-quit', () => {
    isQuitting = true;
    if (backendProcess) {
        if (process.platform === 'win32') {
            // 用 taskkill /T /F 递归杀掉整个进程树
            spawnSync('taskkill', ['/pid', String(backendProcess.pid), '/T', '/F']);
        } else {
            backendProcess.kill();
        }
        backendProcess = null;
    }
    if (logStream) {
        try { logStream.end(); } catch (e) { /* 忽略 */ }
    }
});

// 当所有窗口都关闭时退出应用 (macOS 除外)
app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});
