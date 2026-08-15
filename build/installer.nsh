; =====================================================================
; DSH-GUI 安装器扩展（electron-builder nsis.include）
; 自定义页插入点：customPageAfterChangeDir（选择安装目录之后、开始安装之前）
; 向导顺序：MUI 欢迎 → 安装目录 → 端口设置 → 环境检查(可选) → 预载 dsh(可选) → 安装 → 完成
; =====================================================================

!include "MUI2.nsh"     ; 早于模板引入（MUI2.nsh 有 !ifndef MUI_INCLUDED 保护，模板里的重复 include 是 no-op），
                        ; 这样自定义页可以直接使用 MUI_HEADER_TEXT 标准页头
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; 自定义页只属于安装器：卸载器构建（BUILD_UNINSTALLER）不会插入 customPageAfterChangeDir，
; 不守卫的话页面函数会成为未引用代码，NSIS 6010 警告会被 electron-builder 当作错误
!ifndef BUILD_UNINSTALLER

Var DSH_PORT_INPUT        ; 端口输入框
Var DSH_CHECK_ENV         ; 环境检查勾选框
Var DSH_PORT_VALUE        ; 用户最终选择的端口
Var DSH_CHECK_ENV_FLAG    ; 勾选状态固化值（页面销毁后不能再读控件）
Var DSH_ENV_STATUS        ; 环境检查结果：ok / fail
Var DSH_ENV_MISSING       ; 缺失项列表
Var DSH_ENV_RESULT_TEXT   ; 检查过程与结果文本
Var DSH_ENV_LABEL         ; 结果展示标签
Var DSH_TIMER_STEP        ; 定时器步骤
Var DSH_ENV_NODE_OK       ; node+npm 是否可用（1/0）
Var DSH_ENV_PNPM_OK       ; pnpm 是否可用（1/0）
Var DSH_ENV_ACTION_MODE   ; 0 = 引导去官网下载 Node.js；1 = 自动安装 pnpm
Var DSH_ACTION_BTN        ; 处理按钮（官网 / 自动装 pnpm）
Var DSH_SKIP_BTN          ; 跳过按钮
Var DSH_PRELOAD_LABEL     ; 预载状态标签
Var DSH_PRELOAD_BTN       ; 开始预载按钮

; ---- 在“选择安装目录”之后插入自定义页 ----
!macro customPageAfterChangeDir
  Page custom DshPortPageCreate DshPortPageLeave
  Page custom DshEnvPageCreate
  Page custom DshPreloadPageCreate
!macroend

; =====================================================================
; 页 1：端口设置
; =====================================================================
Function DshPortPageCreate
  !insertmacro MUI_HEADER_TEXT "端口设置" "设置 DeepSeek Harness 后端的监听端口"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 12u "监听端口"
  Pop $0
  ${NSD_CreateText} 0 14u 80u 13u "3080"
  Pop $DSH_PORT_INPUT
  ${NSD_CreateLabel} 88u 16u 100% 10u "0 = 系统随机分配；范围 0 - 65535"
  Pop $0

  ${NSD_CreateCheckbox} 0 38u 100% 12u "安装前检查环境（Node.js / npm / pnpm）"
  Pop $DSH_CHECK_ENV
  ${NSD_Check} $DSH_CHECK_ENV

  ${NSD_CreateLabel} 0 56u 100% 26u "跳过检查时，若机器缺少 Node.js/npm/pnpm，应用可能无法正常运行。$\n端口写入安装目录 Config\config.json，安装后也可在应用内“系统设置”中修改。"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function DshPortPageLeave
  ; 固化勾选状态（离开本页后控件即将销毁，下一步页面创建时不能再读）
  ${NSD_GetState} $DSH_CHECK_ENV $R0
  StrCpy $DSH_CHECK_ENV_FLAG $R0

  ${NSD_GetText} $DSH_PORT_INPUT $R0
  ${If} $R0 == ""
    MessageBox MB_ICONEXCLAMATION "端口不能为空，请输入 0 - 65535 之间的整数。"
    Abort
  ${EndIf}
  IntOp $R1 $R0 + 0
  StrCmp "$R0" "$R1" port_numeric port_not_numeric
  port_not_numeric:
    MessageBox MB_ICONEXCLAMATION "端口必须是 0 - 65535 之间的整数。"
    Abort
  port_numeric:
  IntCmp $R1 65535 port_range_ok port_range_ok port_range_bad
  port_range_bad:
    MessageBox MB_ICONEXCLAMATION "端口必须是 0 - 65535 之间的整数。"
    Abort
  port_range_ok:
  StrCpy $DSH_PORT_VALUE $R0
FunctionEnd

; =====================================================================
; 页 2：环境检查（未勾选时跳过）
; 简化流程：
;   - 缺 node/npm → 只有“前往官网下载 Node.js“按钮，提示安装后关闭并重开安装程序
;   - 仅缺 pnpm → “自动安装 pnpm“按钮（装完自动复检）
;   - “跳过“按钮 → 弹风险提示，确认后可继续下一步
;   - 无“重新检查“/“退出安装“按钮（向导自带取消）
; =====================================================================
Function DshEnvPageCreate
  ${If} $DSH_CHECK_ENV_FLAG != "1"
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "环境检查" "正在检查 Node.js / npm / pnpm"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 64u "准备开始检查..."
  Pop $DSH_ENV_LABEL

  ${NSD_CreateButton} 0 70u 120u 14u ""
  Pop $DSH_ACTION_BTN
  ${NSD_OnClick} $DSH_ACTION_BTN DshEnvAction
  ${NSD_CreateButton} 128u 70u 70u 14u "跳过"
  Pop $DSH_SKIP_BTN
  ${NSD_OnClick} $DSH_SKIP_BTN DshEnvSkip

  EnableWindow $DSH_ACTION_BTN 0
  EnableWindow $DSH_SKIP_BTN 0

  StrCpy $DSH_TIMER_STEP 0
  StrCpy $DSH_ENV_RESULT_TEXT ""
  StrCpy $DSH_ENV_MISSING ""
  StrCpy $DSH_ENV_STATUS ""
  StrCpy $DSH_ENV_NODE_OK 1
  StrCpy $DSH_ENV_PNPM_OK 1
  ${NSD_CreateTimer} DshEnvCheckTick 500

  nsDialogs::Show
FunctionEnd

Function DshEnvSkip
  MessageBox MB_ICONEXCLAMATION|MB_OK "已跳过环境检查。$\r$\n$\r$\n请自行确认机器上已安装 Node.js / npm / pnpm，$\r$\n否则应用可能无法启动或部分功能不可用。"
FunctionEnd

; 内部复检（自动安装 pnpm 成功后调用）
Function DshEnvResetAndRun
  ${NSD_KillTimer} DshEnvCheckTick
  StrCpy $DSH_TIMER_STEP 0
  StrCpy $DSH_ENV_RESULT_TEXT ""
  StrCpy $DSH_ENV_MISSING ""
  StrCpy $DSH_ENV_STATUS ""
  StrCpy $DSH_ENV_NODE_OK 1
  StrCpy $DSH_ENV_PNPM_OK 1
  ${NSD_SetText} $DSH_ENV_LABEL "重新检查中..."
  EnableWindow $DSH_ACTION_BTN 0
  EnableWindow $DSH_SKIP_BTN 0
  ${NSD_CreateTimer} DshEnvCheckTick 500
FunctionEnd

Function DshEnvAction
  ${If} $DSH_ENV_ACTION_MODE == 1
    ; 自动安装 pnpm
    EnableWindow $DSH_ACTION_BTN 0
    ${NSD_SetText} $DSH_ENV_LABEL "$DSH_ENV_RESULT_TEXT$\r$\n正在执行：npm install -g pnpm ...（约 10-60 秒）"
    nsExec::ExecToStack 'cmd /c "npm install -g pnpm"'
    Pop $R1
    ${If} $R1 == 0
      StrCpy $DSH_ENV_RESULT_TEXT "$DSH_ENV_RESULT_TEXT$\r$\n[完成] pnpm 已安装，正在重新检查..."
      Call DshEnvResetAndRun
    ${Else}
      StrCpy $DSH_ENV_RESULT_TEXT "$DSH_ENV_RESULT_TEXT$\r$\n[失败] 自动安装 pnpm 失败，请手动安装（npm install -g pnpm）或跳过。"
      ${NSD_SetText} $DSH_ENV_LABEL "$DSH_ENV_RESULT_TEXT"
      EnableWindow $DSH_ACTION_BTN 1
    ${EndIf}
  ${Else}
    ; 引导去 Node.js 官网
    ExecShell "open" "https://nodejs.org/zh-cn"
    ${NSD_SetText} $DSH_ENV_LABEL "$DSH_ENV_RESULT_TEXT$\r$\n已打开 Node.js 官网。$\r$\n安装完成后，请关闭并重新打开本安装程序，再继续安装。"
  ${EndIf}
FunctionEnd

Function DshEnvCheckTick
  ${If} $DSH_TIMER_STEP == 0
    ${NSD_SetText} $DSH_ENV_LABEL "$DSH_ENV_RESULT_TEXT$\r$\n正在执行：node --version ..."
    nsExec::ExecToStack 'cmd /c "node --version"'
    Pop $R1
    Pop $R2
    ${If} $R1 == 0
      StrCpy $DSH_ENV_RESULT_TEXT "$DSH_ENV_RESULT_TEXT[通过] node --version -> $R2$\r$\n"
    ${Else}
      StrCpy $DSH_ENV_NODE_OK 0
      StrCpy $DSH_ENV_MISSING "$DSH_ENV_MISSING Node.js"
      StrCpy $DSH_ENV_RESULT_TEXT "$DSH_ENV_RESULT_TEXT[缺失] Node.js 未安装（应用后端依赖它）$\r$\n"
    ${EndIf}
    StrCpy $DSH_TIMER_STEP 1
    ${NSD_SetText} $DSH_ENV_LABEL "$DSH_ENV_RESULT_TEXT"
    Return
  ${EndIf}

  ${If} $DSH_TIMER_STEP == 1
    ${NSD_SetText} $DSH_ENV_LABEL "$DSH_ENV_RESULT_TEXT$\r$\n正在执行：npm --version ..."
    nsExec::ExecToStack 'cmd /c "npm --version"'
    Pop $R1
    Pop $R2
    ${If} $R1 == 0
      StrCpy $DSH_ENV_RESULT_TEXT "$DSH_ENV_RESULT_TEXT[通过] npm --version -> $R2$\r$\n"
    ${Else}
      StrCpy $DSH_ENV_NODE_OK 0
      StrCpy $DSH_ENV_MISSING "$DSH_ENV_MISSING npm"
      StrCpy $DSH_ENV_RESULT_TEXT "$DSH_ENV_RESULT_TEXT[缺失] npm 未安装$\r$\n"
    ${EndIf}
    StrCpy $DSH_TIMER_STEP 2
    ${NSD_SetText} $DSH_ENV_LABEL "$DSH_ENV_RESULT_TEXT"
    Return
  ${EndIf}

  ${If} $DSH_TIMER_STEP == 2
    ${NSD_SetText} $DSH_ENV_LABEL "$DSH_ENV_RESULT_TEXT$\r$\n正在执行：pnpm --version ..."
    nsExec::ExecToStack 'cmd /c "pnpm --version"'
    Pop $R1
    Pop $R2
    ${If} $R1 == 0
      StrCpy $DSH_ENV_RESULT_TEXT "$DSH_ENV_RESULT_TEXT[通过] pnpm --version -> $R2（插件管理器需要）$\r$\n"
    ${Else}
      StrCpy $DSH_ENV_PNPM_OK 0
      StrCpy $DSH_ENV_MISSING "$DSH_ENV_MISSING pnpm"
      StrCpy $DSH_ENV_RESULT_TEXT "$DSH_ENV_RESULT_TEXT[缺失] pnpm 未安装（插件管理功能不可用）$\r$\n"
    ${EndIf}
    StrCpy $DSH_TIMER_STEP 3
    ${NSD_SetText} $DSH_ENV_LABEL "$DSH_ENV_RESULT_TEXT"
    Return
  ${EndIf}

  ; 收尾：汇总并决定按钮状态
  ${If} $DSH_TIMER_STEP == 3
    ${NSD_KillTimer} DshEnvCheckTick
    ${If} $DSH_ENV_MISSING == ""
      StrCpy $DSH_ENV_STATUS "ok"
      StrCpy $DSH_ENV_RESULT_TEXT "$DSH_ENV_RESULT_TEXT$\r$\n环境检查全部通过。"
    ${Else}
      StrCpy $DSH_ENV_STATUS "fail"
      ${If} $DSH_ENV_NODE_OK == 0
        ; Node/npm 缺失：只有官网按钮（npm 随 node 一起装）
        StrCpy $DSH_ENV_ACTION_MODE 0
        ${NSD_SetText} $DSH_ACTION_BTN "前往官网下载 Node.js"
        StrCpy $DSH_ENV_RESULT_TEXT "$DSH_ENV_RESULT_TEXT$\r$\n存在缺失项：$DSH_ENV_MISSING$\r$\n请安装 Node.js（含 npm）后，关闭并重新打开本安装程序。"
      ${Else}
        ; 仅 pnpm 缺失且 npm 可用：自动安装
        StrCpy $DSH_ENV_ACTION_MODE 1
        ${NSD_SetText} $DSH_ACTION_BTN "自动安装 pnpm"
        StrCpy $DSH_ENV_RESULT_TEXT "$DSH_ENV_RESULT_TEXT$\r$\n存在缺失项：$DSH_ENV_MISSING"
      ${EndIf}
      EnableWindow $DSH_ACTION_BTN 1
      EnableWindow $DSH_SKIP_BTN 1
    ${EndIf}
    ${NSD_SetText} $DSH_ENV_LABEL "$DSH_ENV_RESULT_TEXT"
  ${EndIf}
FunctionEnd

; =====================================================================
; 页 3：预载 dsh（仅当勾选了环境检查且检查全部通过时出现）
; 采用独立控制台窗口执行下载：非阻塞、有实时进度输出，避免页面“卡死无内容“
; =====================================================================
Function DshPreloadPageCreate
  ${If} $DSH_CHECK_ENV_FLAG != "1"
    Abort
  ${EndIf}
  ${If} $DSH_ENV_STATUS != "ok"
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "预载 DeepSeek Harness" "提前下载 dsh，加快第一次启动"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 30u "首次启动时，应用需要联网下载 DeepSeek Harness（npx）。$\n现在预载可避免第一次启动时的长时间等待；也可以直接点击下一步跳过。"
  Pop $0

  ${NSD_CreateButton} 0 38u 90u 14u "开始预载"
  Pop $DSH_PRELOAD_BTN
  ${NSD_OnClick} $DSH_PRELOAD_BTN DshPreloadStart

  ${NSD_CreateLabel} 0 60u 100% 40u "尚未预载。"
  Pop $DSH_PRELOAD_LABEL

  nsDialogs::Show
FunctionEnd

Function DshPreloadStart
  EnableWindow $DSH_PRELOAD_BTN 0
  ${NSD_SetText} $DSH_PRELOAD_LABEL "已在独立窗口开始预载。$\r$\n请留意标题为“DSH 预载”的控制台窗口，等待它显示“预载完成”后关闭，再点击下一步。"
  ; 用 start 打开独立控制台窗口：下载进度实时可见，且不阻塞安装向导
  nsExec::Exec 'cmd /c start "DSH 预载" cmd /k "echo 正在预载 DeepSeek Harness，请勿关闭本窗口... & npx -y @deepseek-ai/dsh --version & echo. & echo 预载完成，可以关闭本窗口。 & pause"'
  Pop $0
FunctionEnd

!endif ; BUILD_UNINSTALLER

; =====================================================================
; 安装阶段：把用户选择的端口写入安装目录 Config\config.json
; =====================================================================
!macro customInstall
  CreateDirectory "$INSTDIR\Config"
  FileOpen $4 "$INSTDIR\Config\config.json" w
  ${If} $4 != ""
    FileWrite $4 '{"host": "127.0.0.1", "port": $DSH_PORT_VALUE}'
    FileClose $4
  ${EndIf}
!macroend
