$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $projectRoot "scripts\uninstall-registration.ps1")

$testId = [Guid]::NewGuid().ToString("N")
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "hsm-uninstall-registration-$testId"
$sourceRoot = Join-Path $testRoot "source"
$uninstallRoot = Join-Path $testRoot "installed-uninstaller"
$startMenuRoot = Join-Path $testRoot "start-menu"
$jsAddonsPath = Join-Path $testRoot "jsaddons"
$registryPath = "HKCU:\Software\WpsHighSchoolMathTests\$testId"
New-Item -ItemType Directory -Path $sourceRoot, $jsAddonsPath -Force | Out-Null

try {
    foreach ($fileName in @("uninstall.ps1", "uninstall-cleanup.ps1", "uninstall-registration.ps1")) {
        [IO.File]::WriteAllText((Join-Path $sourceRoot $fileName), "# $fileName", (New-Object Text.UTF8Encoding($false)))
    }
    $payload = Join-Path $jsAddonsPath "WpsHighSchoolMath_9.9.9"
    New-Item -ItemType Directory -Path $payload -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $payload "main.js"), "test", (New-Object Text.UTF8Encoding($false)))

    $registered = Register-HsmUninstaller `
        -Version "9.9.9" `
        -SourceRoot $sourceRoot `
        -JsAddonsPath $jsAddonsPath `
        -UninstallRoot $uninstallRoot `
        -RegistryPath $registryPath `
        -StartMenuDirectory $startMenuRoot

    if ($registered.Version -ne "9.9.9" -or
        -not (Test-Path -LiteralPath (Join-Path $uninstallRoot "uninstall.ps1")) -or
        -not (Test-Path -LiteralPath $registered.ShortcutPath)) {
        throw "Uninstaller registration did not install all persistent components."
    }
    $entry = Get-ItemProperty -LiteralPath $registryPath
    if ($entry.DisplayName -ne "WPS 高中数学工具插件" -or
        $entry.UninstallString -notlike "*uninstall.ps1*" -or
        $entry.QuietUninstallString -notlike "*uninstall.ps1* -Quiet" -or
        $entry.Comments -notlike "*14 天全功能试用*") {
        throw "Windows installed-app metadata is incomplete."
    }

    [void](Unregister-HsmUninstaller -UninstallRoot $uninstallRoot -RegistryPath $registryPath -StartMenuDirectory $startMenuRoot)
    if ((Test-Path -LiteralPath $registryPath) -or (Test-Path -LiteralPath $registered.ShortcutPath)) {
        throw "Uninstaller deregistration left a registry entry or Start-menu shortcut."
    }
    if (-not (Test-Path -LiteralPath $uninstallRoot -PathType Container)) {
        throw "Registration cleanup removed persistent files before the delayed self-cleanup stage."
    }

    Write-Output "Windows uninstall registration tests passed"
} finally {
    if (Test-Path -LiteralPath $registryPath) {
        Remove-Item -LiteralPath $registryPath -Recurse -Force
    }
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
