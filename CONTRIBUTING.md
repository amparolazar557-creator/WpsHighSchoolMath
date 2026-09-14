# 参与贡献

请优先提交能说明具体教学问题的小范围改进。

## 报告问题

请提供 Windows 版本、WPS 版本与位数、使用文字还是演示、插件版本，以及复现步骤。

绘图问题请同时提供表达式、坐标范围、定义域和分析设置，说明预期图像与实际差异。使用不含学生、客户或授权信息的示例文档与截图。

## 修改与验证

1. 阅读根目录 CLAUDE.md 中的架构与验证约束。
2. 在独立分支修改。涉及数学计算、文档写入或安装行为时，增加能验证实际行为的回归案例。
3. 从项目根目录构建，再运行完整检查：

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-offline.ps1 -BuildMode Internal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-tests.ps1
```

4. 涉及 WPS 行为时，分别检查文字与演示，并在提交说明中区分模拟测试、浏览器检查和实际 WPS 验证。
5. 提交说明应包含问题、修改后的行为、验证方式与剩余限制。

文档或配图更新应检查链接、图片与手机宽度下的可读性，无需为纯文案添加重复测试。配图示例由 docs/examples/render-gallery.cjs 生成；页面截图必须标注来源，不能将设计示意图称作真实宿主截图。

## 请保留的约束

- 插件保持离线运行，不引入业务服务器或本地页面服务。
- 使用安全表达式解析器，不执行用户表达式中的 JavaScript。
- 插入新图片并验证成功后，才能移除旧图；保留旧版绘图配置的读取能力。
- 不更换现有发行公钥，不上传私钥或真实发码记录。
- 第三方组件需保留许可；提交的项目代码采用根目录 LICENSE 中的 MIT 许可。
