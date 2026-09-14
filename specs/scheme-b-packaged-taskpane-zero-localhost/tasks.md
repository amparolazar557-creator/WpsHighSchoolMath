# 方案 B 实施任务清单

状态：已完成（2026-07-18）  
对应需求：[requirements.md](./requirements.md)  
对应设计：[design.md](./design.md)

- [x] 1. 保留方案一失败证据并建立方案 B 独立规格
  - 不改写 FFI、NativeX、COM 和旧 InputBox 失败记录。
  - 明确允许包内 Web 任务窗格，继续禁止 localhost 与外部辅助 EXE。
  - _需求：R1、R2_

- [x] 2. 建立 Writer/PPT 包内静态页面硬门禁
  - 制作不进入商业载荷的隔离双宿主探针。
  - 验证本地页面可见、WPS API 可访问、PluginStorage ready token、关闭与重开。
  - 验证没有外部进程、监听器和新增回环连接。
  - **G1：任一宿主失败时停止正式载荷切换，保留 0.3.3 并记录证据。**
  - 证据：[g1-packaged-taskpane-gate-2026-07-18.md](./g1-packaged-taskpane-gate-2026-07-18.md)
  - _需求：R1、R2_

- [x] 3. 重构共享任务窗格管理器
  - 新增 `openPackaged()` 白名单映射与本地根校验。
  - 删除端口选择、HTTP 健康检查、ShellExecute、EditorHost 和回环 ready 路径。
  - 保留 token 握手、缓存清理、重建一次与单次失败回调。
  - _依赖：任务 2 G1_
  - _需求：R1、R2_

- [x] 4. 接入函数编辑器和授权中心
  - Writer/PPT 函数入口改用包内任务窗格。
  - 授权中心改用包内任务窗格，增加微信号 `qzt65631` 展示和复制。
  - 保留同一 Ribbon、函数图像事务和无网络快捷函数降级。
  - _依赖：任务 3_
  - _需求：R3、R4、R5_

- [x] 5. 删除正式 localhost/EditorHost 载荷
  - 从源码白名单、构建、安装、卸载、清单和校验删除 runtime 与回环逻辑。
  - 升级路径仅保留停止并清理旧 EditorHost。
  - 更新零网络策略，允许受限 `CreateTaskPane`，继续拒绝网络与外部程序 API。
  - _依赖：任务 4_
  - _需求：R2、R6_

- [x] 6. 更新并通过自动化测试
  - 替换旧回环助手测试为包内 URL、ready、白名单与负向网络测试。
  - 运行 Node、PowerShell、语法、UTF-8、结构、source/staging/installed 扫描。
  - 构建 0.4.0 安装包并复验解包载荷。
  - _依赖：任务 5_
  - _需求：R1—R6_

- [x] 7. 安装并完成 Writer/PPT 实机验收
  - 冷启动验证同一 Ribbon、函数编辑器和授权中心。
  - 验证复制机器码、粘贴激活码、到期状态、QQ/微信号。
  - 验证函数预览、插入、重新编辑和 PPT 放置。
  - 连续采样进程与 TCP，证明无助手、无监听、无新增回环连接。
  - 实机、安装后校验、精确 DOM/剪贴板测试与函数文档事务测试共同通过。
  - 证据：[acceptance-0.4.0-2026-07-18.md](./acceptance-0.4.0-2026-07-18.md)
  - _依赖：任务 6_
  - _需求：R1—R6_
