$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$package.version
$versionSuffix = $version -replace '[^A-Za-z0-9._-]', '_'

function Assert-TestCondition {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

$taskPanePath = Join-Path $projectRoot "js\taskpane.js"
$taskPane = Get-Content -LiteralPath $taskPanePath -Raw -Encoding UTF8
Assert-TestCondition ($taskPane.Contains("openPackaged")) "Packaged task-pane API is missing."
Assert-TestCondition ($taskPane.Contains("PAGE_MAP") -and $taskPane.Contains('"tool-center"') -and $taskPane.Contains('"function-plot"') -and $taskPane.Contains('"license"')) "Packaged page whitelist is incomplete."
Assert-TestCondition ($taskPane.Contains("CreateTaskPane") -and $taskPane.Contains("PluginStorage") -and $taskPane.Contains("file:")) "Packaged task-pane runtime contract is incomplete."
foreach ($forbidden in @("openLocalEditor", "localhost", "127.0.0.1", "ShellExecute", "OAAssist", "XMLHttpRequest", "WpsHighSchoolMathEditorHost")) {
    Assert-TestCondition ($taskPane.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -lt 0) "Task-pane source contains forbidden runtime text: $forbidden"
}

Assert-TestCondition (-not (Test-Path -LiteralPath (Join-Path $projectRoot "entry.js"))) "Retired entry.js is still present."
Assert-TestCondition (-not (Test-Path -LiteralPath (Join-Path $projectRoot "runtime") -PathType Container)) "Retired runtime helper directory is still present."
$writerIndex = Get-Content -LiteralPath (Join-Path $projectRoot "index.html") -Raw -Encoding UTF8
$pptIndex = Get-Content -LiteralPath (Join-Path $projectRoot "ppt\index.html") -Raw -Encoding UTF8
Assert-TestCondition ($writerIndex.Contains('src="./main.js"') -and -not $writerIndex.Contains("entry.js")) "Writer root page does not load main.js directly."
Assert-TestCondition ($pptIndex.Contains('src="./main.js"') -and -not $pptIndex.Contains("entry.js")) "Presentation root page does not load main.js directly."

foreach ($pageName in @("tool-center", "function-plot", "license")) {
    $pagePath = Join-Path $projectRoot "ui\$pageName.html"
    Assert-TestCondition (Test-Path -LiteralPath $pagePath -PathType Leaf) "Task-pane page is missing: $pageName"
    $page = Get-Content -LiteralPath $pagePath -Raw -Encoding UTF8
    Assert-TestCondition ($page -notmatch '(?i)(?:https?|file):\/\/') "Task-pane page contains an absolute URL: $pageName"
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("hsm-packaged-taskpane-test-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path (Join-Path $tempRoot "ui") -Force | Out-Null
try {
    $builtTaskPane = $taskPane.Replace("__PLUGIN_VERSION__", $version)
    [IO.File]::WriteAllText((Join-Path $tempRoot "taskpane.js"), $builtTaskPane, [Text.UTF8Encoding]::new($false))
    foreach ($pageName in @("tool-center", "function-plot", "license")) {
        Copy-Item -LiteralPath (Join-Path $projectRoot "ui\$pageName.html") `
            -Destination (Join-Path $tempRoot "ui\$pageName-$versionSuffix.html") -Force
        Assert-TestCondition (Test-Path -LiteralPath (Join-Path $tempRoot "ui\$pageName-$versionSuffix.html")) "Versioned task-pane page was not created: $pageName"
    }
    Assert-TestCondition (-not $builtTaskPane.Contains("__PLUGIN_VERSION__")) "Built task-pane source still contains the version placeholder."
} finally {
    if (Test-Path -LiteralPath $tempRoot) {
        $resolved = (Resolve-Path -LiteralPath $tempRoot).Path
        $tempPrefix = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path.TrimEnd('\') + '\'
        Assert-TestCondition ($resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase)) "Refusing to remove a path outside the temporary directory."
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

& node (Join-Path $projectRoot "scripts\zero-loopback-policy.js") --profile source --root $projectRoot
Assert-TestCondition ($LASTEXITCODE -eq 0) "Source zero-loopback policy failed."

Write-Output "Packaged task-pane integration tests passed for version $version."
