$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$monitor = Join-Path $projectRoot "probes\wps-native-capabilities\scripts\capture-native-capability-monitor.ps1"
$testRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot (".tmp-tests\native-capability-monitor-" + [Guid]::NewGuid().ToString("N"))))
$workspace = [IO.Path]::GetFullPath($projectRoot).TrimEnd('\', '/')
$utf8 = New-Object Text.UTF8Encoding($false)

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

try {
    Assert (Test-Path -LiteralPath $monitor -PathType Leaf) "Monitor script is missing."
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
    $writer = Join-Path $testRoot "wps.exe"
    $presentation = Join-Path $testRoot "wpp.exe"
    [IO.File]::WriteAllText($writer, "synthetic writer identity", $utf8)
    [IO.File]::WriteAllText($presentation, "synthetic presentation identity", $utf8)

    $runId = [Guid]::NewGuid().ToString("D")
    $evidence = Join-Path $testRoot "monitor.json"
    $ready = Join-Path $testRoot "ready.json"
    $stop = Join-Path $testRoot "stop.signal"
    $stdout = Join-Path $testRoot "stdout.txt"
    $stderr = Join-Path $testRoot "stderr.txt"
    $arguments = @(
        "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"' + $monitor + '"'),
        "-RunId", $runId,
        "-WriterExe", ('"' + $writer + '"'),
        "-PresentationExe", ('"' + $presentation + '"'),
        "-EvidencePath", ('"' + $evidence + '"'),
        "-ReadyPath", ('"' + $ready + '"'),
        "-StopSignalPath", ('"' + $stop + '"'),
        "-SampleIntervalMs", "50", "-MaxMinutes", "1"
    )
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath $ready -PathType Leaf) -and -not $process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 50
        $process.Refresh()
    }
    Assert (Test-Path -LiteralPath $ready -PathType Leaf) ("Monitor did not become ready: " + (Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue))
    $readyRecord = Get-Content -LiteralPath $ready -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert ([string]$readyRecord.runId -eq $runId) "Ready record runId mismatch."

    Start-Sleep -Milliseconds 650
    [IO.File]::WriteAllText($stop, "stop", $utf8)
    Assert ($process.WaitForExit(20000)) "Monitor did not exit after its stop signal."
    Assert (Test-Path -LiteralPath $evidence -PathType Leaf) "Monitor evidence was not written."

    $result = Get-Content -LiteralPath $evidence -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert ([string]$result.schema -eq "WpsHighSchoolMathNativeCapabilityMonitorEvidence") "Monitor schema mismatch."
    Assert ([int]$result.version -eq 1) "Monitor version mismatch."
    Assert ([string]$result.runId -eq $runId) "Monitor evidence runId mismatch."
    Assert ($result.continuousSampling -is [bool] -and $result.continuousSampling) "Clean monitor run was not continuous."
    Assert ($result.coverageComplete -is [bool] -and $result.coverageComplete) "Clean monitor run did not report complete coverage."
    Assert ([int]$result.sampleCount -eq @($result.samples).Count -and [int]$result.sampleCount -ge 2) "Monitor sample count mismatch."
    Assert ([int]$result.droppedSamples -eq 0) "Clean monitor run dropped samples."
    Assert ([int]$result.maxSampleIntervalMs -le 100) "Monitor sample gap exceeded 100 ms."
    Assert ([int]$result.processTree.unexpectedHelperCount -eq 0) "Synthetic run detected an unexpected helper."
    Assert ([int]$result.network.listenerCount -eq 0 -and [int]$result.network.loopbackConnectionCount -eq 0) "Synthetic run detected target network activity."

    $previousAt = $null
    foreach ($sample in @($result.samples)) {
        $at = [DateTimeOffset]::Parse([string]$sample.at)
        if ($null -ne $previousAt) {
            $gap = ($at - $previousAt).TotalMilliseconds
            Assert ($gap -gt 0 -and $gap -le 100) "Raw monitor samples are not continuous."
        }
        $previousAt = $at
    }

    $helperExe = Join-Path $testRoot "WpsHighSchoolMathEditorHost.exe"
    Copy-Item -LiteralPath (Join-Path $env:SystemRoot "System32\ping.exe") -Destination $helperExe -Force
    $violationRunId = [Guid]::NewGuid().ToString("D")
    $violationEvidence = Join-Path $testRoot "monitor-violation.json"
    $violationReady = Join-Path $testRoot "ready-violation.json"
    $violationStop = Join-Path $testRoot "stop-violation.signal"
    $violationStdout = Join-Path $testRoot "stdout-violation.txt"
    $violationStderr = Join-Path $testRoot "stderr-violation.txt"
    $violationArguments = @(
        "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"' + $monitor + '"'),
        "-RunId", $violationRunId,
        "-WriterExe", ('"' + $writer + '"'),
        "-PresentationExe", ('"' + $presentation + '"'),
        "-EvidencePath", ('"' + $violationEvidence + '"'),
        "-ReadyPath", ('"' + $violationReady + '"'),
        "-StopSignalPath", ('"' + $violationStop + '"'),
        "-SampleIntervalMs", "50", "-MaxMinutes", "1"
    )
    $violationProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $violationArguments -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $violationStdout -RedirectStandardError $violationStderr
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath $violationReady -PathType Leaf) -and -not $violationProcess.HasExited -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 50
        $violationProcess.Refresh()
    }
    Assert (Test-Path -LiteralPath $violationReady -PathType Leaf) "Violation monitor did not become ready."
    $helperProcess = Start-Process -FilePath $helperExe -ArgumentList @("-n", "8", "127.0.0.1") -PassThru -WindowStyle Hidden
    Start-Sleep -Milliseconds 650
    [IO.File]::WriteAllText($violationStop, "stop", $utf8)
    Assert ($violationProcess.WaitForExit(20000)) "Violation monitor did not exit after its stop signal."
    Assert (Test-Path -LiteralPath $violationEvidence -PathType Leaf) "Violation evidence was not written."
    $violationResult = Get-Content -LiteralPath $violationEvidence -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert ([int]$violationResult.processTree.unexpectedHelperCount -ge 1) "Product helper process was not detected."
    Assert (@($violationResult.samples | Where-Object { [int]$_.unexpectedHelperCount -ge 1 }).Count -ge 1) "Raw samples omitted the helper violation."

    Write-Output "WPS native capability continuous monitor tests passed"
} finally {
    if ($null -ne (Get-Variable process -ValueOnly -ErrorAction SilentlyContinue) -and -not $process.HasExited) {
        $process.Kill()
        [void]$process.WaitForExit(5000)
    }
    if ($null -ne (Get-Variable violationProcess -ValueOnly -ErrorAction SilentlyContinue) -and -not $violationProcess.HasExited) {
        $violationProcess.Kill()
        [void]$violationProcess.WaitForExit(5000)
    }
    if ($null -ne (Get-Variable helperProcess -ValueOnly -ErrorAction SilentlyContinue) -and -not $helperProcess.HasExited) {
        $helperProcess.Kill()
        [void]$helperProcess.WaitForExit(5000)
    }
    if ($testRoot.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
        (Test-Path -LiteralPath $testRoot)) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
