#!/usr/bin/env bash
# DSH-GUI 开发模式的后端启动脚本（Linux/macOS）
# Windows 开发模式对应 Code/start-dsh.cmd
set -e

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] No Node.js! Please install Node.js first." >&2
  exit 1
fi

exec npx -y @deepseek-ai/dsh web "$@"
