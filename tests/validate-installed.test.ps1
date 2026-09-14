$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$name = [string]$package.name
$version = [string]$package.version
$stagingRoot = Join-Path $projectRoot "release\${name}-${version}-offline"
$validator = Join-Path $stagingRoot "validate-installed.ps1"
if (-not (Test-Path -LiteralPath $validator -PathType Leaf)) {
    throw "Build the current internal release before running validate-installed.test.ps1."
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("hsm-installed-validation-" + [Guid]::NewGuid().ToString("N"))
$jsAddonsPath = Join-Path $testRoot "jsaddons"
New-Item -ItemType Directory -Path $jsAddonsPath -Force | Out-Null
try {
    $writerFolder = "${name}_${version}"
    $pptName = "${name}Ppt"
    $pptFolder = "${pptName}_${version}"
    Copy-Item -LiteralPath (Join-Path $stagingRoot "payload\$writerFolder") -Destination (Join-Path $jsAddonsPath $writerFolder) -Recurse
    Copy-Item -LiteralPath (Join-Path $stagingRoot "payload\$pptFolder") -Destination (Join-Path $jsAddonsPath $pptFolder) -Recurse
    $publish = @"
<jsplugins>
  <jsplugin name="OtherPlugin" type="wps" url="OtherPlugin_1.0" version="1.0" enable="enable_dev" />
  <jsplugin name="$name" type="wps" url="$writerFolder" version="$version" enable="enable_dev" install="null" customDomain="" />
  <jsplugin name="$pptName" type="wpp" url="$pptFolder" version="$version" enable="enable_dev" install="null" customDomain="" />
</jsplugins>
"@
    [IO.File]::WriteAllText((Join-Path $jsAddonsPath "publish.xml"), $publish, (New-Object Text.UTF8Encoding($false)))

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $validator -JsAddonsPath $jsAddonsPath -SkipUninstallRegistration | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Correct installed fixture did not pass validation." }

    Copy-Item -LiteralPath (Join-Path $jsAddonsPath "$writerFolder\main.js") `
        -Destination (Join-Path $jsAddonsPath "$pptFolder\main.js") -Force
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $validator -JsAddonsPath $jsAddonsPath -SkipUninstallRegistration 2>$null | Out-Null
    $crossHostExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorAction
    if ($crossHostExitCode -eq 0) { throw "Installed validator did not detect a Writer main.js copied into the PPT payload." }

    Copy-Item -LiteralPath (Join-Path $stagingRoot "payload\$pptFolder\main.js") `
        -Destination (Join-Path $jsAddonsPath "$pptFolder\main.js") -Force
    [xml]$publishXml = Get-Content -LiteralPath (Join-Path $jsAddonsPath "publish.xml") -Raw -Encoding UTF8
    $publishXml.DocumentElement.SelectSingleNode("*[@name='$pptName']").SetAttribute("type", "wps")
    $publishXml.Save((Join-Path $jsAddonsPath "publish.xml"))
    $ErrorActionPreference = "Continue"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $validator -JsAddonsPath $jsAddonsPath -SkipUninstallRegistration 2>$null | Out-Null
    $registrationExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorAction
    if ($registrationExitCode -eq 0) { throw "Installed validator did not detect a PPT registration mapped to the Writer host type." }

    Write-Output "installed payload cross-host and registration validation tests passed"
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
