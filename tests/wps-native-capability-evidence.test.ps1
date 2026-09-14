$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$probeRoot = Join-Path $projectRoot "probes\wps-native-capabilities"
$recorder = Join-Path $probeRoot "scripts\record-native-capability-result.ps1"
$fixtureRoot = Join-Path $projectRoot (".tmp-tests\native-capability-evidence-" + [Guid]::NewGuid().ToString("N"))
$recordRoot = Join-Path $fixtureRoot "records"
$jsAddons = Join-Path $fixtureRoot "jsaddons"
$binRoot = Join-Path $fixtureRoot "bin"
$monitorPath = Join-Path $fixtureRoot "monitor.json"
$evidenceRoot = Join-Path $projectRoot "specs\scheme-c-native-function-editor\evidence"
$evidencePrefix = ".test-native-capability-" + [Guid]::NewGuid().ToString("N")
$utf8 = New-Object Text.UTF8Encoding($false)
$createdEvidence = New-Object Collections.ArrayList

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function WriteJson([string]$Path, [object]$Value) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 20), $utf8)
}
function WriteHostJson([string]$Path, [object]$Value) {
    $json = $Value | ConvertTo-Json -Depth 20
    $envelope = "HSMB64:1:" + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    [IO.File]::WriteAllText($Path, $envelope, $utf8)
}
function ReadHostJson([string]$Path) {
    $envelope = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
    Assert ($envelope.StartsWith("HSMB64:1:")) "Host fixture is not HSMB64 wrapped."
    return ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($envelope.Substring(9))) | ConvertFrom-Json)
}
function NewHostRecord([string]$HostName, [string]$CurrentRunId, [DateTimeOffset]$Start, [DateTimeOffset]$Loaded, [DateTimeOffset]$Ran, [DateTimeOffset]$Updated) {
    $session1Id = "$HostName-$CurrentRunId-1"
    $session2Id = "$HostName-$CurrentRunId-2"
    function NewCompleteSession([string]$Id, [DateTimeOffset]$When) {
        return [ordered]@{
            id = $Id; runId = $CurrentRunId; loadedAt = $When.ToString("o")
            addinLoaded = $true; visibleConfirmed = $true
            nativeInputBoxCalls = 7; nativeInputMethod = "global.InputBox"
            inputParameterForm = "(prompt,title,defaultValue)"; inputArgumentCount = 3; defaultValueLength = 0
            expectedCase = "invalidInput"; lastReturnType = "string"; lastReturnLength = 17
            defaultEchoReturnType = "string:empty"; emptyReturnType = "string:empty"; emptyReturnLength = 0
            lastExpectedHashMatched = $true; cancelSentinelType = "boolean:false"
            globalInputAttempted = $true; applicationInputAttempted = $false
            initialDefaultPresented = $true; cancelObserved = $true; cancelPreservedState = $true
            cancelDidNotTrySecondEntry = $true; fullInputObserved = $true; acceptedChallengeCount = 3
            plainPasteObserved = $true; whitespacePasteObserved = $true
            maxLengthObserved = $true; maxLegalLength = 33; emptyInputObserved = $true
            invalidInputObserved = $true; verifiedRounds = 3
            syntheticAuthorityRevision = 7; syntheticAuthorityStrength = "paid"; syntheticFeedbackRevision = 0
            authorityUnchangedAfterInvalid = $true; failureCodePersisted = $false; sensitiveTextPersisted = $false
        }
    }
    return [ordered]@{
        schema = "WpsHighSchoolMathNativeCapabilityHostRecord"; version = 2; host = $HostName
        runId = $CurrentRunId; startedAt = $Start.ToString("o"); updatedAt = $Updated.ToString("o")
        sessions = @(
            (NewCompleteSession $session1Id $Loaded),
            (NewCompleteSession $session2Id $Loaded.AddMilliseconds(500))
        )
        ribbon = [ordered]@{
            loaded = $true; totalInputBoxCalls = 14; totalVerifiedRounds = 6
            lastNativeInputMethod = "global.InputBox"; lastError = ""
        }
        fileSystem = [ordered]@{
            runId = $CurrentRunId; startedAt = $Start.ToString("o"); ranAt = $Ran.ToString("o"); lastSessionId = $session2Id
            appDataPathAvailable = $true; directoryCreated = $true
            requiredWriteAsBinaryString = $true; requiredReadAsBinaryString = $true
            utf8Base64RoundTrip = $true; overwriteAndTruncate = $true
            read1024RoundTrip = $true; read1025RoundTrip = $true
            readReturnType1024 = "string"; readReturnType1025 = "string"
            raw12000RoundTrip = $true; raw12001RejectedBeforeWrite = $true; raw12000EnvelopeLength = 16009
            physicalEnvelope16384RoundTrip = $true
            physicalEnvelopeOverLimitRejectedBeforeWrite = $true
            physicalEnvelopeOverLimitRejectedAfterRead = $true
            invalidPrefixRejected = $true; invalidBase64Rejected = $true; invalidUtf8Rejected = $true
            slotRevisionSelection = $true; singleSlotRecovery = $true; corruptSlotRewrite = $true
            ownMarkerWritten = $true; peerHostObserved = $true
            legacyDiagnosticAttempted = $false; legacyDiagnosticTransport = $false
            legacyDiagnosticApi = ""; legacyDiagnosticTransportError = ""; lastError = ""
        }
    }
}
function RestoreRecords {
    WriteHostJson (Join-Path $recordRoot "writer.json") (NewHostRecord writer $runId $started $loaded $ran $updated)
    WriteHostJson (Join-Path $recordRoot "presentation.json") (NewHostRecord presentation $runId $started $loaded $ran $updated)
}
function InvokeRecorder([string]$Case, [string]$Monitor = $monitorPath, [string]$RequestedMode = "Full") {
    $evidence = Join-Path $evidenceRoot "$evidencePrefix-$Case.json"
    [void]$createdEvidence.Add($evidence)
    if (Test-Path -LiteralPath $evidence) { Remove-Item -LiteralPath $evidence -Force }
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $output = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $recorder `
        -WriterExe (Join-Path $binRoot "wps.exe") `
        -PresentationExe (Join-Path $binRoot "wpp.exe") `
        -RunId $runId -StartedAt $started.ToString("o") `
        -MonitorEvidencePath $Monitor -JsAddonsPath $jsAddons -Mode $RequestedMode `
        -MaxRecordAgeMinutes 10 -RecordRoot $recordRoot -EvidencePath $evidence -FixtureMode 2>&1
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorAction
    return [pscustomobject]@{ exitCode = $exitCode; evidencePath = $evidence; output = @($output) -join [Environment]::NewLine }
}
function ReadEvidence([string]$Path) {
    Assert (Test-Path -LiteralPath $Path -PathType Leaf) "Recorder did not write failure evidence: $Path"
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}
function FailureText([object]$Evidence) {
    return @($Evidence.failures | ForEach-Object { [string]$_.message }) -join " | "
}

try {
    New-Item -ItemType Directory -Path $recordRoot, $jsAddons, $binRoot -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $binRoot "wps.exe"), "synthetic-writer", $utf8)
    [IO.File]::WriteAllText((Join-Path $binRoot "wpp.exe"), "synthetic-presentation", $utf8)

    $manifest = Get-Content -LiteralPath (Join-Path $probeRoot "probe-manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert ([int]$manifest.version -eq 6) "Evidence recorder and probe manifest schema version must stay aligned."
    foreach ($hostName in @("writer", "presentation")) {
        $definition = $manifest.$hostName
        $destination = Join-Path $jsAddons ([string]$definition.folder)
        New-Item -ItemType Directory -Path (Join-Path $destination "js") -Force | Out-Null
        $sourceRoot = Join-Path (Join-Path $probeRoot "src") $hostName
        foreach ($name in @("index.html", "main.js", "manifest.xml", "ribbon.xml")) {
            Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination (Join-Path $destination $name) -Force
        }
        Copy-Item -LiteralPath (Join-Path $probeRoot "src\shared\probe.js") -Destination (Join-Path $destination "js\probe.js") -Force
    }

    $runId = [Guid]::NewGuid().ToString("D")
    $started = [DateTimeOffset]::UtcNow.AddSeconds(-4)
    $loaded = $started.AddSeconds(1)
    $ran = $started.AddSeconds(2)
    $updated = $started.AddSeconds(3)
    RestoreRecords
    $monitorStart = $started.AddMilliseconds(-100)
    $monitorEnd = $updated.AddMilliseconds(100)
    $rawSamples = @()
    for ($sampleAt = $monitorStart; $sampleAt -le $monitorEnd; $sampleAt = $sampleAt.AddMilliseconds(100)) {
        $rawSamples += [ordered]@{
            at = $sampleAt.ToString("o")
            unexpectedHelperCount = 0
            listenerCount = 0
            loopbackConnectionCount = 0
        }
    }
    WriteJson $monitorPath ([ordered]@{
        schema = "WpsHighSchoolMathNativeCapabilityMonitorEvidence"
        version = 1
        runId = $runId
        startedAt = $monitorStart.ToString("o")
        endedAt = $monitorEnd.ToString("o")
        continuousSampling = $true
        coverageComplete = $true
        maxSampleIntervalMs = 100
        sampleCount = $rawSamples.Count
        droppedSamples = 0
        samples = $rawSamples
        processTree = [ordered]@{ sampled = $true; unexpectedHelperCount = 0 }
        network = [ordered]@{ sampled = $true; listenerCount = 0; loopbackConnectionCount = 0 }
    })

    $pass = InvokeRecorder "pass"
    $passEvidence = ReadEvidence $pass.evidencePath
    Assert ($pass.exitCode -eq 0) "Valid evidence was rejected: $(FailureText $passEvidence) :: $($pass.output)"
    Assert ($passEvidence.status -eq "fixture-passed") "Valid evidence did not record passed status."
    Assert ($passEvidence.formalPass -eq $false) "Fixture evidence must never be a formal pass."
    Assert ($passEvidence.version -eq 2) "Evidence schema version was not upgraded."
    Assert ($passEvidence.checks.continuousMonitoring -eq $true) "Continuous monitoring was not part of the pass gate."
    Assert ($passEvidence.installedPayloads.hosts.writer.files.Count -eq 5) "Installed Writer hashes were not recorded."
    Assert ($passEvidence.hosts.writer.fileSystem.requiredWriteAsBinaryString -eq $true) "Required write API result was not preserved."
    Assert ($passEvidence.hosts.writer.fileSystem.requiredReadAsBinaryString -eq $true) "Required read API result was not preserved."
    Assert ($passEvidence.hosts.writer.fileSystem.legacyDiagnosticTransport -eq $false) "Legacy diagnostic transport result was not preserved."
    Assert (-not [string]::IsNullOrWhiteSpace([string]$passEvidence.continuousMonitoring.sha256)) "Monitor digest was not recorded."

    RestoreRecords
    $badBoolean = ReadHostJson (Join-Path $recordRoot "writer.json")
    $badBoolean.fileSystem.overwriteAndTruncate = "false"
    WriteHostJson (Join-Path $recordRoot "writer.json") $badBoolean
    $strict = InvokeRecorder "strict-boolean"
    Assert ($strict.exitCode -ne 0) "A string-valued false passed as a boolean."
    $strictEvidence = ReadEvidence $strict.evidencePath
    Assert ($strictEvidence.status -eq "failed") "Strict-type rejection was not recorded as failed."
    Assert ((FailureText $strictEvidence) -match "JSON boolean") "Strict-type failure did not explain the boolean type error."

    RestoreRecords
    $requiredWriteFalse = ReadHostJson (Join-Path $recordRoot "writer.json")
    $requiredWriteFalse.fileSystem.requiredWriteAsBinaryString = $false
    WriteHostJson (Join-Path $recordRoot "writer.json") $requiredWriteFalse
    $writeRequired = InvokeRecorder "required-write-false"
    Assert ($writeRequired.exitCode -ne 0) "requiredWriteAsBinaryString=false passed."
    $writeRequiredEvidence = ReadEvidence $writeRequired.evidencePath
    Assert ((FailureText $writeRequiredEvidence) -match "requiredWriteAsBinaryString") "Required write API failure was not explicit."

    RestoreRecords
    $requiredReadFalse = ReadHostJson (Join-Path $recordRoot "writer.json")
    $requiredReadFalse.fileSystem.requiredReadAsBinaryString = $false
    WriteHostJson (Join-Path $recordRoot "writer.json") $requiredReadFalse
    $readRequired = InvokeRecorder "required-read-false"
    Assert ($readRequired.exitCode -ne 0) "requiredReadAsBinaryString=false passed."
    $readRequiredEvidence = ReadEvidence $readRequired.evidencePath
    Assert ((FailureText $readRequiredEvidence) -match "requiredReadAsBinaryString") "Required read API failure was not explicit."

    RestoreRecords
    $legacyTrue = ReadHostJson (Join-Path $recordRoot "writer.json")
    $legacyTrue.fileSystem.legacyDiagnosticTransport = $true
    WriteHostJson (Join-Path $recordRoot "writer.json") $legacyTrue
    $legacy = InvokeRecorder "legacy-transport-true"
    Assert ($legacy.exitCode -ne 0) "legacyDiagnosticTransport=true passed."
    $legacyEvidence = ReadEvidence $legacy.evidencePath
    Assert ((FailureText $legacyEvidence) -match "legacyDiagnosticTransport") "Legacy diagnostic transport failure was not explicit."

    RestoreRecords
    $historical = ReadHostJson (Join-Path $recordRoot "writer.json")
    $historical.runId = [Guid]::NewGuid().ToString("D")
    WriteHostJson (Join-Path $recordRoot "writer.json") $historical
    $history = InvokeRecorder "historical"
    Assert ($history.exitCode -ne 0) "A historical record with another runId passed."
    $historyEvidence = ReadEvidence $history.evidencePath
    Assert ((FailureText $historyEvidence) -match "historical data is rejected") "Historical-record rejection was not explicit."

    RestoreRecords
    $missingField = ReadHostJson (Join-Path $recordRoot "writer.json")
    [void]$missingField.PSObject.Properties.Remove("startedAt")
    WriteHostJson (Join-Path $recordRoot "writer.json") $missingField
    $missing = InvokeRecorder "missing-run-field"
    Assert ($missing.exitCode -ne 0) "A record missing startedAt passed."
    $missingEvidence = ReadEvidence $missing.evidencePath
    Assert ((FailureText $missingEvidence) -match "missing required property 'startedAt'") "Missing run field was not explicit."

    RestoreRecords
    RestoreRecords
    $badBoundary = ReadHostJson (Join-Path $recordRoot "writer.json")
    $badBoundary.fileSystem.raw12001RejectedBeforeWrite = $false
    WriteHostJson (Join-Path $recordRoot "writer.json") $badBoundary
    $boundaryResult = InvokeRecorder "raw-boundary-false"
    Assert ($boundaryResult.exitCode -ne 0) "A failed 12001-byte pre-write rejection passed."
    Assert ((FailureText (ReadEvidence $boundaryResult.evidencePath)) -match "raw12001RejectedBeforeWrite") "Boundary failure was not explicit."

    RestoreRecords
    $badCancel = ReadHostJson (Join-Path $recordRoot "writer.json")
    foreach ($item in @($badCancel.sessions)) { $item.cancelDidNotTrySecondEntry = $false }
    WriteHostJson (Join-Path $recordRoot "writer.json") $badCancel
    $cancelResult = InvokeRecorder "cancel-fallback"
    Assert ($cancelResult.exitCode -ne 0) "A cancel that attempted the second entry passed."
    Assert ((FailureText (ReadEvidence $cancelResult.evidencePath)) -match "native InputBox boundary session") "Cancel fallback failure was not explicit."

    RestoreRecords
    $noMonitor = InvokeRecorder "missing-monitor" (Join-Path $fixtureRoot "missing-monitor.json")
    Assert ($noMonitor.exitCode -ne 0) "Missing continuous monitor evidence passed."
    $noMonitorEvidence = ReadEvidence $noMonitor.evidencePath
    Assert ($noMonitorEvidence.checks.continuousMonitoring -eq $false) "Missing monitor did not fail its gate."
    Assert (@($noMonitorEvidence.failures | Where-Object { $_.code -eq "continuous-monitor-invalid" }).Count -eq 1) "Missing monitor failure code was not recorded."

    RestoreRecords
    $summaryOnlyPath = Join-Path $fixtureRoot "summary-only-monitor.json"
    $summaryOnly = Get-Content -LiteralPath $monitorPath -Raw -Encoding UTF8 | ConvertFrom-Json
    [void]$summaryOnly.PSObject.Properties.Remove("samples")
    WriteJson $summaryOnlyPath $summaryOnly
    $summaryOnlyResult = InvokeRecorder "summary-only-monitor" $summaryOnlyPath
    Assert ($summaryOnlyResult.exitCode -ne 0) "A monitor summary without raw samples passed."
    $summaryOnlyEvidence = ReadEvidence $summaryOnlyResult.evidencePath
    Assert ((FailureText $summaryOnlyEvidence) -match "missing required property 'samples'") "Raw continuous samples were not enforced."

    RestoreRecords
    $writerMain = Join-Path (Join-Path $jsAddons ([string]$manifest.writer.folder)) "main.js"
    [IO.File]::AppendAllText($writerMain, [Environment]::NewLine + "// tampered", $utf8)
    $tampered = InvokeRecorder "tampered-payload"
    Assert ($tampered.exitCode -ne 0) "A tampered installed payload passed."
    $tamperedEvidence = ReadEvidence $tampered.evidencePath
    Assert ($tamperedEvidence.checks.installedPayloads -eq $false) "Tampered payload did not fail the installed hash gate."
    Assert ((FailureText $tamperedEvidence) -match "hash mismatch") "Tampered payload failure did not identify a hash mismatch."

    Write-Output "WPS native capability evidence recorder tests passed"
} finally {
    foreach ($path in @($createdEvidence)) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
    $workspace = [IO.Path]::GetFullPath($projectRoot).TrimEnd('\', '/')
    $fullFixture = [IO.Path]::GetFullPath($fixtureRoot)
    if ($fullFixture.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $fullFixture)) {
        Remove-Item -LiteralPath $fullFixture -Recurse -Force
    }
}
