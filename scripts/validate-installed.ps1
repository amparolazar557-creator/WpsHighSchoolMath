param(
    [string]$JsAddonsPath,
    [string]$PublishPath,
    [string]$UninstallRoot,
    [string]$UninstallRegistryPath,
    [string]$StartMenuDirectory,
    [switch]$SkipUninstallRegistration,
    [switch]$RequireSignature
)

$ErrorActionPreference = "Stop"

$pluginName = "__PLUGIN_NAME__"
$pptPluginName = "__PPT_PLUGIN_NAME__"
$pluginVersion = "__PLUGIN_VERSION__"
$plugins = @(
    [pscustomobject][ordered]@{
        Name = $pluginName
        Type = "wps"
        FolderName = "${pluginName}_${pluginVersion}"
        ManifestSha256 = "__WRITER_PAYLOAD_MANIFEST_SHA256__"
    },
    [pscustomobject][ordered]@{
        Name = $pptPluginName
        Type = "wpp"
        FolderName = "${pptPluginName}_${pluginVersion}"
        ManifestSha256 = "__PPT_PAYLOAD_MANIFEST_SHA256__"
    }
)

$integrityScript = Join-Path $PSScriptRoot "payload-integrity.ps1"
if (-not (Test-Path -LiteralPath $integrityScript -PathType Leaf)) {
    throw "Payload integrity helper was not found: $integrityScript"
}
. $integrityScript

if (-not $JsAddonsPath) {
    $JsAddonsPath = Join-Path $env:APPDATA "kingsoft\wps\jsaddons"
}
if (-not (Test-Path -LiteralPath $JsAddonsPath -PathType Container)) {
    throw "WPS jsaddons directory was not found: $JsAddonsPath"
}
$JsAddonsPath = (Resolve-Path -LiteralPath $JsAddonsPath).Path
if (-not $PublishPath) {
    $PublishPath = Join-Path $JsAddonsPath "publish.xml"
}
if (-not (Test-Path -LiteralPath $PublishPath -PathType Leaf)) {
    throw "WPS publish.xml was not found: $PublishPath"
}

[xml]$publishXml = Get-Content -LiteralPath $PublishPath -Raw -Encoding UTF8
$root = $publishXml.DocumentElement
$results = @()
foreach ($plugin in $plugins) {
    $payloadPath = Join-Path $JsAddonsPath $plugin.FolderName
    $payloadResult = Test-HsmPayload `
        -PayloadPath $payloadPath `
        -ExpectedProduct $pluginName `
        -ExpectedPluginName $plugin.Name `
        -ExpectedVersion $pluginVersion `
        -ExpectedHostType $plugin.Type `
        -ExpectedManifestSha256 $plugin.ManifestSha256

    $registrations = @($root.SelectNodes("*[@name='$($plugin.Name)']"))
    if ($registrations.Count -ne 1) {
        throw "Expected exactly one publish.xml registration for $($plugin.Name); found $($registrations.Count)."
    }
    $registration = $registrations[0]
    if ($registration.GetAttribute("type") -ne $plugin.Type -or
        $registration.GetAttribute("url") -ne $plugin.FolderName -or
        $registration.GetAttribute("version") -ne $pluginVersion -or
        $registration.GetAttribute("enable") -ne "enable_dev") {
        throw "publish.xml registration does not match the installed $($plugin.Type) payload for $($plugin.Name)."
    }

    $versionSuffix = $pluginVersion -replace '[^A-Za-z0-9._-]', '_'
    foreach ($pageName in @("function-plot", "license")) {
        $pagePath = Join-Path $payloadPath "ui\$pageName-$versionSuffix.html"
        if (-not (Test-Path -LiteralPath $pagePath -PathType Leaf)) {
            throw "Installed packaged task-pane page is missing: $pagePath"
        }
    }
    if (Test-Path -LiteralPath (Join-Path $payloadPath "runtime")) {
        throw "Installed payload must not contain a runtime helper directory: $payloadPath"
    }
    $unexpectedBinary = Get-ChildItem -LiteralPath $payloadPath -Recurse -File -ErrorAction Stop |
        Where-Object { $_.Extension -in @(".exe", ".dll") } |
        Select-Object -First 1
    if ($unexpectedBinary) {
        throw "Installed payload contains an auxiliary binary: $($unexpectedBinary.FullName)"
    }
    $taskPanePath = Join-Path $payloadPath "js\taskpane.js"
    $taskPaneSource = Get-Content -LiteralPath $taskPanePath -Raw -Encoding UTF8
    foreach ($requiredText in @("openPackaged", "PluginStorage", "file:")) {
        if (-not $taskPaneSource.Contains($requiredText)) {
            throw "Installed packaged task-pane manager is missing $requiredText."
        }
    }

    $results += [pscustomobject][ordered]@{
        Plugin = $payloadResult.PluginName
        Host = $payloadResult.HostType
        Version = $payloadResult.Version
        Files = $payloadResult.FileCount
        PayloadSha256 = $payloadResult.PayloadSha256
        ManifestSha256 = $payloadResult.ManifestSha256
        Registration = "$($plugin.Type) -> $($plugin.FolderName)"
        TaskPaneSource = "packaged-file"
        AuxiliaryExecutables = $false
    }
}

$uninstallResult = $null
if (-not $SkipUninstallRegistration) {
    $uninstallRegistrationScript = Join-Path $PSScriptRoot "uninstall-registration.ps1"
    if (-not (Test-Path -LiteralPath $uninstallRegistrationScript -PathType Leaf)) {
        throw "Installed-uninstaller validation helper is missing: $uninstallRegistrationScript"
    }
    . $uninstallRegistrationScript
    $uninstallResult = Test-HsmUninstallerRegistration `
        -Version $pluginVersion `
        -UninstallRoot $UninstallRoot `
        -RegistryPath $UninstallRegistryPath `
        -StartMenuDirectory $StartMenuDirectory
}

Write-Output "Installed WPS High School Math payload validation passed."
$results
if ($uninstallResult) {
    Write-Output "Windows uninstall registration validation passed."
    $uninstallResult
}
