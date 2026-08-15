// 插件管理器（主进程）：DSH web profile 的安装/卸载/启用/禁用 + 管理器窗口的 IPC
//
// 设计要点：
// - 插件 = 声明了 dsh.bundle 的 npm 包；安装/卸载走官方命令
//   `dsh plugin --profile web add/remove <pkg>`（本质是 pnpm + bundles 调和）
// - 启用/禁用不碰用户自己的 cordis.patch.yml（可能含 !!js 表达式），
//   而是写管理器专属的 manager.patch.yml 覆盖层，启动后端时用 --patch 传入
// - 本模块可在纯 Node 环境加载（electron 依赖延迟注入），便于单元测试
//
// 本模块由DeepSeek-V4-Pro生成

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

let electron;
try { electron = require('electron'); } catch (e) { electron = null; }

const PROFILE_NAME = 'web';
const PROFILE_DIR = path.join(
    process.env.DSH_HOME || path.join(os.homedir(), '.dsh'),
    'profiles',
    PROFILE_NAME
);
// 允许测试时用环境变量指向临时文件
const MANAGER_PATCH_FILE = process.env.DSH_PLUGIN_MANAGER_PATCH
    || path.join(PROFILE_DIR, 'manager.patch.yml');
const MANAGER_PATCH_HEADER = '# Managed by DSH-GUI plugin manager - do not edit by hand.\n';

// 包名校验：只允许 npm 包名字符，杜绝命令注入
const PKG_RE = /^[A-Za-z0-9@][A-Za-z0-9._@/-]*$/;

// ===== 读取 profile 状态 =====
function readManifest() {
    try {
        return JSON.parse(fs.readFileSync(path.join(PROFILE_DIR, 'package.json'), 'utf8'));
    } catch (e) {
        return null;
    }
}

function installedVersion(pkgName) {
    try {
        const p = path.join(PROFILE_DIR, 'node_modules', pkgName, 'package.json');
        return JSON.parse(fs.readFileSync(p, 'utf8')).version || null;
    } catch (e) {
        return null;
    }
}

// 读取插件包自带的 bundle patch 文本（含条目 id 定义）
function readBundlePatchText(pkgName) {
    try {
        const pkgPath = path.join(PROFILE_DIR, 'node_modules', pkgName, 'package.json');
        const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const rel = pkgJson && pkgJson.dsh && pkgJson.dsh.bundle && pkgJson.dsh.bundle.patch;
        if (!rel) return null;
        return fs.readFileSync(path.resolve(path.dirname(pkgPath), rel), 'utf8');
    } catch (e) {
        return null;
    }
}

// 从 patch 文本中提取条目 id（- id: xxx，任意缩进）
function extractEntryIds(patchText) {
    const ids = [];
    const re = /^\s*-?\s*id:\s*["']?([^"'#:\n]+)["']?\s*$/gm;
    let m;
    while ((m = re.exec(patchText)) !== null) {
        const id = m[1].trim();
        if (id && id !== 'id') ids.push(id);
    }
    return [...new Set(ids)];
}

// ===== manager.patch.yml 读写（格式由本模块全权管理） =====
function readDisabledIds() {
    const ids = new Set();
    let current = null;
    try {
        const lines = fs.readFileSync(MANAGER_PATCH_FILE, 'utf8').split(/\r?\n/);
        for (const line of lines) {
            const m = /^\s*-\s+id:\s*(.+?)\s*$/.exec(line);
            if (m) {
                current = m[1].trim().replace(/^["']|["']$/g, '');
                continue;
            }
            if (/^\s*-\s*/.test(line)) { current = null; continue; }
            if (current && /^\s*disabled:\s*true\s*$/.test(line)) ids.add(current);
        }
    } catch (e) { /* 文件不存在 = 全部启用 */ }
    return ids;
}

function writeDisabledIds(ids) {
    const lines = [MANAGER_PATCH_HEADER];
    for (const id of [...ids].sort()) {
        lines.push(`- id: ${id}`);
        lines.push('  disabled: true');
        lines.push('');
    }
    fs.writeFileSync(MANAGER_PATCH_FILE, lines.join('\n'), 'utf8');
}

// ===== 插件列表 =====
function listPlugins() {
    const manifest = readManifest();
    const deps = (manifest && manifest.dependencies) ? manifest.dependencies : {};
    const disabledIds = readDisabledIds();
    const plugins = Object.keys(deps).map((name) => {
        const patchText = readBundlePatchText(name);
        const entryIds = patchText === null ? [] : extractEntryIds(patchText);
        let disabledCount = 0;
        for (const id of entryIds) if (disabledIds.has(id)) disabledCount += 1;
        return {
            name,
            spec: deps[name],
            version: installedVersion(name),
            isBundle: patchText !== null,
            entryIds,
            disabledCount,
        };
    });
    return { profileDir: PROFILE_DIR, plugins };
}

// 参数含空格时加引号（外层 cmd /c 的引号会被剥掉，内层引号原样传给 npx/pnpm）
function quoteArg(s) {
    return /[\s"]/.test(s) ? `"${s}"` : s;
}

// ===== pnpm 11 构建脚本审批（allowBuilds） =====

// 从 pnpm 输出提取被忽略构建脚本的包名："Ignored build scripts: a@1.0, b@2.0"
function extractIgnoredBuilds(lines) {
    const names = new Set();
    for (const line of lines) {
        const m = /Ignored build scripts:\s*(.+)$/i.exec(line);
        if (!m) continue;
        for (const token of m[1].split(',')) {
            const t = token.trim();
            if (!t) continue;
            // 去掉版本后缀（支持 @scope/name@1.2.3 形式）
            const at = t.lastIndexOf('@');
            names.add(at > 0 ? t.slice(0, at) : t);
        }
    }
    return names;
}

// 把包名写入 pnpm-workspace.yaml 的 allowBuilds 映射（值为 true = 批准）
// 收集所有顶层 allowBuilds 块做合并重写（能修复重复键），
// 保留已有显式值，把 pnpm 的占位值替换为 true
function approveBuilds(names) {
    if (!names || names.size === 0) return;
    const file = path.join(PROFILE_DIR, 'pnpm-workspace.yaml');
    let lines;
    try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch (e) { return; }

    // 收集所有顶层 allowBuilds 块的映射条目与行范围 [start, end)
    const ranges = [];
    const map = new Map();
    let blockStart = -1;
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\S/.test(line)) {
            if (line.trim() === 'allowBuilds:') {
                if (inBlock) ranges.push([blockStart, i]);   // 先关闭上一个块
                blockStart = i;
                inBlock = true;
            } else if (inBlock) {
                ranges.push([blockStart, i]);
                inBlock = false;
                blockStart = -1;
            }
            continue;
        }
        if (inBlock) {
            const m = /^\s{2,}([A-Za-z0-9@._/-]+):\s*(.*)$/.exec(line);
            if (m) map.set(m[1], m[2].trim());
        }
    }
    if (inBlock) ranges.push([blockStart, lines.length]);

    for (const n of names) {
        const cur = map.get(n);
        // 缺失或 pnpm 占位值 → 批准；用户显式写的 false 保留不动
        if (cur === undefined || cur === 'set this to true or false') map.set(n, 'true');
    }

    // 删除所有旧块，在文件末尾追加一个合并后的块
    const kept = [];
    let prev = 0;
    for (const [s, e] of ranges) {
        kept.push(...lines.slice(prev, s));
        prev = e;
    }
    kept.push(...lines.slice(prev));
    while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();   // 去尾部空行
    const block = ['allowBuilds:'];
    for (const [k, v] of map) block.push(`  ${k}: ${v}`);
    kept.push('', ...block, '');
    fs.writeFileSync(file, kept.join('\n'), 'utf8');
}

// ===== 执行 dsh plugin 命令（安装/卸载），输出逐行回调 =====
// cwd 固定为 profile 目录：pnpm 在 profile 目录运行，dsh 的 anchorPathSpec
// 也以该目录为锚点解析相对路径，两边保持一致
function runDshPlugin(args, onLine) {
    return new Promise((resolve) => {
        const quoted = args.map(quoteArg).join(' ');
        try { fs.mkdirSync(PROFILE_DIR, { recursive: true }); } catch (e) { /* 已存在等情况 */ }
        const isWin = process.platform === 'win32';
        const child = isWin
            ? spawn('cmd.exe', ['/c', `"npx -y @deepseek-ai/dsh plugin --profile ${PROFILE_NAME} ${quoted}"`], {
                cwd: PROFILE_DIR,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsVerbatimArguments: true,
            })
            : spawn('bash', ['-lc', `npx -y @deepseek-ai/dsh plugin --profile ${PROFILE_NAME} ${quoted}`], {
                cwd: PROFILE_DIR,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        const feed = (buf) => {
            for (const line of buf.toString().split(/\r?\n/)) {
                if (line.trim()) onLine(line);
            }
        };
        child.stdout.on('data', feed);
        child.stderr.on('data', feed);
        child.on('error', (err) => {
            onLine('spawn error: ' + err.message);
            resolve(1);
        });
        child.on('exit', (code) => resolve(code));
    });
}

// ===== 安装参数构造与校验 =====
const GIT_RE = /^(github:|gitlab:|bitbucket:|git\+|git@|https?:\/\/|ssh:\/\/|git:\/\/)/i;

// 把安装面板提交的 spec 转成 dsh plugin 可接受的单个参数；校验失败返回错误信息
function buildInstallArg(spec) {
    if (!spec || typeof spec !== 'object') return { error: '无效的安装参数' };
    const kind = spec.kind;
    const value = typeof spec.value === 'string' ? spec.value.trim() : '';
    if (!value) return { error: '请填写安装来源' };

    if (kind === 'npm') {
        if (!PKG_RE.test(value) || value.includes('..')) return { error: '无效的 npm 包名' };
        return { arg: value };
    }
    if (kind === 'git') {
        if (!GIT_RE.test(value) || /[\s"]/.test(value)) return { error: '无效的 Git 地址' };
        return { arg: value };
    }
    if (kind === 'local') {
        if (!fs.existsSync(value)) return { error: '目录不存在：' + value };
        if (!fs.statSync(value).isDirectory()) return { error: '不是目录：' + value };
        // 相对 profile 目录生成相对路径：pnpm 在 profile 目录运行，
        // dsh 的 anchorPathSpec 也会以该目录为锚点，两边解析结果一致
        let rel = path.relative(PROFILE_DIR, path.resolve(value)).replace(/\\/g, '/');
        if (!rel) rel = '.';
        const mode = spec.localMode === 'file' ? 'file' : 'link';
        return { arg: `${mode}:${rel}`, label: `${mode} → ${value}` };
    }
    return { error: '未知的安装类型' };
}

// ===== 后端启动参数：把管理器覆盖层作为 --patch 传入 =====
function getManagerPatchArgs() {
    try {
        if (!fs.existsSync(MANAGER_PATCH_FILE)) return [];
        const text = fs.readFileSync(MANAGER_PATCH_FILE, 'utf8').replace(/^#.*$/gm, '');
        if (!/^\s*-\s+id:/m.test(text)) return [];   // 空覆盖层就不传
        return ['--patch', MANAGER_PATCH_FILE];
    } catch (e) {
        return [];
    }
}

// ===== IPC 注册 =====
function initPluginManager({ ipcMain, restartBackend, appLog, shell }) {
    ipcMain.handle('plugins:list', () => listPlugins());

    ipcMain.handle('plugins:install', async (event, spec) => {
        const built = buildInstallArg(spec);
        const send = (line) => { if (!event.sender.isDestroyed()) event.sender.send('plugins:command-output', line); };
        if (built.error) {
            send('error: ' + built.error);
            return { ok: false, error: built.error };
        }
        const label = built.label || built.arg;
        send('$ dsh plugin --profile web add ' + label);
        const output = [];
        const collect = (line) => { output.push(line); send(line); };
        let code = await runDshPlugin(['add', built.arg], collect);

        // pnpm 11 构建脚本审批：自动批准被忽略的构建脚本并重试一次
        const ignored = extractIgnoredBuilds(output);
        if (code !== 0 && ignored.size > 0) {
            approveBuilds(ignored);
            send(`auto-approved build scripts: ${[...ignored].join(', ')}，重试安装...`);
            output.length = 0;
            code = await runDshPlugin(['add', built.arg], collect);
        }

        appLog('plugin', `install ${label} -> exit ${code}`);
        return { ok: code === 0, code };
    });

    // 目录选择器（本地安装用）
    ipcMain.handle('plugins:pick-directory', async (event) => {
        if (!electron) return null;
        const win = electron.BrowserWindow.fromWebContents(event.sender);
        const res = await electron.dialog.showOpenDialog(win, {
            title: '选择插件目录',
            properties: ['openDirectory'],
        });
        if (res.canceled || !res.filePaths || res.filePaths.length === 0) return null;
        return res.filePaths[0];
    });

    ipcMain.handle('plugins:remove', async (event, pkg) => {
        const known = listPlugins().plugins.find((p) => p.name === pkg);
        if (!known) return { ok: false, error: '未找到该插件' };
        const send = (line) => { if (!event.sender.isDestroyed()) event.sender.send('plugins:command-output', line); };
        send('$ dsh plugin --profile web remove ' + pkg);
        const code = await runDshPlugin(['remove', pkg], send);
        // 卸载后顺带清掉该插件的禁用记录
        if (code === 0) {
            const ids = readDisabledIds();
            for (const id of known.entryIds) ids.delete(id);
            writeDisabledIds(ids);
        }
        appLog('plugin', `remove ${pkg} -> exit ${code}`);
        return { ok: code === 0, code };
    });

    ipcMain.handle('plugins:set-enabled', (_event, pkg, enabled) => {
        const target = listPlugins().plugins.find((p) => p.name === pkg);
        if (!target) return { ok: false, error: '未找到该插件' };
        if (!target.isBundle) return { ok: false, error: '该包未声明 dsh.bundle，不是可启停的插件' };
        const ids = readDisabledIds();
        for (const id of target.entryIds) {
            if (enabled) ids.delete(id);
            else ids.add(id);
        }
        writeDisabledIds(ids);
        appLog('plugin', `${enabled ? 'enable' : 'disable'} ${pkg} (${target.entryIds.length} entries)`);
        return { ok: true };
    });

    ipcMain.handle('plugins:open-profile-dir', () => {
        if (electron) electron.shell.openPath(PROFILE_DIR);
        return true;
    });

    ipcMain.handle('plugins:restart-backend', () => {
        restartBackend();
        return true;
    });
}

module.exports = {
    initPluginManager,
    getManagerPatchArgs,
    listPlugins,
    readDisabledIds,
    writeDisabledIds,
    extractEntryIds,
    buildInstallArg,
    quoteArg,
    extractIgnoredBuilds,
    approveBuilds,
    PROFILE_DIR,
    MANAGER_PATCH_FILE,
};
