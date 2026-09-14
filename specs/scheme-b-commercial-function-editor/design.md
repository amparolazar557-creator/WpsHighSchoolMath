# 方案 B 技术设计

## 总体结构

- `ribbon.xml` 与 `ppt/ribbon.xml`：把现有两页签的 group 合入一个 `高中数学` 页签，命令 ID 不变。
- `js/ppt-api.js`：新增与宿主无关的矩形碰撞、重叠面积和候选位置评分函数，PPT 符号与函数图像共用。
- `js/function-plot-document.js`：集中处理函数图配置元数据、选中对象识别、Writer/PPT 插入与更新。
- `ui/function-plot.js`：只负责编辑器状态、预览和调用文档适配层，不再重复宿主插图逻辑。
- `js/taskpane.js`：用版本化编辑器页面打开任务窗格；回环页面以同源 `/ready` nonce 为主要就绪信号，`PluginStorage` 仅用于 `file://`/调试页兼容；离线安装路径下先按需启动回环页面助手，同一 WPS 会话复用已验证宿主，失败后由 Ribbon 回调原生绘图。
- `runtime/WpsHighSchoolMathEditorHost.cs`：编译为小型静态页面助手，仅绑定 IPv4/IPv6 回环地址，页面用 `localhost` 访问，限定插件根目录、只支持读取请求并在 15 分钟无请求后退出；安装器不创建自启动项。
- `ui/function-plot.html`：Writer 与 PPT 都直接打开各自版本化的完整编辑器页面，避免任务窗格再经过根入口二次分流。调试用 HTTP 地址直接复用，正式离线安装则通过按需回环地址绕开目标 WPS 对 `file://` 任务窗格的限制。

## PPT 自动避让算法

1. 读取幻灯片宽高，按目标宽高比计算最大可用尺寸。
2. 过滤不可见、无有效几何数据和近似覆盖整页的背景形状。
3. 从 100% 到最小比例逐级生成尺寸，并对右侧、下方、左侧、中央等锚点及网格位置取样。
4. 对每个候选计算带安全边距的总重叠面积；同尺寸下优先零重叠、靠近常用排版锚点的位置。
5. 首个存在零重叠解的最大尺寸直接返回；否则返回归一化重叠率最低的候选。
6. 更新已选中函数图时跳过算法，沿用原对象几何信息。

## 可编辑元数据

替代文字采用：

`HSM_FUNCTION_PLOT_V1:<URI 编码 JSON>`

JSON 只保存稳定输入：`expressions`、`bounds`、`options`。解析时做字段、数字范围和布尔值归一化；未知版本或非法 JSON 返回空，不影响普通图片。

## 任务窗格降级

- Ribbon 请求重新创建函数编辑器任务窗格，确保每次能读取当前选区。
- 编辑器加载后向回环助手写入本次打开唯一的 ready nonce；非回环页面继续使用版本化 `PluginStorage` 标记。
- 主页面在超时后隐藏失败窗格并重试一次；第二次失败调用 `MathFunctionPlot.openQuickWriter/openQuickPresentation`。
- 原生流程继续支持 InputBox；宿主无 InputBox 时保留常用函数确认框。

## 商业发布

- 版本提升为 `0.3.0`。
- 构建完成后为 ZIP、EXE 和页面助手计算 SHA-256，写入 `checksums.sha256` 与 `release-manifest.json`。
- `build-offline.ps1` 接受证书指纹、时间戳 URL 和 signtool 路径；只有参数完整时同时签名安装器与页面助手，并用 `Get-AuthenticodeSignature` 二次校验。
- `validate-commercial-release.ps1` 作为正式门禁；默认允许“待签名”开发交付，传入 `-RequireSignature` 时未签名直接失败。

## 0.3.1 方案乙稳定性设计

### 事务式安装

构建阶段为 Writer/PPT 各生成 `PAYLOAD-MANIFEST.json`。清单记录宿主类型、入口约束以及除清单自身之外的全部文件路径、大小和 SHA-256。安装器按以下顺序执行：

1. 验证发布包内两份载荷清单、入口身份和全部文件哈希。
2. 将两份载荷复制到 `jsaddons` 下同一事务 ID 的临时目录，再逐文件复核。
3. 将本产品现有版本目录移动到事务备份目录，并保存 `publish.xml` 快照。
4. 把两份临时目录原子改名为正式版本目录，更新授权缓存和 `publish.xml`。
5. 对正式目录与注册项执行安装后校验；成功后才删除事务备份。
6. 任一步骤抛错时，按相反顺序恢复注册文件和旧目录，再返回非零退出码。

独立的 `validate-installed.ps1` 复用相同清单语义，可在安装后或售后排障时只读检查当前机器，重点确认 `wps -> WpsHighSchoolMath`、`wpp -> WpsHighSchoolMathPpt` 的映射没有串宿主。

### 动态回环助手与 ready 握手

- `js/taskpane.js` 从高位端口范围随机取候选端口，并生成会话令牌；启动参数包含 `--port`、`--token`、`--role`、`--version` 和闲置时间。
- 助手把令牌作为 URL 第一段：`http://localhost:<port>/<token>/...`。相对静态资源会自动继承该前缀，错误令牌无法读取页面。
- `/<token>/health` 返回带产品、协议、版本、角色和端口的 JSON；只为 `null` 或旧版 WPS 实际使用的精确 `file://` 文件源回显 CORS，静态响应不使用 CORS，更不使用通配符。
- `openLocalEditor` 负责启动、创建任务窗格和验证 ready。编辑器完成初始化后把本次 `hsmToken` 写入版本化 `PluginStorage`；超时后关闭旧窗格并以新端口重启一次，之后调用原生降级。
- 非 `file://` 调试地址不启动助手，但仍使用每次打开唯一的 ready 令牌，保持同一套就绪语义。

### 签名清单与门禁

构建先编译并签署页面助手，再把同一已签二进制复制到两份载荷；生成发布清单时仍分别列出 Writer/PPT 路径、哈希和 Authenticode 状态。最后生成并签署安装器。强制门禁从 ZIP 分别提取两个助手校验，不能只抽查一份。

## 风险与回滚

- 若目标 WPS 不支持任务窗格或入口页仍未就绪，自动回退原生绘图，不阻断核心功能。
- 若签名工具或证书缺失，构建保留未签名交付物并在清单中明确状态；正式对外发布前用强制签名门禁重跑。
- Ribbon 合并仅移动 XML group，不改命令实现；可单独回滚 XML 而不影响功能代码。
- 安装事务的备份目录只位于已解析的 `jsaddons` 根内，所有递归删除和移动前都验证绝对路径边界。
- 动态端口连续两次不可用时不继续后台重试，立即回到原生绘图，避免残留白窗格和重复提示。

## 0.3.2 正式授权中心设计

- `js/license.js` 继续负责机器码、试用期、激活码校验和授权状态，但授权入口统一调用 `MathTaskPanes.openLocalEditor`；Writer/PPT 由各自 Ribbon 传入宿主角色和插件根地址。
- `ui/license.html`、`ui/license.css`、`ui/license-ui.js` 组成单页授权面板。面板按“状态摘要 → 机器码 → 激活码 → 联系方式”排列，所有复制、粘贴、校验结果都通过页内 `aria-live` 状态区反馈。
- 剪贴板优先使用 `navigator.clipboard`；旧版 WPS 不支持时，复制使用隐藏输入框与 `execCommand("copy")`，粘贴则聚焦输入区并明确提示用户按 `Ctrl+V`，不打开系统输入框。
- 到期功能入口只负责记录功能名称、打开面板并返回未授权；激活成功后用户重新点击原功能，避免异步面板流程误放行。
- 授权面板与函数编辑器共用动态端口、令牌路径、宿主身份校验、ready 握手和一次重试机制，不新增外网请求或常驻进程。
