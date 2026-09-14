# WPS 高中数学工具插件项目交接指南

## 1. 当前快照

- 项目名称：`WpsHighSchoolMath`
- 当前版本：`0.8.1`
- 支持宿主：WPS Writer、WPS Presentation
- 历史实机基线：Windows 11、Windows PowerShell 5.1、Node.js `24.14.1`、WPS Office `12.1.0.26895`。0.8.0 的自动化和浏览器验证见 `specs/refactor-upgrade-2026-09/implementation-0.8.md`；新版尚需 Writer/PPT 实机验收。
- 当前发布状态：内部测试包，`Internal / internal-test / pending-certificate`
- 商业发布状态：尚未取得并使用可信 Authenticode 代码签名证书，当前安装包不能作为已签名商业包宣传
- 在线更新状态：尚未实现；当前仍通过完整离线安装包升级

插件不依赖业务服务器、数据库、账号系统或本地 HTTP 服务。授权、机器码、试用状态都保存在客户电脑本地。

0.8.1 修复长绘图页的操作入口：设置区域独立滚动，预览、插入/更新按钮和状态提示始终在底部显示。独立绘图页和共享工具窗格使用同一布局，切到授权页时操作栏随绘图页隐藏。本轮改动位于 `codex/plot-action-bar`，记录见 `specs/refactor-upgrade-2026-09/fix-actions-0.8.1.md`。

0.8.0 新增数值交点/零点搜索、指定位置的有限斜率切线、随参数重算、图片及收藏回读和分析对象保护。结果明确标记近似，不承诺搜索全部交点。分析设置使用 V4 图片元数据和 V2 收藏容器，继续读取旧格式。

## 2. 接手后先运行

在项目根目录打开 PowerShell：

```powershell
node --version
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-offline.ps1 -BuildMode Internal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-tests.ps1
```

发码工具需要固定 Node.js `24.14.1`，并且当前 Windows 用户必须持有正确的发行私钥：

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-license-tool.ps1
```

构建结果位于 `release\`。安装测试前保存并关闭全部 WPS Writer 和 WPS Presentation 文档，不要强制结束可能包含未保存文档的 WPS 进程。

## 3. 目录和入口

| 路径 | 用途 |
| --- | --- |
| `index.html`、`main.js`、`manifest.xml`、`ribbon.xml` | Writer 入口与功能区 |
| `ppt/` | Presentation 独立入口与功能区 |
| `js/` | Ribbon、授权、函数图像、试卷和宿主 API 逻辑 |
| `ui/` | 函数绘图、授权中心和工具中心任务窗格 |
| `assets/` | 微信二维码等运行时资源 |
| `scripts/` | 构建、安装、卸载、发码、签名和发布验证 |
| `tests/` | Node.js 与 PowerShell 自动化测试、兼容性夹具 |
| `migration/` | 旧授权迁移兼容代码 |
| `specs/` | 已实施方案、被否决方案和验收证据 |
| `probes/` | WPS 原生能力验证探针，不进入客户正式载荷 |
| `release/` | 构建输出，不作为源码提交 |

生产载荷由 `scripts/build-offline.ps1` 的白名单决定。修改文件布局后，必须同步检查该脚本、`scripts/zero-loopback-policy.js`、载荷完整性测试和安装后验证。

## 4. 必须保留的兼容约束

- Writer 与 Presentation 是两个独立宿主入口，不要因为代码相似而强行合并启动链。
- 已验证的 Writer 启动顺序是 `index.html -> main.js -> document.write(...) -> js/symbols.js -> js/ribbon.js`。旧版 WPS 对异步加载敏感。
- 任务窗格使用安装包内的版本化 HTML，不运行 localhost，不启动辅助网页进程。
- `migration/0.3.4/js/license-legacy-readonly.js` 及 `tests/fixtures/license-legacy-0.3.3/` 用于旧授权兼容验证，不应删除。
- `assets/wechat-qr.jpg` 是当前授权中心实际资源；删除或替换资源时同步更新测试、构建白名单和零回环策略。

## 5. 授权规则

- 授权格式：`HSM2`
- 签名算法：Ed25519
- 公钥指纹：`369DA249CAD36B33`
- 套餐：月卡、季卡、年卡、永久版
- 试用：首次加载开始连续 14 天全功能试用，第 15 天起仅 Writer 试卷功能继续可用，其他功能需要激活
- 普通卸载和重装保留机器码、试用起始时间和激活状态
- Writer 与 Presentation 必须共享同一台电脑的稳定机器码和授权状态

发行私钥默认位置：

```text
%APPDATA%\WpsHighSchoolMathIssuer\ed25519-private.pem
```

私钥不属于源码，不得放入 Git、客户安装包、网盘公开链接或普通聊天附件。没有项目所有者明确授权，不要运行 `scripts/license-keygen.js` 生成新密钥；替换公钥会导致现有插件、现有发码工具和既有授权码之间失去兼容性。

发码历史默认位于：

```text
%APPDATA%\WpsHighSchoolMathIssuer\issuance-history.csv
```

交接源码包不包含私钥和真实发码历史。确需让接手人承担正式发码工作时，由项目所有者另行使用加密介质移交私钥，并当面核对公钥指纹。

只有在以下内容变化时才需要同步升级发码工具：签名密钥、`HSM2` 格式、签名载荷、套餐有效期算法或发码工具自身逻辑。普通界面或功能更新不要求更换发码工具。

## 6. 构建和发布

内部测试包：

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-offline.ps1 -BuildMode Internal
```

正式商业包必须提供可信 Authenticode 证书、时间戳服务和 `signtool.exe`：

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-offline.ps1 `
  -BuildMode Commercial `
  -SignToolPath "C:\path\to\signtool.exe" `
  -CertificateThumbprint "CERTIFICATE_THUMBPRINT" `
  -TimestampUrl "https://timestamp.example.com"
```

每次发布必须：

1. 更新 `package.json` 版本号。
2. 先构建当前版本，再运行完整测试。
3. 检查 EXE、ZIP、`checksums.sha256` 和 `release-manifest.json` 版本一致。
4. 对外发布时确认 Authenticode 状态为 `Valid`，清单为 `Commercial`，不能把 `pending-certificate` 当作正式签名。
5. 在 Writer 与 Presentation 中分别完成安装、信任、功能、授权、升级和卸载回归。
6. 验证升级不会改变 `%APPDATA%\WpsHighSchoolMath` 中的授权状态。

## 7. 测试入口

统一测试：

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-tests.ps1
```

发布校验：

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-commercial-release.ps1
```

已安装状态校验：

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-installed.ps1
```

`run-tests.ps1` 中包含的安装状态测试依赖当前版本的展开发布目录。因此拿到纯源码后应先运行 `build-offline.ps1`，再运行统一测试。

## 8. 当前商业化待办

1. 注册并稳定使用经营主体、域名和国内更新文件存储。
2. 准备隐私政策、用户协议、收费及退款规则、永久版更新范围和安全维护期限。
3. 购买可信 Windows 代码签名证书，并把私钥与授权签名私钥分开管理。
4. 实现在线更新时坚持“自动检查、用户确认下载和安装”，不得静默升级。
5. 更新清单使用独立签名密钥；安装包同时验证 HTTPS、清单签名、SHA-256 和 Authenticode 发布者。
6. 在线检查不得上传机器码、激活码、文档内容或不必要的设备信息。
7. 产品对外说明应注明这是独立第三方插件，不得暗示为金山办公官方产品。

## 9. Git 状态说明

2026-09-13 已为原工作目录创建首个 0.5.3 源码基线提交，并从该提交建立 `codex/function-plot-upgrade` 分支。基线仅代表当日文件快照，不代表此前的真实开发历史；本地备份位于 `.tmp/baseline-0.5.3-before-plot-upgrade.zip`。历史临时对象未清理。

## 10. 接手验收清单

- [ ] 能读取本文件、`README.md` 和 `CLAUDE.md`
- [ ] `node --version` 与固定发码运行时一致
- [ ] 内部安装包构建成功
- [ ] `scripts/run-tests.ps1` 全部通过
- [ ] Writer 与 Presentation 均显示一个“高中数学”页签
- [ ] 机器码跨新建文档、重启 WPS 保持稳定
- [ ] 试用、月卡、季卡、年卡、永久版和过期限制符合规则
- [ ] 当前安装包签名状态被准确标记，没有误称正式商业签名
- [ ] 私钥和发码历史通过独立安全渠道接收或明确仍由原所有者保管
