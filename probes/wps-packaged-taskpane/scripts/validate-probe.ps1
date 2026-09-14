param(
    [ValidateSet("Source", "Installed")][string]$Mode = "Source",
    [string]$JsAddonsPath = (Join-Path $env:APPDATA "kingsoft\wps\jsaddons")
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "probe-common.ps1")
$manifest = Get-PackagedProbeManifest
if ([string]$manifest.schema -ne "WpsHighSchoolMathPackagedTaskPaneProbe" -or [int]$manifest.version -ne 1 -or [bool]$manifest.commercialPayload) {
    throw "Packaged task-pane probe manifest is invalid."
}
$expected = @($manifest.installedFiles | ForEach-Object { [string]$_ } | Sort-Object)
foreach ($definition in @(Get-PackagedProbeDefinitions)) {
    $source = Join-Path (Join-Path $script:ProbeRoot "src") $definition.Host
    foreach ($name in @("index.html", "main.js", "manifest.xml", "ribbon.xml")) {
        if (-not (Test-Path -LiteralPath (Join-Path $source $name) -PathType Leaf)) { throw "Missing source file: $($definition.Host)/$name" }
    }
    if ($Mode -eq "Installed") {
        $root = Assert-PackagedProbeChildPath -Path (Join-Path $JsAddonsPath $definition.Folder) -Root $JsAddonsPath
        $actual = @(
            Get-ChildItem -LiteralPath $root -Recurse -File |
                ForEach-Object { $_.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/') } |
                Sort-Object
        )
        if (($actual -join "|") -ne ($expected -join "|")) { throw "$($definition.Host) installed file set mismatch: $($actual -join ', ')" }
        [xml]$publish = Get-Content -LiteralPath (Join-Path $JsAddonsPath "publish.xml") -Raw -Encoding UTF8
        if (@($publish.DocumentElement.SelectNodes("jsplugin[@name='$($definition.Name)' and @url='$($definition.Folder)']")).Count -ne 1) {
            throw "$($definition.Host) publish registration is missing."
        }
    }
}
foreach ($path in @(
    (Join-Path $script:ProbeRoot "src\shared\probe.js"),
    (Join-Path $script:ProbeRoot "src\shared\pane.js")
)) {
    & node --check $path
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $path" }
}
$forbidden = rg -n --encoding utf-8 "localhost|127\.0\.0\.1|::1|ShellExecute|XMLHttpRequest|fetch\(|WebSocket|EventSource|WpsHighSchoolMathEditorHost" (Join-Path $script:ProbeRoot "src") (Join-Path $script:ProbeRoot "probe-manifest.json")
if ($LASTEXITCODE -eq 0) { throw "Packaged task-pane probe contains forbidden runtime text: $($forbidden -join [Environment]::NewLine)" }
if ($LASTEXITCODE -gt 1) { throw "rg failed while validating the probe." }
Write-Host "Packaged task-pane probe validation passed ($Mode)."
