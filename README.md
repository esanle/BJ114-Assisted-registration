# 辅助挂号软件（fork · Web UI 版）

> 基于上游 v1.2.0 源码的社区 fork：**保留并复用原 C++ 后端，把 Qt 单页界面重构为 Electron + React 桌面应用**，并适配 macOS / Windows 双平台预编译包。原 Qt 程序源码保留作参照与回退，但发行包只包含 Electron 前端。
>
> - Fork：https://github.com/esanle/BJ114-Assisted-registration
> - 上游：https://github.com/ggg1123581321345589/BJ114-Assisted-registration

---

## 免责声明

本软件为**非官方辅助工具**，仅供本人查询号源，并在人工确认后提交一次预约。不保证号源可用或挂号成功；预约与支付结果以官方平台为准。

- 请遵守医院及官方平台规则，核对就诊人、就诊卡、日期、费用及取退号要求。
- 验证码须由本人输入；提交结果未知时先核对官方订单，**勿重复提交**。
- 请妥善保护个人信息，**不得用于倒号、代抢或其他违规用途**。

详细边界见 [免责协议](docs/免责协议.md)。本声明用于说明用途与风险，不代表免除依法应承担的责任。

---

## 下载（预编译包）

GitHub Releases 提供开箱即用的桌面应用包（**仅 Electron 前端，不含 Qt GUI**），内置 Node、Qt 运行库与医院目录数据：

| 平台 | 文件名 | 构建方式 |
| --- | --- | --- |
| macOS（Apple Silicon, arm64） | `AssistedRegistration-v1.2.0-macos-arm64.zip` | 本地打包 + 签名 |
| Windows（x64） | `AssistedRegistration-v1.2.0-windows-x64.zip` | GitHub Actions（`windows-latest`） |

**Release 地址**：https://github.com/esanle/BJ114-Assisted-registration/releases/tag/v1.2.0-macos-ui

使用方式：解压后将应用拖入「应用程序」（macOS）或解压运行 exe（Windows）。首次启动会尝试恢复本机已保存的官方会话（见[会话与隐私](#会话与隐私)）。

> 预编译包未做开发者签名/公证。macOS 若被拦截，右键 → 打开；Windows 若出现 SmartScreen 提示，选择「更多信息 → 仍要运行」。

---

## 功能

### 号源查询
- 按名称 / 地区 / 编码检索 308 家医院，加载本地公开科室目录。
- 多选日期并行查询，结果按所选日期顺序汇总；可随时停止。
- 查询连接可配置（1–16，默认 7），界面展示运行线程、就绪与准备中数量。
- 结果表支持**多列条件筛选**：每列独立设置文本或正则（如医生名列 `张医生|李医生` + 开启正则），各列之间取 AND；支持排序与状态筛选。
- 自动刷新：成功后按「间隔 + 随机抖动」（默认 60 秒 + 0–15 秒）排定下一次，打散固定节奏以降低限流概率；失败、停止或切换条件会取消定时任务，不重发失败请求。

### 有号提醒
- 勾选后，仅当查到**真正可挂号且剩余号源 > 0** 的号源时提醒（无号日历行、候补行、剩余为空的行均不触发）。
- 触发系统通知并弹出提醒对话框，闹钟声持续响直到点击「知道了，停止提醒」。

### 登录与挂号
- 本人输入图形码 + 短信码登录；首次登录后自动加载就诊人 / 就诊卡。
- 官方候补：候补状态号源提供「官方候补」入口，跳转官方页面由本人办理，程序不代为提交。
- 手动挂号并发可配置（1–16，默认 16）：每次点击创建独立任务，提交前保留官方核验，单任务最多一次提交，失败或结果未知不自动重发。
- **无定时提交**：不自动发短信、不自动输入验证码、不自动支付。

### 会话兼容
Web UI 与原 Qt 程序共用同一套会话存储：macOS 用登录 Keychain 保管 AES-256 密钥，Windows 用 CurrentUser DPAPI。组织/应用名保持一致，因此**新前端能读取老程序保存的会话**并经官方校验恢复。

---

## 安全边界与限制

- **会话数据**：仅官方会话 Cookie 经加密落盘（macOS Keychain / Windows DPAPI），不写入手机号、验证码、就诊人或就诊卡。`session.dpapi` 属于个人会话材料，即使加密也不得加入版本控制或分发包。
- **前端边界**：React 只持有脱敏视图，原始 cookie 不进前端；UI 偏好（配置、筛选、选择）持久化在浏览器 localStorage，登录会话本身不落入 localStorage。
- **结果可信度**：科室日历行不等于医生号源；刷新失败保留的旧行不可用于挂号；剩余号源为空不表示 0。切换医院/科室会清除不再适用的结果。
- **并发边界**：防重复限于单任务最多一次提交、失效预览不可复用、忽略迟到结果；程序**没有**跨手动点击的全局去重，再次点击可能产生另一笔预约请求。
- **连接状态**：“就绪”是本地会话的预算/时效检查，不是实时 TCP 探活。DNS 使用应用内共享解析与缓存，不修改系统 DNS，TLS 校验原始主机名。
- **验证范围**：离线测试只验证本地逻辑与合成输入，不能证明站点当前可用；未使用真实账号做端到端挂号验证。

---

## 架构

```
React (ui/src/)               桌面 UI：登录 / 目录 / 查询 / 挂号 / 设置
   │ window.api.call (IPC via preload)
Electron 主进程 (ui/electron/) 启动并管理本地后端进程，转发 RPC
   │ stdin/stdout JSONL
C++ 后端 (src/rpc_service.cpp)  长驻 BookingService（登录状态机）+ Service（查询会话）
   │ JSONL IPC
Node 运行时 (runtime/*.cjs)    jsdom 执行站点 JS 反爬脚本，网络 I/O 由 C++/libcurl 接管
   │
系统安全存储                    macOS Keychain / Windows DPAPI（会话密钥）
```

核心 C++ 后端（`src/`）保持不变：查询服务、预约服务、原生桥接、DNS/连接池调度。Web UI 只是替换了展示层。

---

## 移动端（进行中）

- `ui/src/styles.css` 已做响应式适配：窄屏下侧边栏变底部 Tab、字段堆叠、表格横滚、日历与弹窗自适应。同一套 React UI 可在手机浏览器或 WebView 中复用。
- `mobile-android/` 是 Android 原生客户端骨架（WebView + Kotlin 后端抽象层），**尚未达到可用版本**。最大障碍是原反爬沙箱依赖 jsdom 与 V8 私有 intrinsic，Android（Rhino）无法逐字复刻，真实站点 challenge 很可能无法通过。详见 [mobile-android/README.md](mobile-android/README.md)。

---

## 源码目录

| 路径 | 内容 |
| --- | --- |
| `src/` | C++ 后端：查询/预约服务、原生桥接、会话存储、JSON-RPC 服务（`rpc_service.cpp`） |
| `runtime/` | Node JSONL 运行时、公开请求头、兼容模块 |
| `data/` | 公开医院 CSV 与科室目录快照 |
| `ui/electron/` | Electron 主进程与 preload |
| `ui/src/` | React 页面与组件（含响应式适配） |
| `mobile-android/` | Android 原生客户端骨架（进行中） |
| `vendor/jsdom/` | jsdom 31.0.0 源码及 MIT 许可 |
| `tests/` | 31 个 C++ 离线回归测试（含 16 组并行调度变体） |
| `.github/workflows/` | Windows 包自动化构建 |
| `AssistedRegistration.pro` / `CMakeLists.txt` | 构建配置 |

---

## 从源码构建

### 环境要求
- C++17 编译器；Qt 5.15（Core / Gui / Widgets / Network）；libcurl。
- Node.js（^24.15 或 >=26，需通过启动时的 V8 能力检查）；npm。
- macOS 需 Homebrew 的 `qt@5`；Windows 需 MSVC x64 + Qt MSVC 版 + vcpkg curl。

### 后端与测试（macOS 示例）
```bash
brew install qt@5
npm ci
cmake -S . -B build-macos \
  -DCMAKE_PREFIX_PATH="$(brew --prefix qt@5)" \
  -DCMAKE_BUILD_TYPE=Release
cmake --build build-macos --parallel 4
ctest --test-dir build-macos --output-on-failure
```

### Web UI
```bash
cd ui && npm ci && npm run build
# 若 Electron 二进制未下载：
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
cd ..
./ui/node_modules/.bin/electron ./ui            # 真实会话 / 官方接口
./ui/node_modules/.bin/electron ./ui --fixture  # 合成数据演示，无需账号
```

### 关于 `--fixture`
`--fixture` 用合成数据走通完整流程（图形码 → 短信 → 登录 → 科室 → 排班 → 预览 → 提交），用于界面演示与验证；不访问官方站点，也不保存真实会话。

Windows 包的完整构建流程见 `.github/workflows/build-windows.yml`。

---

## 开发与提交

修改后先构建、跑离线测试、做源码审计，再检查待提交差异：

```bash
cmake --build build-macos --parallel 4
ctest --test-dir build-macos --output-on-failure
python3 scripts/check-source-release.py
git diff --check
git add PATH_TO_CHANGED_FILE
git diff --cached --check && git diff --cached --stat
git commit -m "Describe the change"
```

源码文件变化需同步更新 `SOURCE_MANIFEST.json` 并重跑审计。提交前确认没有加入个人资料、会话、抓包或构建产物。

---

## 许可

本项目沿用上游 MIT 许可，见 [LICENSE](LICENSE)；第三方依赖见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。MIT 许可不授予医院名称、数据、商标或官方平台的额外权利，也不构成平台使用授权。
