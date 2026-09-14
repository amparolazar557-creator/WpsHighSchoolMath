# G1 包内静态任务窗格门禁证据

日期：2026-07-18（Asia/Shanghai）  
结论：**通过，可以将正式载荷从回环助手切换为包内静态任务窗格。**

## 测试环境

- WPS Office：`12.1.0.26895`
- Writer 样本：`release/方案B-Writer回归副本.docx`
- Presentation 样本：`release/方案B-PPT回归副本.pptx`
- 隔离探针：`probes/wps-packaged-taskpane`
- 探针清单 SHA-256：`69433810CF9AE83F95102E310AD69866FEB2789A95D7D4A24DE7FAB5549A6DBB`

## Writer 结果

- 首次加载信任提示后，独立 Ribbon `Writer 包内页面探针` 正常出现。
- 点击“打开包内静态页面”后，任务窗格对象创建成功。
- 包内 `file://` 页面把本次随机 token 写入 `Application.PluginStorage`。
- Ribbon 从“等待”更新为“通过：包内页面已就绪，WPS API 可访问”。
- 再次点击后创建新 token，第二次 ready 握手仍通过；旧任务窗格按设计隐藏。

## Presentation 结果

- 首次加载信任提示后，独立 Ribbon `PPT 包内页面探针` 正常出现。
- 点击“打开包内静态页面”后，任务窗格对象创建成功。
- 包内 `file://` 页面完成随机 token、WPS API 和 PluginStorage ready 握手。
- Ribbon 更新为“通过：包内页面已就绪，WPS API 可访问”。

## 零回环与零外部助手证据

- 连续监控运行 ID：`a455fdbf-71e3-47f8-afda-cc22745153ae`
- 原始证据：`%APPDATA%/WpsHighSchoolMath/packaged-taskpane-probe/runs/a455fdbf-71e3-47f8-afda-cc22745153ae/monitor.json`
- 原始证据 SHA-256：`3F4BA4649C28BB228C4C2F94E0FAAD6CCC030C9EFFAE5DE2DAA887E905946F1E`
- 监控时间：`2026-07-17T20:58:43.2207655Z` 至 `2026-07-17T21:04:43.1994093Z`
- 样本数：`7200`；包含 WPS 进程的样本数：`6621`；最大 WPS 进程数：`11`
- 外部产品助手最大计数：`0`
- WPS 监听器最大计数：`0`
- WPS 回环连接最大计数：`0`
- 扫描错误：`0`

监控器在系统调度繁忙时出现 `8` 个超期样本，最长间隔 `806 ms`，因此其
`continuousSampling` 字段为 `false`；但 `coverageComplete=true`，所有实际采集样本中的助手、
监听器和回环连接计数均为零。该次证据用于 G1 架构可行性判定；正式 0.4.0 交付门禁仍须重新取得
`continuousSampling=true`、`droppedSamples=0` 的证据。

## 视觉证据说明

Windows 应用控制工具能捕获 WPS 主窗口和任务窗格框架，但两个宿主中的 WebView 正文合成层在
窗口截图里均呈白色。页面脚本在各宿主中独立完成随机 token 写入，且探针源代码明确要求
`document.location` 为 `file://`、`Application` 可访问、`PluginStorage.setItem` 可调用后才允许
Ribbon 显示“通过”。因此 G1 以可重复握手、源代码约束、进程和 TCP 监控作为判定依据；正式功能页
仍需在任务 7 做人工可见性和交互验收。

## G1 决策

G1 通过。下一步只允许实现包内静态页面；禁止回退到 localhost、动态端口、HTTP 服务、
`ShellExecute` 或 `WpsHighSchoolMathEditorHost.exe`。
