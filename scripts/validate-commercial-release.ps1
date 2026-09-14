param(
    [string]$ReleasePath,
    [switch]$RequireSignature
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "payload-integrity.ps1")
if (-not $ReleasePath) {
    $ReleasePath = Join-Path $projectRoot "release"
}
if (-not (Test-Path -LiteralPath $ReleasePath -PathType Container)) {
    throw "Release directory was not found: $ReleasePath"
}
$ReleasePath = (Resolve-Path -LiteralPath $ReleasePath).Path
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$pluginName = [string]$package.name
$pptPluginName = "${pluginName}Ppt"
$version = [string]$package.version
$versionSuffix = $version -replace '[^A-Za-z0-9._-]', '_'
$stagingPath = Join-Path $ReleasePath "${pluginName}-${version}-offline"
$zipPath = Join-Path $ReleasePath "${pluginName}-${version}-offline.zip"
$exePath = Join-Path $ReleasePath "${pluginName}-${version}-offline.exe"
$checksumsPath = Join-Path $ReleasePath "${pluginName}-${version}-checksums.sha256"
$manifestPath = Join-Path $ReleasePath "${pluginName}-${version}-release-manifest.json"

function Assert-ReleaseCondition {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        throw "Release validation failed: $Message"
    }
}

function Test-ArchiveEntryName {
    param([string]$Name)
    $normalized = ([string]$Name).Replace('\', '/')
    return [bool]($normalized -and -not $normalized.StartsWith('/') -and
        $normalized -notmatch '^[A-Za-z]:' -and $normalized -notmatch '(^|/)\.\.(/|$)')
}

function Assert-UnifiedRibbon {
    param([string]$Path)
    [xml]$ribbon = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $tabs = @($ribbon.SelectNodes("//*[local-name()='tabs']/*[local-name()='tab']"))
    $expectedLabel = ([char]0x9AD8).ToString() + ([char]0x4E2D).ToString() +
        ([char]0x6570).ToString() + ([char]0x5B66).ToString()
    Assert-ReleaseCondition ($tabs.Count -eq 1) "$Path must contain exactly one add-in tab."
    Assert-ReleaseCondition ($tabs[0].GetAttribute("label") -eq $expectedLabel) "$Path has the wrong unified tab label."
    Assert-ReleaseCondition (@($ribbon.SelectNodes("//*[@id='function_plot']")).Count -eq 1) "$Path must contain the function editor button."
    Assert-ReleaseCondition (@($ribbon.SelectNodes("//*[@id='authorization_center']")).Count -eq 1) "$Path must contain the authorization-center button."
}

function Assert-PackagedPayload {
    param(
        [string]$PayloadPath,
        [string]$Plugin,
        [string]$HostType,
        [string]$ManifestSha256
    )
    $result = Test-HsmPayload `
        -PayloadPath $PayloadPath `
        -ExpectedProduct $pluginName `
        -ExpectedPluginName $Plugin `
        -ExpectedVersion $version `
        -ExpectedHostType $HostType `
        -ExpectedManifestSha256 $ManifestSha256
    foreach ($relative in @(
        "ui\function-plot-$versionSuffix.html",
        "ui\license-$versionSuffix.html",
        "ui\tool-center-$versionSuffix.html",
        "ui\function-plot.html",
        "ui\license.html",
        "ui\tool-center.html",
        "js\taskpane.js",
        "js\license-public-key.js",
        "js\vendor\tweetnacl-fast.min.js",
        "js\vendor\TWEETNACL-LICENSE.txt"
    )) {
        Assert-ReleaseCondition (Test-Path -LiteralPath (Join-Path $PayloadPath $relative) -PathType Leaf) "Packaged task-pane file is missing: $relative"
    }
    Assert-ReleaseCondition (-not (Test-Path -LiteralPath (Join-Path $PayloadPath "entry.js"))) "$Plugin still contains entry.js."
    Assert-ReleaseCondition (-not (Test-Path -LiteralPath (Join-Path $PayloadPath "runtime"))) "$Plugin still contains a runtime helper directory."
    $binary = Get-ChildItem -LiteralPath $PayloadPath -Recurse -File |
        Where-Object { $_.Extension -in @(".exe", ".dll") } |
        Select-Object -First 1
    Assert-ReleaseCondition ($null -eq $binary) "$Plugin contains an auxiliary executable or DLL."
    $taskPane = Get-Content -LiteralPath (Join-Path $PayloadPath "js\taskpane.js") -Raw -Encoding UTF8
    Assert-ReleaseCondition ($taskPane.Contains("openPackaged") -and $taskPane.Contains("CreateTaskPane") -and
        $taskPane.Contains("PluginStorage") -and $taskPane.Contains("file:")) "$Plugin does not contain the packaged-file task-pane contract."
    foreach ($forbidden in @("localhost", "127.0.0.1", "ShellExecute", "OAAssist", "XMLHttpRequest", "WpsHighSchoolMathEditorHost")) {
        Assert-ReleaseCondition ($taskPane.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -lt 0) "$Plugin task-pane manager contains forbidden runtime text: $forbidden"
    }
    return $result
}

foreach ($requiredPath in @($stagingPath, $zipPath, $exePath, $checksumsPath, $manifestPath)) {
    Assert-ReleaseCondition (Test-Path -LiteralPath $requiredPath) "Missing release path: $requiredPath"
}
Assert-UnifiedRibbon -Path (Join-Path $projectRoot "ribbon.xml")
Assert-UnifiedRibbon -Path (Join-Path $projectRoot "ppt\ribbon.xml")

$writerRibbonSource = Get-Content -LiteralPath (Join-Path $projectRoot "js\ribbon.js") -Raw -Encoding UTF8
$pptRibbonSource = Get-Content -LiteralPath (Join-Path $projectRoot "js\ribbon-ppt.js") -Raw -Encoding UTF8
$taskPaneSource = Get-Content -LiteralPath (Join-Path $projectRoot "js\taskpane.js") -Raw -Encoding UTF8
$licenseSource = Get-Content -LiteralPath (Join-Path $projectRoot "js\license.js") -Raw -Encoding UTF8
$licensePublicKeySource = Get-Content -LiteralPath (Join-Path $projectRoot "js\license-public-key.js") -Raw -Encoding UTF8
$licenseHtmlSource = Get-Content -LiteralPath (Join-Path $projectRoot "ui\license.html") -Raw -Encoding UTF8
$licenseEntrySource = Get-Content -LiteralPath (Join-Path $projectRoot "ui\license-entry.js") -Raw -Encoding UTF8
$toolCenterSource = Get-Content -LiteralPath (Join-Path $projectRoot "ui\tool-center.html") -Raw -Encoding UTF8
$licenseUiSource = Get-Content -LiteralPath (Join-Path $projectRoot "ui\license-ui.js") -Raw -Encoding UTF8
$documentSource = Get-Content -LiteralPath (Join-Path $projectRoot "js\function-plot-document.js") -Raw -Encoding UTF8
$pptApiSource = Get-Content -LiteralPath (Join-Path $projectRoot "js\ppt-api.js") -Raw -Encoding UTF8
$installerSource = Get-Content -LiteralPath (Join-Path $projectRoot "scripts\offline-install.ps1") -Raw -Encoding UTF8
$bootstrapSource = Get-Content -LiteralPath (Join-Path $projectRoot "scripts\offline-bootstrap.ps1") -Raw -Encoding UTF8
$builderSource = Get-Content -LiteralPath (Join-Path $projectRoot "scripts\build-offline.ps1") -Raw -Encoding UTF8
$uninstallerSource = Get-Content -LiteralPath (Join-Path $projectRoot "scripts\offline-uninstall.ps1") -Raw -Encoding UTF8
$uninstallRegistrationSource = Get-Content -LiteralPath (Join-Path $projectRoot "scripts\uninstall-registration.ps1") -Raw -Encoding UTF8
$uninstallCleanupSource = Get-Content -LiteralPath (Join-Path $projectRoot "scripts\offline-uninstall-cleanup.ps1") -Raw -Encoding UTF8
$wpsConfigurationSource = Get-Content -LiteralPath (Join-Path $projectRoot "scripts\offline-configure-wps.ps1") -Raw -Encoding UTF8

Assert-ReleaseCondition ($writerRibbonSource.Contains("openPackaged") -and $writerRibbonSource.Contains('role: "writer"')) "Writer does not use the packaged task-pane manager."
Assert-ReleaseCondition ($pptRibbonSource.Contains("openPackaged") -and $pptRibbonSource.Contains('role: "presentation"')) "Presentation does not use the packaged task-pane manager."
Assert-ReleaseCondition ($licenseSource.Contains("MathTaskPanes.openPackaged") -and -not ($licenseSource -match '\balert\s*\(') -and
    -not ($licenseSource -match '\bprompt\s*\(') -and -not $licenseSource.Contains("InputBox")) "Authorization center is not a formal packaged panel."
Assert-ReleaseCondition ($licenseSource.Contains("HSM2") -and $licenseSource.Contains("nacl.sign.detached.verify") -and
    -not $licenseSource.Contains("WPS-HIGH-SCHOOL-MATH-LOCAL-LICENSE-2026") -and
    -not $licenseSource.Contains("createLicenseCode")) "Authorization must use public-key verification without issuer secrets."
Assert-ReleaseCondition ($licensePublicKeySource.Contains("MathLicensePublicKey")) "Ed25519 public-key module is missing."
Assert-ReleaseCondition ($licenseSource.Contains('wechat: "qzt65631"')) "Configured WeChat contact is missing."
foreach ($controlId in @("copyMachineCode", "pasteActivationCode", "expiryTime", "wechatNumber", "copyWechatNumber", "qqNumber", "copyQqNumber")) {
    Assert-ReleaseCondition ($licenseEntrySource.Contains("id=`"$controlId`"")) "Authorization-panel control is missing: $controlId"
}
Assert-ReleaseCondition ($licenseHtmlSource.Contains("license-entry.js")) "Authorization compatibility page does not load its panel view."
Assert-ReleaseCondition ($toolCenterSource.Contains('data-view="function-plot"') -and $toolCenterSource.Contains('data-view="license"')) "Shared tool-center tabs are incomplete."
Assert-ReleaseCondition ($licenseUiSource.Contains('MathTaskPanes.signalReady("license")')) "Authorization panel does not signal ready."
Assert-ReleaseCondition ($taskPaneSource.Contains("openPackaged") -and $taskPaneSource.Contains("PAGE_MAP") -and
    $taskPaneSource.Contains("versionedPagePath")) "Packaged task-pane whitelist is incomplete."
foreach ($forbidden in @("openLocalEditor", "localhost", "127.0.0.1", "ShellExecute", "OAAssist", "XMLHttpRequest", "WpsHighSchoolMathEditorHost")) {
    Assert-ReleaseCondition ($taskPaneSource.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -lt 0) "Source task-pane manager contains forbidden runtime text: $forbidden"
}
Assert-ReleaseCondition ($documentSource.Contains("HSM_FUNCTION_PLOT_V1:") -and $documentSource.Contains("insertOrUpdate")) "Editable function-plot metadata is incomplete."
Assert-ReleaseCondition ($pptApiSource.Contains("findBestPlacement") -and $pptApiSource.Contains("measureOverlap")) "Presentation auto-placement engine is incomplete."
Assert-ReleaseCondition ($installerSource.Contains("Invoke-HsmInstallTransaction") -and $installerSource.Contains("Test-HsmPayload")) "Transactional payload install gate is missing."
Assert-ReleaseCondition ($installerSource.Contains("Test-WpsProcessHasUserWindow") -and
    $installerSource.Contains("MainWindowHandle") -and $installerSource.Contains("Stop-WpsBackgroundHosts -Processes `$wpsProcesses")) "Installer does not distinguish visible WPS documents from headless startup processes."
Assert-ReleaseCondition ($uninstallerSource.Contains("Test-WpsProcessHasUserWindow") -and
    $uninstallerSource.Contains("MainWindowHandle") -and $uninstallerSource.Contains("Stop-WpsBackgroundHosts -Processes `$wpsProcesses")) "Uninstaller does not distinguish visible WPS documents from headless startup processes."
Assert-ReleaseCondition ($bootstrapSource.Contains("Get-FriendlyInstallerMessage") -and
    $bootstrapSource.Contains("System.Windows.Forms") -and $bootstrapSource.Contains("WpsHighSchoolMath\Logs") -and
    $bootstrapSource.Contains("Remove-SafeExtractionDirectory")) "Installer failure dialog, logging, or temporary-directory cleanup is missing."
Assert-ReleaseCondition ($builderSource.Contains("ShowInstallProgramWindow=0") -and
    $builderSource.Contains('FILE2="bootstrap.ps1"') -and $builderSource.Contains('-STA -File "%~dp0bootstrap.ps1"')) "EXE installer does not launch the failure-aware bootstrap without a transient console window."
Assert-ReleaseCondition ($installerSource.Contains("Update-AuthorizationCache") -and $installerSource.Contains("PreserveApproval")) "Authorization-cache integrity policy is missing."
Assert-ReleaseCondition ($installerSource.Contains("Stop-LocalEditorHosts") -and $uninstallerSource.Contains("Stop-LocalEditorHosts")) "Legacy EditorHost upgrade cleanup is missing."
Assert-ReleaseCondition (-not $installerSource.Contains('$installedLicensePath')) "Installer must not mutate installed add-in source files."
Assert-ReleaseCondition ($licenseSource.Contains("var TRIAL_DAYS = 14") -and $licenseSource.Contains('planLabel: trial.active ? "14 天全功能试用"')) "Commercial trial must remain a 14-day full-feature trial."
Assert-ReleaseCondition ($installerSource.Contains("Register-HsmUninstaller") -and $uninstallRegistrationSource.Contains("Windows\CurrentVersion\Uninstall\WpsHighSchoolMath")) "Windows installed-app registration is missing."
Assert-ReleaseCondition (-not $installerSource.Contains("Test-Administrator") -and -not $installerSource.Contains(' -Elevated')) "Per-user installation must not elevate the entire installer."
Assert-ReleaseCondition ($installerSource.Contains("configure-wps.ps1") -and $wpsConfigurationSource.Contains("JsApiShowWebDebugger")) "Optional elevated WPS configuration step is missing."
Assert-ReleaseCondition ($uninstallRegistrationSource.Contains("QuietUninstallString") -and $uninstallRegistrationSource.Contains("卸载高中数学插件.cmd")) "Windows uninstall commands or Start-menu entry are missing."
Assert-ReleaseCondition ($uninstallerSource.Contains("Remove-HsmAuthorizationEntries") -and $uninstallerSource.Contains("Unregister-HsmUninstaller")) "Uninstaller does not remove its WPS authorization cache and Windows registration."
Assert-ReleaseCondition ($uninstallCleanupSource.Contains('Programs\WpsHighSchoolMath') -and $uninstallCleanupSource.Contains("Remove-Item")) "Restricted uninstaller self-cleanup is missing."

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-ReleaseCondition ([int]$manifest.schemaVersion -eq 3) "Release manifest schema must be version 3."
Assert-ReleaseCondition ([string]$manifest.product -eq $pluginName -and [string]$manifest.version -eq $version) "Release identity does not match package.json."
Assert-ReleaseCondition ([bool]$manifest.offline) "Release manifest does not declare offline operation."
Assert-ReleaseCondition ([string]$manifest.buildMode -in @("Internal", "Commercial")) "Release build mode is invalid."
if ([string]$manifest.buildMode -eq "Commercial") {
    Assert-ReleaseCondition ([string]$manifest.channel -eq "commercial-offline" -and [bool]$manifest.signing.required) "Commercial release channel or signing requirement is invalid."
} else {
    Assert-ReleaseCondition ([string]$manifest.channel -eq "internal-test") "Internal builds must use the internal-test channel."
}
if ($RequireSignature) {
    Assert-ReleaseCondition ([string]$manifest.buildMode -eq "Commercial") "-RequireSignature requires a Commercial build."
}
Assert-ReleaseCondition ([bool]$manifest.taskPanes.enabled -and [string]$manifest.taskPanes.source -eq "packaged-file") "Packaged-file task panes are not declared."
Assert-ReleaseCondition ([bool]$manifest.taskPanes.versionedHtml -and [string]$manifest.taskPanes.readyTransport -eq "PluginStorage") "Task-pane cache or ready contract is invalid."
Assert-ReleaseCondition (-not [bool]$manifest.taskPanes.localHttp -and -not [bool]$manifest.taskPanes.auxiliaryExecutables) "Release still declares local HTTP or auxiliary executables."
Assert-ReleaseCondition (@($manifest.taskPanes.allowedPages).Count -eq 3 -and
    @($manifest.taskPanes.allowedPages) -contains "tool-center" -and
    @($manifest.taskPanes.allowedPages) -contains "function-plot" -and @($manifest.taskPanes.allowedPages) -contains "license") "Task-pane page whitelist is invalid."
Assert-ReleaseCondition ([bool]$manifest.featureDecisions.unifiedRibbon -and [bool]$manifest.featureDecisions.fullFunctionEditor -and
    [bool]$manifest.featureDecisions.formalAuthorizationPanel -and [bool]$manifest.featureDecisions.singleToolCenterPane -and
    [bool]$manifest.featureDecisions.packagedFileTaskPanes -and [bool]$manifest.featureDecisions.asymmetricOfflineLicensing -and
    [bool]$manifest.featureDecisions.windowsUninstallRegistration) "Required feature decisions are missing."
Assert-ReleaseCondition (-not [bool]$manifest.featureDecisions.onDemandLoopbackEditorHost -and
    -not [bool]$manifest.featureDecisions.localHttp -and -not [bool]$manifest.featureDecisions.auxiliaryExecutables) "Feature decisions still allow a loopback helper."

$checksumEntries = @{}
foreach ($line in Get-Content -LiteralPath $checksumsPath -Encoding UTF8) {
    if ($line -match '^([0-9a-fA-F]{64})\s+(.+)$') {
        $checksumEntries[$matches[2]] = $matches[1].ToLowerInvariant()
    }
}
$artifacts = @($manifest.artifacts)
Assert-ReleaseCondition ($artifacts.Count -eq 2) "Release manifest must contain exactly the ZIP and EXE artifacts."
foreach ($artifact in $artifacts) {
    $artifactPath = Join-Path $ReleasePath ([string]$artifact.file)
    Assert-ReleaseCondition (Test-Path -LiteralPath $artifactPath -PathType Leaf) "Manifest artifact is missing: $($artifact.file)"
    $actualHash = Get-HsmSha256 -Path $artifactPath
    Assert-ReleaseCondition ($actualHash -eq [string]$artifact.sha256 -and [long](Get-Item $artifactPath).Length -eq [long]$artifact.bytes) "Manifest identity mismatch for $($artifact.file)."
    Assert-ReleaseCondition ($checksumEntries[[string]$artifact.file] -eq $actualHash) "Checksum list mismatch for $($artifact.file)."
}

$payloadByName = @{}
foreach ($record in @($manifest.payloads)) { $payloadByName[[string]$record.name] = $record }
Assert-ReleaseCondition ($payloadByName.Count -eq 2) "Release manifest must contain exactly two payloads."
foreach ($payloadSpec in @(
    @{ Name = $pluginName; Type = "wps"; Folder = "${pluginName}_${version}" },
    @{ Name = $pptPluginName; Type = "wpp"; Folder = "${pptPluginName}_${version}" }
)) {
    $record = $payloadByName[$payloadSpec.Name]
    Assert-ReleaseCondition ($null -ne $record) "Payload record is missing: $($payloadSpec.Name)"
    Assert-ReleaseCondition ([string]$record.folder -eq $payloadSpec.Folder -and [string]$record.type -eq $payloadSpec.Type) "Payload record identity is invalid: $($payloadSpec.Name)"
    $result = Assert-PackagedPayload `
        -PayloadPath (Join-Path $stagingPath "payload\$($payloadSpec.Folder)") `
        -Plugin $payloadSpec.Name `
        -HostType $payloadSpec.Type `
        -ManifestSha256 ([string]$record.manifestSha256)
    Assert-ReleaseCondition ([int]$record.fileCount -eq $result.FileCount -and
        [string]$record.payloadSha256 -eq $result.PayloadSha256) "Payload aggregate identity mismatch: $($payloadSpec.Name)"
}

$zeroPolicy = Join-Path $projectRoot "scripts\zero-loopback-policy.js"
& node $zeroPolicy --profile source --root $projectRoot
Assert-ReleaseCondition ($LASTEXITCODE -eq 0) "Source zero-loopback policy failed."
& node $zeroPolicy --profile staging --root $stagingPath
Assert-ReleaseCondition ($LASTEXITCODE -eq 0) "Staging zero-loopback policy failed."

$extractRoot = Join-Path ([IO.Path]::GetTempPath()) ("hsm-release-validation-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
$resolvedExtractRoot = (Resolve-Path -LiteralPath $extractRoot).Path.TrimEnd('\') + '\'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entryNames = @()
    foreach ($entry in $archive.Entries) {
        $entryName = $entry.FullName.Replace('\', '/')
        Assert-ReleaseCondition (Test-ArchiveEntryName -Name $entryName) "ZIP contains an unsafe path: $entryName"
        $entryNames += $entryName
        $destination = [IO.Path]::GetFullPath((Join-Path $extractRoot $entryName.Replace('/', '\')))
        Assert-ReleaseCondition ($destination.StartsWith($resolvedExtractRoot, [StringComparison]::OrdinalIgnoreCase)) "ZIP extraction escaped the validation directory."
        if ($entryName.EndsWith('/')) {
            New-Item -ItemType Directory -Path $destination -Force | Out-Null
        } else {
            New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
        }
    }
    $writerFolder = "payload/${pluginName}_${version}"
    $pptFolder = "payload/${pptPluginName}_${version}"
    foreach ($requiredEntry in @(
        "BUILD-INFO.json", "configure-wps.ps1", "install.cmd", "install.ps1", "uninstall.cmd", "uninstall.ps1", "uninstall-cleanup.ps1", "uninstall-registration.ps1", "validate-installed.ps1", "payload-integrity.ps1",
        "$writerFolder/PAYLOAD-MANIFEST.json", "$writerFolder/ui/function-plot-$versionSuffix.html", "$writerFolder/ui/license-$versionSuffix.html", "$writerFolder/ui/tool-center-$versionSuffix.html",
        "$pptFolder/PAYLOAD-MANIFEST.json", "$pptFolder/ui/function-plot-$versionSuffix.html", "$pptFolder/ui/license-$versionSuffix.html", "$pptFolder/ui/tool-center-$versionSuffix.html"
    )) {
        Assert-ReleaseCondition ($entryNames -contains $requiredEntry) "ZIP payload entry is missing: $requiredEntry"
    }
    foreach ($entryName in $entryNames) {
        $normalized = $entryName.ToLowerInvariant()
        Assert-ReleaseCondition ($normalized -notmatch '\.(pem|key|pfx|p12)$' -and
            $normalized -notmatch '(^|/)(private.*key|key.*private)') "ZIP contains private licensing material: $entryName"
        if ($normalized.StartsWith("payload/")) {
            Assert-ReleaseCondition ($normalized -notmatch '(^|/)entry\.js$' -and $normalized -notmatch '(^|/)runtime/' -and
                $normalized -notmatch '\.(exe|dll)$') "ZIP payload contains a forbidden runtime file: $entryName"
        }
    }
    & node $zeroPolicy --profile staging --root $extractRoot
    Assert-ReleaseCondition ($LASTEXITCODE -eq 0) "Extracted ZIP zero-loopback policy failed."
} finally {
    $archive.Dispose()
    if (Test-Path -LiteralPath $extractRoot) {
        $resolved = (Resolve-Path -LiteralPath $extractRoot).Path
        $tempPrefix = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path.TrimEnd('\') + '\'
        Assert-ReleaseCondition ($resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) "Refusing to remove a validation directory outside the temporary root."
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

$binaryRecords = @($manifest.signing.binaries)
Assert-ReleaseCondition ($binaryRecords.Count -eq 1 -and [string]$binaryRecords[0].file -eq [IO.Path]::GetFileName($exePath)) "Only the installer may appear in the signature records."
Assert-ReleaseCondition ((Get-HsmSha256 -Path $exePath) -eq [string]$binaryRecords[0].sha256) "Installer signature-record hash is invalid."
$signatureRequired = [bool]$RequireSignature -or [bool]$manifest.signing.required -or [bool]$manifest.signing.requested
$signature = Get-AuthenticodeSignature -LiteralPath $exePath
if ($signatureRequired) {
    Assert-ReleaseCondition ($signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid -and
        [string]$binaryRecords[0].status -eq "valid" -and $null -ne $signature.TimeStamperCertificate -and
        [bool]$binaryRecords[0].timestamped) "A valid timestamped installer signature is required."
    Assert-ReleaseCondition ($signature.SignerCertificate.Thumbprint -eq [string]$manifest.signing.certificateThumbprint) "Installer signer certificate mismatch."
    Assert-ReleaseCondition ([string]$manifest.signing.status -eq "valid") "Release signing status is not valid."
} else {
    Assert-ReleaseCondition ([string]$binaryRecords[0].status -eq "pending-certificate" -and
        [string]$manifest.signing.status -eq "pending-certificate") "Unsigned internal release must be marked pending-certificate."
}

Write-Output "Release validation passed."
[pscustomobject]@{
    Product = $pluginName
    Version = $version
    BuildMode = [string]$manifest.buildMode
    RibbonTabsPerHost = 1
    FunctionEditor = "packaged-file-with-pluginstorage-ready"
    PptPlacement = "shape-aware"
    LocalHttp = $false
    AuxiliaryExecutables = $false
    Signature = [string]$manifest.signing.status
    RequireSignature = [bool]$RequireSignature
}
