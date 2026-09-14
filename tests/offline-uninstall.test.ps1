$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$uninstallerPath = Join-Path $projectRoot "scripts\offline-uninstall.ps1"
$requiredFunctions = @(
    "Write-Utf8TextAtomic",
    "Save-HsmXmlDocument",
    "Remove-HsmPluginDirectories",
    "Remove-HsmPublishEntries",
    "Remove-HsmAuthorizationEntries"
)
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($uninstallerPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
$definitions = @(
    $ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $requiredFunctions -contains $node.Name
    }, $true)
)
if ($definitions.Count -ne $requiredFunctions.Count) {
    throw "Could not load all uninstall functions."
}
Invoke-Expression (($definitions | ForEach-Object { $_.Extent.Text }) -join "`r`n`r`n")

function Write-TestFile {
    param([string]$Path, [string]$Content)
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("hsm-offline-uninstall-" + [Guid]::NewGuid().ToString("N"))
$jsAddonsPath = Join-Path $testRoot "jsaddons"
$publishPath = Join-Path $jsAddonsPath "publish.xml"
$authorizationPath = Join-Path $jsAddonsPath "authaddin.json"
$licenseStatePath = Join-Path $testRoot "license-state"
New-Item -ItemType Directory -Path $jsAddonsPath, $licenseStatePath -Force | Out-Null

try {
    Write-TestFile (Join-Path $jsAddonsPath "WpsHighSchoolMath_0.5.1\main.js") "writer"
    Write-TestFile (Join-Path $jsAddonsPath "WpsHighSchoolMathPpt_0.5.1\main.js") "ppt"
    Write-TestFile (Join-Path $jsAddonsPath "OtherPlugin_1.0\main.js") "other"
    Write-TestFile (Join-Path $licenseStatePath "machine-id.txt") "HSMABC1234567"
    Write-TestFile $publishPath @'
<jsplugins>
  <jsplugin name="OtherPlugin" type="wps" url="OtherPlugin_1.0" version="1.0" />
  <jsplugin name="WpsHighSchoolMath" type="wps" url="WpsHighSchoolMath_0.5.1" version="0.5.1" />
  <jsplugin name="WpsHighSchoolMathPpt" type="wpp" url="WpsHighSchoolMathPpt_0.5.1" version="0.5.1" />
</jsplugins>
'@
    $authorization = [ordered]@{
        wps = [ordered]@{
            namelist = "writer;other"
            writer = [ordered]@{ name = "WpsHighSchoolMath"; path = "writer"; md5 = "remove" }
            other = [ordered]@{ name = "OtherPlugin"; path = "other"; md5 = "keep" }
        }
        wpp = [ordered]@{
            namelist = "ppt"
            ppt = [ordered]@{ name = "WpsHighSchoolMathPpt"; path = "ppt"; md5 = "remove" }
        }
    }
    Write-TestFile $authorizationPath ($authorization | ConvertTo-Json -Depth 8)

    $pluginNames = @("WpsHighSchoolMath", "WpsHighSchoolMathPpt")
    $staleNames = @("WpsHighSchoolMath", "WpsHighSchoolMathE2E3", "WpsHighSchoolMathPpt")
    Remove-HsmPluginDirectories -JsAddonsPath $jsAddonsPath -PluginNames $pluginNames
    Remove-HsmPublishEntries -Path $publishPath -PluginNames $staleNames
    Remove-HsmAuthorizationEntries -Path $authorizationPath -PluginNames $staleNames

    if (Test-Path -LiteralPath (Join-Path $jsAddonsPath "WpsHighSchoolMath_0.5.1")) { throw "Writer payload was not removed." }
    if (Test-Path -LiteralPath (Join-Path $jsAddonsPath "WpsHighSchoolMathPpt_0.5.1")) { throw "Presentation payload was not removed." }
    if (-not (Test-Path -LiteralPath (Join-Path $jsAddonsPath "OtherPlugin_1.0\main.js"))) { throw "Unrelated payload was removed." }

    [xml]$publish = Get-Content -LiteralPath $publishPath -Raw -Encoding UTF8
    if (@($publish.DocumentElement.SelectNodes("*[@name='WpsHighSchoolMath' or @name='WpsHighSchoolMathPpt']")).Count -ne 0 -or
        @($publish.DocumentElement.SelectNodes("*[@name='OtherPlugin']")).Count -ne 1) {
        throw "publish.xml uninstall cleanup changed the wrong registrations."
    }
    $updatedAuthorization = Get-Content -LiteralPath $authorizationPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($updatedAuthorization.wps.other.md5 -ne "keep" -or
        $updatedAuthorization.wps.namelist -ne "other" -or
        $updatedAuthorization.wpp.namelist -ne "") {
        throw "Authorization-cache uninstall cleanup changed unrelated records or left product records."
    }
    if ((Get-Content -LiteralPath (Join-Path $licenseStatePath "machine-id.txt") -Raw).Trim() -ne "HSMABC1234567") {
        throw "Normal uninstall changed the stable machine code or license state."
    }

    Write-Output "offline uninstall cleanup tests passed"
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
