# 方案 B 0.4.0 安装与实机验收

状态：通过（内部交付构建）  
日期：2026-07-18  
WPS：`12.1.0.26895`  
宿主：WPS Writer、WPS Presentation

## 1. 安装结果

- Writer 注册：`wps -> WpsHighSchoolMath_0.4.0`。
- Presentation 注册：`wpp -> WpsHighSchoolMathPpt_0.4.0`。
- Writer 安装载荷：22 个受控文件，载荷 SHA-256
  `40304f72a5b79cdcaee53ecf97140252b251a2d1692962472797d6ca6816a3a6`。
- Presentation 安装载荷：23 个受控文件，载荷 SHA-256
  `61a4899d32970200956cddf5f40c76fcf89837455cce7c5c6418ac8f296a400d`。
- 两个宿主均声明 `TaskPaneSource=packaged-file`、`AuxiliaryExecutables=False`。
- 安装后的 Writer/PPT 目录分别通过零回环策略扫描，未发现 localhost、远程页面、
  EditorHost 启动链路或辅助二进制。
- `%APPDATA%\WpsHighSchoolMath\machine-id.txt` 的时间戳仍为 2026-06-18；0.4.0
  安装未重新生成机器码。

## 2. Writer 实机回归

- 冷启动时只出现 WPS 对新版本加载项的首次信任确认；确认后只有一个“高中数学”Tab。
- 数学符号、函数工具、试卷工具和授权中心位于同一个“高中数学”Ribbon。
- “授权中心”成功创建包内任务窗格，并在 5 秒 ready 门禁后继续保持可用。
- “函数编辑器”成功创建包内任务窗格；关闭后连续重新打开两次，均未再出现旧的
  “运行外部程序”或 localhost/EditorHost 警告。
- 实际点击数学符号“+”后，字符写入当前光标位置；随后移除测试字符并保存回归副本。
- 任务窗格页面的 WebView 像素没有出现在 Windows Graphics Capture 截图中；因此面板内
  具体字段采用同一安装载荷的精确 DOM/剪贴板测试验证，实机部分以 ready token、超时门禁
  和任务窗格存活状态作为加载证据，不把空白截图误判为页面未执行。

## 3. Presentation 实机回归

- 冷启动首次信任确认后，只有一个“高中数学”Tab。
- 数学符号、函数编辑器和授权中心位于同一个“高中数学”Ribbon。
- 授权中心与函数编辑器均成功创建包内任务窗格并通过 5 秒 ready 门禁。
- 函数编辑器打开期间未出现外部程序、端口或 localhost 警告。
- Writer 与 Presentation 同时打开时，两者各自的函数任务窗格均已创建；切换宿主后页面
  按对应宿主角色工作。

## 4. 授权中心功能证据

`tests/license-ui.logic.test.js` 使用正式 `ui/license-ui.js` 和与正式页面一致的 DOM，逐项验证：

- 显示授权类型、到期时间、剩余时间和已到期/有效状态。
- 显示并复制机器码。
- 从剪贴板粘贴激活码并把焦点返回激活码输入框。
- 无效激活不覆盖原授权状态；有效激活后清空输入框并刷新状态。
- 显示并复制 QQ `982303035` 和微信号 `qzt65631`。
- 剪贴板读取超时后安全返回，不记录或泄露完整激活码。

安装后载荷哈希校验确认，实机使用的授权页面、脚本和自动化测试所覆盖的正式源文件来自
同一次 0.4.0 构建。

## 5. 函数编辑器功能证据

- `tests/ribbon.logic.test.js` 验证多函数表达式、SVG 预览、坐标范围、刻度、网格、边框、
  图例、预设函数和同一 Ribbon 入口。
- `tests/function-plot-document.logic.test.js` 验证函数配置元数据、插入、重新编辑、更新旧图、
  保留旧图位置尺寸以及 Presentation 避让式自动放置。
- `tests/ppt.logic.test.js` 验证 Presentation 的函数入口、宿主角色和符号插入路径。
- 实机验证了 Writer/Presentation 的正式包内函数任务窗格创建、ready 握手、关闭与重开；
  文档写入事务由上述正式模块逻辑测试覆盖。

## 6. 正式零 localhost 运行证据

正式证据文件：

`C:\Users\17852\AppData\Roaming\WpsHighSchoolMath\scheme-b-acceptance\runs\4688c850-6aed-4a5f-996b-6f487a730666\monitor.json`

- Run ID：`4688c850-6aed-4a5f-996b-6f487a730666`。
- 证据 SHA-256：`48C2DF87D4D53EB1783B5221364B95D45343E11D986D9849A287A1CDC0DA6B09`。
- Writer 与 Presentation 文档均已打开，两个函数任务窗格均已创建；Writer 为当前可见宿主。
- 连续样本：984；丢样：0；最大样本间隔：65 ms。
- 每个样本的 WPS 进程树计数：11；覆盖期间始终存在目标宿主进程。
- 产品辅助进程最大值：0。
- 目标进程 TCP 监听器最大值：0。
- 目标进程回环连接最大值：0。
- 扫描错误：0。
- `continuousSampling=True`，`coverageComplete=True`。

交互式截图回归的先行监控 Run ID
`33e15312-e5f8-4dd6-9f64-3a6f7a6a308c` 因截图调用造成 5 次采样间隔超限，
不作为连续性通过证据；但该次 10,575 个样本同样记录到辅助进程、监听器、回环连接均为 0。

## 7. 自动化与发布校验

- `scripts/run-tests.ps1`：全部 Node、PowerShell、JavaScript 语法、PowerShell 语法、UTF-8
  和结构检查通过；共检查 41 个 JavaScript 文件、33 个 PowerShell 文件和 113 个 UTF-8
  文本/核心结构项。
- `scripts/validate-commercial-release.ps1 -ReleaseDirectory .\release -Version 0.4.0`：通过。
- source 零回环扫描：26 个正式文件，通过。
- staging 与解包载荷扫描：各 55 个文件，通过。
- installed Writer/PPT 扫描：分别 23/24 个含载荷清单的文件，通过。
- 安装后交叉宿主、注册、文件集合和载荷哈希校验：通过。
- 临时探针注册项已移除；正式 0.4.0 注册项保持不变。

## 8. 交付物

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `WpsHighSchoolMath-0.4.0-offline.zip` | 628509 | `90497069049B9D628D0C560E85578D76F2EDEFACE878EFD53A024217A2369F9A` |
| `WpsHighSchoolMath-0.4.0-offline.exe` | 516096 | `4CCE11F4EA263C87BC113E04D3E4BB88F122DC79C738163C4F03FFD2C45FE578` |
| `WpsHighSchoolMath-0.4.0-checksums.sha256` | 206 | `BAE7B9A0850CF2CE2D71377367FEAD18BC84475450621D61689EA3E1B789BD81` |
| `WpsHighSchoolMath-0.4.0-release-manifest.json` | 4635 | `2DDD98363E3C1AF71489E42EFE3BE7A9080FEF2593223910FAD37AA106E44EDA` |

当前构建模式为 `Internal`，安装器 Authenticode 状态为 `NotSigned`，发布清单状态为
`pending-certificate`。这不影响本机内部安装和方案 B 功能验收，但对外商业分发前仍应使用正式
代码签名证书重新构建并执行 `RequireSignature` 发布门禁。
