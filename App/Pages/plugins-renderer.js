// 插件管理器渲染逻辑（由 plugins.html 在 body 末尾加载，此时 DOM 已就绪）
const api = window.dshPluginManager;
const listWrap = document.getElementById('listWrap');
const emptyTip = document.getElementById('emptyTip');
const restartBtn = document.getElementById('restartBtn');
const openDirBtn = document.getElementById('openDirBtn');
const headerInstallBtn = document.getElementById('headerInstallBtn');
const backBtn = document.getElementById('backBtn');
const restartHint = document.getElementById('restartHint');
const restartHint2 = document.getElementById('restartHint2');
const logBody = document.getElementById('logBody');
const clearLogBtn = document.getElementById('clearLogBtn');
const viewMain = document.getElementById('viewMain');
const viewInstall = document.getElementById('viewInstall');

let dirty = false;

// preload 未加载时的兜底提示（避免页面静默空白）
if (!api) {
    emptyTip.textContent = '未检测到 window.dshPluginManager（preload 未加载）\n请从托盘菜单重新打开"插件管理"窗口';
    restartBtn.disabled = true;
    openDirBtn.disabled = true;
    headerInstallBtn.disabled = true;
    throw new Error('preload missing');
}

function log(line, cls) {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = line;
    logBody.appendChild(div);
    logBody.scrollTop = logBody.scrollHeight;
}

api.onCommandOutput((line) => {
    const isCmd = line.startsWith('$ ');
    log(line, isCmd ? 'cmd' : (/error|failed|EACCES|EPERM|not found/i.test(line) ? 'err' : ''));
});

// ===== 视图切换 =====
function showView(name) {
    const toInstall = name === 'install';
    viewMain.hidden = toInstall;
    viewInstall.hidden = !toInstall;
    headerInstallBtn.hidden = toInstall;
}

headerInstallBtn.addEventListener('click', () => showView('install'));
backBtn.addEventListener('click', () => showView('main'));

// Tab 切换
const tabs = document.querySelectorAll('.tab');
const panels = {
    npm: document.getElementById('panel-npm'),
    local: document.getElementById('panel-local'),
    git: document.getElementById('panel-git'),
};
tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.toggle('active', t === tab));
        for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== tab.dataset.tab;
    });
});

// ===== 主视图：插件列表 =====
function stateOf(p) {
    if (!p.isBundle) return { text: '普通依赖', cls: 'badge--lib' };
    if (p.disabledCount === 0) return { text: '已启用', cls: 'badge--on' };
    if (p.disabledCount >= p.entryIds.length) return { text: '已禁用', cls: 'badge--off' };
    return { text: `部分禁用 ${p.disabledCount}/${p.entryIds.length}`, cls: 'badge--part' };
}

function render(data) {
    listWrap.innerHTML = '';
    const plugins = data.plugins || [];
    if (plugins.length === 0) {
        emptyTip.textContent = '还没有安装任何插件';
        const btn = document.createElement('button');
        btn.className = 'btn btn--primary';
        btn.textContent = '安装第一个插件';
        btn.addEventListener('click', () => showView('install'));
        emptyTip.appendChild(document.createElement('br'));
        emptyTip.appendChild(btn);
        listWrap.appendChild(emptyTip);
        return;
    }
    emptyTip.remove();
    for (const p of plugins) {
        const st = stateOf(p);
        const card = document.createElement('div');
        card.className = 'plugin-card';

        const icon = document.createElement('div');
        icon.className = 'icon';
        icon.textContent = (p.name[0] || '?').toUpperCase();

        const info = document.createElement('div');
        info.className = 'info';
        const nameEl = document.createElement('div');
        nameEl.className = 'name';
        nameEl.textContent = p.name;
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = `v${p.version || p.spec}  ·  ${p.isBundle ? `入口 ${p.entryIds.length} 个` : '未声明 dsh.bundle'}`;
        info.appendChild(nameEl);
        info.appendChild(meta);

        const badge = document.createElement('span');
        badge.className = 'badge ' + st.cls;
        badge.textContent = st.text;

        const actions = document.createElement('div');
        actions.className = 'actions';
        if (p.isBundle) {
            const toggle = document.createElement('button');
            toggle.className = 'btn btn--sm';
            toggle.textContent = p.disabledCount === 0 ? '禁用' : '启用';
            toggle.addEventListener('click', async () => {
                toggle.disabled = true;
                const res = await api.setEnabled(p.name, p.disabledCount > 0);
                if (res.ok) {
                    log(`已${p.disabledCount > 0 ? '启用' : '禁用'} ${p.name}（重启后端生效）`, 'sys');
                    dirty = true;
                    restartHint.classList.add('show');
                    render(await api.list());
                } else {
                    log(res.error || '操作失败', 'err');
                    toggle.disabled = false;
                }
            });
            actions.appendChild(toggle);
        }
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn--sm btn--danger';
        removeBtn.textContent = '卸载';
        removeBtn.addEventListener('click', async () => {
            if (!confirm(`确认卸载 ${p.name}？`)) return;
            removeBtn.disabled = true;
            log(`$ 卸载 ${p.name} ...`, 'cmd');
            const res = await api.remove(p.name);
            if (res.ok) {
                log('卸载完成', 'sys');
                dirty = true;
                restartHint.classList.add('show');
                render(await api.list());
            } else {
                log(res.error || '卸载失败', 'err');
                removeBtn.disabled = false;
            }
        });
        actions.appendChild(removeBtn);

        card.appendChild(icon);
        card.appendChild(info);
        card.appendChild(badge);
        card.appendChild(actions);
        listWrap.appendChild(card);
    }
}

async function refresh() {
    try {
        render(await api.list());
    } catch (err) {
        emptyTip.textContent = '读取失败：' + (err.message || err);
        listWrap.appendChild(emptyTip);
    }
}

// ===== 安装视图 =====
async function runInstall(spec, btn) {
    btn.disabled = true;
    const res = await api.install(spec);
    if (res.ok) {
        log('安装完成（重启后端生效）', 'sys');
        dirty = true;
        restartHint.classList.add('show');
        restartHint2.classList.remove('show');
        await refresh();
        showView('main');
    } else {
        log(res.error || `安装失败（exit ${res.code ?? '?'}）`, 'err');
    }
    btn.disabled = false;
}

// npm
const npmInput = document.getElementById('npmInput');
const npmInstallBtn = document.getElementById('npmInstallBtn');
npmInstallBtn.addEventListener('click', () => runInstall({ kind: 'npm', value: npmInput.value }, npmInstallBtn));
npmInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') npmInstallBtn.click(); });

// 本地目录
const localPathInput = document.getElementById('localPathInput');
const pickDirBtn = document.getElementById('pickDirBtn');
const localInstallBtn = document.getElementById('localInstallBtn');
pickDirBtn.addEventListener('click', async () => {
    const p = await api.pickDirectory();
    if (p) { localPathInput.value = p; localInstallBtn.disabled = false; }
});
localInstallBtn.addEventListener('click', async () => {
    const mode = document.querySelector('input[name="localMode"]:checked');
    await runInstall({ kind: 'local', value: localPathInput.value, localMode: mode ? mode.value : 'link' }, localInstallBtn);
});

// Git
const gitInput = document.getElementById('gitInput');
const gitInstallBtn = document.getElementById('gitInstallBtn');
gitInstallBtn.addEventListener('click', () => runInstall({ kind: 'git', value: gitInput.value }, gitInstallBtn));
gitInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') gitInstallBtn.click(); });

// ===== 全局操作 =====
restartBtn.addEventListener('click', async () => {
    restartBtn.disabled = true;
    await api.restartBackend();
    log('已请求重启后端，就绪后将自动刷新主窗口', 'sys');
    setTimeout(() => {
        restartBtn.disabled = false;
        if (dirty) { dirty = false; restartHint.classList.remove('show'); }
    }, 3000);
});
openDirBtn.addEventListener('click', () => api.openProfileDir());
clearLogBtn.addEventListener('click', () => { logBody.innerHTML = ''; });

refresh();
log('就绪。安装/卸载/启停操作会在这里显示命令输出。', 'sys');
