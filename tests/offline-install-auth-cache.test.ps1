$ErrorActionPreference = "Stop"

$installerPath = Join-Path (Split-Path -Parent $PSScriptRoot) "scripts\offline-install.ps1"
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($installerPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) {
    throw ($parseErrors | Out-String)
}

$requiredFunctions = @("Write-Utf8TextAtomic", "Set-ObjectPropertyValue", "Update-AuthorizationCache")
$functionDefinitions = @(
    $ast.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
        $requiredFunctions -contains $node.Name
    }, $true)
)
if ($functionDefinitions.Count -ne $requiredFunctions.Count) {
    throw "Could not load the authorization-cache functions from the installer."
}
Invoke-Expression (($functionDefinitions | ForEach-Object { $_.Extent.Text }) -join "`r`n`r`n")

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("hsm-auth-cache-test-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
try {
    $authorizationPath = Join-Path $testRoot "authaddin.json"
    $jsAddonsPath = Join-Path $testRoot "jsaddons"
    New-Item -ItemType Directory -Path $jsAddonsPath -Force | Out-Null

    $fixture = [ordered]@{
        wps = [ordered]@{
            namelist = "writer-local;writer-web;qmath;writer-local"
            "writer-local" = [ordered]@{
                name = "WpsHighSchoolMath"
                path = (Join-Path $jsAddonsPath "WpsHighSchoolMath_0.2.18").Replace('\', '/')
                enable = $false
                isload = $false
                mode = 1
                md5 = "writer-fingerprint"
            }
            "writer-web" = [ordered]@{
                name = "WpsHighSchoolMath"
                path = "http://127.0.0.1:3889"
                enable = $true
                isload = $false
                mode = 2
                md5 = "writer-web-fingerprint"
            }
            qmath = [ordered]@{
                name = "qmath-wps"
                path = "C:/other/qmath-wps_0.1.0"
                enable = $true
                isload = $false
                mode = 1
                md5 = "qmath-fingerprint"
            }
        }
        wpp = [ordered]@{
            namelist = "ppt-current;ppt-old;ppt-current"
            "ppt-current" = [ordered]@{
                name = "WpsHighSchoolMathPpt"
                path = (Join-Path $jsAddonsPath "WpsHighSchoolMathPpt_0.2.18").Replace('\', '/')
                enable = $true
                isload = $true
                mode = 1
                md5 = "ppt-current-fingerprint"
            }
            "ppt-old" = [ordered]@{
                name = "WpsHighSchoolMathPpt"
                path = "C:/old/WpsHighSchoolMathPpt_0.2.16"
                enable = $true
                isload = $true
                mode = 1
                md5 = "ppt-old-fingerprint"
            }
        }
    }
    [IO.File]::WriteAllText(
        $authorizationPath,
        ($fixture | ConvertTo-Json -Depth 16),
        (New-Object Text.UTF8Encoding($false))
    )

    $plugins = @(
        @{ Name = "WpsHighSchoolMath"; Type = "wps"; FolderName = "WpsHighSchoolMath_0.2.18"; PreserveApproval = $false },
        @{ Name = "WpsHighSchoolMathPpt"; Type = "wpp"; FolderName = "WpsHighSchoolMathPpt_0.2.18"; PreserveApproval = $true }
    )
    Update-AuthorizationCache -Path $authorizationPath -Plugins $plugins -JsAddonsPath $jsAddonsPath

    $updated = Get-Content -LiteralPath $authorizationPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $writerRecords = @(
        $updated.wps.PSObject.Properties |
            Where-Object { $_.Name -ne "namelist" -and $_.Value.name -eq "WpsHighSchoolMath" }
    )
    if ($writerRecords.Count -ne 0) {
        throw "Stale Writer authorization fingerprints were not removed before the upgrade trust prompt."
    }
    if ($updated.wps.qmath.md5 -ne "qmath-fingerprint" -or $updated.wps.qmath.path -ne "C:/other/qmath-wps_0.1.0") {
        throw "An unrelated authorization record was modified."
    }
    if ($updated.wps.namelist -ne "qmath") {
        throw "Writer namelist was not repaired without changing unrelated entries."
    }

    $pptRecords = @(
        $updated.wpp.PSObject.Properties |
            Where-Object { $_.Name -ne "namelist" -and $_.Value.name -eq "WpsHighSchoolMathPpt" }
    )
    if ($pptRecords.Count -ne 1 -or $pptRecords[0].Name -ne "ppt-current") {
        throw "The current Presentation approval was not preserved while stale duplicates were removed."
    }
    $ppt = $pptRecords[0].Value
    $expectedPptPath = (Join-Path $jsAddonsPath "WpsHighSchoolMathPpt_0.2.18").Replace('\', '/')
    if ($ppt.path -ne $expectedPptPath -or $ppt.enable -ne $true -or $ppt.isload -ne $true -or $ppt.mode -ne 1) {
        throw "The current Presentation authorization record was modified unexpectedly."
    }
    if ($ppt.md5 -ne "ppt-current-fingerprint" -or $updated.wpp.namelist -ne "ppt-current") {
        throw "Presentation authorization fingerprint or namelist changed unexpectedly."
    }

    $backupsAfterFirstRun = @(Get-ChildItem -LiteralPath $testRoot -Filter "authaddin.json.math-plugin-backup-*")
    if ($backupsAfterFirstRun.Count -ne 1) {
        throw "The authorization cache update did not create exactly one backup."
    }
    Update-AuthorizationCache -Path $authorizationPath -Plugins $plugins -JsAddonsPath $jsAddonsPath
    $backupsAfterSecondRun = @(Get-ChildItem -LiteralPath $testRoot -Filter "authaddin.json.math-plugin-backup-*")
    if ($backupsAfterSecondRun.Count -ne 1) {
        throw "An idempotent authorization cache update created another backup."
    }

    Write-Output "offline installer authorization-cache tests passed"
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
