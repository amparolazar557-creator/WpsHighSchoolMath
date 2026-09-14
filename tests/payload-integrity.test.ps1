$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $projectRoot "scripts\payload-integrity.ps1")

function Write-TestFile {
    param([string]$Path, [string]$Content)
    New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
    [IO.File]::WriteAllText($Path, $Content, (New-Object Text.UTF8Encoding($false)))
}

function New-TestPayload {
    param(
        [string]$Path,
        [ValidateSet("wps", "wpp")][string]$HostType,
        [string]$PluginName
    )

    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    if ($HostType -eq "wps") {
        $hostMarker = "writer"
        $main = "load('js/symbols.js'); load('js/ribbon.js');"
        $tabId = "mathTeacherTab"
    } else {
        $hostMarker = "presentation"
        $main = "load('js/symbols.js'); load('js/ppt-api.js'); load('js/ribbon-ppt.js');"
        $tabId = "mathTeacherPptTab"
    }
    Write-TestFile -Path (Join-Path $Path "index.html") -Content ('<script>window.HSM_ENTRY_HOST = "' + $hostMarker + '";</script>')
    Write-TestFile -Path (Join-Path $Path "main.js") -Content $main
    Write-TestFile -Path (Join-Path $Path "manifest.xml") -Content ("<JsPlugin><Name>$PluginName</Name></JsPlugin>")
    Write-TestFile -Path (Join-Path $Path "ribbon.xml") -Content ('<customUI><ribbon><tabs><tab id="{0}" label="高中数学" /></tabs></ribbon></customUI>' -f $tabId)
    Write-TestFile -Path (Join-Path $Path "js\content.js") -Content "payload"
}

function Assert-Throws {
    param([scriptblock]$Action, [string]$Message)
    $threw = $false
    try { & $Action } catch { $threw = $true }
    if (-not $threw) { throw $Message }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("hsm-payload-integrity-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
try {
    $writerPath = Join-Path $testRoot "writer"
    $pptPath = Join-Path $testRoot "ppt"
    New-TestPayload -Path $writerPath -HostType "wps" -PluginName "WpsHighSchoolMath"
    New-TestPayload -Path $pptPath -HostType "wpp" -PluginName "WpsHighSchoolMathPpt"

    $writerManifest = New-HsmPayloadManifest -PayloadPath $writerPath -Product "WpsHighSchoolMath" -PluginName "WpsHighSchoolMath" -PluginVersion "9.9.9" -HostType "wps"
    $pptManifest = New-HsmPayloadManifest -PayloadPath $pptPath -Product "WpsHighSchoolMath" -PluginName "WpsHighSchoolMathPpt" -PluginVersion "9.9.9" -HostType "wpp"
    [void](Test-HsmPayload -PayloadPath $writerPath -ExpectedProduct "WpsHighSchoolMath" -ExpectedPluginName "WpsHighSchoolMath" -ExpectedVersion "9.9.9" -ExpectedHostType "wps" -ExpectedManifestSha256 $writerManifest.Sha256)
    [void](Test-HsmPayload -PayloadPath $pptPath -ExpectedProduct "WpsHighSchoolMath" -ExpectedPluginName "WpsHighSchoolMathPpt" -ExpectedVersion "9.9.9" -ExpectedHostType "wpp" -ExpectedManifestSha256 $pptManifest.Sha256)

    $damagedPath = Join-Path $testRoot "damaged"
    Copy-Item -LiteralPath $writerPath -Destination $damagedPath -Recurse
    Write-TestFile -Path (Join-Path $damagedPath "js\content.js") -Content "changed"
    Assert-Throws {
        Test-HsmPayload -PayloadPath $damagedPath -ExpectedProduct "WpsHighSchoolMath" -ExpectedPluginName "WpsHighSchoolMath" -ExpectedVersion "9.9.9" -ExpectedHostType "wps"
    } "A changed payload file was not rejected."

    $extraPath = Join-Path $testRoot "extra"
    Copy-Item -LiteralPath $writerPath -Destination $extraPath -Recurse
    Write-TestFile -Path (Join-Path $extraPath "unexpected.txt") -Content "unexpected"
    Assert-Throws {
        Test-HsmPayload -PayloadPath $extraPath -ExpectedProduct "WpsHighSchoolMath" -ExpectedPluginName "WpsHighSchoolMath" -ExpectedVersion "9.9.9" -ExpectedHostType "wps"
    } "An unlisted payload file was not rejected."

    $wrongHostPath = Join-Path $testRoot "wrong-host"
    Copy-Item -LiteralPath $writerPath -Destination $wrongHostPath -Recurse
    Assert-Throws {
        Test-HsmPayload -PayloadPath $wrongHostPath -ExpectedProduct "WpsHighSchoolMath" -ExpectedPluginName "WpsHighSchoolMathPpt" -ExpectedVersion "9.9.9" -ExpectedHostType "wpp"
    } "A Writer payload masquerading as Presentation was not rejected."

    $unsafePath = Join-Path $testRoot "unsafe"
    Copy-Item -LiteralPath $writerPath -Destination $unsafePath -Recurse
    $unsafeManifestPath = Join-Path $unsafePath "PAYLOAD-MANIFEST.json"
    $unsafeManifest = Get-Content -LiteralPath $unsafeManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $unsafeManifest.files[0].path = "../outside.txt"
    [IO.File]::WriteAllText($unsafeManifestPath, ($unsafeManifest | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
    Assert-Throws {
        Test-HsmPayload -PayloadPath $unsafePath -ExpectedProduct "WpsHighSchoolMath" -ExpectedPluginName "WpsHighSchoolMath" -ExpectedVersion "9.9.9" -ExpectedHostType "wps"
    } "An unsafe manifest path was not rejected."

    Write-Output "payload integrity tests passed"
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
