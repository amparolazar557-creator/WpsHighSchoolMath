param(
    [string]$JsAddonsPath = (Join-Path $env:APPDATA "kingsoft\wps\jsaddons"),
    [switch]$SkipProcessCheck,
    [switch]$KeepProbeRecords
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "probe-common.ps1")
if (-not $SkipProcessCheck) { Assert-NativeProbeWpsClosed }
$definitions = @(Get-NativeProbeDefinitions)
$nativeX = Get-NativeProbeNativeXPaths
Remove-NativeProbePublishRegistration -Path (Join-Path $JsAddonsPath "publish.xml") -Definitions $definitions
Remove-NativeProbeAuthorizationEntries -Path (Join-Path $JsAddonsPath "authaddin.json") -Definitions $definitions
Remove-NativeProbeNativeXRegistration -NativeX $nativeX
foreach ($definition in $definitions) {
    $path = Assert-NativeProbeChildPath -Path (Join-Path $JsAddonsPath $definition.Folder) -Root $JsAddonsPath
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}
if (-not $KeepProbeRecords) {
    $recordRoot = Join-Path $env:APPDATA "WpsHighSchoolMath\native-capability-probe"
    if (Test-Path -LiteralPath $recordRoot) { Remove-Item -LiteralPath $recordRoot -Recurse -Force }
}
Write-Host "Isolated native capability probe removed. Other add-in nodes were preserved."
