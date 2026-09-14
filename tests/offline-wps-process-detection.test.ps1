$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$installerPath = Join-Path $projectRoot "scripts\offline-install.ps1"
$uninstallerPath = Join-Path $projectRoot "scripts\offline-uninstall.ps1"
$requiredFunctions = @("Test-WpsProcessHasUserWindow", "Stop-WpsBackgroundHosts")
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($installerPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
$definitions = @(
    $ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $requiredFunctions -contains $node.Name
    }, $true)
)
if ($definitions.Count -ne $requiredFunctions.Count) {
    throw "Could not load the WPS process-classification functions."
}
Invoke-Expression (($definitions | ForEach-Object { $_.Extent.Text }) -join "`r`n`r`n")

$headlessStartupProcess = [pscustomobject]@{
    Id = 1001
    ProcessName = "wps"
    MainWindowHandle = [IntPtr]::Zero
    MainWindowTitle = ""
}
$visibleWriterProcess = [pscustomobject]@{
    Id = 1002
    ProcessName = "wps"
    MainWindowHandle = [IntPtr]12345
    MainWindowTitle = "数学试卷 - WPS Office"
}
$visiblePresentationProcess = [pscustomobject]@{
    Id = 1003
    ProcessName = "wpp"
    MainWindowHandle = [IntPtr]67890
    MainWindowTitle = "教学课件 - WPS Office"
}

if (Test-WpsProcessHasUserWindow -Process $headlessStartupProcess) {
    throw "A headless WPS startup process was misclassified as an open document."
}
if (-not (Test-WpsProcessHasUserWindow -Process $visibleWriterProcess)) {
    throw "A visible Writer document was not detected."
}
if (-not (Test-WpsProcessHasUserWindow -Process $visiblePresentationProcess)) {
    throw "A visible Presentation document was not detected."
}

$installerSource = Get-Content -LiteralPath $installerPath -Raw -Encoding UTF8
$uninstallerSource = Get-Content -LiteralPath $uninstallerPath -Raw -Encoding UTF8
if (-not $installerSource.Contains('Stop-WpsBackgroundHosts -Processes $wpsProcesses')) {
    throw "The installer does not stop headless WPS processes after checking visible windows."
}
if ($installerSource.IndexOf('$openWpsProcesses', [StringComparison]::Ordinal) -gt
    $installerSource.IndexOf('Stop-WpsBackgroundHosts -Processes $wpsProcesses', [StringComparison]::Ordinal)) {
    throw "The installer stops background WPS processes before protecting visible document windows."
}
if (-not $uninstallerSource.Contains('Test-WpsProcessHasUserWindow') -or
    -not $uninstallerSource.Contains('Stop-WpsBackgroundHosts -Processes $wpsProcesses')) {
    throw "The uninstaller does not use the same visible-window protection as the installer."
}

Write-Output "WPS visible-window process detection tests passed"
