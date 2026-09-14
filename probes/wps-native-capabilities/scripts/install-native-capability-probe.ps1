param(
    [ValidateSet("Full", "Compat")][string]$Mode = "Full",
    [string]$JsAddonsPath = (Join-Path $env:APPDATA "kingsoft\wps\jsaddons"),
    [switch]$SkipProcessCheck
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "probe-common.ps1")
if (-not $SkipProcessCheck) { Assert-NativeProbeWpsClosed }

$manifest = Get-NativeProbeManifest
if ($manifest.commercialPayload -ne $false -or $manifest.formalWhitelistEligible -ne $false) {
    throw "Probe manifest must exclude commercial payloads and the formal allowlist."
}
$definitions = @(Get-NativeProbeDefinitions)
$nativeX = Get-NativeProbeNativeXPaths
New-Item -ItemType Directory -Path $JsAddonsPath -Force | Out-Null
$transaction = Join-Path $JsAddonsPath (".hsm-native-probe-" + [Guid]::NewGuid().ToString("N"))
[void](Assert-NativeProbeChildPath -Path $transaction -Root $JsAddonsPath)
New-Item -ItemType Directory -Path $transaction -Force | Out-Null

try {
    foreach ($definition in $definitions) {
        $stage = Join-Path $transaction $definition.Folder
        New-NativeProbePayload -Definition $definition -Mode $Mode -Destination $stage
        Assert-NativeProbePayloadFiles -Path $stage
    }
    foreach ($definition in $definitions) {
        $destination = Assert-NativeProbeChildPath -Path (Join-Path $JsAddonsPath $definition.Folder) -Root $JsAddonsPath
        if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
        Move-Item -LiteralPath (Join-Path $transaction $definition.Folder) -Destination $destination
    }
    Set-NativeProbeNativeXRegistration -NativeX $nativeX
    Set-NativeProbePublishRegistration -Path (Join-Path $JsAddonsPath "publish.xml") -Definitions $definitions -Version ([string]$manifest.probeVersion)
} finally {
    if (Test-Path -LiteralPath $transaction) { Remove-Item -LiteralPath $transaction -Recurse -Force }
}

Write-Host "Isolated native capability probe installed (mode: $Mode)."
Write-Host "Cold-start Writer and Presentation. Formal add-in folders and registration nodes were not changed."
