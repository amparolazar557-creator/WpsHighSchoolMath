param(
    [string]$SignToolPath = $env:HSM_SIGNTOOL_PATH,
    [string]$CertificateThumbprint = $env:HSM_CERTIFICATE_THUMBPRINT,
    [string]$TimestampUrl = $env:HSM_TIMESTAMP_URL,
    [string]$CertificateStoreLocation = $env:HSM_CERTIFICATE_STORE_LOCATION,
    [string]$BuildMode = $env:HSM_BUILD_MODE
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "payload-integrity.ps1")
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$pluginName = [string]$package.name
$pptPluginName = "${pluginName}Ppt"
$pluginVersion = [string]$package.version
$pluginFolderName = "${pluginName}_${pluginVersion}"
$releasePath = Join-Path $projectRoot "release"
$stagingPath = Join-Path $releasePath "${pluginName}-${pluginVersion}-offline"
$payloadPath = Join-Path $stagingPath "payload\$pluginFolderName"
$zipPath = Join-Path $releasePath "${pluginName}-${pluginVersion}-offline.zip"
$exePath = Join-Path $releasePath "${pluginName}-${pluginVersion}-offline.exe"
$checksumsPath = Join-Path $releasePath "${pluginName}-${pluginVersion}-checksums.sha256"
$releaseManifestPath = Join-Path $releasePath "${pluginName}-${pluginVersion}-release-manifest.json"
$BuildMode = if ([string]::IsNullOrWhiteSpace($BuildMode)) { "Internal" } else { $BuildMode.Trim() }
if ($BuildMode -notin @("Internal", "Commercial")) {
    throw "BuildMode must be Internal or Commercial."
}
$CertificateStoreLocation = if ([string]::IsNullOrWhiteSpace($CertificateStoreLocation)) { "CurrentUser" } else { $CertificateStoreLocation.Trim() }
if ($CertificateStoreLocation -notin @("CurrentUser", "LocalMachine")) {
    throw "CertificateStoreLocation must be CurrentUser or LocalMachine."
}
$commercialBuild = $BuildMode -eq "Commercial"
$buildChannel = if ($commercialBuild) { "commercial-offline" } else { "internal-test" }
$signingRequested = -not [string]::IsNullOrWhiteSpace($CertificateThumbprint)
$resolvedSignTool = $null
$resolvedCertificate = $null
$normalizedThumbprint = ($CertificateThumbprint -replace '\s', '').ToUpperInvariant()

function Remove-SafeDirectory {
    param(
        [string]$Path,
        [string]$AllowedRoot
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
    $resolvedRoot = (Resolve-Path -LiteralPath $AllowedRoot).Path
    if (-not $resolvedPath.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase) -or $resolvedPath -eq $resolvedRoot) {
        throw "Refusing to remove a directory outside the intended build root: $resolvedPath"
    }
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force
}

function Resolve-SignToolPath {
    param([string]$RequestedPath)

    if ($RequestedPath) {
        if (-not (Test-Path -LiteralPath $RequestedPath -PathType Leaf)) {
            throw "The requested signtool.exe was not found: $RequestedPath"
        }
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    $command = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    if (Test-Path -LiteralPath $kitsRoot) {
        $candidate = Get-ChildItem -LiteralPath $kitsRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName "x64\signtool.exe" } |
            Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
            Select-Object -First 1
        if ($candidate) {
            return $candidate
        }
    }
    return $null
}

function Invoke-CodeSign {
    param([string]$Path)

    if (-not $signingRequested) {
        return
    }
    $signArguments = @("sign", "/s", "My")
    if ($CertificateStoreLocation -eq "LocalMachine") {
        $signArguments += "/sm"
    }
    $signArguments += @(
        "/sha1", $normalizedThumbprint,
        "/fd", "SHA256",
        "/tr", $TimestampUrl,
        "/td", "SHA256",
        "/d", "WPS High School Math",
        $Path
    )
    & $resolvedSignTool @signArguments
    if ($LASTEXITCODE -ne 0) {
        throw "signtool.exe failed with exit code $LASTEXITCODE for $Path."
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
        throw "The signature did not validate after signing $Path. Status: $($signature.Status)"
    }
    if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $normalizedThumbprint) {
        throw "The signed file does not use the requested certificate: $Path"
    }
    if (-not $signature.TimeStamperCertificate) {
        throw "The signed file does not contain a verifiable RFC 3161 timestamp: $Path"
    }
    & $resolvedSignTool verify /pa /all /v /tw $Path | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "signtool.exe verification failed with exit code $LASTEXITCODE for $Path."
    }
}

function Resolve-CodeSigningCertificate {
    param(
        [string]$Thumbprint,
        [string]$StoreLocation
    )

    $certificatePath = "Cert:\$StoreLocation\My\$Thumbprint"
    $certificate = Get-Item -LiteralPath $certificatePath -ErrorAction SilentlyContinue
    if (-not $certificate) {
        throw "The requested signing certificate was not found in $StoreLocation\\My: $Thumbprint"
    }
    $now = Get-Date
    if (-not $certificate.HasPrivateKey) {
        throw "The requested signing certificate does not have an accessible private key."
    }
    if ($certificate.NotBefore -gt $now -or $certificate.NotAfter -le $now) {
        throw "The requested signing certificate is not currently valid."
    }
    $codeSigningOid = "1.3.6.1.5.5.7.3.3"
    $hasCodeSigningEku = @(
        $certificate.EnhancedKeyUsageList |
            Where-Object { $_.ObjectId.Value -eq $codeSigningOid }
    ).Count -gt 0
    if (-not $hasCodeSigningEku) {
        throw "The requested certificate does not include the Code Signing EKU ($codeSigningOid)."
    }
    $chain = New-Object Security.Cryptography.X509Certificates.X509Chain
    try {
        $chain.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::Online
        $chain.ChainPolicy.RevocationFlag = [Security.Cryptography.X509Certificates.X509RevocationFlag]::ExcludeRoot
        $chain.ChainPolicy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(15)
        if (-not $chain.Build($certificate)) {
            $statuses = @($chain.ChainStatus | ForEach-Object { $_.Status.ToString() + ": " + $_.StatusInformation.Trim() }) -join " | "
            throw "The code-signing certificate chain is not trusted: $statuses"
        }
    } finally {
        $chain.Dispose()
    }
    return $certificate
}

function Get-SignatureRecord {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$LogicalPath
    )

    $item = Get-Item -LiteralPath $Path
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    return [ordered]@{
        file = $LogicalPath.Replace('\', '/')
        bytes = [long]$item.Length
        sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
        status = if ($signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid) { "valid" } else { "pending-certificate" }
        authenticodeStatus = [string]$signature.Status
        signerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
        signerThumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }
        timestamped = $null -ne $signature.TimeStamperCertificate
        timestamperSubject = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { $null }
    }
}

if ($commercialBuild -and -not $signingRequested) {
    throw "Commercial builds require a code-signing certificate. Set -CertificateThumbprint or HSM_CERTIFICATE_THUMBPRINT."
}
if ($signingRequested) {
    if ([string]::IsNullOrWhiteSpace($TimestampUrl)) {
        throw "A timestamp URL is required when code signing is requested. Set -TimestampUrl or HSM_TIMESTAMP_URL."
    }
    $resolvedSignTool = Resolve-SignToolPath -RequestedPath $SignToolPath
    if (-not $resolvedSignTool) {
        throw "signtool.exe was not found. Install the Windows SDK or pass -SignToolPath."
    }
    $resolvedCertificate = Resolve-CodeSigningCertificate -Thumbprint $normalizedThumbprint -StoreLocation $CertificateStoreLocation
}

New-Item -ItemType Directory -Path $releasePath -Force | Out-Null
Remove-SafeDirectory -Path $stagingPath -AllowedRoot $releasePath
New-Item -ItemType Directory -Path $payloadPath -Force | Out-Null

$rootFiles = @("index.html", "main.js", "manifest.xml", "ribbon.xml")
foreach ($file in $rootFiles) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $payloadPath -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot "ui") -Destination $payloadPath -Recurse -Force
New-Item -ItemType Directory -Path (Join-Path $payloadPath "js") -Force | Out-Null
foreach ($file in @("symbols.js", "taskpane.js", "license-public-key.js", "license.js", "ribbon.js", "plot-config.js", "plot-analysis.js", "plotter.js", "plot-library.js", "function-plot-document.js", "function-plot-native.js")) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "js\$file") -Destination (Join-Path $payloadPath "js") -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot "js\vendor") -Destination (Join-Path $payloadPath "js") -Recurse -Force
if (Test-Path -LiteralPath (Join-Path $projectRoot "assets")) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "assets") -Destination $payloadPath -Recurse -Force
}

$pptPayloadPath = Join-Path $stagingPath "payload\${pptPluginName}_${pluginVersion}"
New-Item -ItemType Directory -Path $pptPayloadPath -Force | Out-Null
foreach ($file in @("index.html", "main.js", "manifest.xml", "ribbon.xml")) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "ppt\$file") -Destination $pptPayloadPath -Force
}
New-Item -ItemType Directory -Path (Join-Path $pptPayloadPath "js") -Force | Out-Null
foreach ($file in @("symbols.js", "ppt-api.js", "taskpane.js", "license-public-key.js", "license.js", "ribbon-ppt.js", "plot-config.js", "plot-analysis.js", "plotter.js", "plot-library.js", "function-plot-document.js", "function-plot-native.js")) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "js\$file") -Destination (Join-Path $pptPayloadPath "js") -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot "js\vendor") -Destination (Join-Path $pptPayloadPath "js") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "ui") -Destination $pptPayloadPath -Recurse -Force
if (Test-Path -LiteralPath (Join-Path $projectRoot "assets")) {
    Copy-Item -LiteralPath (Join-Path $projectRoot "assets") -Destination $pptPayloadPath -Recurse -Force
}

foreach ($taskPaneScript in @(
    (Join-Path $payloadPath "js\taskpane.js"),
    (Join-Path $pptPayloadPath "js\taskpane.js")
)) {
    $taskPaneContent = [IO.File]::ReadAllText($taskPaneScript, (New-Object Text.UTF8Encoding($false)))
    $taskPaneContent = $taskPaneContent.Replace("__PLUGIN_VERSION__", $pluginVersion)
    [IO.File]::WriteAllText($taskPaneScript, $taskPaneContent, (New-Object Text.UTF8Encoding($false)))
}

$taskPaneVersionSuffix = $pluginVersion -replace '[^A-Za-z0-9._-]', '_'
foreach ($uiPath in @(
    (Join-Path $payloadPath "ui"),
    (Join-Path $pptPayloadPath "ui")
)) {
    foreach ($pageName in @("license", "function-plot", "tool-center")) {
        Copy-Item -LiteralPath (Join-Path $uiPath "$pageName.html") `
            -Destination (Join-Path $uiPath "$pageName-$taskPaneVersionSuffix.html") -Force
    }
}

$writerPayloadManifest = New-HsmPayloadManifest `
    -PayloadPath $payloadPath `
    -Product $pluginName `
    -PluginName $pluginName `
    -PluginVersion $pluginVersion `
    -HostType "wps"
$pptPayloadManifest = New-HsmPayloadManifest `
    -PayloadPath $pptPayloadPath `
    -Product $pluginName `
    -PluginName $pptPluginName `
    -PluginVersion $pluginVersion `
    -HostType "wpp"

[void](Test-HsmPayload `
    -PayloadPath $payloadPath `
    -ExpectedProduct $pluginName `
    -ExpectedPluginName $pluginName `
    -ExpectedVersion $pluginVersion `
    -ExpectedHostType "wps" `
    -ExpectedManifestSha256 $writerPayloadManifest.Sha256)
[void](Test-HsmPayload `
    -PayloadPath $pptPayloadPath `
    -ExpectedProduct $pluginName `
    -ExpectedPluginName $pptPluginName `
    -ExpectedVersion $pluginVersion `
    -ExpectedHostType "wpp" `
    -ExpectedManifestSha256 $pptPayloadManifest.Sha256)

$tokens = @{
    "__PLUGIN_NAME__" = $pluginName
    "__PPT_PLUGIN_NAME__" = $pptPluginName
    "__PLUGIN_VERSION__" = $pluginVersion
    "__WRITER_PAYLOAD_MANIFEST_SHA256__" = $writerPayloadManifest.Sha256
    "__PPT_PAYLOAD_MANIFEST_SHA256__" = $pptPayloadManifest.Sha256
}
foreach ($scriptName in @("offline-install.ps1", "offline-uninstall.ps1", "validate-installed.ps1")) {
    $content = Get-Content -LiteralPath (Join-Path $PSScriptRoot $scriptName) -Raw
    foreach ($entry in $tokens.GetEnumerator()) {
        $content = $content.Replace($entry.Key, $entry.Value)
    }
    $destinationName = $scriptName.Replace("offline-", "")
    [IO.File]::WriteAllText((Join-Path $stagingPath $destinationName), $content, (New-Object Text.UTF8Encoding($true)))
}
foreach ($scriptName in @("offline-configure-wps.ps1", "offline-uninstall-cleanup.ps1", "uninstall-registration.ps1")) {
    $destinationName = $scriptName.Replace("offline-", "")
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $scriptName) -Destination (Join-Path $stagingPath $destinationName) -Force
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "payload-integrity.ps1") `
    -Destination (Join-Path $stagingPath "payload-integrity.ps1") -Force

$installerContent = [IO.File]::ReadAllText((Join-Path $stagingPath "install.ps1"), (New-Object Text.UTF8Encoding($false)))
if ($installerContent.Contains('$installedLicensePath') -or $installerContent.Contains('__INSTALL_MACHINE_ID__')) {
    throw "Installer must not mutate installed add-in source files."
}
if (-not $installerContent.Contains('Update-AuthorizationCache') -or -not $installerContent.Contains('authaddin.json')) {
    throw "Installer must remove only this add-in's stale WPS authorization records during upgrades."
}
if (-not $installerContent.Contains('Test-HsmPayload') -or -not $installerContent.Contains('Invoke-HsmInstallTransaction')) {
    throw "Installer payload integrity and transaction gates are missing."
}
if (-not $installerContent.Contains('Register-HsmUninstaller') -or -not $installerContent.Contains('uninstall-registration.ps1')) {
    throw "Installer must register a persistent Windows uninstall entry."
}

$publicKeyModule = Join-Path $projectRoot "js\license-public-key.js"
if (-not (Test-Path -LiteralPath $publicKeyModule -PathType Leaf)) {
    throw "License public-key module is missing. Run: node scripts\license-keygen.js"
}
$publicKeyContent = [IO.File]::ReadAllText($publicKeyModule, (New-Object Text.UTF8Encoding($false)))
if ($publicKeyContent -notmatch 'MathLicensePublicKey' -or $publicKeyContent -notmatch '[A-Za-z0-9+/]{43}=') {
    throw "License public-key module is invalid. Run: node scripts\license-keygen.js"
}
$forbiddenPrivateKeys = Get-ChildItem -LiteralPath $stagingPath -Recurse -File |
    Where-Object { $_.Extension -in @('.pem', '.key', '.pfx', '.p12') -or $_.Name -match 'private.*key|key.*private' }
if ($forbiddenPrivateKeys) {
    throw "Private licensing material must never be included in the release: $($forbiddenPrivateKeys.FullName -join ', ')"
}

Copy-Item -LiteralPath (Join-Path $PSScriptRoot "offline-install.cmd") -Destination (Join-Path $stagingPath "install.cmd") -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "offline-uninstall.cmd") -Destination (Join-Path $stagingPath "uninstall.cmd") -Force

$readme = @"
WPS High School Math $pluginVersion - Offline Installer

Install:
1. Close all WPS Writer and Presentation windows.
2. Run install.cmd, or run the EXE installer.
3. The add-in installs for the current user first. Approve the optional administrator prompt
   to hide the WPS JS debugger button; cancelling it does not cancel the add-in installation.
4. Reopen WPS Writer or Presentation.
5. On the first launch after an install or upgrade, click Confirm when WPS asks whether to trust this add-in.

The installer preserves unrelated WPS JS add-ins, removes old registrations for this add-in,
clears only stale trust fingerprints for this add-in, installs the local Writer and Presentation
add-ins, and sets JsApiShowWebDebugger=false.

This release contains one unified add-in Ribbon tab in Writer and Presentation,
the full offline function editor, editable function-plot metadata, and automatic
content avoidance when inserting plots into Presentation.

The function editor and authorization center share one versioned task pane with two tabs.
It loads directly from files inside each installed add-in payload and does not start a
local service, open a port, launch an auxiliary executable, or contact the Internet.

Licensing uses Ed25519 asymmetric signatures. The installer contains only the public
verification key. The private issuing key stays on the seller's computer and is never
included in the ZIP, EXE, Writer payload, or Presentation payload.

Trial and expiry:
- The first plugin launch starts a 14-day full-feature trial.
- On day 15, Writer exam-paper tools remain available; all other paid features require activation.
- Reinstalling or normally uninstalling the plugin does not reset the machine code, trial start, or activation state.

Commercial delivery:
- Verify the release SHA-256 list before distribution.
- Internal builds are marked internal-test/pending-certificate and are not commercial deliverables.
- Commercial mode requires and validates a code-signing certificate, private key and timestamp.
- The installer and both Writer and Presentation payload manifests are verified separately.
- WPS may still request its own first-run trust confirmation after an install or upgrade.

Uninstall:
Use Windows Settings > Apps > Installed apps > WPS High School Math Add-in > Uninstall,
or use the Start menu shortcut named Uninstall High School Math Add-in.
The uninstall.cmd file remains available as an offline fallback.
"@
[IO.File]::WriteAllText((Join-Path $stagingPath "README.txt"), $readme, (New-Object Text.UTF8Encoding($false)))

$buildInfo = [ordered]@{
    schemaVersion = 1
    product = $pluginName
    version = $pluginVersion
    channel = $buildChannel
    offline = $true
    features = [ordered]@{
        unifiedRibbon = $true
        pptPlotAutoPlacement = $true
        fullFunctionEditor = $true
        formalAuthorizationPanel = $true
        singleToolCenterPane = $true
        editablePlotMetadata = $true
        packagedFileTaskPanes = $true
        onDemandLoopbackEditorHost = $false
        localHttp = $false
        auxiliaryExecutables = $false
        transactionalDualHostInstall = $true
        payloadIntegrityManifest = $true
        asymmetricOfflineLicensing = $true
        windowsUninstallRegistration = $true
        persistentLocalServer = $false
        symbolSearchAndFavorites = $false
    }
}
[IO.File]::WriteAllText(
    (Join-Path $stagingPath "BUILD-INFO.json"),
    ($buildInfo | ConvertTo-Json -Depth 6),
    (New-Object Text.UTF8Encoding($false))
)

Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stagingPath "*") -DestinationPath $zipPath -CompressionLevel Optimal

$iexpressRoot = Join-Path ([IO.Path]::GetTempPath()) "${pluginName}-${pluginVersion}-iexpress"
New-Item -ItemType Directory -Path ([IO.Path]::GetTempPath()) -Force | Out-Null
Remove-SafeDirectory -Path $iexpressRoot -AllowedRoot ([IO.Path]::GetTempPath())
New-Item -ItemType Directory -Path $iexpressRoot -Force | Out-Null
Copy-Item -LiteralPath $zipPath -Destination (Join-Path $iexpressRoot "payload.zip") -Force
$bootstrapSourcePath = Join-Path $PSScriptRoot "offline-bootstrap.ps1"
if (-not (Test-Path -LiteralPath $bootstrapSourcePath -PathType Leaf)) {
    throw "Offline installer bootstrap script is missing: $bootstrapSourcePath"
}
$bootstrapContent = [IO.File]::ReadAllText($bootstrapSourcePath, (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText(
    (Join-Path $iexpressRoot "bootstrap.ps1"),
    $bootstrapContent,
    (New-Object Text.UTF8Encoding($true))
)

$setupCmd = @'
@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0bootstrap.ps1" -PayloadPath "%~dp0payload.zip"
exit /b %errorlevel%
'@
[IO.File]::WriteAllText((Join-Path $iexpressRoot "setup.cmd"), $setupCmd, (New-Object Text.ASCIIEncoding))

$tempExePath = Join-Path $iexpressRoot "${pluginName}-${pluginVersion}-offline.exe"
$sedPath = Join-Path $iexpressRoot "installer.sed"
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3

[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$tempExePath
FriendlyName=WPS High School Math Offline Installer
AppLaunched=setup.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles

[SourceFiles]
SourceFiles0=$iexpressRoot\

[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=

[Strings]
FILE0="setup.cmd"
FILE1="payload.zip"
FILE2="bootstrap.ps1"
"@
[IO.File]::WriteAllText($sedPath, $sed, (New-Object Text.ASCIIEncoding))

$iexpressExe = Join-Path $env:WINDIR "System32\iexpress.exe"
Start-Process -FilePath $iexpressExe -ArgumentList @("/N", "/Q", $sedPath) -WindowStyle Hidden -Wait
if (-not (Test-Path -LiteralPath $tempExePath)) {
    $ddfPath = Get-ChildItem -LiteralPath $iexpressRoot -Filter "*.DDF" |
        Select-Object -First 1 -ExpandProperty FullName
    if ($ddfPath) {
        & (Join-Path $env:WINDIR "System32\makecab.exe") /F $ddfPath | Out-Null
        Start-Process -FilePath $iexpressExe -ArgumentList @("/N", "/Q", $sedPath) -WindowStyle Hidden -Wait
    }
}
if (-not (Test-Path -LiteralPath $tempExePath)) {
    throw "IExpress did not create the offline EXE installer after the MakeCab fallback."
}
Copy-Item -LiteralPath $tempExePath -Destination $exePath -Force
Invoke-CodeSign -Path $exePath

$authenticode = Get-AuthenticodeSignature -LiteralPath $exePath
if ($signingRequested -and $authenticode.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "The installer signature did not validate after signing. Status: $($authenticode.Status)"
}

$artifactFiles = @($zipPath, $exePath)
$artifactRows = @()
$checksumLines = @()
foreach ($artifactPath in $artifactFiles) {
    $item = Get-Item -LiteralPath $artifactPath
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifactPath).Hash.ToLowerInvariant()
    $artifactRows += [ordered]@{
        file = $item.Name
        bytes = [long]$item.Length
        sha256 = $hash
    }
    $checksumLines += "$hash  $($item.Name)"
}
[IO.File]::WriteAllLines($checksumsPath, $checksumLines, (New-Object Text.UTF8Encoding($false)))

$installerSignatureRecord = Get-SignatureRecord -Path $exePath -LogicalPath ([IO.Path]::GetFileName($exePath))
$signedBinaryRecords = @($installerSignatureRecord)
$allBinariesSignedAndTimestamped = @(
    $signedBinaryRecords |
        Where-Object { $_.status -eq "valid" -and [bool]$_.timestamped }
).Count -eq $signedBinaryRecords.Count
if ($signingRequested -and -not $allBinariesSignedAndTimestamped) {
    throw "Every commercial binary must have a valid Authenticode signature and timestamp."
}
$releaseManifest = [ordered]@{
    schemaVersion = 3
    product = $pluginName
    version = $pluginVersion
    channel = $buildChannel
    buildMode = $BuildMode
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    offline = $true
    signing = [ordered]@{
        requested = $signingRequested
        required = $commercialBuild
        status = if ($allBinariesSignedAndTimestamped) { "valid" } else { "pending-certificate" }
        certificateStoreLocation = if ($signingRequested) { $CertificateStoreLocation } else { $null }
        certificateThumbprint = if ($signingRequested) { $normalizedThumbprint } else { $null }
        timestampUrl = if ($signingRequested) { $TimestampUrl } else { $null }
        binaries = $signedBinaryRecords
    }
    taskPanes = [ordered]@{
        enabled = $true
        source = "packaged-file"
        allowedPages = @("tool-center", "function-plot", "license")
        versionedHtml = $true
        readyTransport = "PluginStorage"
        localHttp = $false
        auxiliaryExecutables = $false
    }
    artifacts = $artifactRows
    payloads = @(
        [ordered]@{
            name = $pluginName
            type = "wps"
            folder = $pluginFolderName
            fileCount = $writerPayloadManifest.FileCount
            payloadSha256 = $writerPayloadManifest.PayloadSha256
            manifestSha256 = $writerPayloadManifest.Sha256
            ribbonSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $payloadPath "ribbon.xml")).Hash.ToLowerInvariant()
        },
        [ordered]@{
            name = $pptPluginName
            type = "wpp"
            folder = "${pptPluginName}_${pluginVersion}"
            fileCount = $pptPayloadManifest.FileCount
            payloadSha256 = $pptPayloadManifest.PayloadSha256
            manifestSha256 = $pptPayloadManifest.Sha256
            ribbonSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $pptPayloadPath "ribbon.xml")).Hash.ToLowerInvariant()
        }
    )
    featureDecisions = $buildInfo.features
}
[IO.File]::WriteAllText(
    $releaseManifestPath,
    ($releaseManifest | ConvertTo-Json -Depth 8),
    (New-Object Text.UTF8Encoding($false))
)

$validationArguments = @{ ReleasePath = $releasePath }
if ($commercialBuild) {
    $validationArguments.RequireSignature = $true
}
& (Join-Path $PSScriptRoot "validate-commercial-release.ps1") @validationArguments

Write-Output "$BuildMode offline release created:"
Get-Item -LiteralPath $zipPath, $exePath, $checksumsPath, $releaseManifestPath |
    Select-Object Name, Length
Write-Output "Authenticode status: $($releaseManifest.signing.status)"
