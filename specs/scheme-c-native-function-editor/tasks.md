# 方案 C：全插件无 localhost 实施任务清单

状态：方案一任务 2 兼容性硬门禁已执行并失败；任务 3 已完成，任务 4—18 已停止并等待用户决定后续路线  
目标版本：0.4.0  
对应需求：[requirements.md](./requirements.md)  
对应设计：[design.md](./design.md)

## 执行规则

- 必须按依赖顺序实施；每完成一个任务，就同步更新本文件的复选框和验证结果。
- 任务 1 的 G0、任务 2、任务 8 的 G2、任务 11 的 G3、任务 12 的 G4，以及任务 15、16 是不得绕过的硬门禁。任一硬门禁失败时立即停止其依赖任务和后续发布工作，保留旧版和证据，不得改用 localhost、Web 任务窗格、外部辅助进程或未经双宿主验证的原生桥接方案。
- 每项代码修改必须同时完成对应自动化测试；不得把“代码已写”视为任务完成。
- 正式 Writer/PPT payload、商业安装器和安装后目录必须分别通过精确白名单与零回环扫描。
- 所有安装脚本对 JavaScript/JSON 的读写必须显式使用 UTF-8，且日志不得输出完整真实激活码。

## 阶段 A：基线与原生能力硬门禁

- [x] 1. 固化 0.3.3 基线与可回滚测试夹具
  - 记录当前源码版本、WPS Writer/PPT 可执行文件规范路径与版本、现有注册节点、已安装插件目录和当前自动化测试结果。
  - 保存只用于迁移测试的 0.3.3 Writer/PPT 历史载荷夹具；夹具必须与正式 0.4.0 构建白名单隔离，不得被当前打包脚本复制。
  - 在修改现有 `js/license.js` 前，从真实 0.3.3 发布载荷提取纯只读的旧授权兼容模块，放入 `migration/0.3.4/js/license-legacy-readonly.js`；模块只能包含规范化、哈希、签名、日期、机器绑定和授权强度判断，不得包含写存储、UI、Ribbon、任务窗格或网络逻辑。
  - 新增不含真实用户激活码的黄金向量夹具与 `tests/license-legacy-readonly.logic.test.js`，锁定月卡、季卡、年卡、永久版、过期、异机、签名错误和格式错误的 0.3.3 结果。
  - 运行现有 JavaScript、PowerShell、内部构建和安装事务测试，记录已知通过项与待替换的 localhost/任务窗格测试。
  - 在 `specs/scheme-c-native-function-editor/evidence/baseline-0.3.3.md` 记录结果，不写入真实完整激活码。
  - **G0 硬门禁：只读兼容模块与真实 0.3.3 对任一黄金向量结果不一致，停止任务 4—18；禁止先重写 `js/license.js` 再补兼容层。**
  - _验证结果（2026-07-16）：G0 通过；8 组合成黄金向量与真实 0.3.3 完全一致，Node 8/8、PowerShell 5/5、隔离 Internal 构建均通过；证据见 `evidence/baseline-0.3.3.md`。_
  - _依赖：无_
  - _需求：R6、R9_

- [x] 2. 构建并实测不进入商业载荷的进程内原生对话框探针（硬门禁失败）
  - 保留现有隔离 Writer/PPT 探针与运行脚本，不得复用页面助手、任务窗格、旧 Web 页面、浏览器 `prompt()` 或 Web 对话框。
  - 永久保留 2026-07-16/17 的 `editBox`、WPS `InputBox` 与旧字符串文件 API 失败记录；这些结果只作为历史兼容性证据，不得删除、改写或伪装成通过，也不再作为方案一的新硬门禁。
  - 新增隔离 x86 C++ DLL，仅导出版本、当前 PID、打开原生输入对话框、读取/清空临时结果等最小 C ABI；探针 DLL 可以未签名，但必须明确标记 Internal，绝不能进入商业载荷。
  - 在当前 WPS Writer/PPT 分别验证同一 Ribbon 按钮通过官方 `jside FFI` 的 `ffi.LoadLibrary()` 按绝对路径加载 DLL；验证 WPS 指针宽度、DLL PE 架构、ABI 主版本、导出表和错误处理。
  - 验证 DLL PID 与当轮 `wps.exe`/`wpp.exe` PID 一致、模块路径出现在该宿主进程中、对话框以宿主窗口为父窗口，并完成 `Ctrl+V`、中文/空白/最大长度/多行输入、确认返回、取消无副作用和敏感缓冲区清零。
  - 在两个宿主分别验证 `Env.GetAppDataPath()`、目录创建，以及完整固定 AppData 路径上的 `writeAsBinaryString()/readAsBinaryString()`：ASCII 封套覆盖截断、立即回读、UTF-8/Base64 往返、12,000 bytes 原始 JSON 与 16,384 bytes 完整封套的写前/读后双门禁、A/B 损坏恢复和跨宿主读取。
  - 记录 WPS 可执行路径、`FileVersion/FileVersionInfo.ProductVersion`、宿主、runId、开始时间、每项结果、原始监测采样和探针文件 SHA-256；未通过新探针前 `validatedWpsBuilds` 必须保持为空。
  - 探针运行期间连续采集 WPS 进程树、模块和网络事件，覆盖重启、新 PID 与子进程，确认没有辅助进程、监听器或回环连接。
  - 保留不含激活入口的 `ribbon.compat.xml` 仅供本机诊断恢复，并验证它不会进入任何正式白名单。
  - **新硬门禁：Writer 或 PPT 任一 `jside FFI` 进程内 DLL 能力、二进制共享文件能力、连续监测或证据完整性失败，停止任务 4—18 并提交兼容性结果给用户决定。**
  - _验证结果（2026-07-18）：当前 WPS Writer `12.1.0.26895` 的 `jside FFI` 不可用；NativeX 未进入探针 DLL；OAAssist 不能创建对象；`COMAddIns` 虽能枚举对象并显示 `Connect=true`，但 WPS 进程未加载 DLL。最后一次执行 `COMAddIns.Update()` 及断开—重连后，请求文件已写入但响应、模块快照和 `DllGetClassObject` 首入口日志仍全部缺失，最终 30 秒超时。Writer 已使双宿主硬门禁失败，因此按规则未再执行 PPT；`validatedWpsBuilds` 保持为空，任务 4—18 停止。证据见 `evidence/wps-native-capability-12.1.0.26895-scheme-one-inproc-failed.md`。_
  - _依赖：任务 1_
  - _需求：R1、R6、R8、R9_

- [x] 3. 建立统一测试入口与零 localhost 策略测试
  - 新增统一测试运行脚本，顺序执行全部 Node.js 逻辑测试、PowerShell 测试、语法检查和结构检查，并在任一失败时返回非零退出码。
  - 新增零回环扫描器及正反夹具，覆盖禁止文件、禁止 API、回环地址变体、动态字符串拼接、远程 DOM URL 属性和仅允许的两个 XML 命名空间。
  - 第一版策略测试必须证明当前 0.3.3 生产源码与 staging 会因旧 Web/runtime/localhost 链被拒绝，并证明允许的最小原生夹具通过，防止扫描器出现“虚假通过”。
  - 在测试环境把网络 API、`OAAssist` 和 DOM URL setter 替换为调用即失败的探针；规格文档和明确标记的历史迁移夹具不参与生产载荷扫描。
  - 让后续任务能够分别扫描生产源码白名单、staging、bootstrapper 解包结果和安装后目录。
  - _验证结果（2026-07-16）：统一入口 `scripts/run-tests.ps1` 通过；11 个 Node.js 测试、7 个 PowerShell 测试、38 个 JavaScript 语法检查、20 个 PowerShell 语法检查和 88 个 UTF-8/结构检查全部通过。策略测试证明当前 0.3.3 生产源码与 staging 会被拒绝、原生最小夹具会通过，并覆盖 source/staging/bootstrapper/installed profile、回环地址变体、禁止 API、DOM URL setter、`OAAssist`、白名单多余文件和命令行失败码。_
  - _依赖：任务 1；可与任务 2并行_
  - _需求：R1、R9_

## 阶段 B：WPS 原生运行功能

- [ ] 4. 实现共享授权存储与无 UI 的授权领域核心
  - 新增 `js/license-storage.js`，使用完整固定 AppData 路径和 `writeAsBinaryString()/readAsBinaryString()` 实现 A/B 双槽；逻辑 JSON 按无 BOM UTF-8 编码并写入带固定版本前缀的 Base64 ASCII 封套。
  - 同时执行 12,000 bytes 原始 JSON 与 16,384 bytes 完整封套（含 Base64 和元数据）的写前/读后上限校验，并实现固定字段 checksum、revision、覆盖截断回读、单槽损坏恢复和并发重试。
  - 重构 `js/license.js`，保留现有激活码格式、机器绑定、试用期、付费门禁和提醒规则；删除任务窗格、URL、弹窗和外部程序逻辑。
  - 只接受已校验迁移导出或带 `source="0.4.x"` 的新版兼容镜像，不再把裸 0.3.x `localStorage/PluginStorage` 当恢复来源。
  - 固定 `getContact()` 返回 QQ `982303035` 和微信号 `qzt65631`，确保过期码不使整个状态槽失效，较弱授权不能覆盖较强授权。
  - 新增共享存储与授权核心测试，覆盖 Writer/PPT 独立上下文、UTF-8/Base64 往返、两个字节上限、非法封套、截断、错误 checksum、异机、过期、永久版、并发 revision 和写入失败。
  - _依赖：任务 1 的 G0、任务 2、3_
  - _需求：R6、R7、R9_

- [ ] 5. 实现同一“高中数学”Tab 内的原生 Ribbon 授权中心
  - 新增 `js/native-dialog-bridge.js` 与 `js/license-ribbon.js`，统一 Writer/PPT 的 `jside FFI` 加载、ABI 校验、动态标签、原生授权面板、非敏感反馈和 Ribbon 刷新；不得保存会话激活码或持久草稿。
  - 更新 `ribbon.xml` 与 `ppt/ribbon.xml`：数学符号、函数工具、试卷工具和授权中心仍在同一个 Tab，仅新增授权分组，不新增第二个 Tab，也不加入 `editBox`。
  - 实现状态、授权类型、到期日、剩余天数、权限、完整机器码、“打开授权中心”按钮、复制机器码、粘贴/输入激活码、复制 QQ、复制微信和刷新授权。
  - 主激活路径必须使用任务 2 通过的签名进程内原生 DLL；DLL 只返回用户明确提交的临时码值，禁止浏览器 `prompt()`、WPS `InputBox`、Web 对话框和外部程序兜底。
  - 用户取消时不得校验、写入、增加 revision、改变反馈或刷新状态；失败码只存在于当前调用栈并在返回前丢弃，原授权保持不变，日志、错误文本、宿主存储和状态文件不得包含失败码。
  - 激活成功必须在二进制共享状态回读成功后才刷新；只有已验证的规范化激活码可以进入权威授权状态。
  - 更新 Writer/PPT Ribbon 测试，覆盖 `qzt65631`、DLL ABI/签名/架构门禁、取消无副作用、失败不覆盖、敏感缓冲清零、无激活码日志/草稿、跨宿主刷新和兼容诊断 Ribbon 不进入正式载荷。
  - _依赖：任务 2、4_
  - _需求：R1、R6、R7、R8、R9_

- [ ] 6. 完成原生函数向导与事务式 Writer/PPT 图像更新
  - 在共用原生 DLL 中实现完整函数编辑面板；重构 `js/function-plot-native.js`，通过桥接器传入默认配置、接收版本化 JSON，并实现多表达式、x/y 范围、四项显示、取消和旧配置回填。
  - 保留现有表达式能力和 SVG 绘图引擎；确认前不得生成文件或修改文档，任何退出路径都清理唯一临时 SVG。
  - 重构 `js/function-plot-document.js`：Writer 使用折叠范围插入；Writer/PPT 更新均先创建并验证新图，再删除旧图，失败时保留旧图、元数据、位置和尺寸。
  - 保留 PPT 内容避让算法；进程内桥接不可用时仅提供四个离线快捷函数，取消或确认能力不足时不修改文档。
  - 扩充函数、元数据、事务回滚和 PPT 拥挤布局测试。
  - _依赖：任务 2、3、4_
  - _需求：R2、R3、R4、R5、R7、R8、R9_

- [ ] 7. 切换 Writer/PPT 正式加载链并移除 Web/助手运行路径
  - 更新 `index.html`、`main.js`、`ppt/index.html`、`ppt/main.js`、`js/ribbon.js` 和 `js/ribbon-ppt.js`，按设计顺序同步加载共享模块并只保留薄宿主回调。
  - 删除正式实现中的 `entry.js`、`js/taskpane.js`、`runtime/WpsHighSchoolMathEditorHost.cs`、函数/授权 Web 页面和二维码资源；加入同一份已签名 `native/HsmMathNativeBridge.dll`；需要留作历史验证的内容只能移入明确排除的测试夹具目录。
  - 删除所有 `openLocalEditor`、`ShellExecute`、`CreateTaskPane`、Web 对话框、端口选择、ready 握手和任务窗格 ID 缓存路径。
  - 替换旧 taskpane/editor-host/license-Web 测试为“正式入口不可达、文件不在白名单、正常流程不触发网络”的负向测试。
  - 对生产源码白名单运行任务 3 的扫描和 JavaScript UTF-8/语法检查。
  - _依赖：任务 4、5、6_
  - _需求：R1、R6、R7、R9_

## 阶段 C：旧授权迁移与发布载荷

- [ ] 8. 实现零 localhost 的 `0.3.4-migration` 只读迁移桥
  - 新增独立迁移源码树和清单；每个宿主只包含最小 HTML/主脚本、迁移 Ribbon、`license-legacy-readonly.js` 和 `license-migrate-0.3.js`。
  - 只复用任务 1 已锁定的纯只读旧授权兼容模块，并再次运行全部黄金向量；不得重新实现另一套旧算法，不得直接打包旧 `license.js`。
  - 从 Writer/PPT `_file://` 主上下文读取四个旧键，合并后写入限字段 `legacy-license-export-v1.json`，固定 checksum 顺序并分别记录两个宿主导出标记。
  - 使用归档的真实 0.3.3，在 Writer/PPT 完整冷启动后旧授权仍可识别的状态下，实机证明最小迁移页能从两个宿主的 `_file://` 上下文读取且只读取四个旧键；不得打开旧授权 Web 面板，不得直接读取、复制、解析或修改 WPS LevelDB。
  - Ribbon 只显示迁移状态和重新导出；不得加载旧提醒、授权入口、函数入口、任务窗格、Web 页面或助手。
  - 增加导出合并、损坏、异机、无授权、单宿主和零回环测试。
  - **G2 硬门禁：Writer 或 PPT 任一宿主无法在上述约束下读取并导出旧状态，停止任务 9—18，保留 0.3.3 并提交迁移不可达证据。**
  - _依赖：任务 1 的 G0、任务 2、3、4_
  - _需求：R1、R6、R9_

- [ ] 9. 重构 0.4.0 白名单构建与发布清单
  - 将 `package.json` 主版本升级为 0.4.0，并让 Writer/PPT 仅按设计中的源文件白名单复制；先验证源集合，再生成全新的 `PAYLOAD-MANIFEST.json` 并复验最终集合。
  - 从 `scripts/build-offline.ps1` 删除 EditorHost 编译/签名/复制、taskpane 版本注入、版本化 Web 页面和 `runtimeHost` 清单。
  - 生成 `schemaVersion: 3`、`BUILD-INFO.json`、`SUPPORTED-WPS-BUILDS.json` 与不自哈希的 `INSTALLER-MANIFEST.json`；支持构建号只能来自任务 2 的通过记录。
  - 更新 `scripts/payload-integrity.ps1` 与 `scripts/validate-commercial-release.ps1`，对额外文件、禁止字符串、空构建白名单、错误哈希和 Web/runtime 回归执行失败测试。
  - Commercial 构建不得在 release 目录留下可直接运行安装脚本的 ZIP；当前交付只能声明签名 bootstrapper EXE。
  - _依赖：任务 2、3、7_
  - _需求：R1、R8、R9_

- [ ] 10. 实现从启动即提权的签名安装 bootstrapper
  - 新增 `installer/Bootstrapper.cs`、`requireAdministrator` manifest 和构建资源流程；顶层 EXE 是唯一允许的安装二进制，不进入 Writer/PPT payload。
  - 实现 WinVerifyTrust、自身发布者指纹固定、内存 `INSTALLER-MANIFEST.json` 信任锚、管理员专属解包目录 ACL、精确根白名单和解包哈希复验。
  - 只有完成签名、ACL 和哈希验证后，bootstrapper 才能以固定系统 PowerShell 路径和固定参数启动唯一安装脚本；安装脚本删除自提权与 `Start-Process` 路径。
  - 增加签名无效、发布者不符、manifest/脚本同时替换、额外文件、ACL 异常和哈希不符的失败测试。
  - _依赖：任务 9_
  - _需求：R1、R8、R9_

- [ ] 11. 重写安全安装、升级、恢复、卸载和已安装验证事务
  - 在 `scripts/offline-install.ps1` 中实现多来源 WPS 枚举、Writer/PPT 四版本字段白名单匹配，以及所有状态修改前的完整 SemVer 2.0.0 解析和禁止降级门禁。
  - WPS 全部关闭后重新验证迁移导出，冻结 SHA-256，并在旧注册/目录不变时按同一 UTF-8 + Base64 ASCII 封套与 12,000/16,384 bytes 双上限预写、回读 A/B 二进制双槽；失败立即保留旧版。
  - 新增 JavaScript/PowerShell 共用的授权文件黄金向量，固定字段顺序、`\u001F` 连接符、7 位大写 Base36 checksum、激活码签名与日期语义；两端必须对每个向量产生完全一致结果。
  - 实现 `Prepared → PayloadReady → SwitchingRegistration → RegistrationSwitched → Verified → Committed → CleanupComplete` 日志，以及 Writer/PPT 每个注册文件的子状态。
  - 对 `publish.xml/authaddin.json` 只做本产品节点 compare-and-swap 和条件反向补丁；恢复必须按两端实际 old/new/other 对账，确认无注册引用后才能删除新载荷。
  - 仅在 `Committed` 后清理严格低于 0.4.0 的产品目录，拒绝重解析点、冲突目录和未来版本；只按完整路径停止 0.3.x 遗留助手。
  - 更新卸载器以保留机器码/授权状态并保护其他插件；`validate-installed` 只报告未完成事务，不擅自恢复。
  - 扩充事务测试，覆盖两个注册文件之间的每个断电点、并发修改、SemVer prerelease/build metadata、失败回滚和幂等恢复。
  - **G3 硬门禁：JavaScript 与 PowerShell 任一共享向量不一致，安装器不得预写 A/B 双槽，不得进入迁移升级或实机安装。**
  - _依赖：任务 4、9、10_
  - _需求：R1、R6、R8、R9_

- [ ] 12. 构建可交付、可修复、可回滚的迁移桥安装包
  - 为 `0.3.4-migration` 使用独立签名 bootstrapper、release manifest、checksum、精确文件名和用途标识，不与 0.4.0 正式载荷混包。
  - 旁路安装桥目录并仅切换本产品注册节点，始终原地保留 0.3.3；维护 `migration-bridge-journal.json` 和旧目录哈希。
  - 让同一迁移安装器支持“安装/修复迁移桥”和“验证后恢复 0.3.3”，失败时不得留下悬空或双宿主不一致注册。
  - 让 0.4.0 只读预检在缺少导出时显示迁移包精确名称和 SHA-256；所有门禁失败仍可恢复 0.3.3。
  - 增加桥安装、重复运行、单端失败、导出失败、0.4 门禁失败和回滚测试。
  - 对迁移桥旁路安装、修复、恢复 0.3.3、注册切换和事务日志逐断点注入失败，证明重复运行可幂等恢复、旧目录始终在原位且其他插件节点不变。
  - **G4 硬门禁：迁移桥尚未通过安装、修复、失败恢复和 0.3.3 回滚闭环时，不得开始任务 15 的正式升级测试，也不得清理任何旧版本目录。**
  - _依赖：任务 8、10、11_
  - _需求：R1、R6、R8、R9_

## 阶段 D：自动化回归与实机硬门禁

- [ ] 13. 完成全量自动化回归与安装包结构负向测试
  - 用统一入口运行授权、Ribbon、函数、文档事务、PPT 避让、迁移、构建、bootstrapper、安装事务、卸载和已安装校验测试。
  - 对生产源码、staging、嵌入资源解包结果和模拟安装目录执行精确白名单、JavaScript/PowerShell 语法、UTF-8、URL allowlist 与零回环扫描。
  - 验证发布清单不存在 `runtimeHost`，`signing.binaries` 只含顶层安装器和同哈希原生桥接 DLL，Writer/PPT 文件集合精确匹配，禁止文件/API 的每个负向夹具都会失败。
  - 构建 Internal 包并解包复验，确认没有 runtime、taskpane、Web 页面、二维码或 payload 内 EXE；唯一允许的 DLL 是路径、架构、导出表和哈希均匹配的 `native/HsmMathNativeBridge.dll`。
  - _依赖：任务 3—12_
  - _需求：R1—R9_

- [ ] 14. 更新安装、迁移、测试和交付文档
  - 重写 README：区分新装和 0.3.x 升级，说明 0.4 只读预检 → 精确迁移包 → Writer/PPT 导出 → 重跑 0.4 的流程。
  - 删除 localhost、动态端口、页面助手、Web 任务窗格、ZIP 直接安装和多二进制签名说明。
  - 保留离线激活码生成器说明，更新原生 Ribbon 授权入口、QQ `982303035`、微信 `qzt65631`、回滚和验证命令。
  - 记录 Internal 与 Commercial 的边界：没有可信代码签名证书时只能交付内部测试包，不能标记为商业发布。
  - _依赖：任务 9—13_
  - _需求：R1、R6、R8、R9_

- [ ] 15. 执行真实 0.3.3 → 0.3.4-migration → 0.4.0 授权迁移硬门禁
  - 在真实 Writer/PPT 分别建立完整冷启动后仍可识别的 0.3.3 有效授权，安装迁移桥并完成双宿主导出，再由 0.4.0 安装器预写/回读 A/B 双槽。
  - 验证 Writer 激活与 PPT 激活两种来源、无授权但保留试用起始日、损坏导出、异机导出、单宿主未导出、WPS 关闭窗口内改写和 A/B 写入失败。
  - 失败用迁移桥安装器恢复 0.3.3，确认原目录、注册和授权仍可用；全程不得复制、解析或修改 WPS 全局 Local Storage/LevelDB。
  - 把脱敏证据写入 `specs/scheme-c-native-function-editor/evidence/migration-acceptance.md`。
  - **硬门禁：任一有效旧授权需要重新输入、失败时不能恢复旧版或出现 localhost，停止任务 17—18。**
  - _依赖：任务 12、13、14_
  - _需求：R1、R6、R9_

- [ ] 16. 执行 Writer/PPT 原生功能和零网络实机验收
  - 在任务 2 已验证构建上安装 Internal 0.4.0；Writer/PPT 各连续至少 10 次执行函数新建、取消、插入和编辑，检查多函数、范围、四显示项、旧元数据回填和 PPT 避让。
  - 验证同一“高中数学”Tab、授权状态、机器码、到期信息、原生授权面板取消/空输入/错误/正确激活码、失败不覆盖、DLL 敏感缓冲清零与无日志草稿、A/B 二进制封套跨宿主一致性、复制 QQ 和复制微信 `qzt65631`。
  - 从执行插件动作前到结束后连续采集进程创建/退出及 TCP 连接/监听事件，覆盖 WPS 重启、新 PID 和子进程；确认没有外部程序警告、辅助进程、监听端口或新增回环连接。
  - 验证未验证 WPS 构建在任何插件状态修改前被拒绝，兼容诊断 Ribbon 不会混入正式安装。
  - 把脱敏证据写入 `specs/scheme-c-native-function-editor/evidence/wps-acceptance.md`。
  - **硬门禁：出现安全警告、辅助进程、短时/持续回环连接、Tab 空白或事务式更新丢失旧图，停止商业发布。**
  - _依赖：任务 13、15_
  - _需求：R1—R9_

## 阶段 E：商业构建与交付

- [ ] 17. 生成并验证 Commercial 0.4.0 与独立迁移发布
  - 仅在任务 2、15、16 全部通过且已提供可信代码签名证书时，生成签名 bootstrapper、时间戳、checksums、release manifest 和探针/验证摘要。
  - 确认 `validatedWpsBuilds` 非空且与探针记录一致，bootstrapper 的 `requireAdministrator`、WinVerifyTrust、发布者指纹、内存 manifest 和解包资源全部复验通过。
  - 确认 0.4.0 的 `installableArtifacts` 只有一个签名 EXE；迁移桥拥有独立签名 EXE和独立清单，商业 release 目录不存在可直接安装的 ZIP。
  - 解包最终 EXE 再次执行根白名单、payload 白名单、零回环、签名和安装后模拟验证。
  - _依赖：任务 14、15、16；外部依赖：可信代码签名证书_
  - _需求：R1、R6、R8、R9_

- [ ] 18. 完成最终安装、回归复测与交付清单
  - 使用最终签名包在当前机器执行一次新装或受控升级，复跑关键 Writer/PPT、授权、迁移、卸载保留状态和零网络检查。
  - 核对安装目录、`publish.xml/authaddin.json`、A/B 状态和任务日志达到 `CleanupComplete`，其他 WPS 插件未变化，历史 runtime/Web 残留已安全清除。
  - 汇总最终文件名、SHA-256、支持的 WPS 构建号、安装/升级/回滚步骤、已通过测试和未覆盖边界，形成可交付验收记录。
  - 将本任务清单全部完成项勾选，并把最终状态改为“已完成”。
  - _依赖：任务 17_
  - _需求：R1—R9_

## 确认记录

- 技术设计已于 2026-07-16 获得用户确认。
- 本任务清单已于 2026-07-16 获得用户确认，现按依赖与硬门禁顺序实施。
- 用户于 2026-07-17 在 `InputBox` 双宿主实机门禁失败后选择方案一；任务 2、5、6、7、9、13、16、17 已按“WPS `jside FFI` + 签名 x86 进程内原生 DLL + UTF-8/Base64 二进制 A/B 状态”修订，旧失败证据保留，新门禁通过前不启动任务 4—18。
