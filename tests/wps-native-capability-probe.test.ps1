$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$probeRoot = Join-Path $projectRoot "probes\wps-native-capabilities"
$scriptsRoot = Join-Path $probeRoot "scripts"
$fixtureRoot = Join-Path $projectRoot (".tmp-tests\native-probe-" + [Guid]::NewGuid().ToString("N"))
$utf8Strict = New-Object Text.UTF8Encoding($false, $true)

function Invoke-ProbeScript {
    param([Parameter(Mandatory = $true)][string]$Name, [string[]]$Arguments = @())
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptsRoot $Name) @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE." }
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

try {
    Invoke-ProbeScript -Name "validate-native-capability-probe.ps1" -Arguments @("-Mode", "Source")

    New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
    $publishPath = Join-Path $fixtureRoot "publish.xml"
    $publish = '<?xml version="1.0" encoding="UTF-8"?><jsplugins><jsplugin name="UnrelatedPlugin" type="wps" url="Unrelated_1.0.0" version="1.0.0" enable="enable_dev" /></jsplugins>'
    [IO.File]::WriteAllText($publishPath, $publish, (New-Object Text.UTF8Encoding($false)))

    $stateRoot = Join-Path $fixtureRoot "probe-state"
    New-Item -ItemType Directory -Path (Join-Path $stateRoot "records"), (Join-Path $stateRoot "file-tests") -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $stateRoot "records\writer.json"), "stale", (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path $stateRoot "file-tests\stale.bin"), "stale", (New-Object Text.UTF8Encoding($false)))
    $preparedRunId = [Guid]::NewGuid().ToString("D")
    $preparedStartedAt = [DateTimeOffset]::UtcNow.AddSeconds(-1).ToString("o")
    Invoke-ProbeScript -Name "prepare-native-capability-run.ps1" -Arguments @("-ProbeStateRoot", $stateRoot, "-RunId", $preparedRunId, "-StartedAt", $preparedStartedAt)
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $stateRoot "records\writer.json"))) "PrepareRun kept a stale host record."
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $stateRoot "file-tests\stale.bin"))) "PrepareRun kept a stale file marker."
    $runEnvelope = [IO.File]::ReadAllText((Join-Path $stateRoot "run-context.json"), [Text.Encoding]::UTF8)
    Assert-True ($runEnvelope.StartsWith("HSMB64:1:")) "PrepareRun did not write the binary Base64 envelope."
    $runJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($runEnvelope.Substring(9))) | ConvertFrom-Json
    Assert-True ([string]$runJson.runId -eq $preparedRunId) "PrepareRun runId did not round-trip."
    Assert-True ([string]$runJson.startedAt -eq ([DateTimeOffset]::Parse($preparedStartedAt).ToUniversalTime().ToString("o"))) "PrepareRun startedAt did not round-trip."

    Invoke-ProbeScript -Name "install-native-capability-probe.ps1" -Arguments @("-Mode", "Full", "-JsAddonsPath", $fixtureRoot, "-SkipProcessCheck")
    Invoke-ProbeScript -Name "validate-native-capability-probe.ps1" -Arguments @("-Mode", "Full", "-JsAddonsPath", $fixtureRoot)

    $manifest = Get-Content -LiteralPath (Join-Path $probeRoot "probe-manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($definition in @($manifest.writer, $manifest.presentation)) {
        $payload = Join-Path $fixtureRoot ([string]$definition.folder)
        Assert-True (Test-Path -LiteralPath $payload -PathType Container) "Probe payload was not installed: $payload"
        [xml]$ribbon = Get-Content -LiteralPath (Join-Path $payload "ribbon.xml") -Raw -Encoding UTF8
        Assert-True (@($ribbon.SelectNodes("//*[local-name()='editBox']")).Count -eq 0) "Scheme-A full probe must not contain editBox."
        Assert-True (@($ribbon.SelectNodes("//*[@id='probe_open_input']")).Count -eq 1) "Scheme-A full probe must contain one native-input button."
        Assert-True (@($ribbon.SelectNodes("//*[@id='probe_open_native_dialog']")).Count -eq 1) "Scheme-one full probe must contain one in-process native-dialog button."
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $payload "native") -PathType Container)) "The registered COM probe DLL must not be duplicated inside the JS add-in payload."
    }

    $bytes = [IO.File]::ReadAllBytes($publishPath)
    [void]$utf8Strict.GetString($bytes)
    $firstLine = Get-Content -LiteralPath $publishPath -TotalCount 1 -Encoding UTF8
    Assert-True ($firstLine -eq '<?xml version="1.0" encoding="UTF-8"?>') "publish.xml must truthfully declare UTF-8."
    [xml]$fullPublish = Get-Content -LiteralPath $publishPath -Raw -Encoding UTF8
    Assert-True (@($fullPublish.DocumentElement.SelectNodes("jsplugin[@name='UnrelatedPlugin']")).Count -eq 1) "Unrelated publish.xml node changed."

    Invoke-ProbeScript -Name "install-native-capability-probe.ps1" -Arguments @("-Mode", "Compat", "-JsAddonsPath", $fixtureRoot, "-SkipProcessCheck")
    Invoke-ProbeScript -Name "validate-native-capability-probe.ps1" -Arguments @("-Mode", "Compat", "-JsAddonsPath", $fixtureRoot)
    foreach ($definition in @($manifest.writer, $manifest.presentation)) {
        [xml]$ribbon = Get-Content -LiteralPath (Join-Path (Join-Path $fixtureRoot ([string]$definition.folder)) "ribbon.xml") -Raw -Encoding UTF8
        Assert-True (@($ribbon.SelectNodes("//*[local-name()='editBox']")).Count -eq 0) "Compat probe must not contain editBox."
        Assert-True (@($ribbon.SelectNodes("//*[@id='probe_open_input']")).Count -eq 0) "Compat probe must not contain the native-input hard-gate button."
        Assert-True (@($ribbon.SelectNodes("//*[@id='probe_open_native_dialog']")).Count -eq 0) "Compat probe must not contain the in-process native-dialog hard-gate button."
    }

    $authPath = Join-Path $fixtureRoot "authaddin.json"
    $auth = [ordered]@{
        wps = [ordered]@{
            namelist = "unrelated;probeWriter"
            unrelated = [ordered]@{ name = "UnrelatedPlugin"; enable = $true }
            probeWriter = [ordered]@{ name = [string]$manifest.writer.name; enable = $true }
        }
        wpp = [ordered]@{
            namelist = "probePresentation"
            probePresentation = [ordered]@{ name = [string]$manifest.presentation.name; enable = $true }
        }
    }
    [IO.File]::WriteAllText($authPath, ($auth | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))

    Invoke-ProbeScript -Name "uninstall-native-capability-probe.ps1" -Arguments @("-JsAddonsPath", $fixtureRoot, "-SkipProcessCheck", "-KeepProbeRecords")
    [xml]$after = Get-Content -LiteralPath $publishPath -Raw -Encoding UTF8
    Assert-True (@($after.DocumentElement.SelectNodes("jsplugin[@name='UnrelatedPlugin']")).Count -eq 1) "Uninstall changed unrelated publish.xml node."
    foreach ($definition in @($manifest.writer, $manifest.presentation)) {
        Assert-True (@($after.DocumentElement.SelectNodes("jsplugin[@name='$([string]$definition.name)']")).Count -eq 0) "Probe registration remained after uninstall."
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $fixtureRoot ([string]$definition.folder)))) "Probe folder remained after uninstall."
    }
    $authAfter = Get-Content -LiteralPath $authPath -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-True ($null -ne $authAfter.wps.unrelated) "Uninstall removed unrelated authaddin entry."
    Assert-True ($null -eq $authAfter.wps.probeWriter -and $null -eq $authAfter.wpp.probePresentation) "Probe authaddin entry remained after uninstall."

    Write-Output "WPS native capability probe source/install/compat/uninstall tests passed."
} finally {
    $workspace = [IO.Path]::GetFullPath($projectRoot).TrimEnd('\', '/')
    $fullFixture = [IO.Path]::GetFullPath($fixtureRoot)
    if ($fullFixture.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
        (Test-Path -LiteralPath $fullFixture)) {
        Remove-Item -LiteralPath $fullFixture -Recurse -Force
    }
}
