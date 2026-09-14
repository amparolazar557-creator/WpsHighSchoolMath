param()

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "com-probe-common.ps1")

$source = Join-Path $script:ComProbeRoot "wps_hsm_com_probe.cpp"
$exports = Join-Path $script:ComProbeRoot "wps_hsm_com_probe.def"
$idl = Join-Path $script:ComProbeRoot "wps_hsm_com_probe.idl"
$buildDirectory = Join-Path $script:ComProbeRoot "build\x86"
$outputDirectory = Join-Path $script:ComProbeRoot "bin\x86"
$output = Join-Path $outputDirectory "WpsHsmNativeDialogProbe.dll"
$typeLibrary = Join-Path $outputDirectory "WpsHsmNativeDialogProbe.tlb"
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) { throw "Visual Studio vswhere.exe was not found." }
$vsPath = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
if (-not $vsPath) { throw "Visual Studio C++ x86/x64 build tools are not installed." }
$devCmd = Join-Path $vsPath "Common7\Tools\VsDevCmd.bat"
if (-not (Test-Path -LiteralPath $devCmd -PathType Leaf)) { throw "VsDevCmd.bat was not found: $devCmd" }
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Native COM probe source is missing: $source" }
if (-not (Test-Path -LiteralPath $idl -PathType Leaf)) { throw "Native COM probe IDL is missing: $idl" }
New-Item -ItemType Directory -Path $buildDirectory, $outputDirectory -Force | Out-Null
$midlHeader = Join-Path $buildDirectory "wps_hsm_com_probe_h.h"
$midlIid = Join-Path $buildDirectory "wps_hsm_com_probe_i.c"
$midlCommand = 'call "{0}" -no_logo -arch=x86 -host_arch=x64 && midl.exe /nologo /env win32 /char signed /h "{1}" /iid "{2}" /tlb "{3}" "{4}"' -f $devCmd, $midlHeader, $midlIid, $typeLibrary, $idl
& $env:ComSpec /d /s /c $midlCommand
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $typeLibrary -PathType Leaf)) {
    throw "Native COM Automation type library build failed with exit code $LASTEXITCODE."
}
$object = Join-Path $buildDirectory "wps_hsm_com_probe.obj"
$pdb = Join-Path $buildDirectory "WpsHsmNativeDialogProbe.pdb"
$command = 'call "{0}" -no_logo -arch=x86 -host_arch=x64 && cl.exe /nologo /utf-8 /std:c++17 /permissive- /W4 /WX /O2 /MT /EHsc /DUNICODE /D_UNICODE /LD "{1}" /Fo"{2}" /link /NOLOGO /DEF:"{3}" /OUT:"{4}" /PDB:"{5}" user32.lib gdi32.lib ole32.lib oleaut32.lib' -f $devCmd, $source, $object, $exports, $output, $pdb
& $env:ComSpec /d /s /c $command
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output -PathType Leaf)) {
    throw "Native COM dialog probe compilation failed with exit code $LASTEXITCODE."
}
if ((Get-ComProbePeMachine -Path $output) -ne 0x014C) { throw "COM dialog probe is not PE32 x86." }
$dumpbin = Get-ChildItem -LiteralPath (Join-Path $vsPath "VC\Tools\MSVC") -Recurse -Filter dumpbin.exe -File |
    Where-Object { $_.FullName -match '\\bin\\Hostx64\\x64\\dumpbin\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
if ($null -eq $dumpbin) { throw "dumpbin.exe was not found." }
$exportText = (& $dumpbin.FullName /exports $output | Out-String)
foreach ($name in @("DllGetClassObject", "DllCanUnloadNow")) {
    if ($exportText -notmatch [Regex]::Escape($name)) { throw "Native COM probe is missing export: $name" }
}
$signature = Get-AuthenticodeSignature -LiteralPath $output
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned) {
    throw "Internal COM probe must remain explicitly unsigned; production signing is a separate gate."
}
$hash = Get-FileHash -LiteralPath $output -Algorithm SHA256
Write-Host "Built Internal x86 native in-process COM dialog probe."
Write-Host "Path: $output"
Write-Host "Type library: $typeLibrary"
Write-Host "SHA256: $($hash.Hash)"
Write-Host "Signature: $($signature.Status)"
