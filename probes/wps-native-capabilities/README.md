# WPS 方案甲原生能力探针

该探针只用于方案甲的 WPS 实机硬门禁，不属于正式插件、迁移包或商业载荷。Writer 与 Presentation 使用独立插件名和目录；安装、验证和卸载脚本不会修改正式插件节点。

## 自动检查

```powershell
node .\tests\wps-native-capability-probe.logic.test.js
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tests\wps-native-capability-probe.test.ps1
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tests\wps-native-capability-evidence.test.ps1
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tests\wps-native-capability-monitor.test.ps1
```

## 实机顺序

1. 完整退出 Writer、Presentation 及残留的 `wps.exe` / `wpp.exe`。
2. 生成唯一 `runId`，启动真实的 50ms 进程与 TCP 监测。监测器写出 ready 文件后，才可继续安装和 PrepareRun。不要手写或合成监测样本。
3. 安装完整探针，并用同一个 `runId` 与 `startedAt` 准备本轮状态。PrepareRun 会清除旧宿主记录和旧跨宿主标记，写入 `HSMB64:1:` UTF-8/Base64 run-context：

   ```powershell
   $runId = [Guid]::NewGuid().ToString("D")
   $startedAt = [DateTimeOffset]::UtcNow.ToString("o")

   powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\probes\wps-native-capabilities\scripts\run-native-capability-probe.ps1 -Action InstallFull

   powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\probes\wps-native-capabilities\scripts\run-native-capability-probe.ps1 -Action PrepareRun -RunId $runId -StartedAt $startedAt
   ```

4. 冷启动 Writer，打开“Writer 原生能力探针”Tab，点击“Tab 显示正常”。
5. 按按钮状态机完成 7 次原生输入：空默认值不编辑直接确定、取消、普通完整粘贴、保留前后各两个空格、33 字符最大合法格式向量、空输入确定、无效向量。记录只能包含用例名、入口、参数形式、返回类型/长度、取消哨兵和布尔结果，不得包含输入原文。
6. 点击“运行二进制共享文件探针”，随后退出 Writer。
7. 冷启动 Presentation，重复第 4—6 步。PPT 文件状态应读到 Writer 的本轮标记。
8. 再冷启动 Writer，仅点击一次“运行二进制共享文件探针”，使 Writer 读到 PPT 的本轮标记；随后退出。
9. 创建监测 stop-signal，等待监测器正常结束并写出原始 `samples[]`。监测文件必须完整覆盖本轮、实际最大间隔不超过 100ms，且辅助进程、监听端口、回环连接和丢样均为零。
10. 使用同一个 `runId`、`startedAt` 和监测文件运行 `record-native-capability-result.ps1`。记录器仍会校验真实 WPS 可执行文件、安装载荷哈希、当前轮宿主记录与连续监测；任何缺项都会写失败证据并返回退出码 1。
11. 完整退出 WPS 后卸载探针；可用 `-KeepProbeRecords` 保留记录复核。

## 严格判定

Ribbon 门禁不再使用 `editBox`。Writer 与 Presentation 必须在同一 run 中分别满足：

- add-in 与 Tab 可见；
- WPS 原生模态输入框调用至少 7 次，并完成冷启动与重启两份当前 run 会话；
- 空默认值只有在“不编辑直接确定”精确返回空字符串后才算通过；
- 取消至少 1 次且已验证轮数、已接受挑战数均不改变；
- 普通粘贴、保留前后空白、33 字符最大长度、空输入与无效输入不覆盖原状态均通过；
- 输入来源必须是 `global.InputBox` 或 `Application.InputBox`，浏览器 `prompt`、HTML 输入框和 Web 对话框不得计入通过。

文件门禁只接受完整 AppData 绝对路径上的 `writeAsBinaryString(path,data)` 与 `readAsBinaryString(path)`。所有文本先由 ES5 代码进行严格 UTF-8 编解码，再放入 Base64 二进制信封。两宿主必须通过 UTF-8/Base64 回读、覆盖截断、1024/1025 字符读取返回类型分支、12,000 bytes 原始数据通过与 12,001 bytes 写前拒绝、16,384 bytes 物理封套边界与超限写前/读后拒绝、非法前缀/Base64/UTF-8 拒绝、A/B revision、单槽损坏恢复、损坏槽重写以及双向跨宿主本轮标记。

`writeFileString/readFileString` 与 `WriteFile/ReadFile` 只允许在正式二进制接口失败后运送失败诊断记录。只要本轮尝试或使用过旧传输，`legacyDiagnosticAttempted` / `legacyDiagnosticTransport` 就会让整体硬门禁失败；旧接口永远不能贡献任何正式通过项。

兼容 Ribbon 只用于恢复 Tab 可见性和显示联系方式，不参与硬门禁，也不能进入商业载荷。联系方式微信号：`qzt65631`。
