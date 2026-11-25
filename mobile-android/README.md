# Android 原生客户端（进行中）

把桌面 Electron 应用移植到 Android 原生 App。当前是**骨架阶段**,尚未达到可用版本。

## 架构

```
WebView (assets/app = ui/dist 的响应式 React UI)
   │ window.nativeApi.call(op, params)  ← 对应 Electron preload 的 window.api.call
Kotlin Backend (Backend.kt)             ← 对应 src/rpc_service.cpp
   ├─ Transport.kt        OkHttp 替代 libcurl（带白名单/请求头约束）
   ├─ SessionStore.kt     Android Keystore 替代 DPAPI/Keychain
   └─ JsSandbox.kt        Rhino JS 引擎替代 Node + jsdom 反爬沙箱（见下）
data / runtime            与桌面共用公开数据与 Node 运行时脚本（待适配）
```

React 前端已做响应式适配（`ui/src/styles.css` 的媒体查询），窄屏下侧边栏变底部 Tab、字段堆叠、表格横滚、日历/弹窗自适应，因此同一套 UI 可在 WebView 中复用。

## 当前完成
- Gradle / AGP / Kotlin 配置，AndroidManifest，网络安全配置，主题。
- `MainActivity` + `WebBridge`：WebView 加载响应式 UI，JS bridge 映射 `window.api.call`。
- `Transport`：OkHttp 网络层，复刻桌面的操作白名单与敏感请求头拦截。
- `SessionStore`：Android Keystore + EncryptedSharedPreferences 保存会话 Cookie。
- `Backend`：操作分发表（与桌面相同 op 名），核心流程仍为 stub。
- `sync-assets.sh`：把 `ui/dist` 同步到 `assets/app`。

## 未完成 / 已知风险（重要）
1. **反爬沙箱**：桌面用 Node + jsdom 执行站点 JS，并有一批依赖 **V8 私有 intrinsic** 的 helper（如 `%GetUndetectable`、`document.all` 的 exotic ownKeys）。Android 用 Rhino（非 V8）无法逐字复刻这些 helper；`JsSandbox.unsupportedHelpers()` 列出了无法忠实移植的部分。这是完整移植的最大技术障碍，**真实站点的 challenge 很可能无法通过**。
2. **协议逻辑**：`Backend.kt` 中 `captcha/sms/login/availability/preview/direct` 等目前是 stub，需把 `native_service.cpp`/`booking_service.cpp` 的数千行逻辑逐项转到 Kotlin。
3. **Node 运行时**：`runtime/*.cjs` 依赖 `jsdom` / `whatwg-url` / `sm-crypto`，Android 上没有 Node，需移植到 Rhino/Java 等价物。
4. **会话互通**：Android Keystore 与桌面 DPAPI/Keychain 不互通，移动端需独立登录，不能恢复桌面已保存的会话。
5. **未构建验证**：本机没有 Android SDK/Gradle，Kotlin 仅做了语法级检查（无括号等语法错误），**尚未实际编译成 APK**。

## 构建（需 Android SDK）
```bash
cd ui && npm run build && cd ..
./mobile-android/sync-assets.sh
cd mobile-android
# 需安装 Android SDK 35 与 JDK 17+，然后用 Android Studio 或：
./gradlew assembleDebug
```

首次用 Gradle Wrapper 需生成 `gradle/wrapper/gradle-wrapper.jar`（用 `gradle wrapper` 命令），本仓库未提交该二进制。

## 结论
移动端适配的**界面层已经可用**；原生后端的**完整移植仍在进行**，尤其是反爬沙箱在 Android 上缺少 V8/jsdom 等价实现，是当前最大的未解问题。若只需手机查看/演示，可先用响应式 Web UI（浏览器打开）；如需真实查询，建议等待后端移植完成或采用桌面后端局域网方案。
