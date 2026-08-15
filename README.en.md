<div align="center">

# DSH-GUI

---

![Static Badge](https://img.shields.io/badge/Desktop-green) ![Static Badge](https://img.shields.io/badge/License-MIT-blue) ![Static Badge](https://img.shields.io/badge/Platform-Windows-yellow)

English | **[中文](README.md)**

</div>

---

A lightweight desktop shell for DeepSeek Harness: wraps the [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) web UI in a native Electron window, with built-in backend hosting, a system tray, and a simple plugin manager.

Installer user guide — **[Docs/install.md](Docs/install.md)** (Chinese)

## Why This Project

A learning project built for "working the way I like": wrapping the DeepSeek Harness web UI in a native Electron window, and polishing the rough edges I hit in daily use one by one. Technically there is nothing fancy here — just a thin shell; most of its value comes from the DSH ecosystem itself and from lessons learned the hard way.

A few small touches I find handy (not bold enough to call advantages):

- **Plugin manager**: install from npm / local directory (link or copy) / Git repository, enable/disable/uninstall, automatic pnpm build-script approval
- **Installer**: Windows ships an NSIS wizard (port setup → optional environment check → optional dsh preload); Linux ships AppImage / deb, ready out of the box
- **Port self-healing**: random port support; when a port is occupied or system-reserved, one click switches to a random port and restarts; the main window follows automatically
- **Readable errors**: backend-failure dialogs show the key output directly, no log digging
- **Daily details**: close-to-tray, window-position memory, shortcuts, external links via system browser, log-to-file

For a more complete, cross-platform experience, these more mature projects are worth checking out (they do it better than I do):

- [anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) — Electron, deep macOS & Windows adaptation
- [xiincs/deepseek-harness-desktop](https://github.com/xiincs/deepseek-harness-desktop) — Tauri 2 with a bundled Node runtime, auto-update
- [ningbainb/deepseek-harness-desktop](https://github.com/ningbainb/deepseek-harness-desktop) — plugins, skins and skill dock

Special thanks to the DeepSeek team and the DeepSeek Harness ecosystem.

## Features

- **Backend hosting**: launches `dsh web` the official way (`npx @deepseek-ai/dsh web`) and waits until ready; supports a fixed port and a random port (0); when a port is reserved or occupied, a dialog explains the error and offers a one-click switch to a random port and restart
- **System tray**: closing the window minimizes to tray; menu includes Show Main Window / Plugin Manager / Settings / Restart Backend / Open Logs / Launch at Login / Quit; single-instance lock, re-launching focuses the existing window
- **Window experience**: remembers window position, size, and zoom; shortcuts Ctrl+R reload, Ctrl+Shift+R hard reload, F11 fullscreen, F12 DevTools, Ctrl+=/-/0 zoom; external links always open in the system browser
- **Simple external plugin manager**: standalone window; installs plugins from npm packages / local directories (link or copy install) / Git repositories; enable/disable/uninstall; automatically handles pnpm build-script approval — no need to dig through the official settings UI
- **Settings**: edit backend host/port visually; saving restarts the backend and refreshes the main window automatically
- **Installer**: Windows ships an NSIS wizard installer (port setup → optional environment check → optional dsh preload); Linux ships AppImage / deb, ready to use out of the box

## Requirements

| Scenario | Requirements |
|---|---|
| Run from source / build | Windows or Linux, Node.js ≥ 22.19 (24+ recommended), npm |
| Installed app | Node.js + npm (backend is launched via `npx`); **pnpm** only for installing/uninstalling plugins in the plugin manager |

## Quick Start (from source)

```bash
npm install
npm start
```

On first launch, `@deepseek-ai/dsh` is fetched via `npx` (requires network, about 1–3 minutes), then the main window opens the DSH web UI.

Development-mode config lives in `Config/config.json` (host / port; editable via the tray "Settings" window):

```json
{
  "host": "127.0.0.1",
  "port": 3080
}
```

## Building the Installer

| Platform | Command | Artifacts |
|---|---|---|
| Windows | `npm run dist` | `dist/DSH-GUI-Setup-<version>.exe` (NSIS wizard installer) |
| Linux | `npm run dist -- --linux` | `dist/*.AppImage` / `dist/*.deb` (requires Linux or Docker) |

For debugging: `npm run pack` produces only the unpacked directory. See [Docs/build.md](Docs/build.md) (Chinese) for details.

## Project Layout

```text
App/
  Main/           Main process: windows/tray/backend hosting (index.js), plugin management (plugin-manager.js), settings (settings.js)
  Pages/          Splash, plugin manager (html/css/js trio), settings
  Preload/        Per-window contextBridge scripts (privilege-isolated from the remote DSH page)
  Assets/         Icons and logo
Code/             Backend launcher script for development (start-dsh.cmd / start-dsh.sh)
Config/           Development-mode config (config.json)
build/            NSIS installer script and assets
Docs/             Documentation (packaging, install & usage)
dist/             Build output (generated by npm run dist, gitignored)
```

## Documentation

- **[Docs/install.md](Docs/install.md)** (Chinese) — installer user guide: installation steps, wizard walkthrough, config & plugins, FAQ
- **[Docs/build.md](Docs/build.md)** (Chinese) — packaging guide: artifacts, build steps, installer behavior, packaged-vs-development differences

## License

[MIT](LICENSE) © 2026 0Ra1n416

Third-party component notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
