$script:HsmUninstallProductId = "WpsHighSchoolMath"
$script:HsmUninstallDisplayName = "WPS 高中数学工具插件"

function Get-HsmUninstallPaths {
    param(
        [string]$UninstallRoot,
        [string]$RegistryPath,
        [string]$StartMenuDirectory
    )

    if (-not $UninstallRoot) {
        $UninstallRoot = Join-Path $env:LOCALAPPDATA "Programs\WpsHighSchoolMath"
    }
    if (-not $RegistryPath) {
        $RegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WpsHighSchoolMath"
    }
    if (-not $StartMenuDirectory) {
        $StartMenuDirectory = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\高中数学插件"
    }
    return [pscustomobject][ordered]@{
        Root = [IO.Path]::GetFullPath($UninstallRoot)
        ScriptPath = Join-Path $UninstallRoot "uninstall.ps1"
        CleanupScriptPath = Join-Path $UninstallRoot "uninstall-cleanup.ps1"
        RegistrationScriptPath = Join-Path $UninstallRoot "uninstall-registration.ps1"
        RegistryPath = $RegistryPath
        StartMenuDirectory = [IO.Path]::GetFullPath($StartMenuDirectory)
        ShortcutPath = Join-Path $StartMenuDirectory "卸载高中数学插件.cmd"
    }
}

function Get-HsmRegistrySubKeyPath {
    param([Parameter(Mandatory = $true)][string]$RegistryPath)
    $match = [regex]::Match($RegistryPath, '^HKCU:\\(.+)$', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) { throw "Only HKCU uninstall registration paths are allowed: $RegistryPath" }
    return $match.Groups[1].Value
}

function Set-HsmUninstallRegistryValues {
    param(
        [Parameter(Mandatory = $true)][string]$RegistryPath,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$StringValues,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$DwordValues
    )
    $subKeyPath = Get-HsmRegistrySubKeyPath -RegistryPath $RegistryPath
    $legacyBaseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::CurrentUser,
        [Microsoft.Win32.RegistryView]::Registry32
    )
    try {
        $legacyBaseKey.DeleteSubKeyTree($subKeyPath, $false)
    } finally {
        $legacyBaseKey.Dispose()
    }

    $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::CurrentUser,
        [Microsoft.Win32.RegistryView]::Registry64
    )
    $key = $null
    try {
        $key = $baseKey.CreateSubKey($subKeyPath, $true)
        foreach ($entry in $StringValues.GetEnumerator()) {
            $key.SetValue([string]$entry.Key, [string]$entry.Value, [Microsoft.Win32.RegistryValueKind]::String)
        }
        foreach ($entry in $DwordValues.GetEnumerator()) {
            $key.SetValue([string]$entry.Key, [int]$entry.Value, [Microsoft.Win32.RegistryValueKind]::DWord)
        }
    } finally {
        if ($key) { $key.Dispose() }
        $baseKey.Dispose()
    }

}

function Get-HsmUninstallRegistryValues {
    param([Parameter(Mandatory = $true)][string]$RegistryPath)
    $subKeyPath = Get-HsmRegistrySubKeyPath -RegistryPath $RegistryPath
    $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::CurrentUser,
        [Microsoft.Win32.RegistryView]::Registry64
    )
    $key = $null
    try {
        $key = $baseKey.OpenSubKey($subKeyPath, $false)
        if (-not $key) { return $null }
        $values = [ordered]@{}
        foreach ($name in $key.GetValueNames()) { $values[$name] = $key.GetValue($name) }
        return [pscustomobject]$values
    } finally {
        if ($key) { $key.Dispose() }
        $baseKey.Dispose()
    }
}

function Remove-HsmUninstallRegistryKey {
    param([Parameter(Mandatory = $true)][string]$RegistryPath)
    $subKeyPath = Get-HsmRegistrySubKeyPath -RegistryPath $RegistryPath
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
        $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
        try {
            $baseKey.DeleteSubKeyTree($subKeyPath, $false)
        } finally {
            $baseKey.Dispose()
        }
    }
}

function Get-HsmUninstallCommand {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [switch]$Quiet
    )

    $powershellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $quietArgument = if ($Quiet) { " -Quiet" } else { "" }
    return "`"$powershellPath`" -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$ScriptPath`"$quietArgument"
}

function Get-HsmEstimatedSizeKb {
    param([string]$JsAddonsPath, [string]$UninstallRoot)

    $bytes = [long]0
    foreach ($root in @($JsAddonsPath, $UninstallRoot)) {
        if (-not $root -or -not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        $files = if ($root -eq $JsAddonsPath) {
            Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -match '^WpsHighSchoolMath(Ppt)?_' } |
                ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Recurse -File -ErrorAction SilentlyContinue }
        } else {
            Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue
        }
        $measure = $files | Measure-Object -Property Length -Sum
        if ($measure.Sum) { $bytes += [long]$measure.Sum }
    }
    return [Math]::Max(1, [int][Math]::Ceiling($bytes / 1KB))
}

function Resolve-HsmUninstallSourceFile {
    param([string]$SourceRoot, [string]$PackagedName, [string]$SourceName)

    $packagedPath = Join-Path $SourceRoot $PackagedName
    if (Test-Path -LiteralPath $packagedPath -PathType Leaf) { return $packagedPath }
    $sourcePath = Join-Path $SourceRoot $SourceName
    if (Test-Path -LiteralPath $sourcePath -PathType Leaf) { return $sourcePath }
    throw "Required uninstall component was not found: $PackagedName"
}

function Register-HsmUninstaller {
    param(
        [Parameter(Mandatory = $true)][string]$Version,
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$JsAddonsPath,
        [string]$UninstallRoot,
        [string]$RegistryPath,
        [string]$StartMenuDirectory
    )

    $paths = Get-HsmUninstallPaths -UninstallRoot $UninstallRoot -RegistryPath $RegistryPath -StartMenuDirectory $StartMenuDirectory
    New-Item -ItemType Directory -Path $paths.Root -Force | Out-Null
    $components = @(
        @{ Packaged = "uninstall.ps1"; Source = "offline-uninstall.ps1"; Destination = $paths.ScriptPath },
        @{ Packaged = "uninstall-cleanup.ps1"; Source = "offline-uninstall-cleanup.ps1"; Destination = $paths.CleanupScriptPath },
        @{ Packaged = "uninstall-registration.ps1"; Source = "uninstall-registration.ps1"; Destination = $paths.RegistrationScriptPath }
    )
    foreach ($component in $components) {
        $sourcePath = Resolve-HsmUninstallSourceFile -SourceRoot $SourceRoot -PackagedName $component.Packaged -SourceName $component.Source
        Copy-Item -LiteralPath $sourcePath -Destination $component.Destination -Force
    }

    $uninstallCommand = Get-HsmUninstallCommand -ScriptPath $paths.ScriptPath
    $quietUninstallCommand = Get-HsmUninstallCommand -ScriptPath $paths.ScriptPath -Quiet
    $registryValues = [ordered]@{
        DisplayName = $script:HsmUninstallDisplayName
        DisplayVersion = $Version
        Publisher = "高中数学工具"
        InstallDate = Get-Date -Format "yyyyMMdd"
        InstallLocation = $JsAddonsPath
        DisplayIcon = (Join-Path $env:SystemRoot "System32\shell32.dll") + ",31"
        UninstallString = $uninstallCommand
        QuietUninstallString = $quietUninstallCommand
        Comments = "包含 14 天全功能试用；试用到期后仅试卷功能可用。"
        Contact = "QQ 982303035"
    }
    $dwordValues = @{
        NoModify = 1
        NoRepair = 1
        EstimatedSize = (Get-HsmEstimatedSizeKb -JsAddonsPath $JsAddonsPath -UninstallRoot $paths.Root)
    }
    Set-HsmUninstallRegistryValues -RegistryPath $paths.RegistryPath -StringValues $registryValues -DwordValues $dwordValues

    New-Item -ItemType Directory -Path $paths.StartMenuDirectory -Force | Out-Null
$startMenuCommand = @"
@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%LOCALAPPDATA%\Programs\WpsHighSchoolMath\uninstall.ps1"
"@
    [IO.File]::WriteAllText($paths.ShortcutPath, $startMenuCommand, (New-Object Text.ASCIIEncoding))

    return Test-HsmUninstallerRegistration -Version $Version -UninstallRoot $paths.Root -RegistryPath $paths.RegistryPath -StartMenuDirectory $paths.StartMenuDirectory
}

function Test-HsmUninstallerRegistration {
    param(
        [Parameter(Mandatory = $true)][string]$Version,
        [string]$UninstallRoot,
        [string]$RegistryPath,
        [string]$StartMenuDirectory
    )

    $paths = Get-HsmUninstallPaths -UninstallRoot $UninstallRoot -RegistryPath $RegistryPath -StartMenuDirectory $StartMenuDirectory
    foreach ($filePath in @($paths.ScriptPath, $paths.CleanupScriptPath, $paths.RegistrationScriptPath, $paths.ShortcutPath)) {
        if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
            throw "Installed uninstaller component is missing: $filePath"
        }
    }
    $entry = Get-HsmUninstallRegistryValues -RegistryPath $paths.RegistryPath
    if (-not $entry) {
        throw "Windows uninstall registration is missing: $($paths.RegistryPath)"
    }
    if ([string]$entry.DisplayName -ne $script:HsmUninstallDisplayName -or
        [string]$entry.DisplayVersion -ne $Version -or
        [string]$entry.UninstallString -notlike "*uninstall.ps1*" -or
        [string]$entry.QuietUninstallString -notlike "*uninstall.ps1* -Quiet") {
        throw "Windows uninstall registration is inconsistent with version $Version."
    }
    return [pscustomobject][ordered]@{
        DisplayName = [string]$entry.DisplayName
        Version = [string]$entry.DisplayVersion
        Root = $paths.Root
        RegistryPath = $paths.RegistryPath
        ShortcutPath = $paths.ShortcutPath
        EstimatedSizeKb = [int]$entry.EstimatedSize
    }
}

function Unregister-HsmUninstaller {
    param(
        [string]$UninstallRoot,
        [string]$RegistryPath,
        [string]$StartMenuDirectory
    )

    $paths = Get-HsmUninstallPaths -UninstallRoot $UninstallRoot -RegistryPath $RegistryPath -StartMenuDirectory $StartMenuDirectory
    Remove-HsmUninstallRegistryKey -RegistryPath $paths.RegistryPath
    if (Test-Path -LiteralPath $paths.ShortcutPath -PathType Leaf) {
        Remove-Item -LiteralPath $paths.ShortcutPath -Force
    }
    if (Test-Path -LiteralPath $paths.StartMenuDirectory -PathType Container) {
        if (@(Get-ChildItem -LiteralPath $paths.StartMenuDirectory -Force).Count -eq 0) {
            Remove-Item -LiteralPath $paths.StartMenuDirectory -Force
        }
    }
    return $paths
}
