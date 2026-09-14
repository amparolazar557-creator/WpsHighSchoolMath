param(
    [string]$NodePath
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Reset-SafeDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$AllowedRoot
    )
    $rootFull = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd("\") + "\"
    $pathFull = [IO.Path]::GetFullPath($Path)
    if (-not $pathFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to reset a directory outside the allowed root: $pathFull"
    }
    if (Test-Path -LiteralPath $pathFull) {
        Remove-Item -LiteralPath $pathFull -Recurse -Force
    }
    New-Item -ItemType Directory -Path $pathFull -Force | Out-Null
    return $pathFull
}

function Write-Utf8Text {
    param([string]$Path, [string]$Content)
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$package.version
$toolName = "WpsHighSchoolMath-LicenseTool-$version"
$releaseRoot = Join-Path $projectRoot "release"
$outputRoot = Join-Path $projectRoot "output"
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

if (-not $NodePath) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw "Node.js was not found. Install the pinned runtime before building the license tool." }
    $NodePath = $nodeCommand.Source
}
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path
$expectedNodeVersion = (Get-Content -LiteralPath (Join-Path $PSScriptRoot "license-tool\node-version.txt") -Raw).Trim()
$actualNodeVersion = (& $NodePath -p "process.versions.node").Trim()
if ($LASTEXITCODE -ne 0 -or $actualNodeVersion -ne $expectedNodeVersion) {
    throw "License tool requires Node.js $expectedNodeVersion, but found $actualNodeVersion. Update node-version.txt and the matching Node license deliberately before changing the runtime."
}

$nodeLicensePath = Join-Path $PSScriptRoot "license-tool\NODE-LICENSE.txt"
if (-not (Test-Path -LiteralPath $nodeLicensePath -PathType Leaf)) {
    throw "Node runtime license is missing: $nodeLicensePath"
}

$sourceStatusRaw = & $NodePath (Join-Path $PSScriptRoot "license-tool-cli.js") status
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect the issuer key: $sourceStatusRaw" }
$sourceStatus = $sourceStatusRaw | ConvertFrom-Json
if (-not $sourceStatus.keyExists) { throw "Issuer private key was not found: $($sourceStatus.privateKeyPath)" }
if (-not $sourceStatus.keyMatches) { throw "Issuer private key does not match the plugin public key. The tool was not built." }

$stagingPath = Reset-SafeDirectory -Path (Join-Path $outputRoot "$toolName-staging") -AllowedRoot $outputRoot
$filesToCopy = @(
    @{ Source = (Join-Path $PSScriptRoot "license-tool.ps1"); Destination = "license-tool.ps1" },
    @{ Source = (Join-Path $PSScriptRoot "license-tool-cli.js"); Destination = "license-tool-cli.js" },
    @{ Source = (Join-Path $PSScriptRoot "license-issuer.js"); Destination = "license-issuer.js" },
    @{ Source = (Join-Path $projectRoot "js\license-public-key.js"); Destination = "license-public-key.js" },
    @{ Source = $NodePath; Destination = "node.exe" },
    @{ Source = $nodeLicensePath; Destination = "NODE-LICENSE.txt" }
)
foreach ($entry in $filesToCopy) {
    if (-not (Test-Path -LiteralPath $entry.Source -PathType Leaf)) { throw "Required tool file is missing: $($entry.Source)" }
    Copy-Item -LiteralPath $entry.Source -Destination (Join-Path $stagingPath $entry.Destination) -Force
}

$launchCmd = @'
@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0license-tool.ps1"
'@
[IO.File]::WriteAllText((Join-Path $stagingPath "launch.cmd"), $launchCmd, (New-Object Text.ASCIIEncoding))

$readme = @"
WPS 高中数学插件发码工具 $version

双击 launch.cmd，或直接运行 $toolName.exe。
工具完全离线运行，不启动服务器，不连接网络。

私钥默认位置：$($sourceStatus.privateKeyPath)
公钥指纹：$($sourceStatus.publicKeyFingerprint)
发码记录：$($sourceStatus.historyPath)

安全要求：
1. 本工具仅供插件发行方使用，不得发送给客户。
2. 本工具和压缩包不包含私钥；私钥仍保存在当前 Windows 用户目录。
3. 必须安全备份私钥。私钥丢失后无法继续发码，泄露后他人可以伪造授权。
4. 工具检测到私钥与插件公钥不一致时会禁止生成激活码。
"@
Write-Utf8Text -Path (Join-Path $stagingPath "README.txt") -Content $readme

$embeddedStatusRaw = & (Join-Path $stagingPath "node.exe") (Join-Path $stagingPath "license-tool-cli.js") status
if ($LASTEXITCODE -ne 0) { throw "Packaged license runtime failed its key check: $embeddedStatusRaw" }
$embeddedStatus = $embeddedStatusRaw | ConvertFrom-Json
if (-not $embeddedStatus.keyMatches -or $embeddedStatus.publicKeyFingerprint -ne $sourceStatus.publicKeyFingerprint) {
    throw "Packaged license runtime does not match the current plugin public key."
}

$forbiddenFiles = @(
    Get-ChildItem -LiteralPath $stagingPath -Recurse -File | Where-Object {
        $_.Extension -match '^\.(pem|key|pfx|p12)$' -or $_.Name -match '(?i)private.*key|secret.*key'
    }
)
if ($forbiddenFiles.Count -gt 0) {
    throw "Private-key material must not be packaged: $($forbiddenFiles.FullName -join ', ')"
}
$privateMarkers = @(
    Get-ChildItem -LiteralPath $stagingPath -Recurse -File |
        Select-String -SimpleMatch -Pattern "-----BEGIN PRIVATE KEY-----" -ErrorAction SilentlyContinue
)
if ($privateMarkers.Count -gt 0) {
    throw "Private-key content was detected in the license tool staging directory."
}

$manifest = [ordered]@{
    product = "WpsHighSchoolMath"
    tool = "LicenseIssuer"
    version = $version
    builtAt = (Get-Date).ToUniversalTime().ToString("o")
    offline = $true
    localServer = $false
    privateKeyIncluded = $false
    publicKeyFingerprint = [string]$sourceStatus.publicKeyFingerprint
    nodeVersion = $actualNodeVersion
    historyPath = [string]$sourceStatus.historyPath
    files = @(Get-ChildItem -LiteralPath $stagingPath -File | Sort-Object Name | ForEach-Object {
        [ordered]@{
            name = $_.Name
            bytes = [long]$_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    })
}
Write-Utf8Text -Path (Join-Path $stagingPath "LICENSE-TOOL-MANIFEST.json") -Content ($manifest | ConvertTo-Json -Depth 6)

$zipPath = Join-Path $releaseRoot "$toolName.zip"
$exePath = Join-Path $releaseRoot "$toolName.exe"
$checksumPath = Join-Path $releaseRoot "$toolName-checksums.sha256"
Remove-Item -LiteralPath $zipPath, $exePath, $checksumPath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stagingPath "*") -DestinationPath $zipPath -CompressionLevel Optimal

$iexpressRoot = Reset-SafeDirectory -Path (Join-Path ([IO.Path]::GetTempPath()) "$toolName-iexpress") -AllowedRoot ([IO.Path]::GetTempPath())
$iexpressSource = Join-Path $iexpressRoot "source"
New-Item -ItemType Directory -Path $iexpressSource -Force | Out-Null
Copy-Item -Path (Join-Path $stagingPath "*") -Destination $iexpressSource -Force
$tempExePath = Join-Path $iexpressRoot "$toolName.exe"
$sedPath = Join-Path $iexpressRoot "tool.sed"
$sourceFiles = @(Get-ChildItem -LiteralPath $iexpressSource -File | Sort-Object Name)
$sourceEntries = @()
$stringEntries = @()
for ($index = 0; $index -lt $sourceFiles.Count; $index++) {
    $sourceEntries += "%FILE$index%="
    $stringEntries += "FILE$index=`"$($sourceFiles[$index].Name)`""
}
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3

[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$tempExePath
FriendlyName=WPS High School Math License Tool
AppLaunched=launch.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles

[SourceFiles]
SourceFiles0=$iexpressSource\

[SourceFiles0]
$($sourceEntries -join "`r`n")

[Strings]
$($stringEntries -join "`r`n")
"@
[IO.File]::WriteAllText($sedPath, $sed, (New-Object Text.ASCIIEncoding))

$iexpressExe = Join-Path $env:WINDIR "System32\iexpress.exe"
Start-Process -FilePath $iexpressExe -ArgumentList @("/N", "/Q", $sedPath) -WindowStyle Hidden -Wait
if (-not (Test-Path -LiteralPath $tempExePath -PathType Leaf)) {
    $ddfPath = Get-ChildItem -LiteralPath $iexpressRoot -Filter "*.DDF" | Select-Object -First 1 -ExpandProperty FullName
    if ($ddfPath) {
        & (Join-Path $env:WINDIR "System32\makecab.exe") /F $ddfPath | Out-Null
        Start-Process -FilePath $iexpressExe -ArgumentList @("/N", "/Q", $sedPath) -WindowStyle Hidden -Wait
    }
}
if (-not (Test-Path -LiteralPath $tempExePath -PathType Leaf)) {
    throw "IExpress did not create the license tool executable."
}
Copy-Item -LiteralPath $tempExePath -Destination $exePath -Force

$checksumLines = @($zipPath, $exePath) | ForEach-Object {
    $item = Get-Item -LiteralPath $_
    $hash = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $($item.Name)"
}
Write-Utf8Text -Path $checksumPath -Content (($checksumLines -join "`n") + "`n")

$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $archiveForbidden = @($archive.Entries | Where-Object { $_.FullName -match '(?i)\.(pem|key|pfx|p12)$|private.*key|secret.*key' })
    if ($archiveForbidden.Count -gt 0) { throw "Private-key file detected in the final ZIP." }
} finally {
    $archive.Dispose()
}

Write-Host ""
Write-Host "Offline license tool created:"
Get-Item -LiteralPath $exePath, $zipPath, $checksumPath | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
Write-Host "Public key fingerprint: $($sourceStatus.publicKeyFingerprint)"
Write-Host "Private key included: false"
