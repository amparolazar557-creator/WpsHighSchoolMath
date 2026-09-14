param(
    [string]$JsAddonsPath = (Join-Path $env:APPDATA "kingsoft\wps\jsaddons"),
    [switch]$SkipProcessCheck
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "probe-common.ps1")
if (-not $SkipProcessCheck) { Assert-PackagedProbeWpsClosed }
$manifest = Get-PackagedProbeManifest
$definitions = @(Get-PackagedProbeDefinitions)
New-Item -ItemType Directory -Path $JsAddonsPath -Force | Out-Null

foreach ($definition in $definitions) {
    $destination = Assert-PackagedProbeChildPath -Path (Join-Path $JsAddonsPath $definition.Folder) -Root $JsAddonsPath
    $staging = Assert-PackagedProbeChildPath -Path (Join-Path $JsAddonsPath (".staging-" + $definition.Folder + "-" + [Guid]::NewGuid().ToString("N"))) -Root $JsAddonsPath
    try {
        New-Item -ItemType Directory -Path (Join-Path $staging "js") -Force | Out-Null
        $source = Join-Path (Join-Path $script:ProbeRoot "src") $definition.Host
        foreach ($name in @("index.html", "main.js", "manifest.xml", "ribbon.xml")) {
            Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $staging $name) -Force
        }
        Copy-Item -LiteralPath (Join-Path $script:ProbeRoot "src\shared\probe.js") -Destination (Join-Path $staging "js\probe.js") -Force
        Copy-Item -LiteralPath (Join-Path $script:ProbeRoot "src\shared\pane.html") -Destination (Join-Path $staging "pane.html") -Force
        Copy-Item -LiteralPath (Join-Path $script:ProbeRoot "src\shared\pane.js") -Destination (Join-Path $staging "pane.js") -Force
        if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
        Move-Item -LiteralPath $staging -Destination $destination
    } finally {
        if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    }
}

Set-PackagedProbePublish -Path (Join-Path $JsAddonsPath "publish.xml") -Definitions $definitions -Version ([string]$manifest.probeVersion)
Write-Host "Packaged task-pane probe installed. Formal add-in nodes were preserved."
