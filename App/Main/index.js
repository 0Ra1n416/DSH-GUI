const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const URL = 'http://127.0.0.1:3080/';

let backendProcess = null;
let splashWindow = null;   // 启动动画窗口
let mainWindow = null;     // 主窗口

// ===== 单实例锁：重复启动时聚焦已有窗口，避免多个后端抢 3080 端口 =====
const gotTheLock = app.requestSingleInstanceLock();

// 根目录
const codeDir = path.join(__dirname, '..', '..');

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

    // Windows 下 spawn 无法直接执行 .cmd/.bat，必须通过 cmd.exe /c 调用。
    // 注意：必须配合 windowsVerbatimArguments，路径两边的引号才能原样传给 cmd.exe
    // （否则 libuv 会把引号转义成 \"，cmd.exe 无法识别；路径含空格时必须有引号）。
    const backend = spawn(
        'cmd.exe',
        ['/c', `"${cmd}"`],
        {
            cwd: cwd,
            windowsHide: true,   // 隐藏命令行黑窗口
            // stdin 置为 ignore：让 start-dsh.cmd 末尾的 pause 读到 EOF 立即返回，
            // 避免后端退出后留下隐藏的 cmd 残留进程
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsVerbatimArguments: true,
        }
    );

    // 把后端的日志转发到 Electron 的终端
    backend.stdout.on('data', (d) => console.log('[backend]', d.toString().trim()));
    backend.stderr.on('data', (d) => console.error('[backend]', d.toString().trim()));
    backend.on('exit', (code) => {
        console.log('[backend] Exit, code =', code);
        // 后端异常退出时检查 3080 是否已被另一个 DSH 占用
        if (code !== 0) {
            fetch(URL).then((res) => {
                if (res.ok) console.warn('[backend] Exited early, but 3080 is already serving - will connect to the existing instance.');
            }).catch(() => {});
        }
    });
    backend.on('error', (err) => {
        console.error('[backend] Failed to start:', err.message);
        if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
        dialog.showErrorBox('Error', 'Failed to start DSH: ' + err.message);
        backendProcess = null;
        app.quit();
    });

    return backend;
}

// 启动动画（Splash）窗口：后台就绪前显示在屏幕中央
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
        .catch((err) => console.error('[window] Failed to load splash:', err.message));
    splashWindow.on('closed', () => { splashWindow = null; });
    console.log('[window] Splash shown.');
}

// 轮询等待就绪
async function waitForBackend(url, timeoutMs = 600000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.ok) {
                console.log('[backend] Ready.');
                return true;
            }
        } catch (e) {
            // 还没就绪，继续等待
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
}

async function createWindow() {
    const ready = await waitForBackend(URL);
    if (!ready) {
        console.error('[backend] Start Timeout.');
        if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
        dialog.showErrorBox('Error', 'Failed to start DSH. Please check the logs.');
        app.quit();
        return;
    }

    // 创建一个浏览器窗口（先隐藏，等页面渲染完成再显示，避免白屏）
    mainWindow = new BrowserWindow({
        width: 1600,
        height: 900,
        show: false,
        icon: path.join(__dirname, '..', 'Assets', 'dsh.ico'),
        backgroundColor: '#0b0e16',   // 与 DSH 深色主题一致，防止加载时白闪
        webPreferences: {
            // 指定预加载脚本
            preload: path.join(__dirname, '..', 'Preload','preload.js'),

            nodeIntegration: false,
            contextIsolation: true,
        }
    });
    // 去掉Menu
    mainWindow.removeMenu();
    mainWindow.on('closed', () => { mainWindow = null; });

    // 页面渲染完成：显示主窗口并关闭启动动画
    let shown = false;
    const showMainWindow = () => {
        if (shown || mainWindow.isDestroyed()) return;
        shown = true;
        mainWindow.show();
        if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
        console.log('[window] DSH ready, main window shown.');
    };
    mainWindow.once('ready-to-show', showMainWindow);
    // 兜底：万一 ready-to-show 不触发，加载完成后稍等片刻也关闭启动动画
    mainWindow.webContents.once('did-finish-load', () => setTimeout(showMainWindow, 200));

    // 加载失败时给出明确提示
    mainWindow.webContents.on('did-fail-load', (_event, code, desc, url, isMainFrame) => {
        if (!isMainFrame || code === -3) return;  // -3 = ERR_ABORTED，忽略
        console.error('[web] Failed to load:', code, desc, url);
        if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
        dialog.showErrorBox('Error', `Failed to load DSH: ${desc} (${code})`);
        app.quit();
    });

    // 加载应用的URL
    mainWindow.loadURL(URL)  // DSH Web 入口
        .catch((err) => console.error('[web] loadURL failed:', err.message));

    // 打开开发者工具
    // mainWindow.webContents.openDevTools();
}

// 当 Electron 完成初始化并准备创建窗口时，调用 createWindow 函数
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
        createSplash();  // 先显示启动动画

        try {
            backendProcess = startBackend();  // 启动DSH
        } catch (err) {
            console.error('[backend]', err.message);
            if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
            dialog.showErrorBox('Error', err.message);
            app.quit();
            return;
        }

        await createWindow();  // 等就绪后再建窗口

        // macOS 特定：当点击 dock 图标且没有窗口打开时，重新创建一个窗口
        app.on('activate', function () {
            if (BrowserWindow.getAllWindows().length === 0) {
                if (!splashWindow) createSplash();
                createWindow();
            }
        });
    });
}

// 当应用退出时，杀掉后端子进程
app.on('before-quit', () => {
    if (backendProcess) {
        if (process.platform === 'win32') {
            // 用 taskkill /T /F 递归杀掉整个进程树
            spawnSync('taskkill', ['/pid', String(backendProcess.pid), '/T', '/F']);
        } else {
            backendProcess.kill();
        }
        backendProcess = null;
    }
});

// 当所有窗口都关闭时退出应用 (macOS 除外)
app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});