param()

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$projectRoot = Split-Path -Parent $PSScriptRoot
$testsRoot = Join-Path $projectRoot "tests"
$utf8Strict = New-Object Text.UTF8Encoding($false, $true)

function Write-Step {
    param([string]$Message)
    Write-Output "`n==> $Message"
}

function Invoke-CheckedProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$Description
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

function Get-ProjectFiles {
    param([string[]]$Extensions)
    $roots = @(
        $projectRoot,
        (Join-Path $projectRoot "js"),
        (Join-Path $projectRoot "ppt"),
        (Join-Path $projectRoot "ui"),
        (Join-Path $projectRoot "scripts"),
        (Join-Path $projectRoot "migration"),
        (Join-Path $projectRoot "probes"),
        (Join-Path $projectRoot "installer"),
        $testsRoot
    )
    $files = @()
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        if ($root -eq $projectRoot) {
            $candidates = @(Get-ChildItem -LiteralPath $root -File)
        } else {
            $candidates = @(Get-ChildItem -LiteralPath $root -File -Recurse)
        }
        $files += @($candidates | Where-Object { $Extensions -contains $_.Extension.ToLowerInvariant() })
    }
    return @($files | Sort-Object FullName -Unique)
}

try {
    $nodeCommand = Get-Command node -ErrorAction Stop
    $powerShellCommand = Get-Command powershell.exe -ErrorAction Stop

    Write-Step "Node.js logic tests"
    $nodeTests = @(Get-ChildItem -LiteralPath $testsRoot -File -Filter "*.test.js" | Sort-Object Name)
    if ($nodeTests.Count -eq 0) { throw "No Node.js tests were found." }
    foreach ($test in $nodeTests) {
        Write-Output "[node] $($test.Name)"
        Invoke-CheckedProcess -FilePath $nodeCommand.Source -Arguments @($test.FullName) -Description $test.Name
    }

    Write-Step "PowerShell tests"
    $powerShellTests = @(Get-ChildItem -LiteralPath $testsRoot -File -Filter "*.test.ps1" | Sort-Object Name)
    if ($powerShellTests.Count -eq 0) { throw "No PowerShell tests were found." }
    foreach ($test in $powerShellTests) {
        Write-Output "[powershell] $($test.Name)"
        Invoke-CheckedProcess `
            -FilePath $powerShellCommand.Source `
            -Arguments @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $test.FullName) `
            -Description $test.Name
    }

    Write-Step "JavaScript syntax checks"
    $javaScriptFiles = @(Get-ProjectFiles -Extensions @(".js", ".mjs", ".cjs"))
    foreach ($file in $javaScriptFiles) {
        Invoke-CheckedProcess -FilePath $nodeCommand.Source -Arguments @("--check", $file.FullName) -Description "JavaScript syntax: $($file.FullName)"
    }
    Write-Output "Checked $($javaScriptFiles.Count) JavaScript files."

    Write-Step "PowerShell syntax checks"
    $powerShellFiles = @(Get-ProjectFiles -Extensions @(".ps1", ".psm1", ".psd1"))
    foreach ($file in $powerShellFiles) {
        $tokens = $null
        $parseErrors = $null
        [void][Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors)
        if ($parseErrors.Count -gt 0) {
            throw "PowerShell syntax failed for $($file.FullName):`n$($parseErrors | Out-String)"
        }
    }
    Write-Output "Checked $($powerShellFiles.Count) PowerShell files."

    Write-Step "UTF-8 and structure checks"
    $textFiles = @(Get-ProjectFiles -Extensions @(
        ".js", ".mjs", ".cjs", ".json", ".xml", ".html", ".htm", ".svg",
        ".css", ".ps1", ".psm1", ".psd1", ".cmd", ".bat", ".cs", ".txt"
    ))
    foreach ($file in $textFiles) {
        try {
            [void]$utf8Strict.GetString([IO.File]::ReadAllBytes($file.FullName))
        } catch {
            throw "Invalid UTF-8 file: $($file.FullName)"
        }
    }

    $requiredFiles = @(
        "package.json",
        "index.html",
        "main.js",
        "manifest.xml",
        "ribbon.xml",
        "ppt/index.html",
        "ppt/main.js",
        "ppt/manifest.xml",
        "ppt/ribbon.xml",
        "scripts/zero-loopback-policy.js",
        "tests/zero-loopback-policy.test.js",
        "tests/helpers/zero-network-runtime.js"
    )
    foreach ($relativePath in $requiredFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relativePath) -PathType Leaf)) {
            throw "Required project file is missing: $relativePath"
        }
    }

    $packageInfo = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $packageInfo.name -or -not $packageInfo.version) {
        throw "package.json must contain name and version."
    }
    foreach ($relativePath in @("manifest.xml", "ribbon.xml", "ppt/manifest.xml", "ppt/ribbon.xml")) {
        try {
            [xml](Get-Content -LiteralPath (Join-Path $projectRoot $relativePath) -Raw -Encoding UTF8) | Out-Null
        } catch {
            throw "Invalid XML structure: $relativePath"
        }
    }
    Write-Output "Checked $($textFiles.Count) UTF-8 text files and core project structure."

    Write-Output "`nAll test, syntax, UTF-8, and structure checks passed."
    exit 0
} catch {
    Write-Error $_
    exit 1
}
