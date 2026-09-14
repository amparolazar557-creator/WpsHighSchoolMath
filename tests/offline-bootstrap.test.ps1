$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$projectRoot = Split-Path -Parent $PSScriptRoot
$bootstrapPath = Join-Path $projectRoot "scripts\offline-bootstrap.ps1"
$powerShellPath = (Get-Command powershell.exe -ErrorAction Stop).Source

function Write-TestFile {
    param([string]$Path, [string]$Content)
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($true)))
}

function New-TestPayloadArchive {
    param(
        [string]$Root,
        [string]$Name,
        [string]$InstallerContent
    )

    $sourcePath = Join-Path $Root "$Name-source"
    $archivePath = Join-Path $Root "$Name.zip"
    New-Item -ItemType Directory -Path $sourcePath -Force | Out-Null
    Write-TestFile -Path (Join-Path $sourcePath "install.ps1") -Content $InstallerContent
    Compress-Archive -Path (Join-Path $sourcePath "*") -DestinationPath $archivePath -CompressionLevel Optimal
    return $archivePath
}

function Invoke-Bootstrap {
    param(
        [string]$ArchivePath,
        [string]$LogRoot,
        [string]$ExtractRoot
    )

    $output = @(& $powerShellPath -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File $bootstrapPath `
        -PayloadPath $ArchivePath -NoDialog -LogRoot $LogRoot -ExtractBasePath $ExtractRoot 2>&1)
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = ($output | Out-String)
    }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("hsm-offline-bootstrap-test-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
try {
    $extractRoot = Join-Path $testRoot "extract"
    $logRoot = Join-Path $testRoot "logs"
    $markerPath = Join-Path $testRoot "success.marker"
    $env:HSM_BOOTSTRAP_TEST_MARKER = $markerPath

    $successArchive = New-TestPayloadArchive -Root $testRoot -Name "success" -InstallerContent @'
$ErrorActionPreference = "Stop"
[IO.File]::WriteAllText($env:HSM_BOOTSTRAP_TEST_MARKER, "ok")
'@
    $success = Invoke-Bootstrap -ArchivePath $successArchive -LogRoot $logRoot -ExtractRoot $extractRoot
    if ($success.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        throw "Bootstrap did not run a valid install payload successfully. Output: $($success.Output)"
    }
    if (@(Get-ChildItem -LiteralPath $extractRoot -Directory -Filter "WpsHighSchoolMathOffline_*" -ErrorAction SilentlyContinue).Count -ne 0) {
        throw "Bootstrap left its successful extraction directory behind."
    }

    $failureArchive = New-TestPayloadArchive -Root $testRoot -Name "wps-open" -InstallerContent @'
$ErrorActionPreference = "Stop"
throw "Close all WPS Writer and Presentation windows before installing this add-in."
'@
    $failure = Invoke-Bootstrap -ArchivePath $failureArchive -LogRoot $logRoot -ExtractRoot $extractRoot
    if ($failure.ExitCode -eq 0) {
        throw "Bootstrap returned success for a failed installer."
    }
    if ($failure.Output -notmatch 'WPS 文字或 WPS 演示仍在运行') {
        throw "Bootstrap did not translate the WPS-running error into a clear Chinese message. Output: $($failure.Output)"
    }
    $logs = @(Get-ChildItem -LiteralPath $logRoot -File -Filter "installer-*.log" -ErrorAction SilentlyContinue)
    if ($logs.Count -ne 1) {
        throw "Bootstrap did not write exactly one failure log."
    }
    $logContent = Get-Content -LiteralPath $logs[0].FullName -Raw -Encoding UTF8
    if ($logContent -notmatch 'Close all WPS Writer and Presentation windows') {
        throw "Bootstrap failure log does not contain the original technical error."
    }
    if (@(Get-ChildItem -LiteralPath $extractRoot -Directory -Filter "WpsHighSchoolMathOffline_*" -ErrorAction SilentlyContinue).Count -ne 0) {
        throw "Bootstrap left its failed extraction directory behind."
    }

    Write-Output "offline bootstrap tests passed"
} finally {
    Remove-Item Env:\HSM_BOOTSTRAP_TEST_MARKER -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
