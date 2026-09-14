# 0.3.3 基线与 G0 授权兼容证据

状态：**G0 通过**  
采集时间：2026-07-16 16:59:32 +08:00  
适用任务：`tasks.md` 任务 1  
数据约束：本文及测试夹具均不包含真实客户机器码或真实客户激活码。

## 1. 结论

- 当前源码、真实 0.3.3 发布载荷和当前 Writer/PPT 安装载荷中的 `js/license.js` 完全相同，原始字节 SHA-256 均为 `6bd7cbe504ef80faa8b56271b256ad70d05b1f2ce779b6d45478440cf9e7034b`。
- 已从该发布载荷冻结纯只读兼容模块 `migration/0.3.4/js/license-legacy-readonly.js`。该模块不读写存储，不包含 UI、Ribbon、任务窗格、文件系统或网络逻辑。
- 8 组纯合成黄金向量逐项同时通过完整 0.3.3 快照和只读兼容模块；月卡、季卡、年卡、永久版、过期、异机、签名错误、格式错误的返回对象完全一致。
- 全部现有自动化回归通过：8/8 个 Node.js 测试文件、5/5 个 PowerShell 测试文件。
- Internal 构建在系统临时目录的隔离副本中通过，未覆盖本节冻结的原始 0.3.3 release 产物。
- 正式 `js/license.js` 未在任务 1 中修改，其任务结束时 SHA-256 仍为上述基线值。

## 2. 真实 0.3.3 来源链

### 2.1 项目与发布产物

| 项目 | 结果 |
| --- | --- |
| `package.json` 名称/版本 | `WpsHighSchoolMath` / `0.3.3` |
| release manifest | `schemaVersion: 2`、`buildMode: Internal`、`channel: internal-test` |
| 0.3.3 ZIP | 654782 字节，SHA-256 `7c5288325d8938a2cf6d3ea3a1dc36be11ae73877300a57d781dbe4873e0e6fa` |
| 0.3.3 EXE | 528384 字节，SHA-256 `f177585f3cb9747b0af25ac7631cf573eb2829fe555ec6868b1bcc3c9276178d` |
| 发布签名状态 | `pending-certificate`，属于内部测试包，不是商业签名交付物 |

上述 ZIP/EXE 哈希同时与 `WpsHighSchoolMath-0.3.3-checksums.sha256` 和 `WpsHighSchoolMath-0.3.3-release-manifest.json` 一致。

### 2.2 Writer/PPT 载荷一致性

| 来源 | 文件/集合 | 结果 |
| --- | --- | --- |
| release Writer | `payload/WpsHighSchoolMath_0.3.3/js/license.js` | 16056 字节；SHA-256 `6bd7cbe504ef80faa8b56271b256ad70d05b1f2ce779b6d45478440cf9e7034b` |
| release PPT | `payload/WpsHighSchoolMathPpt_0.3.3/js/license.js` | 与 Writer 原始字节完全一致 |
| 已安装 Writer | `%APPDATA%/Kingsoft/wps/jsaddons/WpsHighSchoolMath_0.3.3/js/license.js` | 与 release 完全一致 |
| 已安装 PPT | `%APPDATA%/Kingsoft/wps/jsaddons/WpsHighSchoolMathPpt_0.3.3/js/license.js` | 与 release 完全一致 |
| 当前源码 | `js/license.js` | 与 release 完全一致 |
| Writer 完整载荷 | 27 个清单文件 | manifest `1372bbd922712afd7c7e4993132ab889f5f0d6200d54fa7ac5ee15c629953655`；payload `7deb6bc9a516dc0051efc74cbb2a1b1e3e240322db78339c66cfa9b86a6763f6` |
| PPT 完整载荷 | 26 个清单文件 | manifest `4b95192e1fc3c93b0bf2ba61bb79d8731602bbd292adfe77f5bf9d6f60c105a3`；payload `21ebd09e365ef1c1464d1d292d139d033fc6876ede49f01ee75c3340abc44405` |

已对两个安装目录执行 `Test-HsmPayload`，文件数量、每文件哈希、聚合 payload 哈希、宿主身份与入口契约均通过。

## 3. 当前 WPS 与注册状态

### 3.1 宿主可执行文件

| 宿主 | 规范路径 | FileVersion | ProductVersion | SHA-256 |
| --- | --- | --- | --- | --- |
| Writer | `D:\Program Files (x86)\WPS Office\WPS Office\12.1.0.26895\office6\wps.exe` | `12,1,0,26895` | `12,1,0,26895` | `a79c853937fd557f701bf596cd118a856ade9f008b1ab40a51a86ca0841e6935` |
| Presentation | `D:\Program Files (x86)\WPS Office\WPS Office\12.1.0.26895\office6\wpp.exe` | `12,1,0,26895` | `12,1,0,26895` | `d64bfaa6aa03d79e43f4a15ce25eae1aa1ffeb23771d0abe74a148392b515ba6` |

本节只记录版本，不把该构建写入 0.4.0 的 `validatedWpsBuilds`；原生能力尚须通过任务 2 的实机探针。

### 3.2 注册记录

`%APPDATA%\Kingsoft\wps\jsaddons\publish.xml`：

- Writer 节点：`name=WpsHighSchoolMath`、`type=wps`、`url=WpsHighSchoolMath_0.3.3`、`version=0.3.3`、`enable=enable_dev`。
- PPT 节点：`name=WpsHighSchoolMathPpt`、`type=wpp`、`url=WpsHighSchoolMathPpt_0.3.3`、`version=0.3.3`、`enable=enable_dev`。
- 取证时文件 SHA-256：`d7eaabb3467ca87ff25d181df43f87978f02c71f0808b1e1d8880f8277d81dab`。

`%APPDATA%\Kingsoft\wps\jsaddons\authaddin.json`：

- Writer 与 PPT 的当前产品记录均为本地 `mode=1`、`enable=true`、`isload=true`，路径分别指向上述 0.3.3 安装目录。
- 文件还保留了若干旧 E2E 诊断记录，其中包含 `mode=2` 的回环地址；任务 1 未修改这些记录。它们属于任务 3/7 的零回环清理与负向测试基线，不能进入 0.4.0 正式状态。
- 取证时文件 SHA-256：`6a6eb4f776a61bca415c8e8269b64266c897a28abcc97f19deec53b9b05e4b88`。

## 4. 历史夹具与只读模块

### 4.1 隔离位置

- 完整 0.3.3 授权源码快照：`tests/fixtures/license-legacy-0.3.3/license-0.3.3.js`。
- Writer/PPT 历史载荷指纹：`tests/fixtures/license-legacy-0.3.3/payload-fixture.json`。
- 合成黄金向量：`tests/fixtures/license-legacy-0.3.3/golden-vectors.json`。
- 纯只读迁移模块：`migration/0.3.4/js/license-legacy-readonly.js`。
- 对照测试：`tests/license-legacy-readonly.logic.test.js`。

快照的原始字节 SHA-256 与真实 release 的 `license.js` 完全相同。历史快照位于 `tests/fixtures`，只读模块位于独立 `migration/0.3.4` 树；当前 0.3.3 构建脚本只复制明确的根文件及 `js/ui/assets/ppt/runtime`，不会把上述测试夹具或迁移树复制到当前正式 payload。

### 4.2 新增文件指纹

| 文件 | SHA-256 |
| --- | --- |
| `migration/0.3.4/js/license-legacy-readonly.js` | `4f6010d195b01600e65f76474b5fafb826111eb5fe4484d2eee8e019792d63a0` |
| `tests/fixtures/license-legacy-0.3.3/golden-vectors.json` | `b0a2cecedfc343dba601ae52ab6f662c46ac393b0571a08efb5a3a235cc98e84` |
| `tests/fixtures/license-legacy-0.3.3/payload-fixture.json` | `457522509da9de02c5547ec0b19d7fc70460c1f074e05e83ba21d50c284edbcb` |
| `tests/license-legacy-readonly.logic.test.js` | `ff31e7fea3d7b72ae19ec072fc93ab114d1e3ae154592148dd83fbe73721939e` |

### 4.3 只读边界

自动检查确认只读模块不包含以下运行依赖：`localStorage`、`PluginStorage`、写存储、`CreateTaskPane`、`MathTaskPanes`、`ShellExecute`、`OAAssist`、XHR/WebSocket、localhost/127.0.0.1、`window.Application`、DOM 页面访问。模块只暴露规范化、旧 FNV 风格哈希、7 位 Base36 签名、解析、日期/过期判断、机器绑定验证和授权强度比较。

## 5. G0 黄金向量结果

测试固定求值日期为 `2026-07-16`，使用显式标记的合成机器码。夹具不来自任何客户数据。

| 向量 | 完整 0.3.3 快照 | 只读模块 | 一致性 |
| --- | --- | --- | --- |
| 月卡有效 | 通过 | 通过 | 完全一致 |
| 季卡有效 | 通过 | 通过 | 完全一致 |
| 年卡有效 | 通过 | 通过 | 完全一致 |
| 永久版有效 | 通过 | 通过 | 完全一致 |
| 已过期 | 拒绝：已过期 | 拒绝：已过期 | 完全一致 |
| 异机 | 拒绝：机器码不匹配 | 拒绝：机器码不匹配 | 完全一致 |
| 签名错误 | 拒绝：校验失败 | 拒绝：校验失败 | 完全一致 |
| 格式错误 | 拒绝：格式错误 | 拒绝：格式错误 | 完全一致 |

G0 判定：**通过**。任务 4 以后只能复用该已锁定模块及向量，不得从重写后的正式授权核心反向推导旧算法。

## 6. 自动化与构建记录

### 6.1 UTF-8、语法与 G0

```powershell
node --check migration\0.3.4\js\license-legacy-readonly.js
node --check tests\fixtures\license-legacy-0.3.3\license-0.3.3.js
node --check tests\license-legacy-readonly.logic.test.js
node tests\license-legacy-readonly.logic.test.js
```

结果：全部通过。测试使用 fatal UTF-8 解码，拒绝非法 UTF-8 与替换字符；G0 输出为 `8 synthetic vectors, UTF-8, release parity`。

### 6.2 全部现有测试

按文件名顺序运行 `tests/*.test.js` 与 `tests/*.test.ps1`：

- Node.js：8/8 个文件通过。
- PowerShell：5/5 个文件通过。
- 安装授权缓存、安装事务、payload integrity、已安装验证和 EditorHost 集成测试均通过。

### 6.3 Internal 隔离构建

为避免覆盖已冻结 release，先把构建所需白名单源码复制到 `%TEMP%/hsm-baseline-build-<GUID>`，然后运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\build-offline.ps1 -BuildMode Internal
```

结果：`Release validation passed`；版本 `0.3.3`、Writer 27 文件、PPT 26 文件、ZIP/EXE 均生成，签名状态为内部包预期的 `pending-certificate`。临时目录经路径边界校验后已删除，工作区原 release 未被构建覆盖。

## 7. 已知旧测试与后续替换项

以下测试在 0.3.3 基线下通过，但验证的是即将删除的旧实现，不能作为 0.4.0 验收依据：

- `tests/taskpane.logic.test.js`：动态 localhost 页面助手与任务窗格。
- `tests/editor-host.integration.test.ps1`：EditorHost token、ready、CORS 与回环服务。
- `tests/license-ui.logic.test.js`：Web 授权面板 DOM/剪贴板交互。
- `tests/license.logic.test.js` 中对 `MathTaskPanes.openLocalEditor` 的旧入口断言。
- 当前发布验证中的 `EditorHost=on-demand-loopback` 与 `onDemandLoopbackEditorHost=true`。

任务 3 必须新增零回环策略测试，并证明当前 0.3.3 正式源码/载荷会因这些旧链路被拒绝；任务 7 再删除正式加载链并用原生 Ribbon/函数流程的负向测试替换上述旧断言。

## 8. 门禁与下一步

- G0 已通过，可进入任务 2 和任务 3。
- 本证据不代表 WPS 12.1.0.26895 已通过原生 `editBox`/FileSystem 能力验收；该结论只能由任务 2 的 Writer/PPT 实机探针产生。
- 在任务 2 硬门禁和任务 3 的策略测试通过前，不得开始任务 4 的正式授权核心改造。
