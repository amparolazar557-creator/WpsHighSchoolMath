param(
    [string]$TargetRoot = (Join-Path $env:APPDATA "WpsHighSchoolMath\native-capability-probe\com\x86"),
    [switch]$SkipActivation
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "com-probe-common.ps1")
$target = Assert-ComProbeTargetPath -TargetRoot $TargetRoot
$targetDll = Join-Path $target "WpsHsmNativeDialogProbe.dll"
$targetTlb = Join-Path $target "WpsHsmNativeDialogProbe.tlb"
if (-not (Test-Path -LiteralPath $targetDll -PathType Leaf)) { throw "Installed COM probe DLL is missing: $targetDll" }
if (-not (Test-Path -LiteralPath $targetTlb -PathType Leaf)) { throw "Installed COM probe type library is missing: $targetTlb" }
if ((Get-ComProbePeMachine -Path $targetDll) -ne 0x014C) { throw "Installed COM probe DLL is not x86." }
if ((Get-FileHash -LiteralPath $targetTlb -Algorithm SHA256).Hash -ne
    (Get-FileHash -LiteralPath $script:ComProbeSourceTlb -Algorithm SHA256).Hash) {
    throw "Installed COM probe type library does not match the built artifact."
}
$signature = Get-AuthenticodeSignature -LiteralPath $targetDll
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned) {
    throw "Internal COM probe signature state changed unexpectedly: $($signature.Status)"
}

$base = Open-ComProbeRegistryBase
try {
    $classRoot = "Software\Classes\CLSID\$script:ComProbeClassId"
    $inprocRoot = "$classRoot\InprocServer32"
    if ([string](Get-ComProbeRegistryValue -Base $base -Path $inprocRoot -Name "") -ne $targetDll -or
        [string](Get-ComProbeRegistryValue -Base $base -Path $inprocRoot -Name "ThreadingModel") -ne "Both" -or
        [string](Get-ComProbeRegistryValue -Base $base -Path "Software\Classes\$script:ComProbeProgId\CLSID" -Name "") -ne $script:ComProbeClassId -or
        [string](Get-ComProbeRegistryValue -Base $base -Path "$classRoot\TypeLib" -Name "") -ne $script:ComProbeTypeLibId -or
        [string](Get-ComProbeRegistryValue -Base $base -Path "Software\Classes\TypeLib\$script:ComProbeTypeLibId\1.0\0\win32" -Name "") -ne $targetTlb -or
        [string](Get-ComProbeRegistryValue -Base $base -Path "Software\Classes\Interface\$script:ComProbeAutomationId\TypeLib" -Name "") -ne $script:ComProbeTypeLibId -or
        [string](Get-ComProbeRegistryValue -Base $base -Path "Software\Classes\Interface\$script:ComProbeAutomationId\TypeLib" -Name "Version") -ne "1.0") {
        throw "COM class registration is incomplete or inconsistent."
    }
    foreach ($path in $script:ComProbeAddinPaths) {
        if ([int](Get-ComProbeRegistryValue -Base $base -Path $path -Name "LoadBehavior") -ne 3) {
            throw "COMAddIns registration is missing or disabled: HKCU\$path"
        }
    }
} finally {
    $base.Dispose()
}

if (-not $SkipActivation) {
    $x86PowerShell = Join-Path $env:WINDIR "SysWOW64\WindowsPowerShell\v1.0\powershell.exe"
    if (-not (Test-Path -LiteralPath $x86PowerShell -PathType Leaf)) { throw "x86 PowerShell is unavailable." }
    $activationCode = @'
$ErrorActionPreference = "Stop"
$probe = New-Object -ComObject "WpsHsm.NativeDialogProbe"
try {
    $version = [string]$probe.GetBridgeVersion()
    $name = [string]$probe.GetProcessName()
    if ($version -ne "1.1-file-channel" -or $name -ne "powershell") { throw "Unexpected COM activation result: $version / $name" }
    Write-Output "COM activation passed: $version / $name"
} finally {
    if ($null -ne $probe -and [Runtime.InteropServices.Marshal]::IsComObject($probe)) {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($probe)
    }
}
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($activationCode))
    & $x86PowerShell -NoLogo -NoProfile -EncodedCommand $encoded
    if ($LASTEXITCODE -ne 0) { throw "x86 COM activation smoke test failed with exit code $LASTEXITCODE." }
}
$hash = Get-FileHash -LiteralPath $targetDll -Algorithm SHA256
Write-Host "COM dialog probe validation passed. SHA256=$($hash.Hash)"
