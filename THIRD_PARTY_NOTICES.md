# Third-Party Notices

DSH-GUI 本体以 [MIT License](LICENSE) 发布。本项目使用了以下第三方组件，各自保留其许可与版权：

## 随应用分发（打包产物内）

| 组件 | 许可 | 说明 |
|---|---|---|
| Electron | MIT | 桌面运行时；其自带 `LICENSE.electron.txt` 随包分发 |
| Chromium | BSD-3-Clause 等 | Electron 内嵌浏览器引擎；`LICENSES.chromium.html` 随包分发 |

## 随安装器分发（构建工具链产物，仅 Windows 安装包）

| 组件 | 许可 | 说明 |
|---|---|---|
| NSIS | zlib/libpng | 安装器引擎（electron-builder 构建时注入） |
| 7-Zip（7za） | LGPL（含 unRAR 限制） | 安装包压缩/解压工具 |

## 运行时获取（不随包分发）

| 组件 | 许可 | 说明 |
|---|---|---|
| @deepseek-ai/dsh | MIT | 后端在用户机器上通过 `npx` 按需获取，本项目不分发其代码 |
| pnpm | MIT | 仅插件管理器调用；由用户环境提供 |

## 商标声明

- "DeepSeek" 及鲸鱼图形 Logo 为 DeepSeek 的商标。本项目中的 `App/Assets/dsh.svg` / `dsh.ico`
  取自 MIT 许可的 `@deepseek-ai/dsh-web-app` 包，仅作为应用图标/启动画面使用，
  **不代表与 DeepSeek 官方存在关联或背书**。
- 其余名称与商标归各自权利人所有。
