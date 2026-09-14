param(
    [string]$RunId = "",
    [string]$StartedAt = "",
    [string]$ProbeStateRoot = (Join-Path $env:APPDATA "WpsHighSchoolMath\native-capability-probe")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "probe-common.ps1")

[Guid]$guid = [Guid]::Empty
if ([string]::IsNullOrWhiteSpace($RunId)) {
    $guid = [Guid]::NewGuid()
} elseif (-not [Guid]::TryParse($RunId, [ref]$guid) -or $guid -eq [Guid]::Empty) {
    throw "RunId must be a non-empty GUID."
}
[DateTimeOffset]$start = [DateTimeOffset]::UtcNow
if (-not [string]::IsNullOrWhiteSpace($StartedAt)) {
    $style = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
    if (-not [DateTimeOffset]::TryParse($StartedAt, [Globalization.CultureInfo]::InvariantCulture, $style, [ref]$start) -or $StartedAt -notmatch '(Z|[+-]\d{2}:\d{2})$') {
        throw "StartedAt must be an ISO-8601 timestamp with an explicit UTC offset."
    }
    $start = $start.ToUniversalTime()
}
$now = [DateTimeOffset]::UtcNow
if ($start -lt $now.AddMinutes(-120) -or $start -gt $now.AddMinutes(5)) { throw "StartedAt must be within the recorder freshness window." }

$root = [IO.Path]::GetFullPath($ProbeStateRoot).TrimEnd('\', '/')
if ([string]::IsNullOrWhiteSpace($root) -or $root -eq [IO.Path]::GetPathRoot($root)) { throw "ProbeStateRoot is unsafe." }
$records = [IO.Path]::GetFullPath((Join-Path $root "records"))
$fileTests = [IO.Path]::GetFullPath((Join-Path $root "file-tests"))
foreach ($candidate in @($records, $fileTests)) {
    if (-not $candidate.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Prepared-run child path escapes ProbeStateRoot: $candidate"
    }
}
New-Item -ItemType Directory -Path $root, $records -Force | Out-Null
foreach ($hostName in @("writer", "presentation")) {
    $record = [IO.Path]::GetFullPath((Join-Path $records "$hostName.json"))
    if (-not $record.StartsWith($records + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Host record path escapes records root." }
    if (Test-Path -LiteralPath $record -PathType Leaf) { Remove-Item -LiteralPath $record -Force }
}
if (Test-Path -LiteralPath $fileTests -PathType Container) {
    if (-not $fileTests.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing to reset an unsafe file-tests path." }
    Remove-Item -LiteralPath $fileTests -Recurse -Force
}
New-Item -ItemType Directory -Path $fileTests -Force | Out-Null

$context = [ordered]@{
    schema = "WpsHighSchoolMathNativeCapabilityRunContext"
    version = 1
    runId = $guid.ToString("D")
    startedAt = $start.ToString("o")
    preparedAt = $now.ToString("o")
}
$json = $context | ConvertTo-Json -Depth 4 -Compress
$binaryEnvelope = "HSMB64:1:" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
$contextPath = [IO.Path]::GetFullPath((Join-Path $root "run-context.json"))
if (-not $contextPath.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Run-context path escapes ProbeStateRoot." }
Write-NativeProbeUtf8Atomic -Path $contextPath -Content $binaryEnvelope
$roundTrip = [IO.File]::ReadAllText($contextPath, [Text.Encoding]::UTF8)
if ($roundTrip -ne $binaryEnvelope) { throw "Prepared run-context write-back validation failed." }
[pscustomobject][ordered]@{
    schema = $context.schema
    version = $context.version
    runId = $context.runId
    startedAt = $context.startedAt
    preparedAt = $context.preparedAt
    path = $contextPath
}
