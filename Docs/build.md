# DSH-GUI 打包指南

本文档说明如何把 DSH-GUI（DeepSeek Harness 桌面壳）打包成 Windows 安装包，以及打包版与开发版的行为差异。

## 目录

- [产物与目录约定](#产物与目录约定)
- [环境要求](#环境要求)
- [构建步骤](#构建步骤)
- [安装包行为](#安装包行为)
- [配置文件的两种位置](#配置文件的两种位置)
- [代码层面的打包适配](#代码层面的打包适配)
- [常见问题](#常见问题)

## 产物与目录约定

| 内容 | 位置 |
|---|---|
| 安装包输出目录 | 项目根目录 `dist/` |
| 安装包 | `dist/DSH-GUI-Setup-<版本>.exe` |
| 免安装目录（调试用） | `dist/win-unpacked/` |
| 构建工具缓存 | `.eb-cache/`（已 gitignore，删除不影响构建，只是下次要重新下载） |
| 构建脚本与素材 | `build/`（installer.nsh、安装器 BMP 素材，已提交） |
| 构建配置 | `electron-builder.yml` |

## 环境要求

- **构建机器**：Windows + Node.js（`npm run dist` 即可）
- **目标机器（安装后运行）**：
  - Node.js + npm —— 应用通过 `npx @deepseek-ai/dsh web` 托管后端，必须有
  - pnpm —— 仅插件管理器的"安装/卸载插件"功能需要，不用可缺
  - 安装器的"环境检查"页会自动检测这三项；跳过检查时不满足会导致应用无法启动

## 构建步骤

```bash
npm install          # 安装依赖（electron + electron-builder）
npm run dist         # 构建 NSIS 安装包 → dist/DSH-GUI-Setup-0.0.1.exe
npm run pack         # 只出免安装目录 dist/win-unpacked（快速调试用）
```

构建流程：electron-builder 按 `files` 配置打包（`App/**` + `Config/config.json` + `package.json`）→ 打 asar → 生成 NSIS 安装器（注入 `build/installer.nsh` 的自定义页）。

## 安装包行为

向导页面顺序（自定义页插入在"选择安装目录"之后、"开始安装"之前）：

1. 欢迎 → 选择安装目录（MUI 标准页）
2. **端口设置** —— 输入监听端口（0 = 系统随机分配，1-65535）。`下一步`时校验：空值/非数字/超范围会被拦截并提示
3. **环境检查**（可选）—— 端口页勾选"检查环境"才出现。逐项执行 `node --version` / `npm --version` / `pnpm --version`，**实时显示每条命令与版本号回复**；有缺失时列出缺失项并弹窗询问"是否退出安装"
   - 未勾选时直接跳过，端口页上有常驻提示："跳过检查时，若机器缺少 Node.js/npm/pnpm，应用可能无法正常运行"
4. **预载 DeepSeek Harness**（可选）—— 仅当"勾选了环境检查且检查全部通过"时出现。点击"开始预载"执行 `npx -y @deepseek-ai/dsh --version` 提前下载 dsh（输出实时显示在安装日志窗口），加快第一次启动；也可直接下一步跳过
5. 安装 → 完成（MUI 标准页）

**端口写入时机**：安装阶段（`customInstall` 宏）把用户选择的端口写入
`<安装目录>\Config\config.json`，内容形如：

```json
{"host": "127.0.0.1", "port": 3080}
```

如果用户后续在安装目录页改了安装位置，配置依然写进最终目录（写入发生在安装阶段，用最终 `$INSTDIR`）。

## 配置文件的两种位置

| 模式 | 配置位置 | 说明 |
|---|---|---|
| 开发（`npm start`） | 项目根目录 `Config/config.json` | 手改或"系统设置"窗口修改 |
| 打包（安装版） | `<安装目录>\Config\config.json` | 安装器端口页写入；"系统设置"窗口同样读写这里 |

> 注意：若用户把安装目录选到需要管理员权限的位置（如 `C:\Program Files`），
> 后续写配置可能失败，此时应用回退默认值（127.0.0.1:3080）并在日志告警。
> 默认的按用户安装路径（`%LOCALAPPDATA%\Programs\DSH-GUI`）没有此问题。

## 常见问题

- **构建时报 `spawn EPERM`**：构建链需要完整权限（沙箱/受限环境会拦截子进程管道）。在正常终端运行 `npm run dist` 即可
- **安装后双击无反应**：大概率缺 Node.js——安装时勾选环境检查可提前发现；已装的情况下看 `%APPDATA%\DSH-GUI\logs\backend.log`
- **端口绑定失败（EACCES）**：该端口被系统保留（如 Hyper-V/WSL 保留段）。弹窗里点"重启（端口设为 0）"自动改用随机端口，或改 `安装目录\Config\config.json`
- **改完配置不生效**：配置是启动时读取的，改完用托盘"重启后端"或重启应用
- **`Config/config.json` 在 git 里显示被修改**：开发模式下 dsh 端口回退/自愈会改写它，属预期；提交时 `git restore` 即可
