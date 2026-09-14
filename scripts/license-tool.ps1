$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[Windows.Forms.Application]::EnableVisualStyles()

$script:statusData = $null
$script:lastCode = ""
$script:plans = @("M", "Q", "Y", "P")

function Invoke-LicenseBackend {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [hashtable]$Environment = @{}
    )

    $nodePath = Join-Path $PSScriptRoot "node.exe"
    if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
        $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
        if (-not $nodeCommand) {
            throw "发码运行时缺失，请重新构建或重新解压发码工具。"
        }
        $nodePath = $nodeCommand.Source
    }
    $cliPath = Join-Path $PSScriptRoot "license-tool-cli.js"
    if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
        throw "发码程序文件缺失：$cliPath"
    }

    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nodePath
    $startInfo.Arguments = "`"$cliPath`" $Command"
    $startInfo.WorkingDirectory = $PSScriptRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = [Text.Encoding]::UTF8
    $startInfo.StandardErrorEncoding = [Text.Encoding]::UTF8
    $startInfo.EnvironmentVariables["NODE_NO_WARNINGS"] = "1"
    foreach ($entry in $Environment.GetEnumerator()) {
        $startInfo.EnvironmentVariables[[string]$entry.Key] = [string]$entry.Value
    }

    $process = New-Object Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        $data = $null
        if (-not [string]::IsNullOrWhiteSpace($stdout)) {
            try { $data = $stdout | ConvertFrom-Json } catch { }
        }
        if ($process.ExitCode -ne 0) {
            if ($data -and $data.error) { throw [string]$data.error }
            if (-not [string]::IsNullOrWhiteSpace($stderr)) { throw $stderr.Trim() }
            throw "发码程序执行失败，退出码：$($process.ExitCode)"
        }
        if (-not $data -or -not $data.ok) {
            throw "发码程序未返回有效结果。"
        }
        return $data
    } finally {
        $process.Dispose()
    }
}

function New-Label {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][int]$X,
        [Parameter(Mandatory = $true)][int]$Y,
        [Drawing.Font]$Font,
        [Drawing.Color]$Color = [Drawing.Color]::FromArgb(58, 62, 65)
    )
    $label = New-Object Windows.Forms.Label
    $label.Text = $Text
    $label.Location = New-Object Drawing.Point($X, $Y)
    $label.AutoSize = $true
    $label.ForeColor = $Color
    if ($Font) { $label.Font = $Font }
    return $label
}

function Set-ButtonStyle {
    param(
        [Parameter(Mandatory = $true)][Windows.Forms.Button]$Button,
        [Drawing.Color]$BackColor,
        [Drawing.Color]$ForeColor,
        [Drawing.Color]$BorderColor
    )
    $Button.FlatStyle = [Windows.Forms.FlatStyle]::Flat
    $Button.FlatAppearance.BorderSize = 1
    $Button.FlatAppearance.BorderColor = $BorderColor
    $Button.BackColor = $BackColor
    $Button.ForeColor = $ForeColor
    $Button.Cursor = [Windows.Forms.Cursors]::Hand
}

$form = New-Object Windows.Forms.Form
$form.Text = "高中数学插件发码工具"
$form.StartPosition = [Windows.Forms.FormStartPosition]::CenterScreen
$form.ClientSize = New-Object Drawing.Size(760, 640)
$form.MinimumSize = New-Object Drawing.Size(776, 679)
$form.MaximumSize = New-Object Drawing.Size(776, 679)
$form.MaximizeBox = $false
$form.BackColor = [Drawing.Color]::FromArgb(247, 248, 248)
$form.AutoScaleMode = [Windows.Forms.AutoScaleMode]::Dpi
$form.Font = New-Object Drawing.Font("Microsoft YaHei UI", 10)

$header = New-Object Windows.Forms.Panel
$header.Dock = [Windows.Forms.DockStyle]::Top
$header.Height = 84
$header.BackColor = [Drawing.Color]::FromArgb(35, 40, 42)
$form.Controls.Add($header)

$titleFont = New-Object Drawing.Font("Microsoft YaHei UI", 18, [Drawing.FontStyle]::Bold)
$subtitleFont = New-Object Drawing.Font("Microsoft YaHei UI", 9)
$header.Controls.Add((New-Label -Text "高中数学插件发码工具" -X 28 -Y 16 -Font $titleFont -Color ([Drawing.Color]::White)))
$header.Controls.Add((New-Label -Text "离线 Ed25519 授权签名" -X 30 -Y 53 -Font $subtitleFont -Color ([Drawing.Color]::FromArgb(190, 201, 200))))

$keyPanel = New-Object Windows.Forms.Panel
$keyPanel.Location = New-Object Drawing.Point(28, 102)
$keyPanel.Size = New-Object Drawing.Size(704, 56)
$keyPanel.BackColor = [Drawing.Color]::FromArgb(235, 239, 238)
$form.Controls.Add($keyPanel)

$keyIndicator = New-Label -Text "●" -X 14 -Y 15 -Font (New-Object Drawing.Font("Microsoft YaHei UI", 12)) -Color ([Drawing.Color]::FromArgb(133, 139, 138))
$keyPanel.Controls.Add($keyIndicator)
$keyStatusLabel = New-Label -Text "正在检查发码私钥..." -X 40 -Y 10 -Font (New-Object Drawing.Font("Microsoft YaHei UI", 10, [Drawing.FontStyle]::Bold))
$keyPanel.Controls.Add($keyStatusLabel)
$fingerprintLabel = New-Label -Text "公钥指纹：检查中" -X 40 -Y 33 -Font $subtitleFont -Color ([Drawing.Color]::FromArgb(92, 99, 98))
$keyPanel.Controls.Add($fingerprintLabel)

$fieldFont = New-Object Drawing.Font("Microsoft YaHei UI", 9, [Drawing.FontStyle]::Bold)
$form.Controls.Add((New-Label -Text "客户机器码" -X 28 -Y 178 -Font $fieldFont))
$machineBox = New-Object Windows.Forms.TextBox
$machineBox.Location = New-Object Drawing.Point(28, 202)
$machineBox.Size = New-Object Drawing.Size(704, 36)
$machineBox.Font = New-Object Drawing.Font("Consolas", 13)
$machineBox.CharacterCasing = [Windows.Forms.CharacterCasing]::Upper
$machineBox.MaxLength = 40
$form.Controls.Add($machineBox)

$form.Controls.Add((New-Label -Text "授权类型" -X 28 -Y 258 -Font $fieldFont))
$planBox = New-Object Windows.Forms.ComboBox
$planBox.Location = New-Object Drawing.Point(28, 282)
$planBox.Size = New-Object Drawing.Size(210, 34)
$planBox.DropDownStyle = [Windows.Forms.ComboBoxStyle]::DropDownList
[void]$planBox.Items.Add("月卡（1个月）")
[void]$planBox.Items.Add("季卡（3个月）")
[void]$planBox.Items.Add("年卡（12个月）")
[void]$planBox.Items.Add("永久版")
$planBox.SelectedIndex = 0
$form.Controls.Add($planBox)

$form.Controls.Add((New-Label -Text "起始/续费日期" -X 264 -Y 258 -Font $fieldFont))
$startDatePicker = New-Object Windows.Forms.DateTimePicker
$startDatePicker.Location = New-Object Drawing.Point(264, 282)
$startDatePicker.Size = New-Object Drawing.Size(210, 34)
$startDatePicker.Format = [Windows.Forms.DateTimePickerFormat]::Custom
$startDatePicker.CustomFormat = "yyyy-MM-dd"
$startDatePicker.Value = [DateTime]::Today
$form.Controls.Add($startDatePicker)

$form.Controls.Add((New-Label -Text "预计到期" -X 500 -Y 258 -Font $fieldFont))
$expiryValue = New-Object Windows.Forms.TextBox
$expiryValue.Location = New-Object Drawing.Point(500, 282)
$expiryValue.Size = New-Object Drawing.Size(232, 34)
$expiryValue.ReadOnly = $true
$expiryValue.BackColor = [Drawing.Color]::White
$expiryValue.TextAlign = [Windows.Forms.HorizontalAlignment]::Center
$form.Controls.Add($expiryValue)

$generateButton = New-Object Windows.Forms.Button
$generateButton.Text = "生成激活码"
$generateButton.Location = New-Object Drawing.Point(28, 340)
$generateButton.Size = New-Object Drawing.Size(704, 46)
$generateButton.Font = New-Object Drawing.Font("Microsoft YaHei UI", 11, [Drawing.FontStyle]::Bold)
Set-ButtonStyle -Button $generateButton -BackColor ([Drawing.Color]::FromArgb(30, 116, 88)) -ForeColor ([Drawing.Color]::White) -BorderColor ([Drawing.Color]::FromArgb(30, 116, 88))
$generateButton.Enabled = $false
$form.Controls.Add($generateButton)

$form.Controls.Add((New-Label -Text "激活码" -X 28 -Y 408 -Font $fieldFont))
$resultBox = New-Object Windows.Forms.TextBox
$resultBox.Location = New-Object Drawing.Point(28, 432)
$resultBox.Size = New-Object Drawing.Size(704, 82)
$resultBox.Multiline = $true
$resultBox.ReadOnly = $true
$resultBox.BackColor = [Drawing.Color]::White
$resultBox.Font = New-Object Drawing.Font("Consolas", 10)
$resultBox.ScrollBars = [Windows.Forms.ScrollBars]::Vertical
$resultBox.WordWrap = $true
$form.Controls.Add($resultBox)

$copyButton = New-Object Windows.Forms.Button
$copyButton.Text = "复制激活码"
$copyButton.Location = New-Object Drawing.Point(28, 534)
$copyButton.Size = New-Object Drawing.Size(150, 38)
$copyButton.Enabled = $false
Set-ButtonStyle -Button $copyButton -BackColor ([Drawing.Color]::White) -ForeColor ([Drawing.Color]::FromArgb(35, 40, 42)) -BorderColor ([Drawing.Color]::FromArgb(164, 171, 170))
$form.Controls.Add($copyButton)

$clearButton = New-Object Windows.Forms.Button
$clearButton.Text = "清空"
$clearButton.Location = New-Object Drawing.Point(188, 534)
$clearButton.Size = New-Object Drawing.Size(100, 38)
Set-ButtonStyle -Button $clearButton -BackColor ([Drawing.Color]::White) -ForeColor ([Drawing.Color]::FromArgb(35, 40, 42)) -BorderColor ([Drawing.Color]::FromArgb(164, 171, 170))
$form.Controls.Add($clearButton)

$historyButton = New-Object Windows.Forms.Button
$historyButton.Text = "打开发码记录"
$historyButton.Location = New-Object Drawing.Point(452, 534)
$historyButton.Size = New-Object Drawing.Size(130, 38)
Set-ButtonStyle -Button $historyButton -BackColor ([Drawing.Color]::White) -ForeColor ([Drawing.Color]::FromArgb(35, 40, 42)) -BorderColor ([Drawing.Color]::FromArgb(164, 171, 170))
$form.Controls.Add($historyButton)

$backupButton = New-Object Windows.Forms.Button
$backupButton.Text = "备份私钥"
$backupButton.Location = New-Object Drawing.Point(592, 534)
$backupButton.Size = New-Object Drawing.Size(140, 38)
Set-ButtonStyle -Button $backupButton -BackColor ([Drawing.Color]::FromArgb(255, 248, 232)) -ForeColor ([Drawing.Color]::FromArgb(117, 78, 10)) -BorderColor ([Drawing.Color]::FromArgb(211, 174, 98))
$backupButton.Enabled = $false
$form.Controls.Add($backupButton)

$statusStrip = New-Object Windows.Forms.StatusStrip
$statusStrip.SizingGrip = $false
$statusStrip.BackColor = [Drawing.Color]::FromArgb(235, 237, 237)
$statusText = New-Object Windows.Forms.ToolStripStatusLabel
$statusText.Spring = $true
$statusText.TextAlign = [Drawing.ContentAlignment]::MiddleLeft
$statusText.Text = "准备就绪"
[void]$statusStrip.Items.Add($statusText)
$form.Controls.Add($statusStrip)

$toolTip = New-Object Windows.Forms.ToolTip
$toolTip.SetToolTip($startDatePicker, "续费时可选择客户原授权到期日，让新周期从原到期日继续计算。")
$toolTip.SetToolTip($backupButton, "将私钥复制到安全位置。私钥不得发送给客户。")
$toolTip.SetToolTip($historyButton, "打开本机发码记录所在目录。")

function Set-StatusText {
    param([string]$Text, [bool]$IsError = $false)
    $statusText.Text = $Text
    $statusText.ForeColor = if ($IsError) { [Drawing.Color]::FromArgb(170, 48, 48) } else { [Drawing.Color]::FromArgb(51, 61, 59) }
}

function Update-ExpiryPreview {
    $index = $planBox.SelectedIndex
    if ($index -eq 3) {
        $startDatePicker.Enabled = $false
        $expiryValue.Text = "永久有效"
        return
    }
    $startDatePicker.Enabled = $true
    $months = @(1, 3, 12)[$index]
    $expiryValue.Text = $startDatePicker.Value.Date.AddMonths($months).ToString("yyyy-MM-dd")
}

function Update-KeyStatus {
    try {
        $script:statusData = Invoke-LicenseBackend -Command "status"
        $fingerprintLabel.Text = "公钥指纹：$($script:statusData.publicKeyFingerprint)"
        $toolTip.SetToolTip($keyPanel, "私钥位置：$($script:statusData.privateKeyPath)")
        if (-not $script:statusData.keyExists) {
            $keyIndicator.ForeColor = [Drawing.Color]::FromArgb(186, 54, 54)
            $keyStatusLabel.Text = "未找到发码私钥"
            $generateButton.Enabled = $false
            $backupButton.Enabled = $false
            Set-StatusText -Text "请恢复私钥备份：$($script:statusData.privateKeyPath)" -IsError $true
            return
        }
        if (-not $script:statusData.keyMatches) {
            $keyIndicator.ForeColor = [Drawing.Color]::FromArgb(186, 54, 54)
            $keyStatusLabel.Text = "私钥与插件公钥不匹配"
            $generateButton.Enabled = $false
            $backupButton.Enabled = $true
            Set-StatusText -Text "已禁止发码，避免生成客户无法激活的授权码。" -IsError $true
            return
        }
        $keyIndicator.ForeColor = [Drawing.Color]::FromArgb(30, 139, 94)
        $keyStatusLabel.Text = "私钥可用，且与插件公钥匹配"
        $generateButton.Enabled = $true
        $backupButton.Enabled = $true
        Set-StatusText -Text "可以生成月卡、季卡、年卡和永久版激活码。"
    } catch {
        $keyIndicator.ForeColor = [Drawing.Color]::FromArgb(186, 54, 54)
        $keyStatusLabel.Text = "发码环境检查失败"
        $generateButton.Enabled = $false
        $backupButton.Enabled = $false
        Set-StatusText -Text $_.Exception.Message -IsError $true
    }
}

$planBox.Add_SelectedIndexChanged({ Update-ExpiryPreview })
$startDatePicker.Add_ValueChanged({ Update-ExpiryPreview })
$machineBox.Add_Leave({
    $machineBox.Text = ($machineBox.Text.ToUpperInvariant() -replace "[^A-Z0-9]", "")
})

$generateButton.Add_Click({
    $machineId = ($machineBox.Text.ToUpperInvariant() -replace "[^A-Z0-9]", "")
    $machineBox.Text = $machineId
    if ($machineId -notmatch "^HSM[A-Z0-9]{10}$") {
        Set-StatusText -Text "机器码格式不正确，应为 HSM 加 10 位字母或数字。" -IsError $true
        $machineBox.Focus()
        return
    }
    if (-not $script:statusData -or -not $script:statusData.keyMatches) {
        Set-StatusText -Text "私钥状态无效，不能生成激活码。" -IsError $true
        return
    }

    $generateButton.Enabled = $false
    $generateButton.Text = "正在生成..."
    Set-StatusText -Text "正在使用本机私钥签名..."
    [Windows.Forms.Application]::DoEvents()
    try {
        $result = Invoke-LicenseBackend -Command "issue" -Environment @{
            HSM_TOOL_MACHINE_ID = $machineId
            HSM_TOOL_PLAN = $script:plans[$planBox.SelectedIndex]
            HSM_TOOL_START_DATE = $startDatePicker.Value.Date.ToString("yyyy-MM-dd")
        }
        $script:lastCode = [string]$result.code
        $resultBox.Text = $script:lastCode
        $expiryValue.Text = [string]$result.expiresDisplay
        $copyButton.Enabled = $true
        Set-StatusText -Text "激活码已生成，并已写入本机发码记录。"
    } catch {
        Set-StatusText -Text $_.Exception.Message -IsError $true
    } finally {
        $generateButton.Text = "生成激活码"
        $generateButton.Enabled = [bool]($script:statusData -and $script:statusData.keyMatches)
    }
})

$copyButton.Add_Click({
    if ([string]::IsNullOrWhiteSpace($script:lastCode)) { return }
    try {
        [Windows.Forms.Clipboard]::SetText($script:lastCode)
        Set-StatusText -Text "激活码已复制到剪贴板。"
    } catch {
        Set-StatusText -Text "复制失败：$($_.Exception.Message)" -IsError $true
    }
})

$clearButton.Add_Click({
    $machineBox.Clear()
    $resultBox.Clear()
    $script:lastCode = ""
    $copyButton.Enabled = $false
    $machineBox.Focus()
    Update-ExpiryPreview
    Set-StatusText -Text "已清空当前内容。"
})

$historyButton.Add_Click({
    try {
        if (-not $script:statusData) { $script:statusData = Invoke-LicenseBackend -Command "status" }
        $folder = Split-Path -Parent ([string]$script:statusData.historyPath)
        if (-not (Test-Path -LiteralPath $folder -PathType Container)) {
            New-Item -ItemType Directory -Path $folder -Force | Out-Null
        }
        Start-Process -FilePath "explorer.exe" -ArgumentList @($folder)
        Set-StatusText -Text "已打开本机发码记录目录。"
    } catch {
        Set-StatusText -Text $_.Exception.Message -IsError $true
    }
})

$backupButton.Add_Click({
    if (-not $script:statusData -or -not $script:statusData.keyExists) { return }
    $dialog = New-Object Windows.Forms.SaveFileDialog
    $dialog.Title = "备份 Ed25519 发码私钥"
    $dialog.Filter = "PEM 私钥 (*.pem)|*.pem"
    $dialog.FileName = "WpsHighSchoolMath-ed25519-private-$([DateTime]::Today.ToString('yyyyMMdd')).pem"
    try {
        if ($dialog.ShowDialog($form) -ne [Windows.Forms.DialogResult]::OK) { return }
        Copy-Item -LiteralPath ([string]$script:statusData.privateKeyPath) -Destination $dialog.FileName -Force
        [Windows.Forms.MessageBox]::Show(
            $form,
            "私钥备份完成。请把备份保存在安全位置，不要发送给客户，也不要放进插件安装包。",
            "备份完成",
            [Windows.Forms.MessageBoxButtons]::OK,
            [Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
        Set-StatusText -Text "私钥已备份到：$($dialog.FileName)"
    } catch {
        Set-StatusText -Text "备份失败：$($_.Exception.Message)" -IsError $true
    } finally {
        $dialog.Dispose()
    }
})

$form.AcceptButton = $generateButton
$form.Add_Shown({
    Update-ExpiryPreview
    Update-KeyStatus
    $machineBox.Focus()
})

try {
    [void]$form.ShowDialog()
} finally {
    $toolTip.Dispose()
    $form.Dispose()
}
