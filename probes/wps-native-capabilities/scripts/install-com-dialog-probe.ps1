param(
    [string]$TargetRoot = (Join-Path $env:APPDATA "WpsHighSchoolMath\native-capability-probe\com\x86"),
    [switch]$SkipProcessCheck
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "com-probe-common.ps1")
if (-not $SkipProcessCheck) { Assert-ComProbeWpsClosed }
$target = Assert-ComProbeTargetPath -TargetRoot $TargetRoot
if (-not (Test-Path -LiteralPath $script:ComProbeSourceDll -PathType Leaf)) {
    throw "Built COM probe DLL is missing. Run build-com-dialog-probe.ps1 first."
}
if (-not (Test-Path -LiteralPath $script:ComProbeSourceTlb -PathType Leaf)) {
    throw "Built COM probe type library is missing. Run build-com-dialog-probe.ps1 first."
}
if ((Get-ComProbePeMachine -Path $script:ComProbeSourceDll) -ne 0x014C) { throw "Source COM probe DLL is not x86." }

New-Item -ItemType Directory -Path $target -Force | Out-Null
$targetDll = Join-Path $target "WpsHsmNativeDialogProbe.dll"
$targetTlb = Join-Path $target "WpsHsmNativeDialogProbe.tlb"
$temporaryDll = Join-Path $target ("WpsHsmNativeDialogProbe.dll.tmp-" + [Guid]::NewGuid().ToString("N"))
$temporaryTlb = Join-Path $target ("WpsHsmNativeDialogProbe.tlb.tmp-" + [Guid]::NewGuid().ToString("N"))
Copy-Item -LiteralPath $script:ComProbeSourceDll -Destination $temporaryDll -Force
Copy-Item -LiteralPath $script:ComProbeSourceTlb -Destination $temporaryTlb -Force
Move-Item -LiteralPath $temporaryDll -Destination $targetDll -Force
Move-Item -LiteralPath $temporaryTlb -Destination $targetTlb -Force

$base = Open-ComProbeRegistryBase
try {
    $classRoot = "Software\Classes\CLSID\$script:ComProbeClassId"
    $inprocRoot = "$classRoot\InprocServer32"
    $progIdRoot = "Software\Classes\$script:ComProbeProgId"
    $typeLibRoot = "Software\Classes\TypeLib\$script:ComProbeTypeLibId"
    $interfaceRoot = "Software\Classes\Interface\$script:ComProbeAutomationId"
    Remove-ComProbeRegistryTree -Base $base -Path $progIdRoot
    Remove-ComProbeRegistryTree -Base $base -Path $classRoot
    Remove-ComProbeRegistryTree -Base $base -Path $typeLibRoot
    Remove-ComProbeRegistryTree -Base $base -Path $interfaceRoot
    Set-ComProbeRegistryValue -Base $base -Path $classRoot -Name "" -Value "WPS High School Math Native Dialog Probe" -Kind String
    Set-ComProbeRegistryValue -Base $base -Path "$classRoot\ProgID" -Name "" -Value $script:ComProbeProgId -Kind String
    Set-ComProbeRegistryValue -Base $base -Path "$classRoot\Implemented Categories\$script:ComProbeCategoryId" -Name "" -Value "" -Kind String
    Set-ComProbeRegistryValue -Base $base -Path $inprocRoot -Name "" -Value $targetDll -Kind String
    Set-ComProbeRegistryValue -Base $base -Path $inprocRoot -Name "ThreadingModel" -Value "Both" -Kind String
    Set-ComProbeRegistryValue -Base $base -Path "$classRoot\TypeLib" -Name "" -Value $script:ComProbeTypeLibId -Kind String
    Set-ComProbeRegistryValue -Base $base -Path "$classRoot\Version" -Name "" -Value "1.0" -Kind String
    Set-ComProbeRegistryValue -Base $base -Path $progIdRoot -Name "" -Value "WPS High School Math Native Dialog Probe" -Kind String
    Set-ComProbeRegistryValue -Base $base -Path "$progIdRoot\CLSID" -Name "" -Value $script:ComProbeClassId -Kind String
    Set-ComProbeRegistryValue -Base $base -Path "$typeLibRoot\1.0" -Name "" -Value "WPS High School Math Native Dialog Probe Type Library" -Kind String
    Set-ComProbeRegistryValue -Base $base -Path "$typeLibRoot\1.0\0\win32" -Name "" -Value $targetTlb -Kind String
    Set-ComProbeRegistryValue -Base $base -Path "$typeLibRoot\1.0\FLAGS" -Name "" -Value 0 -Kind DWord
    Set-ComProbeRegistryValue -Base $base -Path "$typeLibRoot\1.0\HELPDIR" -Name "" -Value $target -Kind String
    Set-ComProbeRegistryValue -Base $base -Path $interfaceRoot -Name "" -Value "IWpsHsmNativeDialogAutomation" -Kind String
    Set-ComProbeRegistryValue -Base $base -Path "$interfaceRoot\ProxyStubClsid32" -Name "" -Value $script:ComProbeAutomationProxyId -Kind String
    Set-ComProbeRegistryValue -Base $base -Path "$interfaceRoot\TypeLib" -Name "" -Value $script:ComProbeTypeLibId -Kind String
    Set-ComProbeRegistryValue -Base $base -Path "$interfaceRoot\TypeLib" -Name "Version" -Value "1.0" -Kind String
    foreach ($path in $script:ComProbeAddinPaths) {
        Set-ComProbeRegistryValue -Base $base -Path $path -Name "FriendlyName" -Value "高中数学进程内对话框探针" -Kind String
        Set-ComProbeRegistryValue -Base $base -Path $path -Name "Description" -Value "Internal WPS Writer/PPT COMAddIns bridge probe" -Kind String
        Set-ComProbeRegistryValue -Base $base -Path $path -Name "LoadBehavior" -Value 3 -Kind DWord
        Set-ComProbeRegistryValue -Base $base -Path $path -Name "CommandLineSafe" -Value 0 -Kind DWord
    }
} catch {
    Remove-ComProbeRegistryTree -Base $base -Path "Software\Classes\$script:ComProbeProgId"
    Remove-ComProbeRegistryTree -Base $base -Path "Software\Classes\CLSID\$script:ComProbeClassId"
    Remove-ComProbeRegistryTree -Base $base -Path "Software\Classes\TypeLib\$script:ComProbeTypeLibId"
    Remove-ComProbeRegistryTree -Base $base -Path "Software\Classes\Interface\$script:ComProbeAutomationId"
    foreach ($path in $script:ComProbeAddinPaths) { Remove-ComProbeRegistryTree -Base $base -Path $path }
    throw
} finally {
    $base.Dispose()
}

Write-Host "Installed isolated x86 native COMAddIns dialog probe for Writer and Presentation."
Write-Host "ProgID: $script:ComProbeProgId"
Write-Host "DLL: $targetDll"
Write-Host "Type library: $targetTlb"
