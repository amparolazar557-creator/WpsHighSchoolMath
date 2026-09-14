param(
    [Parameter(Mandatory = $true)][string]$TargetRoot,
    [int]$ParentProcessId
)

$ErrorActionPreference = "Stop"

$expectedRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Programs\WpsHighSchoolMath"))
$resolvedTarget = [IO.Path]::GetFullPath($TargetRoot)
if (-not $resolvedTarget.Equals($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove an unexpected uninstall directory: $resolvedTarget"
}

if ($ParentProcessId -gt 0) {
    Wait-Process -Id $ParentProcessId -Timeout 15 -ErrorAction SilentlyContinue
}
for ($attempt = 0; $attempt -lt 10; $attempt++) {
    if (-not (Test-Path -LiteralPath $resolvedTarget)) { break }
    try {
        Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
        break
    } catch {
        Start-Sleep -Milliseconds 500
    }
}
