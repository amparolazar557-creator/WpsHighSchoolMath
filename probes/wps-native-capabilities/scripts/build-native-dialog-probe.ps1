param(
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$probeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$nativeRoot = Join-Path $probeRoot "native"
$source = Join-Path $nativeRoot "hsm_native_probe.cpp"
$exports = Join-Path $nativeRoot "hsm_native_probe.def"
$buildRoot = Join-Path $nativeRoot "build\x86"
$outputRoot = Join-Path $nativeRoot "bin\x86"
$outputDll = Join-Path $outputRoot "HsmMathNativeProbe.dll"

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) {
    throw "Visual Studio vswhere.exe was not found."
}
$vsPath = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
if (-not $vsPath) {
    throw "Visual Studio C++ x86/x64 build tools are not installed."
}
$devCmd = Join-Path $vsPath "Common7\Tools\VsDevCmd.bat"
if (-not (Test-Path -LiteralPath $devCmd -PathType Leaf)) {
    throw "VsDevCmd.bat was not found: $devCmd"
}

New-Item -ItemType Directory -Path $buildRoot, $outputRoot -Force | Out-Null
$object = Join-Path $buildRoot "hsm_native_probe.obj"
$pdb = Join-Path $buildRoot "HsmMathNativeProbe.pdb"
$command = 'call "{0}" -no_logo -arch=x86 -host_arch=x64 && cl.exe /nologo /utf-8 /std:c++17 /permissive- /W4 /WX /O2 /MT /EHsc /DUNICODE /D_UNICODE /LD "{1}" /Fo"{2}" /link /NOLOGO /DEF:"{3}" /OUT:"{4}" /PDB:"{5}" user32.lib gdi32.lib' -f $devCmd, $source, $object, $exports, $outputDll, $pdb
& $env:ComSpec /d /s /c $command
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputDll -PathType Leaf)) {
    throw "Native dialog probe DLL build failed with exit code $LASTEXITCODE."
}

$dumpbin = Get-ChildItem -LiteralPath (Join-Path $vsPath "VC\Tools\MSVC") -Recurse -Filter dumpbin.exe -File |
    Where-Object { $_.FullName -match '\\bin\\Hostx64\\x64\\dumpbin\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
if ($null -eq $dumpbin) {
    throw "dumpbin.exe was not found."
}
$headers = (& $dumpbin.FullName /headers $outputDll | Out-String)
if ($headers -notmatch '14C machine \(x86\)' -or $headers -notmatch 'PE32') {
    throw "Probe DLL is not an x86 PE32 image."
}
$exportText = (& $dumpbin.FullName /exports $outputDll | Out-String)
foreach ($name in @(
    "OnWpsLoad",
    "HsmProbeGetBridgeVersion",
    "HsmProbeGetProcessId",
    "HsmProbeShowInputDialog",
    "HsmProbeGetLastResult",
    "HsmProbeGetLastResultLength",
    "HsmProbeClearResult"
)) {
    if ($exportText -notmatch [Regex]::Escape($name)) {
        throw "Probe DLL is missing export: $name"
    }
}

$hash = (Get-FileHash -LiteralPath $outputDll -Algorithm SHA256).Hash
$signature = Get-AuthenticodeSignature -LiteralPath $outputDll
Write-Host "Native dialog probe built: $outputDll"
Write-Host "Architecture: x86 PE32"
Write-Host "SHA256: $hash"
Write-Host "Signature status (Internal probe only): $($signature.Status)"
