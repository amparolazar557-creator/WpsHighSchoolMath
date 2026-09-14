param(
    [Parameter(Mandatory = $true)][string]$PayloadPath,
    [switch]$NoDialog,
    [string]$LogRoot,
    [string]$ExtractBasePath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$exitCode = 0
$extractPath = $null

function Get-FriendlyInstallerMessage {
    param([Exception]$Exception)

    $technicalMessage = [string]$Exception.Message
    if ($technicalMessage -match 'Close all WPS Writer and Presentation windows') {
        return "检测到 WPS 文字或 WPS 演示仍在运行。请先保存所有文档，并完全退出所有 WPS 窗口，然后重新运行安装包。"
    }
    if ($technicalMessage -match 'Rollback also failed') {
        return "安装失败，自动恢复旧版本时也遇到问题。请保留错误日志并联系技术支持，不要手动删除插件目录。"
    }
    if ($technicalMessage -match 'previous Writer/PPT installation was restored') {
        return "安装失败，安装器已自动恢复到安装前的状态。请查看错误日志后重试。"
    }
    if ($technicalMessage -match '(?i)payload|manifest|integrity|hash|SHA-256|archive|Expand-Archive') {
        return "安装包解压或完整性校验失败。请重新下载安装包后再试。"
    }
    if ($Exception -is [UnauthorizedAccessException] -or $technicalMessage -match '(?i)access.*denied|unauthorized') {
        return "安装时没有足够的文件访问权限。请确认当前账户可以写入用户目录后再试。"
    }
    return "插件安装未完成。请查看错误日志后重试。"
}

function Write-InstallerFailureLog {
    param(
        [Exception]$Exception,
        [string]$FriendlyMessage,
        [string]$RequestedLogRoot
    )

    $resolvedLogRoot = $RequestedLogRoot
    if ([string]::IsNullOrWhiteSpace($resolvedLogRoot)) {
        $base = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { [IO.Path]::GetTempPath() } else { $env:LOCALAPPDATA }
        $resolvedLogRoot = Join-Path $base "WpsHighSchoolMath\Logs"
    }
    New-Item -ItemType Directory -Path $resolvedLogRoot -Force | Out-Null
    $logPath = Join-Path $resolvedLogRoot ("installer-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss-fff"))
    $lines = @(
        "Time: $([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))",
        "Payload: $PayloadPath",
        "Friendly message: $FriendlyMessage",
        "Error type: $($Exception.GetType().FullName)",
        "Error message: $($Exception.Message)",
        "PowerShell: $($PSVersionTable.PSVersion)",
        "Windows: $([Environment]::OSVersion.VersionString)",
        "",
        "Script stack:",
        [string]$global:Error[0].ScriptStackTrace,
        "",
        "Full error:",
        [string]$global:Error[0]
    )
    [IO.File]::WriteAllLines($logPath, $lines, (New-Object Text.UTF8Encoding($true)))
    return $logPath
}

function Remove-SafeExtractionDirectory {
    param(
        [string]$Path,
        [string]$AllowedRoot
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Container)) {
        return
    }
    $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $fullRoot = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd('\')
    $rootPrefix = $fullRoot + '\'
    if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($fullPath) -notlike 'WpsHighSchoolMathOffline_*') {
        throw "Refusing to remove an unexpected installer directory: $fullPath"
    }
    Remove-Item -LiteralPath $fullPath -Recurse -Force
}

try {
    $payloadFullPath = [IO.Path]::GetFullPath($PayloadPath)
    if (-not (Test-Path -LiteralPath $payloadFullPath -PathType Leaf)) {
        throw "Installer payload archive was not found: $payloadFullPath"
    }

    if ([string]::IsNullOrWhiteSpace($ExtractBasePath)) {
        $ExtractBasePath = [IO.Path]::GetTempPath()
    }
    $extractBaseFullPath = [IO.Path]::GetFullPath($ExtractBasePath)
    New-Item -ItemType Directory -Path $extractBaseFullPath -Force | Out-Null
    $extractPath = Join-Path $extractBaseFullPath ("WpsHighSchoolMathOffline_" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $extractPath -Force | Out-Null

    Expand-Archive -LiteralPath $payloadFullPath -DestinationPath $extractPath -Force
    $installerPath = Join-Path $extractPath "install.ps1"
    if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
        throw "Installer payload does not contain install.ps1."
    }
    & $installerPath
} catch {
    $exitCode = 1
    $friendlyMessage = Get-FriendlyInstallerMessage -Exception $_.Exception
    try {
        $logPath = Write-InstallerFailureLog -Exception $_.Exception -FriendlyMessage $friendlyMessage -RequestedLogRoot $LogRoot
    } catch {
        $logPath = "日志写入失败：$($_.Exception.Message)"
    }
    $technicalMessage = [string]$global:Error[0].Exception.Message
    if ($technicalMessage.Length -gt 600) {
        $technicalMessage = $technicalMessage.Substring(0, 600) + "..."
    }
    $displayMessage = "$friendlyMessage`r`n`r`n错误详情：$technicalMessage`r`n`r`n错误日志：$logPath"
    if ($NoDialog) {
        Write-Output $displayMessage
    } else {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            [Windows.Forms.MessageBox]::Show(
                $displayMessage,
                "WPS 高中数学工具插件 - 安装失败",
                [Windows.Forms.MessageBoxButtons]::OK,
                [Windows.Forms.MessageBoxIcon]::Error
            ) | Out-Null
        } catch {
            [Console]::Error.WriteLine($displayMessage)
        }
    }
} finally {
    if ($extractPath) {
        try {
            Remove-SafeExtractionDirectory -Path $extractPath -AllowedRoot $ExtractBasePath
        } catch {
            [Console]::Error.WriteLine("Unable to remove the installer temporary directory: $($_.Exception.Message)")
        }
    }
}

exit $exitCode
