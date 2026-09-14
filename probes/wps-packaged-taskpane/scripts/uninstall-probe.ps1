param(
    [string]$JsAddonsPath = (Join-Path $env:APPDATA "kingsoft\wps\jsaddons"),
    [switch]$SkipProcessCheck
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "probe-common.ps1")
if (-not $SkipProcessCheck) { Assert-PackagedProbeWpsClosed }
$definitions = @(Get-PackagedProbeDefinitions)
Remove-PackagedProbePublish -Path (Join-Path $JsAddonsPath "publish.xml") -Definitions $definitions
Remove-PackagedProbeAuthorization -Path (Join-Path $JsAddonsPath "authaddin.json") -Definitions $definitions
foreach ($definition in $definitions) {
    $path = Assert-PackagedProbeChildPath -Path (Join-Path $JsAddonsPath $definition.Folder) -Root $JsAddonsPath
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}
Write-Host "Packaged task-pane probe removed. Other add-in nodes were preserved."
