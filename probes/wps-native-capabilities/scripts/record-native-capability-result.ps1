param(
    [Parameter(Mandatory = $true)][string]$WriterExe,
    [Parameter(Mandatory = $true)][string]$PresentationExe,
    [string]$RunId = "",
    [string]$StartedAt = "",
    [string]$MonitorEvidencePath = "",
    [string]$JsAddonsPath = (Join-Path $env:APPDATA "kingsoft\wps\jsaddons"),
    [ValidateSet("Full", "Compat")][string]$Mode = "Full",
    [ValidateRange(1, 1440)][int]$MaxRecordAgeMinutes = 120,
    [string]$RecordRoot = (Join-Path $env:APPDATA "WpsHighSchoolMath\native-capability-probe\records"),
    [string]$EvidencePath = "",
    [switch]$FixtureMode
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$probeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$projectRoot = [IO.Path]::GetFullPath((Join-Path $probeRoot "..\.."))
$evidenceRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot "specs\scheme-c-native-function-editor\evidence")).TrimEnd('\', '/')
$utf8Strict = New-Object Text.UTF8Encoding($false, $true)
$utf8NoBom = New-Object Text.UTF8Encoding($false)
$now = [DateTimeOffset]::UtcNow
$failures = New-Object Collections.ArrayList
$checks = [ordered]@{
    executionContext = $false
    runIdentity = $false
    writerExecutable = $false
    presentationExecutable = $false
    matchingWpsBuild = $false
    writerRecord = $false
    presentationRecord = $false
    installedPayloads = $false
    continuousMonitoring = $false
}

function Fail([string]$Code, [string]$Message) {
    [void]$failures.Add([ordered]@{ code = $Code; message = $Message })
}
function Req([object]$Object, [string]$Name, [string]$Context) {
    $p = $Object.PSObject.Properties[$Name]
    if ($null -eq $p) { throw "$Context is missing required property '$Name'." }
    if ($p.Value -is [array]) { return ,$p.Value }
    return $p.Value
}
function ReqStr([object]$Object, [string]$Name, [string]$Context) {
    $v = Req $Object $Name $Context
    if ($v -isnot [string]) {
        $t = if ($null -eq $v) { "null" } else { $v.GetType().FullName }
        throw "$Context.$Name must be a JSON string, not $t."
    }
    if ([string]::IsNullOrWhiteSpace($v)) { throw "$Context.$Name must not be empty." }
    return [string]$v
}
function IsInt([object]$Value) {
    return $null -ne $Value -and ($Value -is [byte] -or $Value -is [sbyte] -or
        $Value -is [int16] -or $Value -is [uint16] -or $Value -is [int32] -or
        $Value -is [uint32] -or $Value -is [int64] -or $Value -is [uint64])
}
function ReqInt([object]$Object, [string]$Name, [string]$Context) {
    $v = Req $Object $Name $Context
    if (-not (IsInt $v)) {
        $t = if ($null -eq $v) { "null" } else { $v.GetType().FullName }
        throw "$Context.$Name must be a JSON integer, not $t."
    }
    return [int64]$v
}
function ReqBool([object]$Object, [string]$Name, [string]$Context) {
    $v = Req $Object $Name $Context
    if ($v -isnot [bool]) {
        $t = if ($null -eq $v) { "null" } else { $v.GetType().FullName }
        throw "$Context.$Name must be a JSON boolean, not $t."
    }
    return [bool]$v
}
function ReqObj([object]$Object, [string]$Name, [string]$Context) {
    $v = Req $Object $Name $Context
    if ($null -eq $v -or $v -is [string] -or $v -is [ValueType] -or $v -is [array]) {
        throw "$Context.$Name must be a JSON object."
    }
    return $v
}
function Iso([string]$Value, [string]$Context) {
    [DateTimeOffset]$d = [DateTimeOffset]::MinValue
    $style = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
    if (-not [DateTimeOffset]::TryParse($Value, [Globalization.CultureInfo]::InvariantCulture, $style, [ref]$d) -or
        $Value -notmatch '(Z|[+-]\d{2}:\d{2})$') {
        throw "$Context must be an ISO-8601 timestamp with an explicit UTC offset."
    }
    return $d.ToUniversalTime()
}
function Json([string]$Path, [int64]$Limit, [string]$Context) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing $Context file: $Path" }
    $b = [IO.File]::ReadAllBytes($Path)
    if ($b.Length -gt $Limit) { throw "$Context exceeds $Limit bytes." }
    $s = $utf8Strict.GetString($b)
    if ($s.Contains([char]0xFFFD)) { throw "$Context contains replacement characters." }
    $binaryPrefix = "HSMB64:1:"
    if ($s.StartsWith($binaryPrefix, [StringComparison]::Ordinal)) {
        $encoded = $s.Substring($binaryPrefix.Length)
        try { $decodedBytes = [Convert]::FromBase64String($encoded) }
        catch { throw "$Context has an invalid HSMB64 Base64 payload: $($_.Exception.Message)" }
        if ($decodedBytes.Length -gt $Limit) { throw "$Context decoded payload exceeds $Limit bytes." }
        try { $s = $utf8Strict.GetString($decodedBytes) }
        catch { throw "$Context HSMB64 payload is not strict UTF-8: $($_.Exception.Message)" }
        if ($s.Contains([char]0xFFFD)) { throw "$Context decoded payload contains replacement characters." }
    }
    try { return $s | ConvertFrom-Json } catch { throw "$Context is not valid JSON: $($_.Exception.Message)" }
}
function Hash([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function TextHash([string]$Text) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return (($sha.ComputeHash($utf8NoBom.GetBytes($Text)) | ForEach-Object { $_.ToString("x2") }) -join "") }
    finally { $sha.Dispose() }
}
function ExecutionContext {
    if ($Mode -ne "Full") { throw "Only Mode=Full can be evaluated by the scheme-A hard gate." }
    if ($FixtureMode) { return [pscustomobject]@{ fixtureMode = $true; productionEnvironment = $false } }
    $defaultJsAddons = [IO.Path]::GetFullPath((Join-Path $env:APPDATA "kingsoft\wps\jsaddons"))
    $defaultRecords = [IO.Path]::GetFullPath((Join-Path $env:APPDATA "WpsHighSchoolMath\native-capability-probe\records"))
    if ([IO.Path]::GetFullPath($JsAddonsPath) -ne $defaultJsAddons) { throw "Production evidence must use the real WPS jsaddons path." }
    if ([IO.Path]::GetFullPath($RecordRoot) -ne $defaultRecords) { throw "Production evidence must use the real AppData probe records path." }
    return [pscustomobject]@{ fixtureMode = $false; productionEnvironment = $true }
}
function Exe([string]$Path, [string]$Expected) {
    $p = [IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "WPS executable does not exist: $p" }
    if ([IO.Path]::GetFileName($p) -ine $Expected) { throw "Expected $Expected but received $p" }
    $i = Get-Item -LiteralPath $p
    return [pscustomobject][ordered]@{
        path = $i.FullName
        fileVersion = [string]$i.VersionInfo.FileVersion
        productVersion = [string]$i.VersionInfo.ProductVersion
        sha256 = Hash $i.FullName
    }
}
function RunContext {
    if ([string]::IsNullOrWhiteSpace($RunId)) { throw "RunId is required; historical records cannot be accepted without it." }
    [Guid]$g = [Guid]::Empty
    if (-not [Guid]::TryParse($RunId, [ref]$g) -or $g -eq [Guid]::Empty) { throw "RunId must be a non-empty GUID." }
    if ([string]::IsNullOrWhiteSpace($StartedAt)) { throw "StartedAt is required to establish freshness." }
    $d = Iso $StartedAt "StartedAt"
    if ($d -gt $now.AddMinutes(5) -or $d -lt $now.AddMinutes(-$MaxRecordAgeMinutes)) {
        throw "StartedAt is outside the allowed evidence window."
    }
    return [pscustomobject]@{ runId = $g.ToString("D"); startedAt = $d; startedAtText = $d.ToString("o") }
}
function HostRecord([string]$HostName, [object]$Run) {
    $path = Join-Path $RecordRoot "$HostName.json"
    $r = Json $path 65536 "$HostName probe record"
    $c = "$HostName record"
    if ((ReqStr $r schema $c) -ne "WpsHighSchoolMathNativeCapabilityHostRecord" -or
        (ReqInt $r version $c) -ne 2 -or (ReqStr $r host $c) -ne $HostName) { throw "$c schema or identity is invalid." }
    if ((ReqStr $r runId $c) -ne $Run.runId) { throw "$c.runId does not match; historical data is rejected." }
    $rs = Iso (ReqStr $r startedAt $c) "$c.startedAt"
    if ([Math]::Abs(($rs - $Run.startedAt).TotalSeconds) -gt 1) { throw "$c.startedAt does not match the run." }
    $updated = Iso (ReqStr $r updatedAt $c) "$c.updatedAt"
    if ($updated -lt $rs -or $updated -gt $now.AddMinutes(5) -or $updated -lt $now.AddMinutes(-$MaxRecordAgeMinutes)) {
        throw "$c.updatedAt is stale or outside the run."
    }
    $sv = Req $r sessions $c
    if ($sv -isnot [array]) { throw "$c.sessions must be a JSON array." }
    $sessions = @()
    foreach ($s in @($sv)) {
        if ($null -eq $s) { continue }
        $rp = $s.PSObject.Properties["runId"]
        if ($null -eq $rp) { continue }
        if ($rp.Value -isnot [string]) { throw "$c session.runId must be a JSON string." }
        if ([string]$rp.Value -ne $Run.runId) { continue }
        $id = ReqStr $s id "$c session"
        $loaded = Iso (ReqStr $s loadedAt "$c session") "$c session.loadedAt"
        if ($loaded -lt $Run.startedAt -or $loaded -gt $updated) { throw "$c session '$id' is outside the run." }
        if (-not (ReqBool $s addinLoaded "$c session '$id'")) { throw "$c session '$id' was not loaded." }
        $sessions += [pscustomobject]@{ value = $s; id = $id; loadedAt = $loaded }
    }
    if ($sessions.Count -lt 2) { throw "$c must contain at least two current-run cold-start sessions." }

    $complete = @()
    foreach ($si in $sessions) {
        $s = $si.value
        $sc = "$c session '$($si.id)'"
        $methodRaw = Req $s nativeInputMethod $sc
        if ($methodRaw -isnot [string]) { throw "$sc.nativeInputMethod must be a JSON string." }
        $method = [string]$methodRaw
        $cancelSentinelRaw = Req $s cancelSentinelType $sc
        if ($cancelSentinelRaw -isnot [string]) { throw "$sc.cancelSentinelType must be a JSON string." }
        $nativeMethod = $method -eq "global.InputBox" -or $method -eq "Application.InputBox"
        $cancelSentinel = @("boolean:false", "undefined", "null", "string:empty") -contains [string]$cancelSentinelRaw
        $completeInput = $nativeMethod -and (ReqBool $s visibleConfirmed $sc) -and
            (ReqInt $s nativeInputBoxCalls $sc) -ge 7 -and
            (ReqStr $s inputParameterForm $sc) -eq "(prompt,title,defaultValue)" -and
            (ReqInt $s inputArgumentCount $sc) -eq 3 -and
            (ReqInt $s defaultValueLength $sc) -eq 0 -and
            (ReqBool $s initialDefaultPresented $sc) -and
            (ReqStr $s defaultEchoReturnType $sc) -eq "string:empty" -and
            (ReqBool $s fullInputObserved $sc) -and
            (ReqInt $s acceptedChallengeCount $sc) -ge 3 -and
            (ReqBool $s plainPasteObserved $sc) -and
            (ReqBool $s whitespacePasteObserved $sc) -and
            (ReqBool $s maxLengthObserved $sc) -and
            (ReqInt $s maxLegalLength $sc) -eq 33 -and
            (ReqBool $s emptyInputObserved $sc) -and
            (ReqStr $s emptyReturnType $sc) -eq "string:empty" -and
            (ReqInt $s emptyReturnLength $sc) -eq 0 -and
            (ReqBool $s cancelObserved $sc) -and $cancelSentinel -and
            (ReqBool $s cancelPreservedState $sc) -and
            (ReqBool $s cancelDidNotTrySecondEntry $sc) -and
            (ReqBool $s invalidInputObserved $sc) -and
            (ReqBool $s authorityUnchangedAfterInvalid $sc) -and
            -not (ReqBool $s failureCodePersisted $sc) -and
            -not (ReqBool $s sensitiveTextPersisted $sc) -and
            (ReqInt $s verifiedRounds $sc) -ge 3
        if ($completeInput) { $complete += $si }
    }
    if ($complete.Count -eq 0) { throw "$c has no complete current-run native InputBox boundary session." }
    $ri = @($complete | Sort-Object loadedAt)[-1]

    $ribbon = ReqObj $r ribbon $c
    $file = ReqObj $r fileSystem $c
    if ((ReqStr $file runId "$c.fileSystem") -ne $Run.runId) { throw "$c.fileSystem.runId does not match." }
    $fs = Iso (ReqStr $file startedAt "$c.fileSystem") "$c.fileSystem.startedAt"
    if ([Math]::Abs(($fs - $Run.startedAt).TotalSeconds) -gt 1) { throw "$c.fileSystem.startedAt does not match." }
    $fr = Iso (ReqStr $file ranAt "$c.fileSystem") "$c.fileSystem.ranAt"
    if ($fr -lt $Run.startedAt -or $fr -gt $updated) { throw "$c.fileSystem.ranAt is outside the run." }
    $fid = ReqStr $file lastSessionId "$c.fileSystem"
    $fi = @($sessions | Where-Object { $_.id -eq $fid })
    if ($fi.Count -ne 1) { throw "$c file session is missing or ambiguous for this run." }
    if ($fi[0].loadedAt -lt $ri.loadedAt) { throw "$c file result predates the complete native-input session." }

    $methodValue = ReqStr $ri.value nativeInputMethod "$c native-input session"
    $rc = [ordered]@{
        loaded = (ReqBool $ribbon loaded "$c.ribbon") -and (ReqBool $ri.value addinLoaded "$c native-input session")
        restartObserved = $sessions.Count -ge 2
        visibleConfirmed = ReqBool $ri.value visibleConfirmed "$c native-input session"
        nativeInputMethod = $methodValue
        nativeInputAvailable = (($methodValue -eq "global.InputBox" -or $methodValue -eq "Application.InputBox") -and
            (ReqInt $ri.value nativeInputBoxCalls "$c native-input session") -ge 7)
        parameterFormObserved = (ReqStr $ri.value inputParameterForm "$c native-input session") -eq "(prompt,title,defaultValue)"
        returnTypeObserved = -not [string]::IsNullOrWhiteSpace((ReqStr $ri.value lastReturnType "$c native-input session"))
        cancelSentinelType = ReqStr $ri.value cancelSentinelType "$c native-input session"
        initialDefaultPresented = ReqBool $ri.value initialDefaultPresented "$c native-input session"
        plainPasteObserved = ReqBool $ri.value plainPasteObserved "$c native-input session"
        whitespacePasteObserved = ReqBool $ri.value whitespacePasteObserved "$c native-input session"
        maxLengthObserved = (ReqBool $ri.value maxLengthObserved "$c native-input session") -and
            (ReqInt $ri.value maxLegalLength "$c native-input session") -eq 33
        emptyInputObserved = (ReqBool $ri.value emptyInputObserved "$c native-input session") -and
            (ReqStr $ri.value emptyReturnType "$c native-input session") -eq "string:empty"
        fullChallengeObserved = (ReqBool $ri.value fullInputObserved "$c native-input session") -and
            (ReqInt $ri.value acceptedChallengeCount "$c native-input session") -ge 3
        cancelObserved = ReqBool $ri.value cancelObserved "$c native-input session"
        cancelPreservedState = ReqBool $ri.value cancelPreservedState "$c native-input session"
        cancelDidNotTrySecondEntry = ReqBool $ri.value cancelDidNotTrySecondEntry "$c native-input session"
        invalidPreservedAuthority = (ReqBool $ri.value invalidInputObserved "$c native-input session") -and
            (ReqBool $ri.value authorityUnchangedAfterInvalid "$c native-input session") -and
            -not (ReqBool $ri.value failureCodePersisted "$c native-input session")
        sensitiveTextPersisted = ReqBool $ri.value sensitiveTextPersisted "$c native-input session"
        threeVerifiedRounds = (ReqInt $ri.value verifiedRounds "$c native-input session") -ge 3
    }

    $fc = [ordered]@{}
    $requiredTrue = @(
        "appDataPathAvailable", "directoryCreated", "requiredWriteAsBinaryString", "requiredReadAsBinaryString",
        "utf8Base64RoundTrip", "overwriteAndTruncate", "read1024RoundTrip", "read1025RoundTrip",
        "raw12000RoundTrip", "raw12001RejectedBeforeWrite", "physicalEnvelope16384RoundTrip",
        "physicalEnvelopeOverLimitRejectedBeforeWrite", "physicalEnvelopeOverLimitRejectedAfterRead",
        "invalidPrefixRejected", "invalidBase64Rejected", "invalidUtf8Rejected",
        "slotRevisionSelection", "singleSlotRecovery", "corruptSlotRewrite", "ownMarkerWritten", "peerHostObserved"
    )
    foreach ($n in $requiredTrue) { $fc[$n] = ReqBool $file $n "$c.fileSystem" }
    $fc["readReturnType1024"] = ReqStr $file readReturnType1024 "$c.fileSystem"
    $fc["readReturnType1025"] = ReqStr $file readReturnType1025 "$c.fileSystem"
    $fc["raw12000EnvelopeLength"] = ReqInt $file raw12000EnvelopeLength "$c.fileSystem"
    if ($fc["readReturnType1024"] -ne "string" -or $fc["readReturnType1025"] -ne "string") {
        throw "$c binary read boundary returned a non-string value."
    }
    if ($fc["raw12000EnvelopeLength"] -lt 1 -or $fc["raw12000EnvelopeLength"] -gt 16384) {
        throw "$c 12000-byte raw payload produced an invalid envelope length."
    }
    $fc["legacyDiagnosticAttempted"] = ReqBool $file legacyDiagnosticAttempted "$c.fileSystem"
    $fc["legacyDiagnosticTransport"] = ReqBool $file legacyDiagnosticTransport "$c.fileSystem"
    $legacyApiValue = Req $file legacyDiagnosticApi "$c.fileSystem"
    if ($legacyApiValue -isnot [string]) { throw "$c.fileSystem.legacyDiagnosticApi must be a JSON string." }
    $fc["legacyDiagnosticApi"] = [string]$legacyApiValue

    $requiredRibbonTrue = @(
        "loaded", "restartObserved", "visibleConfirmed", "nativeInputAvailable", "parameterFormObserved",
        "returnTypeObserved", "initialDefaultPresented", "plainPasteObserved", "whitespacePasteObserved",
        "maxLengthObserved", "emptyInputObserved", "fullChallengeObserved", "cancelObserved",
        "cancelPreservedState", "cancelDidNotTrySecondEntry", "invalidPreservedAuthority", "threeVerifiedRounds"
    )
    $bad = @($requiredRibbonTrue | Where-Object { $rc[$_] -ne $true })
    if ($rc["sensitiveTextPersisted"] -ne $false) { $bad += "sensitiveTextPersisted" }
    $bad += @($requiredTrue | Where-Object { $fc[$_] -ne $true })
    if ($fc["legacyDiagnosticAttempted"] -ne $false) { $bad += "legacyDiagnosticAttempted" }
    if ($fc["legacyDiagnosticTransport"] -ne $false) { $bad += "legacyDiagnosticTransport" }
    if (-not [string]::IsNullOrEmpty($fc["legacyDiagnosticApi"])) { $bad += "legacyDiagnosticApi" }
    if ($bad.Count -gt 0) { throw "$c did not pass: $($bad -join ', ')" }

    return [pscustomobject][ordered]@{
        host = $HostName
        recordPath = [IO.Path]::GetFullPath($path)
        recordSha256 = Hash $path
        runId = $Run.runId
        startedAt = $rs.ToString("o")
        updatedAt = $updated.ToString("o")
        updatedAtValue = $updated
        sessionCount = $sessions.Count
        ribbonSession = $ri.value
        fileSession = $fi[0].value
        ribbon = $rc
        fileSystem = $fc
    }
}
function InstalledPayloads {
    $mp = Join-Path $probeRoot "probe-manifest.json"
    $m = Json $mp 65536 "probe manifest"; $c = "probe manifest"
    if ((ReqStr $m schema $c) -ne "WpsHighSchoolMathNativeCapabilityProbe" -or (ReqInt $m version $c) -ne 6) { throw "Probe manifest schema is invalid." }
    if ((ReqBool $m commercialPayload $c) -ne $false -or (ReqBool $m formalWhitelistEligible $c) -ne $false) { throw "Probe manifest isolation flags are invalid." }
    $fv = Req $m installedFiles $c
    if ($fv -isnot [array]) { throw "probe manifest.installedFiles must be a JSON array." }
    $files = @()
    foreach ($v in @($fv)) {
        if ($v -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$v)) { throw "installedFiles entries must be strings." }
        $files += ([string]$v).Replace('\', '/')
    }
    if (@($files | Sort-Object -Unique).Count -ne $files.Count) { throw "installedFiles contains duplicates." }
    $expected = @($files | Sort-Object); $hosts = [ordered]@{}
    foreach ($hostName in @("writer", "presentation")) {
        $d = ReqObj $m $hostName $c; $folder = ReqStr $d folder "$c.$hostName"
        $root = [IO.Path]::GetFullPath((Join-Path $JsAddonsPath $folder)); $jr = [IO.Path]::GetFullPath($JsAddonsPath).TrimEnd('\', '/')
        if (-not $root.StartsWith($jr + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "$hostName payload escapes jsaddons." }
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "Missing $hostName installed payload: $root" }
        $actual = @(Get-ChildItem -LiteralPath $root -Recurse -File | ForEach-Object { $_.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/') } | Sort-Object)
        if (($actual -join "|") -ne ($expected -join "|")) { throw "$hostName installed file set does not match the manifest." }
        $sr = Join-Path (Join-Path $probeRoot src) $hostName
        $rn = if ($Mode -eq "Compat") { "ribbon.compat.xml" } else { "ribbon.xml" }
        $map = [ordered]@{
            "index.html" = Join-Path $sr "index.html"; "main.js" = Join-Path $sr "main.js"
            "manifest.xml" = Join-Path $sr "manifest.xml"; "ribbon.xml" = Join-Path $sr $rn
            "js/probe.js" = Join-Path $probeRoot "src\shared\probe.js"
        }
        if ((@($map.Keys | Sort-Object) -join "|") -ne ($expected -join "|")) { throw "$hostName source map does not match the manifest." }
        $out = @(); $parts = @()
        foreach ($rel in $expected) {
            $src = [IO.Path]::GetFullPath([string]$map[$rel]); $dst = [IO.Path]::GetFullPath((Join-Path $root $rel.Replace('/', '\')))
            if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { throw "Missing source file: $src" }
            $sh = Hash $src; $dh = Hash $dst
            if ($sh -ne $dh) { throw "$hostName installed payload hash mismatch: $rel" }
            $parts += "$rel=$dh"; $out += [ordered]@{ file = $rel; sourceSha256 = $sh; installedSha256 = $dh }
        }
        $hosts[$hostName] = [ordered]@{ folder = $folder; path = $root; mode = $Mode; fileCount = $out.Count; payloadSha256 = TextHash ($parts -join "|"); files = $out }
    }
    return [pscustomobject][ordered]@{ manifestPath = [IO.Path]::GetFullPath($mp); manifestSha256 = Hash $mp; hosts = $hosts }
}
function Monitor([object]$Run, [object]$Writer, [object]$Presentation) {
    if ([string]::IsNullOrWhiteSpace($MonitorEvidencePath)) { throw "MonitorEvidencePath is required; missing continuous process/network evidence can never pass." }
    $p = [IO.Path]::GetFullPath($MonitorEvidencePath); $m = Json $p 8388608 "continuous monitor evidence"; $c = "continuous monitor evidence"
    if ((ReqStr $m schema $c) -ne "WpsHighSchoolMathNativeCapabilityMonitorEvidence" -or (ReqInt $m version $c) -ne 1) { throw "$c schema is invalid." }
    if ((ReqStr $m runId $c) -ne $Run.runId) { throw "$c.runId does not match." }
    $s = Iso (ReqStr $m startedAt $c) "$c.startedAt"; $e = Iso (ReqStr $m endedAt $c) "$c.endedAt"
    if ($e -le $s -or $e -gt $now.AddMinutes(5) -or $s -gt $Run.startedAt) { throw "$c time range is invalid." }
    $last = if ($Writer.updatedAtValue -gt $Presentation.updatedAtValue) { $Writer.updatedAtValue } else { $Presentation.updatedAtValue }
    if ($e -lt $last) { throw "$c ended before both host records completed." }
    $continuous = ReqBool $m continuousSampling $c; $coverage = ReqBool $m coverageComplete $c
    $interval = ReqInt $m maxSampleIntervalMs $c; $count = ReqInt $m sampleCount $c; $dropped = ReqInt $m droppedSamples $c
    if (-not $continuous -or -not $coverage -or $interval -lt 1 -or $interval -gt 100 -or $count -lt 2 -or $dropped -ne 0) { throw "$c continuity fields are invalid." }
    $sampleValues = Req $m samples $c
    if ($sampleValues -isnot [array]) { throw "$c.samples must be a JSON array of raw observations." }
    $samples = @($sampleValues)
    if ($samples.Count -ne $count -or $samples.Count -lt 2) { throw "$c.sampleCount does not match its raw samples." }
    $previousAt = $null; $firstAt = $null; $lastAt = $null; [double]$observedMaximumGapMs = 0
    foreach ($sample in $samples) {
        $at = Iso (ReqStr $sample at "$c sample") "$c sample.at"
        if ($at -lt $s -or $at -gt $e) { throw "$c contains a sample outside its declared range." }
        if ($null -eq $firstAt) { $firstAt = $at }
        if ($null -ne $previousAt) {
            $gap = ($at - $previousAt).TotalMilliseconds
            if ($gap -le 0 -or $gap -gt 100) { throw "$c raw samples are not strictly ordered at intervals no greater than 100 ms." }
            if ($gap -gt $observedMaximumGapMs) { $observedMaximumGapMs = $gap }
        }
        if ((ReqInt $sample unexpectedHelperCount "$c sample") -ne 0 -or
            (ReqInt $sample listenerCount "$c sample") -ne 0 -or
            (ReqInt $sample loopbackConnectionCount "$c sample") -ne 0) {
            throw "$c raw sample detected a helper, listener, or loopback connection."
        }
        $previousAt = $at; $lastAt = $at
    }
    if ($firstAt -gt $Run.startedAt -or $lastAt -lt $last) { throw "$c raw samples do not cover the complete capability run." }
    if ([Math]::Ceiling($observedMaximumGapMs) -gt $interval) { throw "$c.maxSampleIntervalMs understates the observed raw-sample gap." }
    $pt = ReqObj $m processTree $c; $net = ReqObj $m network $c
    $ps = ReqBool $pt sampled "$c.processTree"; $helpers = ReqInt $pt unexpectedHelperCount "$c.processTree"
    $ns = ReqBool $net sampled "$c.network"; $listeners = ReqInt $net listenerCount "$c.network"; $loopback = ReqInt $net loopbackConnectionCount "$c.network"
    if (-not $ps -or $helpers -ne 0 -or -not $ns -or $listeners -ne 0 -or $loopback -ne 0) { throw "$c detected a helper/listener/loopback event or lacks sampling." }
    return [pscustomobject][ordered]@{
        path = $p; sha256 = Hash $p; runId = $Run.runId; startedAt = $s.ToString("o"); endedAt = $e.ToString("o")
        continuousSampling = $continuous; coverageComplete = $coverage; maxSampleIntervalMs = $interval; observedMaximumGapMs = [Math]::Ceiling($observedMaximumGapMs); sampleCount = $count; droppedSamples = $dropped
        processTree = [ordered]@{ sampled = $ps; unexpectedHelperCount = $helpers }
        network = [ordered]@{ sampled = $ns; listenerCount = $listeners; loopbackConnectionCount = $loopback }
    }
}
function Stage([string]$Name, [string]$Code, [scriptblock]$Action, [ref]$Out) {
    try { $Out.Value = & $Action; $checks[$Name] = $true }
    catch { $Out.Value = $null; $checks[$Name] = $false; Fail $Code $_.Exception.Message }
}

$context = $null; $run = $null; $writer = $null; $presentation = $null; $wr = $null; $pr = $null; $payloads = $null; $monitor = $null
Stage executionContext execution-context-invalid { ExecutionContext } ([ref]$context)
Stage runIdentity run-identity-invalid { RunContext } ([ref]$run)
Stage writerExecutable writer-executable-invalid { Exe $WriterExe "wps.exe" } ([ref]$writer)
Stage presentationExecutable presentation-executable-invalid { Exe $PresentationExe "wpp.exe" } ([ref]$presentation)
try {
    if ($null -eq $writer -or $null -eq $presentation) { throw "Both executable records are required before comparing WPS builds." }
    if ($writer.fileVersion -ne $presentation.fileVersion -or $writer.productVersion -ne $presentation.productVersion) { throw "Writer and Presentation version tuples differ." }
    $checks.matchingWpsBuild = $true
} catch { Fail wps-build-mismatch $_.Exception.Message }
if ($null -ne $run) {
    Stage writerRecord writer-record-invalid { HostRecord writer $run } ([ref]$wr)
    Stage presentationRecord presentation-record-invalid { HostRecord presentation $run } ([ref]$pr)
} else {
    Fail writer-record-unverifiable "Writer record cannot be accepted without run identity."
    Fail presentation-record-unverifiable "Presentation record cannot be accepted without run identity."
}
Stage installedPayloads installed-payload-invalid { InstalledPayloads } ([ref]$payloads)
if ($null -ne $run -and $null -ne $wr -and $null -ne $pr) {
    Stage continuousMonitoring continuous-monitor-invalid { Monitor $run $wr $pr } ([ref]$monitor)
} else { Fail continuous-monitor-unverifiable "Continuous monitor evidence requires run identity and both host records." }

$digests = @(Get-ChildItem -LiteralPath $probeRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
    [ordered]@{ file = $_.FullName.Substring($probeRoot.Length).TrimStart('\', '/').Replace('\', '/'); sha256 = Hash $_.FullName }
})
$gatePassed = $failures.Count -eq 0
foreach ($v in $checks.Values) { if ($v -ne $true) { $gatePassed = $false } }
$formalPass = $gatePassed -and -not $FixtureMode
$status = if (-not $gatePassed) { "failed" } elseif ($FixtureMode) { "fixture-passed" } else { "passed" }
$result = [ordered]@{
    schema = "WpsHighSchoolMathNativeCapabilityEvidence"; version = 2; status = $status; recordedAt = $now.ToString("o")
    runId = if ($null -ne $run) { $run.runId } else { $RunId }; startedAt = if ($null -ne $run) { $run.startedAtText } else { $StartedAt }
    commercialPayload = $false; formalWhitelistEligible = $false; fixtureMode = [bool]$FixtureMode; formalPass = $formalPass; checks = $checks; failures = @($failures)
    wpsBuild = [ordered]@{ fileVersion = if ($null -ne $writer) { $writer.fileVersion } else { "" }; productVersion = if ($null -ne $writer) { $writer.productVersion } else { "" }; writer = $writer; presentation = $presentation }
    hosts = [ordered]@{ writer = $wr; presentation = $pr }; installedPayloads = $payloads; continuousMonitoring = $monitor; probeFiles = $digests
    decision = if ($formalPass) { "This production evidence permits a later supported-build candidate only; it is not a commercial whitelist." } elseif ($gatePassed) { "Fixture checks passed, but fixture evidence can never authorize a WPS build." } else { "Task 2 hard gate failed. Do not begin dependent implementation or generate a supported-build candidate." }
}
if (-not $EvidencePath) {
    $build = if ($null -ne $writer -and $writer.fileVersion) { $writer.fileVersion -replace '[^0-9A-Za-z._-]', '-' } else { "unknown-build" }
    $rid = if ($null -ne $run) { $run.runId } else { "unbound-run" }
    $EvidencePath = Join-Path $evidenceRoot "wps-native-capability-$build-$rid.json"
}
$ep = [IO.Path]::GetFullPath($EvidencePath)
if (-not $ep.StartsWith($evidenceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Evidence path must stay below the specification evidence directory." }
New-Item -ItemType Directory -Path (Split-Path -Parent $ep) -Force | Out-Null
$tmp = "$ep.tmp-$([Guid]::NewGuid().ToString('N'))"
try {
    [IO.File]::WriteAllText($tmp, ($result | ConvertTo-Json -Depth 32), $utf8NoBom)
    if (Test-Path -LiteralPath $ep -PathType Leaf) {
        $bak = "$ep.bak-$([Guid]::NewGuid().ToString('N'))"
        try { [IO.File]::Replace($tmp, $ep, $bak, $true) } finally { if (Test-Path -LiteralPath $bak) { Remove-Item -LiteralPath $bak -Force } }
    } else { [IO.File]::Move($tmp, $ep) }
} finally { if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force } }
$round = Json $ep 4194304 "written capability evidence"
if ((ReqStr $round schema "written evidence") -ne "WpsHighSchoolMathNativeCapabilityEvidence" -or (ReqInt $round version "written evidence") -ne 2 -or (ReqStr $round status "written evidence") -ne $status) { throw "Evidence write-back validation failed." }
if ($gatePassed) { Write-Output "Native WPS capability evidence status '$status' was written to: $ep"; exit 0 }
[Console]::Error.WriteLine("Native WPS capability hard gate failed; honest evidence was written to: $ep")
exit 1
