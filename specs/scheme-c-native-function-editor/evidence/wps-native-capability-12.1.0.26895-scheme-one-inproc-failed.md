# WPS 12.1.0.26895 方案一进程内原生桥接硬门禁失败证据

取证日期：2026-07-18  
结论：方案一任务 2 已完成实测但硬门禁失败。`validatedWpsBuilds` 必须保持为空，任务 4—18 停止，不能生成或发布 0.4.0 商业载荷。

## 1. 测试边界

- 宿主：WPS Writer x86，`12.1.0.26895`。
- 可执行文件：`D:\Program Files (x86)\WPS Office\WPS Office\12.1.0.26895\office6\wps.exe`。
- 原生探针：`%APPDATA%\WpsHighSchoolMath\native-capability-probe\com\x86\WpsHsmNativeDialogProbe.dll`。
- DLL 类型：Internal x86 COM/原生窗口探针，不进入商业载荷。
- 最终诊断构建 SHA-256：`DF1CBCD0A96C5ED648FA888203F88842B149BF0C96C5F07F5435D481341FA4F3`。
- COM 探针版本：`1.1-file-channel`。
- 测试期间没有把 localhost、Web 任务窗格、Web 对话框或外部辅助 EXE 当作兜底。

任务 2 要求 Writer 与 PPT 全部通过。Writer 已出现确定性失败，因此按硬门禁规则停止，没有再执行 PPT；这不是把 PPT 记为通过或未覆盖风险。

## 2. 已验证的进程内加载路线

### 2.1 WPS `jside FFI`

隔离 JS 加载项调用设计要求的 `ffi.LoadLibrary()` 时得到：

```text
WPS jside ffi.LoadLibrary is unavailable
```

因此当前 JS 加载项上下文不能使用计划中的官方 FFI 入口。

### 2.2 NativeX

- `inproc=false` 返回 `Load dll fail`。
- `inproc=true` 没有产生 DLL 审计或模块加载记录。
- 本机构建的 `ksomisc -regnativex` 不支持该注册流程。

该路线没有进入探针 DLL，不能构成进程内能力通过证据。

### 2.3 OAAssist 与 COMAddIns

- `OAAssist.CoCreateInstance` 返回 `WpsHsm.NativeDialogProbe can not create`。
- WPS `COMAddIns` 可以枚举 `WpsHsm.NativeDialogProbe`，并能看到对象包装；将 `Connect` 设为 `true` 后读取仍为 `true`。
- 通过对象包装调用 `ShowInputDialog` 时，WPS 报告该方法不是函数；这不能证明自定义 COM 方法已暴露。
- 外部 x86 PowerShell 验证器可以实例化并调用同一个已注册 COM DLL，说明 DLL 构建和 32 位注册本身有效；但该进程不属于 WPS，结果不得计入硬门禁。

## 3. 文件命令通道与首入口诊断

为避免依赖 WPS 对自定义 COM 方法的 JS 映射，探针实现了纯进程内文件命令通道：

1. COM 加载项连接后在宿主窗口上设置定时器。
2. 定时器轮询 `%APPDATA%\WpsHighSchoolMath\native-capability-probe\command-wps.txt`。
3. DLL 在 WPS 进程内显示原生模态窗口，随后原子写入 `response-wps.txt`。
4. JS 只写请求并轮询响应；30 秒无响应即失败。

为区分“DLL 已加载但定时器未运行”和“WPS 从未进入 DLL”，最终诊断构建在以下入口追加非敏感日志到 `com-load-trace.txt`：

- `DllGetClassObject`
- `ProbeClassFactory.CreateInstance`
- `ProbeAddIn.constructor`
- `ProbeAddIn.OnConnection`
- `ProbeAddIn.OnStartupComplete`

日志只包含 PID、进程名和事件名，不包含挑战文本或激活码。

## 4. 最终受控复测

最终复测在 Writer 冷启动并确认加载项信任提示后执行：

1. 调用 `Application.COMAddIns.Update()` 刷新集合。
2. 仅对隔离探针执行 `Connect=false`。
3. 再次调用 `Application.COMAddIns.Update()`。
4. 设置 `Connect=true`，读取对象包装，然后写入请求。

观测结果：

| 证据 | 结果 |
|---|---|
| `command-wps.txt` | 已写入，时间 `2026-07-18 03:26:57`，长度 74 bytes |
| `response-wps.txt` | 不存在 |
| `com-load-trace.txt` | 不存在 |
| `tasklist /m WpsHsmNativeDialogProbe.dll` | 没有匹配进程 |
| WPS Ribbon 状态 | `等待原生窗口` |
| 最终错误 | `方案一进程内对话框失败: native COM file channel timed out` |

没有 `com-load-trace.txt` 意味着连最早的 `DllGetClassObject` 都未执行；没有模块快照进一步确认 DLL 没有装入 WPS 进程。刷新、断开和重连没有改变结果，因此不能再把 `Connect=true` 解释为原生加载成功。

## 5. 硬门禁决定

当前 WPS `12.1.0.26895` 上，以下三条候选进程内路线均不能提供经实测的原生对话框能力：

1. `jside FFI`：入口不可用。
2. NativeX：加载器没有进入 DLL。
3. COM/OAAssist：WPS 只暴露连接状态或对象包装，没有装入 DLL；最终首入口跟踪为空。

根据已确认的任务规则：

- 任务 2 记录为“已执行，硬门禁失败”。
- `validatedWpsBuilds` 保持为空。
- 任务 4—18 不得开始或继续。
- 不得自行改用 localhost、Web 任务窗格、浏览器提示框、外部辅助 EXE 或未经验证的桥接方案。
- 正式 0.3.3 载荷与注册备份继续保留，等待用户决定是更换 WPS 构建，还是修订产品约束。

## 6. 测试环境恢复与验证

硬门禁结束后已完成以下收尾：

- 从真实 `publish.xml` 和 `authaddin.json` 移除隔离 Writer/PPT 探针节点。
- 注销 `WpsHsm.NativeDialogProbe` 的 COM ProgID、CLSID、TypeLib、接口及 WPS/Office Addins 节点。
- 删除活动的 `0.0.6` 探针载荷，保留脱敏诊断记录与仓库内探针源码。
- 恢复 `WpsHighSchoolMath_0.3.3` 与 `WpsHighSchoolMathPpt_0.3.3` 两个正式注册节点。
- 冷启动 Writer/PPT，确认两端“高中数学”Tab 均恢复；Writer 的数学符号、函数工具、试卷工具和授权中心仍位于同一 Ribbon。

恢复验证期间，旧 0.3.3 Writer 仍弹出启动 `WpsHighSchoolMathEditorHost.exe` 的外部程序警告；测试选择“否”，没有启动旧助手。这是保留旧版后的已知行为，不代表方案一已解决警告或 localhost 依赖。

修正证据记录器与当前 probe manifest 的 schema 版本漂移后，`scripts/run-tests.ps1` 全量通过：11 个 Node.js 测试、8 个 PowerShell 测试、38 个 JavaScript 语法检查、29 个 PowerShell 语法检查及 98 个 UTF-8/结构检查。零回环策略测试通过只证明扫描器和正反夹具有效；对真实 source profile 的扫描仍按预期以退出码 1 拒绝并报告 20 项，包括旧 `runtime`、任务窗格/Web 页面、`openLocalEditor` 和 `CreateTaskPane`。现有 0.3.3 正式载荷仍包含旧 Web/runtime/localhost 链，不能据此声称已经实现全插件零 localhost。
