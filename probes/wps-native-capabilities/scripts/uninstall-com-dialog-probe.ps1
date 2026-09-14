param(
    [string]$TargetRoot = (Join-Path $env:APPDATA "WpsHighSchoolMath\native-capability-probe\com\x86"),
    [switch]$SkipProcessCheck,
    [switch]$KeepBinary
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "com-probe-common.ps1")
if (-not $SkipProcessCheck) { Assert-ComProbeWpsClosed }
$target = Assert-ComProbeTargetPath -TargetRoot $TargetRoot
$base = Open-ComProbeRegistryBase
try {
    foreach ($path in $script:ComProbeAddinPaths) { Remove-ComProbeRegistryTree -Base $base -Path $path }
    Remove-ComProbeRegistryTree -Base $base -Path "Software\Classes\$script:ComProbeProgId"
    Remove-ComProbeRegistryTree -Base $base -Path "Software\Classes\CLSID\$script:ComProbeClassId"
    Remove-ComProbeRegistryTree -Base $base -Path "Software\Classes\TypeLib\$script:ComProbeTypeLibId"
    Remove-ComProbeRegistryTree -Base $base -Path "Software\Classes\Interface\$script:ComProbeAutomationId"
} finally {
    $base.Dispose()
}
if (-not $KeepBinary -and (Test-Path -LiteralPath $target)) { Remove-Item -LiteralPath $target -Recurse -Force }
Write-Host "Removed isolated WPS COM dialog probe registration. Unrelated COM add-ins were preserved."
