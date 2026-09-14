param(
    [string]$JsAddonsPath = "",
    [ValidateSet("Source", "Full", "Compat")][string]$Mode = "Source"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "probe-common.ps1")
$manifest = Get-NativeProbeManifest
if ($manifest.version -ne 6 -or $manifest.commercialPayload -ne $false -or $manifest.formalWhitelistEligible -ne $false) {
    throw "Probe manifest identity or isolation flags are invalid."
}
if ([string]$manifest.hardGate.nativeDialogBridge -ne "Application.CreateObject+NativeX.OnWpsLoad+x86-inprocess-native-dialog" -or
    [string]$manifest.hardGate.bridgeAbi -ne "NativeX-OnWpsLoad-1.1" -or
    [string]$manifest.hardGate.nativeXModule -ne "hsmmathnativeprobe" -or
    [string]$manifest.hardGate.nativeXEntry -ne "OnWpsLoad" -or
    (@($manifest.hardGate.requiredFileApis) -join "|") -ne "writeAsBinaryString|readAsBinaryString" -or
    [string]$manifest.hardGate.storageEncoding -ne "ES5-UTF8-Base64" -or
    $manifest.hardGate.legacyTransportCanPass -ne $false) {
    throw "Scheme-A hard-gate manifest contract is invalid."
}

$definitions = @(Get-NativeProbeDefinitions)
foreach ($definition in $definitions) {
    $source = Join-Path (Join-Path $script:ProbeRoot "src") $definition.Host
    foreach ($name in @("index.html", "main.js", "manifest.xml", "ribbon.xml", "ribbon.compat.xml")) {
        if (-not (Test-Path -LiteralPath (Join-Path $source $name) -PathType Leaf)) { throw "Missing probe source file: $($definition.Host)/$name" }
    }
    [xml]$fullRibbon = Get-Content -LiteralPath (Join-Path $source "ribbon.xml") -Raw -Encoding UTF8
    [xml]$compatRibbon = Get-Content -LiteralPath (Join-Path $source "ribbon.compat.xml") -Raw -Encoding UTF8
    if (@($fullRibbon.SelectNodes("//*[local-name()='editBox']")).Count -ne 0) { throw "$($definition.Host) scheme-A Ribbon must not contain editBox." }
    $inputButtons = @($fullRibbon.SelectNodes("//*[local-name()='button' and @id='probe_open_input']"))
    if ($inputButtons.Count -ne 1 -or $inputButtons[0].GetAttribute("onAction") -ne "OnProbeAction") {
        throw "$($definition.Host) scheme-A Ribbon must expose exactly one native-input button."
    }
    $dialogButtons = @($fullRibbon.SelectNodes("//*[local-name()='button' and @id='probe_open_native_dialog']"))
    if ($dialogButtons.Count -ne 1 -or $dialogButtons[0].GetAttribute("onAction") -ne "OnProbeAction") {
        throw "$($definition.Host) scheme-one Ribbon must expose exactly one in-process native-dialog button."
    }
    if (@($compatRibbon.SelectNodes("//*[@id='probe_open_input' or local-name()='editBox']")).Count -ne 0) {
        throw "$($definition.Host) compatibility Ribbon must not participate in native-input validation."
    }
}

$probeJs = Join-Path $script:ProbeRoot "src\shared\probe.js"
& node --check $probeJs
if ($LASTEXITCODE -ne 0) { throw "probe.js syntax check failed." }
$probeSource = Get-Content -LiteralPath $probeJs -Raw -Encoding UTF8
foreach ($required in @("writeAsBinaryString", "readAsBinaryString", "Application.CreateObject", "hsmmathnativeprobe", "nativex-result.txt", "HSMNATIVEX1", "HSMB64:1:")) {
    if ($probeSource.IndexOf($required, [StringComparison]::Ordinal) -lt 0) { throw "Probe runtime is missing required scheme-A capability: $required" }
}
$nativeSource = Join-Path $script:ProbeRoot "native\hsm_native_probe.cpp"
$nativeExports = Join-Path $script:ProbeRoot "native\hsm_native_probe.def"
if (-not (Test-Path -LiteralPath $nativeSource -PathType Leaf) -or -not (Test-Path -LiteralPath $nativeExports -PathType Leaf)) {
    throw "NativeX in-process dialog probe source is missing."
}
$nativeSourceText = Get-Content -LiteralPath $nativeSource -Raw -Encoding UTF8
$nativeExportText = Get-Content -LiteralPath $nativeExports -Raw -Encoding UTF8
if ($nativeSourceText.IndexOf('OnWpsLoad', [StringComparison]::Ordinal) -lt 0 -or
    $nativeExportText.IndexOf('OnWpsLoad', [StringComparison]::Ordinal) -lt 0) {
    throw "NativeX probe does not export OnWpsLoad."
}
if ($probeSource -match '(?i)\b(?:window\.|global\.)?prompt\s*\(') { throw "Browser prompt must never be used as a native input result." }
$forbidden = @(
    ([string]::Concat('Shell','Execute')),
    ([string]::Concat('Create','TaskPane')),
    ([string]::Concat('Create','Web','Dialog')),
    ([string]::Concat('XML','HttpRequest')),
    ([string]::Concat('Web','Socket'))
)
foreach ($token in $forbidden) {
    if ($probeSource.IndexOf($token, [StringComparison]::OrdinalIgnoreCase) -ge 0) { throw "Probe runtime contains a forbidden API: $token" }
}

$buildScript = Join-Path (Split-Path -Parent (Split-Path -Parent $script:ProbeRoot)) "scripts\build-offline.ps1"
if (Test-Path -LiteralPath $buildScript) {
    $buildText = Get-Content -LiteralPath $buildScript -Raw -Encoding UTF8
    foreach ($definition in $definitions) {
        if ($buildText.Contains($definition.Name) -or $buildText.Contains($definition.Folder)) { throw "Formal build script references the isolated probe: $($definition.Name)" }
    }
}
if ($Mode -ne "Source") {
    if (-not $JsAddonsPath) { $JsAddonsPath = Join-Path $env:APPDATA "kingsoft\wps\jsaddons" }
    [xml]$publish = Get-Content -LiteralPath (Join-Path $JsAddonsPath "publish.xml") -Raw -Encoding UTF8
    foreach ($definition in $definitions) {
        $nodes = @($publish.DocumentElement.SelectNodes("*[@name='$($definition.Name)']"))
        if ($nodes.Count -ne 1 -or $nodes[0].GetAttribute("url") -ne $definition.Folder -or $nodes[0].GetAttribute("type") -ne $definition.Type) {
            throw "$($definition.Host) probe registration is inconsistent."
        }
        $payload = Join-Path $JsAddonsPath $definition.Folder
        Assert-NativeProbePayloadFiles -Path $payload
        [xml]$installed = Get-Content -LiteralPath (Join-Path $payload "ribbon.xml") -Raw -Encoding UTF8
        $nativeCount = @($installed.SelectNodes("//*[@id='probe_open_input']")).Count
        $dialogCount = @($installed.SelectNodes("//*[@id='probe_open_native_dialog']")).Count
        if (($Mode -eq "Full" -and ($nativeCount -ne 1 -or $dialogCount -ne 1)) -or
            ($Mode -eq "Compat" -and ($nativeCount -ne 0 -or $dialogCount -ne 0)) -or
            @($installed.SelectNodes("//*[local-name()='editBox']")).Count -ne 0) {
            throw "$($definition.Host) installed Ribbon does not match the requested scheme-A mode."
        }
    }
    $nativeX = Get-NativeProbeNativeXPaths
    if (-not (Test-Path -LiteralPath $nativeX.Target -PathType Leaf)) { throw "Installed NativeX probe DLL is missing." }
    if ((Get-FileHash -LiteralPath $nativeX.Target -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $nativeX.Source -Algorithm SHA256).Hash) {
        throw "Installed NativeX probe DLL does not match the built source artifact."
    }
    if (-not (Test-Path -LiteralPath $nativeX.Config -PathType Leaf)) { throw "WPSNativeX.conf is missing." }
    $nativeConfig = Get-Content -LiteralPath $nativeX.Config -Raw -Encoding UTF8
    $expectedPath = ([IO.Path]::GetFullPath($nativeX.Target)).Replace('\', '/')
    $sectionPattern = "(?ms)^\[" + [Regex]::Escape($nativeX.Module) + "\]\r?\n.*?(?=^\[|\z)"
    $match = [Regex]::Match($nativeConfig, $sectionPattern)
    if (-not $match.Success -or $match.Value -notmatch '(?m)^crash=false\r?$' -or
        $match.Value -notmatch '(?m)^inproc=true\r?$' -or
        $match.Value.IndexOf("path=$expectedPath", [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw "WPSNativeX.conf does not contain the expected in-process probe registration."
    }
}
Write-Host "Native capability probe validation passed (mode: $Mode)."
