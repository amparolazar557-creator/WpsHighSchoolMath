param(
    [string]$Destination,
    [switch]$SkipBuild,
    [switch]$SkipTests,
    [switch]$SkipMarketing
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$product = [string]$package.name
$version = [string]$package.version
$dateStamp = [DateTime]::Today.ToString("yyyyMMdd")

if ([string]::IsNullOrWhiteSpace($Destination)) {
    $desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
    $Destination = Join-Path $desktop "${product}-Handoff-${version}-${dateStamp}"
}
$destinationFull = [IO.Path]::GetFullPath($Destination)
$sourceRoot = Join-Path $destinationFull "01-source"
$releaseRoot = Join-Path $destinationFull "02-current-release"
$marketingRoot = Join-Path $destinationFull "03-marketing-deliveries"
$referenceRoot = Join-Path $destinationFull "04-reference-materials"
$zipPath = "$destinationFull.zip"
$zipHashPath = "$zipPath.sha256"

function Assert-SafeNewDestination {
    param([string]$Path)

    if (Test-Path -LiteralPath $Path) {
        throw "Destination already exists. Move or rename it before rebuilding: $Path"
    }
    $projectPrefix = $projectRoot.TrimEnd("\") + "\"
    if ($Path.StartsWith($projectPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "The handoff package must be created outside the project directory."
    }
}

function Copy-RequiredItem {
    param([string]$RelativePath)

    $source = Join-Path $projectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Required handoff source is missing: $RelativePath"
    }
    $target = Join-Path $sourceRoot $RelativePath
    $targetParent = Split-Path -Parent $target
    New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
}

function Invoke-ProjectScript {
    param(
        [string]$ScriptPath,
        [string[]]$Arguments,
        [string]$Description
    )

    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

function Copy-FilePreservingRelativePath {
    param(
        [IO.FileInfo]$File,
        [string]$BasePath,
        [string]$TargetRoot
    )

    $relative = $File.FullName.Substring($BasePath.TrimEnd("\").Length + 1)
    $target = Join-Path $TargetRoot $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $File.FullName -Destination $target -Force
}

function Remove-DirectoryInsideSource {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return }
    $sourcePrefix = [IO.Path]::GetFullPath($sourceRoot).TrimEnd("\") + "\"
    $fullPath = [IO.Path]::GetFullPath($Path)
    if (-not $fullPath.StartsWith($sourcePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a directory outside the handoff source: $fullPath"
    }
    Remove-Item -LiteralPath $fullPath -Recurse -Force
}

function Assert-NoPrivateMaterial {
    $forbiddenNames = @(Get-ChildItem -LiteralPath $destinationFull -File -Recurse -Force | Where-Object {
        $_.Name -match '(?i)(ed25519-private|issuance-history)' -or
        $_.Extension -match '(?i)^\.(pem|key|pfx|p12)$'
    })
    if ($forbiddenNames.Count -gt 0) {
        throw "Private material was found in the handoff package: $($forbiddenNames.FullName -join ', ')"
    }
}

function Write-HashManifest {
    $manifestPath = Join-Path $destinationFull "SHA256SUMS.txt"
    $records = @(Get-ChildItem -LiteralPath $destinationFull -File -Recurse -Force |
        Where-Object { $_.FullName -ne $manifestPath } |
        Sort-Object FullName |
        ForEach-Object {
            $relative = $_.FullName.Substring($destinationFull.TrimEnd("\").Length + 1).Replace("\", "/")
            $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            "$hash  $relative"
        })
    [IO.File]::WriteAllLines($manifestPath, $records, (New-Object Text.UTF8Encoding($false)))
    return $records.Count
}

Assert-SafeNewDestination -Path $destinationFull
if (Test-Path -LiteralPath $zipPath) { throw "Archive already exists: $zipPath" }
if (Test-Path -LiteralPath $zipHashPath) { throw "Archive hash already exists: $zipHashPath" }

New-Item -ItemType Directory -Path $sourceRoot, $releaseRoot, $referenceRoot -Force | Out-Null

$rootFiles = @(
    ".gitignore",
    "CLAUDE.md",
    "HANDOFF.md",
    "README.md",
    "package.json",
    "index.html",
    "main.js",
    "manifest.xml",
    "ribbon.xml"
)
$sourceDirectories = @("assets", "js", "migration", "ppt", "probes", "scripts", "specs", "tests", "ui")
foreach ($path in $rootFiles + $sourceDirectories) {
    Copy-RequiredItem -RelativePath $path
}

if (-not $SkipBuild) {
    Invoke-ProjectScript `
        -ScriptPath (Join-Path $sourceRoot "scripts\build-offline.ps1") `
        -Arguments @("-BuildMode", "Internal") `
        -Description "Internal offline build"

    Invoke-ProjectScript `
        -ScriptPath (Join-Path $sourceRoot "scripts\build-license-tool.ps1") `
        -Arguments @() `
        -Description "License tool build"
}

if (-not $SkipTests) {
    Invoke-ProjectScript `
        -ScriptPath (Join-Path $sourceRoot "scripts\run-tests.ps1") `
        -Arguments @() `
        -Description "Handoff source test suite"
}

$sourceRelease = Join-Path $sourceRoot "release"
$pluginArtifactNames = @(
    "${product}-${version}-offline.exe",
    "${product}-${version}-offline.zip",
    "${product}-${version}-checksums.sha256",
    "${product}-${version}-release-manifest.json"
)
foreach ($name in $pluginArtifactNames) {
    $path = Join-Path $sourceRelease $name
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Copy-Item -LiteralPath $path -Destination (Join-Path $releaseRoot $name) -Force
    }
}

$licenseToolPattern = "WpsHighSchoolMath-LicenseTool-${version}*"
Get-ChildItem -LiteralPath $sourceRelease -File -Filter $licenseToolPattern -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @(".exe", ".sha256") } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $releaseRoot $_.Name) -Force }

$originalRelease = Join-Path $projectRoot "release"
foreach ($sampleName in @("scheme-b-writer-regression.docx", "scheme-b-ppt-regression.pptx")) {
    $sourceSample = switch ($sampleName) {
        "scheme-b-writer-regression.docx" { Join-Path $originalRelease "scheme-b-Writer-regression-copy.docx" }
        default { Join-Path $originalRelease "scheme-b-PPT-regression-copy.pptx" }
    }
    if (Test-Path -LiteralPath $sourceSample -PathType Leaf) {
        Copy-Item -LiteralPath $sourceSample -Destination (Join-Path $referenceRoot $sampleName) -Force
    }
}

# The original regression files use Chinese names. Copy them without embedding
# non-ASCII literals in this Windows PowerShell 5 compatible script.
Get-ChildItem -LiteralPath $originalRelease -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @(".docx", ".pptx") } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $referenceRoot $_.Name) -Force }

Get-ChildItem -LiteralPath $projectRoot -File -Filter "WPS*.png" -ErrorAction SilentlyContinue |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $referenceRoot $_.Name) -Force }

$playwrightOutput = Join-Path $projectRoot "output\playwright"
if (Test-Path -LiteralPath $playwrightOutput -PathType Container) {
    Copy-Item -LiteralPath $playwrightOutput -Destination (Join-Path $referenceRoot "ui-screenshots") -Recurse -Force
}

if (-not $SkipMarketing) {
    New-Item -ItemType Directory -Path $marketingRoot -Force | Out-Null
    $outputRoot = Join-Path $projectRoot "output"
    Get-ChildItem -LiteralPath $outputRoot -File -Recurse -Filter "*delivery.zip" -ErrorAction SilentlyContinue |
        ForEach-Object { Copy-FilePreservingRelativePath -File $_ -BasePath $outputRoot -TargetRoot (Join-Path $marketingRoot "archives") }

    Get-ChildItem -LiteralPath $outputRoot -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Extension -in @(".md", ".json", ".py", ".ps1") -and
            $_.FullName -notmatch '(?i)\\vendor\\|\\__pycache__\\|LicenseTool-.*-staging'
        } |
        ForEach-Object { Copy-FilePreservingRelativePath -File $_ -BasePath $outputRoot -TargetRoot (Join-Path $marketingRoot "sources-and-plans") }
}

# The license-tool build creates an 80+ MiB staging directory. It is a build
# cache and must not be part of the source handoff.
Remove-DirectoryInsideSource -Path (Join-Path $sourceRoot "output")
Get-ChildItem -LiteralPath $sourceRelease -File -Filter "WpsHighSchoolMath-LicenseTool-*" -ErrorAction SilentlyContinue |
    Remove-Item -Force

Copy-Item -LiteralPath (Join-Path $sourceRoot "HANDOFF.md") -Destination (Join-Path $destinationFull "README-FIRST.md") -Force

$privateKeyPath = Join-Path $env:APPDATA "WpsHighSchoolMathIssuer\ed25519-private.pem"
$historyPath = Join-Path $env:APPDATA "WpsHighSchoolMathIssuer\issuance-history.csv"
$statusLines = @(
    "Product: $product",
    "Version: $version",
    "Handoff date: $([DateTime]::Today.ToString('yyyy-MM-dd'))",
    "Source build: $(if ($SkipBuild) { 'skipped' } else { 'passed' })",
    "Source tests: $(if ($SkipTests) { 'skipped' } else { 'passed' })",
    "Release channel: internal-test",
    "Authenticode: not a signed commercial release",
    "License public key fingerprint: 369DA249CAD36B33",
    "Owner private key present during packaging: $(Test-Path -LiteralPath $privateKeyPath)",
    "Private key included in package: False",
    "Issuance history present during packaging: $(Test-Path -LiteralPath $historyPath)",
    "Issuance history included in package: False",
    "Original Git history included: False",
    "Handoff Git baseline: reconstructed from the current file snapshot"
)
[IO.File]::WriteAllLines((Join-Path $destinationFull "HANDOFF-STATUS.txt"), $statusLines, (New-Object Text.UTF8Encoding($false)))

$selectionLines = @(
    "INCLUDED",
    "- Runtime source for Writer and Presentation",
    "- Build, install, uninstall, license, integrity, and validation scripts",
    "- Automated tests, compatibility fixtures, specifications, and probes",
    "- Fresh internal $version plugin build and issuer tool",
    "- Regression documents, UI screenshots, product reference images",
    "- Final social-media delivery archives and their source plans/scripts",
    "",
    "EXCLUDED",
    "- Original .git directory: no commits and hundreds of MiB of temporary objects",
    "- Issuer private key and real issuance-history.csv",
    "- Old release versions and expanded old installers",
    "- Video vendor runtimes, caches, segments, temporary audio, and duplicate render intermediates",
    "- Local editor settings, Playwright session state, logs, .tmp folders, root .obj/.lib/.exp files"
)
[IO.File]::WriteAllLines((Join-Path $destinationFull "PACKAGE-SELECTION.txt"), $selectionLines, (New-Object Text.UTF8Encoding($false)))

Assert-NoPrivateMaterial

$gitCommand = Get-Command git -ErrorAction SilentlyContinue
if ($gitCommand) {
    & $gitCommand.Source -C $sourceRoot init -b main | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unable to initialize the handoff Git repository." }
    & $gitCommand.Source -C $sourceRoot config user.name "Project Handoff"
    & $gitCommand.Source -C $sourceRoot config user.email "handoff@local.invalid"
    & $gitCommand.Source -C $sourceRoot add --all
    & $gitCommand.Source -C $sourceRoot commit -m "Initial handoff snapshot" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unable to create the handoff Git baseline commit." }
}

$manifestCount = Write-HashManifest

[IO.Compression.ZipFile]::CreateFromDirectory(
    $destinationFull,
    $zipPath,
    [IO.Compression.CompressionLevel]::Optimal,
    $true
)
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($zipHashPath, "$zipHash  $([IO.Path]::GetFileName($zipPath))`r`n", (New-Object Text.UTF8Encoding($false)))

$verifyRoot = Join-Path ([IO.Path]::GetTempPath()) ("hsm-handoff-verify-" + [Guid]::NewGuid().ToString("N"))
try {
    [IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $verifyRoot)
    $verifiedManifest = Get-ChildItem -LiteralPath $verifyRoot -File -Recurse -Filter "SHA256SUMS.txt" | Select-Object -First 1
    if (-not $verifiedManifest) { throw "The handoff archive does not contain SHA256SUMS.txt." }
    $verifiedRoot = Split-Path -Parent $verifiedManifest.FullName
    foreach ($line in Get-Content -LiteralPath $verifiedManifest.FullName -Encoding UTF8) {
        if ($line -notmatch '^([0-9a-f]{64})  (.+)$') { throw "Invalid hash manifest line: $line" }
        $expected = $Matches[1]
        $relative = $Matches[2].Replace("/", "\")
        $filePath = Join-Path $verifiedRoot $relative
        if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { throw "Archive file missing: $relative" }
        $actual = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) { throw "Archive hash mismatch: $relative" }
    }
} finally {
    if (Test-Path -LiteralPath $verifyRoot) {
        Remove-Item -LiteralPath $verifyRoot -Recurse -Force
    }
}

Write-Output "Handoff package created and verified."
Write-Output "Directory: $destinationFull"
Write-Output "Archive: $zipPath"
Write-Output "Archive SHA256: $zipHash"
Write-Output "Manifest file count: $manifestCount"
