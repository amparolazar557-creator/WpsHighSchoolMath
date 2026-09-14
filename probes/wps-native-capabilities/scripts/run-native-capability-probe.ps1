param(
    [ValidateSet("ValidateSource", "BuildCom", "InstallCom", "ValidateCom", "PrepareRun", "InstallFull", "InstallCompat", "ValidateFull", "ValidateCompat", "Uninstall", "UninstallCom")]
    [string]$Action = "ValidateSource",
    [string]$JsAddonsPath = (Join-Path $env:APPDATA "kingsoft\wps\jsaddons"),
    [string]$RunId = "",
    [string]$StartedAt = "",
    [string]$ProbeStateRoot = (Join-Path $env:APPDATA "WpsHighSchoolMath\native-capability-probe"),
    [switch]$SkipProcessCheck,
    [switch]$KeepProbeRecords
)

$ErrorActionPreference = "Stop"
switch ($Action) {
    "ValidateSource" { & (Join-Path $PSScriptRoot "validate-native-capability-probe.ps1") -Mode Source }
    "BuildCom" { & (Join-Path $PSScriptRoot "build-com-dialog-probe.ps1") }
    "InstallCom" { & (Join-Path $PSScriptRoot "install-com-dialog-probe.ps1") -SkipProcessCheck:$SkipProcessCheck }
    "ValidateCom" { & (Join-Path $PSScriptRoot "validate-com-dialog-probe.ps1") }
    "PrepareRun" { & (Join-Path $PSScriptRoot "prepare-native-capability-run.ps1") -RunId $RunId -StartedAt $StartedAt -ProbeStateRoot $ProbeStateRoot }
    "InstallFull" { & (Join-Path $PSScriptRoot "install-native-capability-probe.ps1") -Mode Full -JsAddonsPath $JsAddonsPath -SkipProcessCheck:$SkipProcessCheck }
    "InstallCompat" { & (Join-Path $PSScriptRoot "install-native-capability-probe.ps1") -Mode Compat -JsAddonsPath $JsAddonsPath -SkipProcessCheck:$SkipProcessCheck }
    "ValidateFull" { & (Join-Path $PSScriptRoot "validate-native-capability-probe.ps1") -Mode Full -JsAddonsPath $JsAddonsPath }
    "ValidateCompat" { & (Join-Path $PSScriptRoot "validate-native-capability-probe.ps1") -Mode Compat -JsAddonsPath $JsAddonsPath }
    "Uninstall" { & (Join-Path $PSScriptRoot "uninstall-native-capability-probe.ps1") -JsAddonsPath $JsAddonsPath -SkipProcessCheck:$SkipProcessCheck -KeepProbeRecords:$KeepProbeRecords }
    "UninstallCom" { & (Join-Path $PSScriptRoot "uninstall-com-dialog-probe.ps1") -SkipProcessCheck:$SkipProcessCheck }
}
