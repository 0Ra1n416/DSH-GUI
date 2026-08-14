// 系统设置：Config/config.json 的读写、校验与设置窗口的 IPC
// 纯 Node 模块（不依赖 electron），便于单元测试
const path = require('path');
const fs = require('fs');

// 配置路径优先级：测试环境变量 > 宿主注入（打包后 = %APPDATA%\DSH-GUI\config.json）> 开发默认
let injectedPath = null;
function setConfigPath(p) { injectedPath = p; }
function getConfigPath() {
    return process.env.DSH_CONFIG_PATH
        || injectedPath
        || path.join(__dirname, '..', '..', 'Config', 'config.json');
}

// host 约束与 dsh web 实际行为一致：官方启动器出于安全考虑
// 明确拒绝 --host 0.0.0.0（"would expose remote code execution to the network"）
const ALLOWED_HOSTS = ['127.0.0.1'];
const DEFAULT_CONFIG = { host: '127.0.0.1', port: 3080 };

function loadConfig() {
    const defaults = { ...DEFAULT_CONFIG };
    try {
        const cfg = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
        return { ...defaults, ...cfg };
    } catch (err) {
        console.warn('[config] 读取 config.json 失败，使用默认值：', err.message);
        return defaults;
    }
}

// 校验并归一化用户输入；成功返回 { ok: true, config }，失败返回 { ok: false, error }
function validateConfig(input) {
    if (!input || typeof input !== 'object') return { ok: false, error: '无效的配置' };
    const host = String(input.host || '').trim();
    const portRaw = String(input.port ?? '').trim();
    if (!ALLOWED_HOSTS.includes(host)) {
        return { ok: false, error: 'host 仅支持 ' + ALLOWED_HOSTS.join(' / ') };
    }
    if (!/^\d{1,5}$/.test(portRaw)) {
        return { ok: false, error: 'port 必须是 0-65535 的整数' };
    }
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        return { ok: false, error: 'port 必须是 0-65535 的整数' };
    }
    return { ok: true, config: { host, port } };
}

function saveConfig(config) {
    const target = getConfigPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

// 注册设置窗口的 IPC；保存成功后立即重启后端（就绪后主窗口会自动刷新）
function initSettings({ ipcMain, restartBackend, appLog }) {
    ipcMain.handle('settings:get', () => loadConfig());

    ipcMain.handle('settings:save', (_event, input) => {
        const result = validateConfig(input);
        if (!result.ok) return result;
        try {
            saveConfig(result.config);
        } catch (err) {
            return { ok: false, error: '写入 config.json 失败：' + err.message };
        }
        appLog('settings', `Saved config: host=${result.config.host}, port=${result.config.port}; restarting backend.`);
        restartBackend();
        return { ok: true };
    });
}

module.exports = {
    initSettings,
    loadConfig,
    validateConfig,
    saveConfig,
    setConfigPath,
    getConfigPath,
    ALLOWED_HOSTS,
    DEFAULT_CONFIG,
};
