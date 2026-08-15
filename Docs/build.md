# DSH-GUI 打包指南

本文档说明如何把 DSH-GUI（DeepSeek Harness 桌面壳）打包成安装包，以及打包版与开发版的行为差异。

## 平台与产物一览

| 平台 | 产物 | 构建命令 | 构建环境 |
|---|---|---|---|
| Windows | NSIS 安装包 `DSH-GUI-Setup-<版本>.exe` | `npm run dist` | Windows 本机即可 |
| Linux | `*.AppImage`、`*.deb` | `npm run dist -- --linux` | Linux 本机（或 Docker，见 [Linux 打包](#linux-打包)） |

## 通用约定

| 内容 | 位置 / 说明 |
|---|---|
| 产物输出目录 | 项目根目录 `dist/` |
| 构建工具缓存 | `.eb-cache/`（已 gitignore，删除不影响构建，只是下次要重新下载） |
| 构建脚本与素材 | `build/`（installer.nsh、安装器 BMP 素材，已提交） |
| 构建配置 | `electron-builder.yml`（`win`/`nsis` 与 `linux` 两段并列） |
| 打包内容 | `App/**` + `Config/config.json` + `package.json` → 打 asar |
| 原生依赖重建 | `npmRebuild: false`（应用无原生依赖，跳过 @electron/rebuild） |

**目标机器通用要求**（两平台一致）：

- Node.js + npm —— 应用通过 `npx @deepseek-ai/dsh web` 托管后端，必须有
- pnpm —— 仅插件管理器的"安装/卸载插件"功能需要，不用可缺
- 网络（首次）—— 首次启动或预载 dsh 时下载

## Windows 打包

```bash
npm install    # 安装依赖（electron + electron-builder）
npm run dist   # NSIS 安装包 → dist/DSH-GUI-Setup-<版本>.exe
npm run pack   # 免安装目录 dist/win-unpacked（快速调试用）
```

### 安装包行为（NSIS 向导）

向导页面顺序（自定义页插入在"选择安装目录"之后、"开始安装"之前）：

1. 欢迎 → 选择安装目录（MUI 标准页）
2. **端口设置** —— 输入监听端口（0 = 系统随机分配，1-65535）。`下一步`时校验：空值/非数字/超范围会被拦截并提示
3. **环境检查**（可选）—— 端口页勾选"检查环境"才出现。逐项执行 `node --version` / `npm --version` / `pnpm --version`，**实时显示每条命令与版本号回复**；结果分三种处理：
   - **缺 node/npm** → 只提供"前往官网下载 Node.js"按钮，页面写明"安装完成后请关闭并重新打开安装程序"
   - **仅缺 pnpm 且 npm 可用** → 提供"自动安装 pnpm"按钮（执行 `npm install -g pnpm` 后自动复检）
   - **"跳过"按钮** → 弹出风险提示（需自行确认已装 node/npm/pnpm），确认后可继续下一步
   - 未勾选检查时该页跳过，端口页上有常驻提示："跳过检查时，若机器缺少 Node.js/npm/pnpm，应用可能无法正常运行"
4. **预载 DeepSeek Harness**（可选）—— 仅当"勾选了环境检查且检查全部通过"时出现。点击"开始预载"会打开一个**独立的控制台窗口**执行 `npx -y @deepseek-ai/dsh --version`（进度实时可见、不阻塞向导），完成后提示用户关闭窗口并继续；也可直接下一步跳过
5. 安装 → 完成（MUI 标准页）

**端口写入时机**：安装阶段（`customInstall` 宏）把用户选择的端口写入
`<安装目录>\Config\config.json`，内容形如：

```json
{"host": "127.0.0.1", "port": 3080}
```

若用户在安装目录页改了安装位置，配置依然写进最终目录（写入发生在安装阶段，用最终 `$INSTDIR`）。

### Windows 配置位置

| 模式 | 配置位置 |
|---|---|
| 开发（`npm start`） | 项目根目录 `Config/config.json` |
| 安装版 | `<安装目录>\Config\config.json`（安装器端口页写入；"系统设置"窗口同样读写这里） |

> 若安装目录选在需要管理员权限的位置（如 `C:\Program Files`），后续写配置可能失败，
> 应用会回退默认值（127.0.0.1:3080）并记录日志。默认按用户安装路径（`%LOCALAPPDATA%\Programs\DSH-GUI`）没有此问题。

## Linux 打包

### 构建

Linux 产物需要在 Linux 环境构建。方式一，在 Linux 机器上：

```bash
npm install
npm run dist -- --linux    # 产物：dist/*.AppImage 与 dist/*.deb
```

方式二，在 Windows/macOS 上用 Docker（需要 Docker）：

```bash
docker run --rm -ti \
  --env ELECTRON_CACHE="/root/.cache/electron" \
  --env ELECTRON_BUILDER_CACHE="/root/.cache/electron-builder" \
  -v ${PWD}:/project -v ${PWD}/.eb-cache:/root/.cache/electron-builder \
  electronuserland/builder:wine \
  /bin/bash -c "cd /project && npm install && npm run dist -- --linux"
```

### 与 Windows 包的差异

| 项 | Windows | Linux |
|---|---|---|
| 安装向导 | 有（NSIS 自定义页：端口/环境检查/预载） | 无，AppImage 直接运行、deb 用包管理器装 |
| 端口设置入口 | 安装向导 + 应用内"系统设置" | 应用内"系统设置"（或首次运行后手动改配置） |
| 配置位置 | `<安装目录>\Config\config.json` | `~/.config/DSH-GUI/config.json`（XDG 目录；AppImage 只读挂载写不了安装目录） |
| 开机自启 | 托盘菜单支持 | 不支持（无标准机制，托盘项静默忽略） |
| 开发模式启动 | `npm start`（经 `start-dsh.cmd`） | `npm start`（经 `bash` 调 npx，等价手动脚本见 `Code/start-dsh.sh`） |

## 代码层面的打包适配

| 位置 | 打包版行为 |
|---|---|
| 后端启动（index.js `startBackend`） | Windows：`cmd /c npx ...`（打包）/ `start-dsh.cmd`（开发）；Linux/macOS：`bash -lc npx ...`（打包与开发一致） |
| 插件命令（plugin-manager.js `runDshPlugin`） | Windows：`cmd /c` + `windowsVerbatimArguments`；Linux：`bash -lc` |
| 后端进程清理 | Windows：`taskkill /T`；Linux：`detached` 进程组 `kill(-pid)` |
| 配置路径 | 平台感知（见上表）；注入点统一在 settings.js `setConfigPath` |
| 图标 | Windows `.ico`；Linux `.png`（`App/Assets/dsh.png`） |
| 页面/preload/单实例锁/托盘/日志 | 全部跨平台，asar 内加载，无平台差异 |

## 常见问题

- **构建时报 `spawn EPERM`**：构建链需要完整权限（沙箱/受限环境会拦截子进程管道）。在正常终端运行 `npm run dist` 即可
- **Windows 安装后双击无反应**：大概率缺 Node.js——安装时勾选环境检查可提前发现；已装的情况下看 `%APPDATA%\DSH-GUI\logs\backend.log`
- **端口绑定失败（EACCES）**：该端口被系统保留（Windows 常见于 Hyper-V/WSL 保留段）。弹窗里点"重启（端口设为 0）"自动改用随机端口，或改配置文件换端口
- **改完配置不生效**：配置是启动时读取的，改完用托盘"重启后端"或重启应用
- **`Config/config.json` 在 git 里显示被修改**：开发模式下 dsh 端口回退/自愈会改写它，属预期；提交时 `git restore` 即可
