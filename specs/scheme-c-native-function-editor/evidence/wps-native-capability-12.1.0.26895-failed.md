# WPS 12.1.0.26895 原生能力硬门禁失败证据

取证日期：2026-07-16  
结论：任务 2 硬门禁失败；`validatedWpsBuilds` 必须保持为空，任务 4—18 不得开始，正式 0.3.3 继续保留。

## 1. 环境身份

| 文件 | FileVersion / ProductVersion | SHA-256 |
|---|---|---|
| `wps.exe` | `12,1,0,26895` | `a79c853937fd557f701bf596cd118a856ade9f008b1ab40a51a86ca0841e6935` |
| `wpp.exe` | `12,1,0,26895` | `d64bfaa6aa03d79e43f4a15ce25eae1aa1ffeb23771d0abe74a148392b515ba6` |
| `ksojscore.dll` | `12,1,0,26895` | `59717e0eaa81e67803155e3d4840efeae251a695c13fc1cdfbf240c79f131068` |
| `jsapiservice.dll` | `12,1,0,26895` | `1e23a92b358db8c7fd2bc11cce42193ec5aa99b1811cf1a0121e23606b03dce2` |

Writer 与 Presentation 的规范路径均位于：

`D:\Program Files (x86)\WPS Office\WPS Office\12.1.0.26895\office6`

## 2. Ribbon `editBox` 实机结果

Writer 与 Presentation 均完成冷启动实测，结果一致：

- 隔离探针 Tab 和 `editBox` 能显示。
- `getText` 提供的初始值能显示；“恢复初始值”能重新显示初始文本。
- 通过键盘向输入框写入完整挑战文本 `HSM-PROBE-中文-1234567890`，随后离开焦点并触发验证/刷新动作。
- 两个宿主的记录都保持 `onChangeCalls=0`、`fullInputObserved=false`、`verifiedRounds=0`。

因此当前构建不能证明、且实测未触发设计要求的 `onChange(control,text)`。授权中心不能依赖该 `editBox` 回调接收粘贴的激活码。

## 3. FileSystem 实机结果

设计要求以完整 AppData 绝对路径调用：

```javascript
FileSystem.writeFileString(fullPath, data)
FileSystem.readFileString(fullPath)
```

当前 WPS 对完整路径的严格调用弹出原始错误：

```text
path cannot contains "/" or "\"
```

本机 `ksojscore.dll` 中的 `readFileString` / `writeFileString` 分支都会检查并拒绝 `/` 和 `\`，通过检查后把单段文件名放入内部 `jsapi/filesystem` 沙箱；而 `GetAppDataPath()` 返回的系统 AppData 路径天然含目录分隔符。因此不能通过改变斜杠方向、转义或路径拼接修复，严格 AppData A/B 文件方案在该构建上必然失败。

为定位差异，随后仅以诊断方式调用本机构建实际支持的双参数 `WriteFile` / `ReadFile`，覆盖截断、A/B revision、单槽恢复、损坏重写和 Writer/PPT 跨宿主标记均观察到成功。该接口的双参数形式不属于当前设计指定的正式 API，公开契约也不稳定，所以这些结果不得计入任务 2 通过。

严格探针已固定以下判定：

- 只有 `requiredWriteFileString=true` 且 `requiredReadFileString=true` 才可能通过。
- 旧 `WriteFile` / `ReadFile` 只能在严格 API 失败后运送失败记录，并设置 `legacyDiagnosticTransport=true`。
- 一旦使用诊断 transport，本轮整体必定失败。

## 4. 原始记录与证据边界

当前保留的两份 AppData 记录来自严格失败后的 legacy 诊断轮次，不代表正式能力通过：

| 宿主 | 记录 | SHA-256 |
|---|---|---|
| Writer | `%APPDATA%\WpsHighSchoolMath\native-capability-probe\records\writer.json` | `ad438efa258d5547a3836eeb5e0bfc831d61580e61aa9b8237cbeb8655106eb2` |
| Presentation | `%APPDATA%\WpsHighSchoolMath\native-capability-probe\records\presentation.json` | `78f47ff27906b447b172af8e0be792cba8831b3e4d5abbf0d2a920fbbea39696` |

它们缺少硬化记录器要求的当前 `runId`、严格 API 字段和连续进程/网络原始样本；记录器必须把它们判为失败，不得从历史或诊断数据推导成功。本轮没有覆盖完整实测时段的连续 100 ms 进程树/网络样本，因此连续监测门禁也不通过。缺少该证据不会改变结论，因为两个正式功能门禁已经分别失败。

机器生成的失败 JSON：`wps-native-capability-12.1.0.26895-task2-failed.json`；schema version 2，`status=failed`，`commercialPayload=false`，`formalWhitelistEligible=false`，runId `061d4179-fad9-458f-8c4a-a145b8ce5f4b`，SHA-256 `0fadd0999997b4c9fc27f4c2c73346b59628954cbac8c70aec3266fb4029c592`。

## 5. 硬门禁决定

失败项：

1. Writer `editBox.onChange` 未触发。
2. Presentation `editBox.onChange` 未触发。
3. Writer/PPT 所需的 `writeFileString(full AppData path,data)` 被 WPS 拒绝。
4. 连续进程/网络原始监测证据不完整，不能构成通过证据。

按已确认任务清单，任务 2 保持未完成并明确记录为失败；任务 4—18 停止，不能以 localhost、Web 任务窗格或诊断性旧 FileSystem API 绕过。

后续若修订设计，风险从低到高的候选路线是：

1. 使用公开的 `writeAsBinaryString/readAsBinaryString` 完整路径 API，并以 UTF-8 + Base64/十六进制编码承载 JSON；重新实测 Unicode、覆盖截断、A/B 恢复和跨宿主共享。
2. 明确锁定 WPS 构建白名单，采用本机构建实际支持但公开契约不稳定的双参数 `WriteFile/ReadFile`；每次 WPS 更新都必须重跑探针。
3. 保留 `writeFileString` 但改用其内部单文件名沙箱；这会放弃固定 AppData 产品目录、嵌套目录和可运维性，不建议。

无论选择哪条存储路线，Ribbon 激活码输入仍是独立阻塞项，必须另行验证可编辑原生控件的回调能力，或明确修订“不使用原生模态输入”的现有设计约束。
