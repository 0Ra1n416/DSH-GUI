<div align="center">

# DSH-GUI

![Static Badge](https://img.shields.io/badge/Desktop-green) ![Static Badge](https://img.shields.io/badge/License-MIT-blue) ![Static Badge](https://img.shields.io/badge/Platform-Windows-yellow)

**[English](README.en.md)** | 中文

</div>

---

DeepSeek Harness 的简易桌面壳：用 Electron 把 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) 的 Web 界面装进原生窗口，自带后端托管、系统托盘、简易插件管理器。

安装包用户指南——**[Docs/install.md](Docs/install.md)**

## 项目初衷

这是一个为"自己用着顺手"而写的学习项目：用 Electron 把 DeepSeek Harness 的 Web 界面装进原生窗口，顺便解决一些自己使用过程中遇到的一些小问题。技术上没有高深之处——薄壳而已；它的大部分价值来自 DSH 生态本身，以及踩坑经验的沉淀。

几个小特色：

- **简易插件管理器**：npm / 本地目录（链接或复制）/ Git 仓库三种安装来源，启停与卸载，自动处理 pnpm 构建脚本审批
- **安装包**：NSIS 向导（端口设置 → 可选环境检查 → 可选预载 dsh），开箱即用
- **端口自愈**：随机端口、端口被占用/系统保留时一键改随机端口重启，后端重启后主窗口自动跟随
- **错误可读**：后端异常弹窗直接展示关键输出，不必翻日志
- **日常细节**：关闭到托盘、窗口位置记忆、快捷键、外链交系统浏览器、日志落盘

如果你追求更完整、更多平台的体验，推荐看看这些更成熟的项目：

- [anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) —— Electron，深度适配 macOS 与 Windows
- [xiincs/deepseek-harness-desktop](https://github.com/xiincs/deepseek-harness-desktop) —— Tauri 2 + 内置 Node 运行时，自动更新
- [ningbainb/deepseek-harness-desktop](https://github.com/ningbainb/deepseek-harness-desktop) —— 插件、皮肤与技能坞

特别感谢 DeepSeek 团队与 DeepSeek Harness 生态。

## 特性

- **后端托管**：按照官方启动方式`npx @deepseek-ai/dsh web`自动拉起 `dsh web` 并等待就绪；支持固定端口、随机端口（0）；端口被系统保留/占用时弹窗提示并支持一键改随机端口重启
- **系统托盘**：关闭窗口最小化到托盘；菜单含 显示主窗口 / 插件管理 / 系统设置 / 重启后端 / 打开日志 / 开机自启 / 退出；单实例锁，重复启动自动唤起已有窗口
- **窗口体验**：记住窗口位置、大小与缩放；快捷键 Ctrl+R 刷新、Ctrl+Shift+R 强刷、F11 全屏、F12 开发者工具、Ctrl+=/-/0 缩放；外链一律交系统浏览器
- **简易外部插件管理器**：独立窗口，支持从 npm 包 / 本地目录（链接或复制安装）/ Git 仓库安装插件，启停/卸载，自动处理 pnpm 构建脚本审批。可以不用在官方的设置中翻了。
- **系统设置**：可视化修改后端 host/port，保存后自动重启并刷新主窗口
- **安装包**：Windows 提供 NSIS 向导式安装（端口设置 → 可选环境检查 → 可选预载 dsh）；Linux 提供 AppImage / deb，开箱即用

## 环境要求

| 场景 | 要求 |
|---|---|
| 从源码运行 / 打包 | Windows 或 Linux、Node.js ≥ 22.19（推荐 24+）、npm |
| 安装包运行 | Node.js + npm（后端经 `npx` 启动）；**pnpm** 仅插件管理器的安装/卸载需要 |

## 快速开始（源码运行）

```bash
npm install
npm start
```

首次启动会通过 `npx` 拉取 `@deepseek-ai/dsh`（需要联网，约 1-3 分钟），随后主窗口打开 DSH Web 界面。

开发模式配置在 `Config/config.json`（host / port，可通过托盘"系统设置"修改）：

```json
{
  "host": "127.0.0.1",
  "port": 3080
}
```

## 构建安装包

| 平台 | 命令 | 产物 |
|---|---|---|
| Windows | `npm run dist` | `dist/DSH-GUI-Setup-<版本>.exe`（NSIS 向导安装包） |
| Linux | `npm run dist -- --linux` | `dist/*.AppImage` / `dist/*.deb`（需 Linux 环境或 Docker） |

调试用：`npm run pack` 只出免安装目录。详见 [Docs/build.md](Docs/build.md)。

## 项目结构

```text
App/
  Main/           主进程：窗口/托盘/后端托管（index.js）、插件管理（plugin-manager.js）、系统设置（settings.js）
  Pages/          Splash、插件管理器（html/css/js 三件套）、系统设置
  Preload/        各窗口的 contextBridge 桥接（与远程 DSH 页面权限隔离）
  Assets/         图标与 Logo
Code/             开发模式的后端启动脚本（start-dsh.cmd / start-dsh.sh）
Config/           开发模式配置（config.json）
build/            NSIS 安装器脚本与素材
Docs/             文档（打包、安装使用）
dist/             构建产物（npm run dist 生成，已 gitignore）
```

## 文档

- **[Docs/install.md](Docs/install.md)** —— 安装包用户指南：安装步骤、向导说明、配置与插件、常见问题
- **[Docs/build.md](Docs/build.md)** —— 打包指南：产物约定、构建步骤、安装包行为、打包与开发的行为差异

## License

[MIT](LICENSE) © 2026 0Ra1n416

第三方组件声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
