Set-StrictMode -Version Latest

$script:ComProbeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\native-com"))
$script:ComProbeProgId = "WpsHsm.NativeDialogProbe"
$script:ComProbeClassId = "{76F85F17-71B3-40E2-A4CD-50B769FA37A7}"
$script:ComProbeTypeLibId = "{903C67EF-5C8F-4E00-ACF4-E7931DDCF587}"
$script:ComProbeAutomationId = "{7B4641C6-2E3B-4FBF-9611-52577CDDD0CA}"
$script:ComProbeAutomationProxyId = "{00020424-0000-0000-C000-000000000046}"
$script:ComProbeCategoryId = "{62C8FE65-4EBB-45E7-B440-6E39B2CDBF29}"
$script:ComProbeDefaultTargetRoot = Join-Path $env:APPDATA "WpsHighSchoolMath\native-capability-probe\com\x86"
$script:ComProbeSourceDll = Join-Path $script:ComProbeRoot "bin\x86\WpsHsmNativeDialogProbe.dll"
$script:ComProbeSourceTlb = Join-Path $script:ComProbeRoot "bin\x86\WpsHsmNativeDialogProbe.tlb"
$script:ComProbeAddinPaths = @(
    "Software\Microsoft\Office\Word\Addins\$script:ComProbeProgId",
    "Software\Microsoft\Office\PowerPoint\Addins\$script:ComProbeProgId",
    "Software\Microsoft\Office\WPS\Addins\$script:ComProbeProgId",
    "Software\Microsoft\Office\WPP\Addins\$script:ComProbeProgId",
    "Software\Microsoft\Office\6.0\Word\Addins\$script:ComProbeProgId",
    "Software\Microsoft\Office\6.0\PowerPoint\Addins\$script:ComProbeProgId",
    "Software\Kingsoft\Office\6.0\WPS\Addins\$script:ComProbeProgId",
    "Software\Kingsoft\Office\6.0\WPP\Addins\$script:ComProbeProgId",
    "Software\Kingsoft\Office\6.0\Addins\$script:ComProbeProgId"
)

function Open-ComProbeRegistryBase {
    return [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::CurrentUser,
        [Microsoft.Win32.RegistryView]::Registry32)
}

function Set-ComProbeRegistryValue {
    param(
        [Parameter(Mandatory = $true)][Microsoft.Win32.RegistryKey]$Base,
        [Parameter(Mandatory = $true)][string]$Path,
        [AllowEmptyString()][string]$Name,
        [Parameter(Mandatory = $true)]$Value,
        [Parameter(Mandatory = $true)][Microsoft.Win32.RegistryValueKind]$Kind
    )
    $key = $Base.CreateSubKey($Path, [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree)
    if ($null -eq $key) { throw "Cannot create registry key: HKCU\$Path" }
    try { $key.SetValue($Name, $Value, $Kind) } finally { $key.Dispose() }
}

function Get-ComProbeRegistryValue {
    param(
        [Parameter(Mandatory = $true)][Microsoft.Win32.RegistryKey]$Base,
        [Parameter(Mandatory = $true)][string]$Path,
        [AllowEmptyString()][string]$Name
    )
    $key = $Base.OpenSubKey($Path, $false)
    if ($null -eq $key) { return $null }
    try { return $key.GetValue($Name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
    finally { $key.Dispose() }
}

function Remove-ComProbeRegistryTree {
    param(
        [Parameter(Mandatory = $true)][Microsoft.Win32.RegistryKey]$Base,
        [Parameter(Mandatory = $true)][string]$Path
    )
    try { $Base.DeleteSubKeyTree($Path, $false) } catch [ArgumentException] { }
}

function Get-ComProbePeMachine {
    param([Parameter(Mandatory = $true)][string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    $reader = New-Object IO.BinaryReader($stream)
    try {
        $stream.Position = 0x3C
        $peOffset = $reader.ReadInt32()
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x00004550) { throw "Invalid PE signature: $Path" }
        return $reader.ReadUInt16()
    } finally {
        $reader.Dispose()
        $stream.Dispose()
    }
}

function Assert-ComProbeWpsClosed {
    $hosts = @(Get-Process -Name "wps", "wpp" -ErrorAction SilentlyContinue)
    if ($hosts.Count -gt 0) {
        throw "Close all WPS Writer and Presentation processes before changing the in-process COM probe."
    }
}

function Assert-ComProbeTargetPath {
    param([Parameter(Mandatory = $true)][string]$TargetRoot)
    $allowed = [IO.Path]::GetFullPath((Join-Path $env:APPDATA "WpsHighSchoolMath\native-capability-probe\com")).TrimEnd('\', '/')
    $actual = [IO.Path]::GetFullPath($TargetRoot).TrimEnd('\', '/')
    if (-not $actual.StartsWith($allowed + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "COM probe target must remain below the isolated AppData root: $actual"
    }
    return $actual
}
