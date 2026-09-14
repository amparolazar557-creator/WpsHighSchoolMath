$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$installerPath = Join-Path $projectRoot "scripts\offline-install.ps1"
. (Join-Path $projectRoot "scripts\payload-integrity.ps1")

$requiredFunctions = @(
    "Save-XmlDocument",
    "Write-Utf8TextAtomic",
    "Copy-FileAtomic",
    "Set-ObjectPropertyValue",
    "Update-AuthorizationCache",
    "Assert-HsmChildPath",
    "Remove-HsmSafeDirectory",
    "Update-HsmPublishRegistration",
    "Test-HsmInstalledState",
    "Invoke-HsmInstallTransaction"
)
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($installerPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
$definitions = @(
    $ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $requiredFunctions -contains $node.Name
    }, $true)
)
if ($definitions.Count -ne $requiredFunctions.Count) {
    throw "Could not load all install-transaction functions."
}
Invoke-Expression (($definitions | ForEach-Object { $_.Extent.Text }) -join "`r`n`r`n")

function Write-TestFile {
    param([string]$Path, [string]$Content)
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
}

function New-TestPayload {
    param([string]$Path, [string]$HostType, [string]$PluginName)
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    if ($HostType -eq "wps") {
        $hostMarker = "writer"
        $main = "load('js/ribbon.js');"
        $tabId = "mathTeacherTab"
    } else {
        $hostMarker = "presentation"
        $main = "load('js/ppt-api.js'); load('js/ribbon-ppt.js');"
        $tabId = "mathTeacherPptTab"
    }
    Write-TestFile (Join-Path $Path "index.html") ('<script>window.HSM_ENTRY_HOST = "' + $hostMarker + '";</script>')
    Write-TestFile (Join-Path $Path "main.js") $main
    Write-TestFile (Join-Path $Path "manifest.xml") ("<JsPlugin><Name>$PluginName</Name></JsPlugin>")
    Write-TestFile (Join-Path $Path "ribbon.xml") ('<customUI><ribbon><tabs><tab id="{0}" label="高中数学" /></tabs></ribbon></customUI>' -f $tabId)
    Write-TestFile (Join-Path $Path "runtime\WpsHighSchoolMathEditorHost.exe") "host"
}

function New-TransactionFixture {
    param([string]$Root)

    $installerRoot = Join-Path $Root "installer"
    $jsAddonsPath = Join-Path $Root "jsaddons"
    New-Item -ItemType Directory -Path $installerRoot, $jsAddonsPath -Force | Out-Null
    $writerFolder = "WpsHighSchoolMath_9.9.9"
    $pptFolder = "WpsHighSchoolMathPpt_9.9.9"
    $writerPayload = Join-Path $installerRoot "payload\$writerFolder"
    $pptPayload = Join-Path $installerRoot "payload\$pptFolder"
    New-TestPayload $writerPayload "wps" "WpsHighSchoolMath"
    New-TestPayload $pptPayload "wpp" "WpsHighSchoolMathPpt"
    $writerManifest = New-HsmPayloadManifest $writerPayload "WpsHighSchoolMath" "WpsHighSchoolMath" "9.9.9" "wps"
    $pptManifest = New-HsmPayloadManifest $pptPayload "WpsHighSchoolMath" "WpsHighSchoolMathPpt" "9.9.9" "wpp"

    $oldWriter = Join-Path $jsAddonsPath "WpsHighSchoolMath_9.9.8"
    $oldPpt = Join-Path $jsAddonsPath "WpsHighSchoolMathPpt_9.9.8"
    Write-TestFile (Join-Path $oldWriter "old.txt") "old-writer"
    Write-TestFile (Join-Path $oldPpt "old.txt") "old-ppt"

    $publishPath = Join-Path $jsAddonsPath "publish.xml"
    Write-TestFile $publishPath @'
<jsplugins>
  <jsplugin name="OtherPlugin" type="wps" url="OtherPlugin_1.0" version="1.0" enable="enable_dev" />
  <jsplugin name="WpsHighSchoolMath" type="wps" url="WpsHighSchoolMath_9.9.8" version="9.9.8" enable="enable_dev" />
  <jsplugin name="WpsHighSchoolMathPpt" type="wpp" url="WpsHighSchoolMathPpt_9.9.8" version="9.9.8" enable="enable_dev" />
</jsplugins>
'@
    $authorizationPath = Join-Path $jsAddonsPath "authaddin.json"
    $authorization = [ordered]@{
        wps = [ordered]@{
            namelist = "old-writer;other"
            "old-writer" = [ordered]@{ name = "WpsHighSchoolMath"; path = $oldWriter; mode = 1; md5 = "old" }
            other = [ordered]@{ name = "OtherPlugin"; path = "C:/other"; mode = 1; md5 = "keep" }
        }
        wpp = [ordered]@{
            namelist = "old-ppt"
            "old-ppt" = [ordered]@{ name = "WpsHighSchoolMathPpt"; path = $oldPpt; mode = 1; md5 = "old" }
        }
    }
    Write-TestFile $authorizationPath ($authorization | ConvertTo-Json -Depth 8)

    return [pscustomobject]@{
        InstallerRoot = $installerRoot
        JsAddonsPath = $jsAddonsPath
        PublishPath = $publishPath
        AuthorizationPath = $authorizationPath
        OldWriter = $oldWriter
        OldPpt = $oldPpt
        WriterFolder = $writerFolder
        PptFolder = $pptFolder
        Plugins = @(
            @{ Name = "WpsHighSchoolMath"; Type = "wps"; FolderName = $writerFolder; ManifestSha256 = $writerManifest.Sha256 },
            @{ Name = "WpsHighSchoolMathPpt"; Type = "wpp"; FolderName = $pptFolder; ManifestSha256 = $pptManifest.Sha256 }
        )
    }
}

function Invoke-FixtureInstall {
    param([object]$Fixture, [scriptblock]$Checkpoint)
    return @(Invoke-HsmInstallTransaction `
        -InstallerRoot $Fixture.InstallerRoot `
        -JsAddonsPath $Fixture.JsAddonsPath `
        -PublishPath $Fixture.PublishPath `
        -AuthorizationPath $Fixture.AuthorizationPath `
        -Plugins $Fixture.Plugins `
        -StaleNames @("WpsHighSchoolMath", "WpsHighSchoolMathE2E3", "WpsHighSchoolMathPpt") `
        -Product "WpsHighSchoolMath" `
        -Version "9.9.9" `
        -TestCheckpoint $Checkpoint)
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("hsm-install-transaction-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
try {
    $success = New-TransactionFixture (Join-Path $testRoot "success")
    $results = @(Invoke-FixtureInstall $success $null)
    if ($results.Count -ne 2 -or
        -not (Test-Path -LiteralPath (Join-Path $success.JsAddonsPath $success.WriterFolder)) -or
        -not (Test-Path -LiteralPath (Join-Path $success.JsAddonsPath $success.PptFolder)) -or
        (Test-Path -LiteralPath $success.OldWriter) -or
        (Test-Path -LiteralPath $success.OldPpt)) {
        throw "Successful transaction did not commit both payloads together."
    }
    [xml]$successPublish = Get-Content -LiteralPath $success.PublishPath -Raw -Encoding UTF8
    if (@($successPublish.DocumentElement.SelectNodes("*[@name='OtherPlugin']")).Count -ne 1) {
        throw "Successful transaction changed an unrelated publish.xml entry."
    }
    $successAuth = Get-Content -LiteralPath $success.AuthorizationPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($successAuth.wps.other.md5 -ne "keep") {
        throw "Successful transaction changed an unrelated authorization entry."
    }

    foreach ($failurePoint in @("after-payload-switch-1", "after-publish")) {
        $failure = New-TransactionFixture (Join-Path $testRoot $failurePoint)
        $publishHashBefore = Get-HsmSha256 $failure.PublishPath
        $authHashBefore = Get-HsmSha256 $failure.AuthorizationPath
        $caught = $false
        try {
            [void](Invoke-FixtureInstall $failure { param($point) if ($point -eq $failurePoint) { throw "injected-$failurePoint" } })
        } catch {
            $caught = $true
        }
        if (-not $caught) { throw "Injected failure $failurePoint did not fail the transaction." }
        if (-not (Test-Path -LiteralPath (Join-Path $failure.OldWriter "old.txt")) -or
            -not (Test-Path -LiteralPath (Join-Path $failure.OldPpt "old.txt")) -or
            (Test-Path -LiteralPath (Join-Path $failure.JsAddonsPath $failure.WriterFolder)) -or
            (Test-Path -LiteralPath (Join-Path $failure.JsAddonsPath $failure.PptFolder)) -or
            (Get-HsmSha256 $failure.PublishPath) -ne $publishHashBefore -or
            (Get-HsmSha256 $failure.AuthorizationPath) -ne $authHashBefore) {
            throw "Transaction failure $failurePoint did not restore the previous installation byte-for-byte."
        }
        if (@(Get-ChildItem -LiteralPath $failure.JsAddonsPath -Directory -Filter ".hsm-install-*").Count -ne 0) {
            throw "Successful rollback left a transaction directory behind for $failurePoint."
        }
    }

    Write-Output "offline install transaction tests passed"
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
