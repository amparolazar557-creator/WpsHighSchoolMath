$ErrorActionPreference = "Stop"

function Get-HsmSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-HsmPayloadFiles {
    param([Parameter(Mandatory = $true)][string]$PayloadPath)

    $resolvedRoot = (Resolve-Path -LiteralPath $PayloadPath).Path.TrimEnd('\', '/')
    $rootPrefix = $resolvedRoot + [IO.Path]::DirectorySeparatorChar
    $records = @()
    foreach ($file in @(
        Get-ChildItem -LiteralPath $resolvedRoot -Recurse -File |
            Where-Object { $_.Name -ne "PAYLOAD-MANIFEST.json" } |
            Sort-Object FullName
    )) {
        if (-not $file.FullName.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Payload file escaped the expected root: $($file.FullName)"
        }
        $relativePath = $file.FullName.Substring($rootPrefix.Length).Replace('\', '/')
        $records += [pscustomobject][ordered]@{
            path = $relativePath
            bytes = [long]$file.Length
            sha256 = Get-HsmSha256 -Path $file.FullName
        }
    }
    return @($records)
}

function Get-HsmPayloadDigest {
    param([Parameter(Mandatory = $true)][object[]]$Files)

    $canonicalLines = @(
        $Files |
            Sort-Object path |
            ForEach-Object { "{0}|{1}|{2}" -f ([string]$_.path), ([long]$_.bytes), ([string]$_.sha256).ToLowerInvariant() }
    )
    $bytes = [Text.Encoding]::UTF8.GetBytes(($canonicalLines -join "`n"))
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
}

function Get-HsmEntryContract {
    param([Parameter(Mandatory = $true)][ValidateSet("wps", "wpp")][string]$HostType)

    if ($HostType -eq "wps") {
        return [pscustomobject][ordered]@{
            entryHost = "writer"
            requiredMainScripts = @("js/ribbon.js")
            forbiddenMainScripts = @("js/ribbon-ppt.js", "js/ppt-api.js")
            ribbonTabId = "mathTeacherTab"
        }
    }
    return [pscustomobject][ordered]@{
        entryHost = "presentation"
        requiredMainScripts = @("js/ppt-api.js", "js/ribbon-ppt.js")
        forbiddenMainScripts = @("js/ribbon.js")
        ribbonTabId = "mathTeacherPptTab"
    }
}

function Assert-HsmPayloadEntryContract {
    param(
        [Parameter(Mandatory = $true)][string]$PayloadPath,
        [Parameter(Mandatory = $true)][ValidateSet("wps", "wpp")][string]$HostType,
        [Parameter(Mandatory = $true)][string]$PluginName
    )

    $contract = Get-HsmEntryContract -HostType $HostType
    foreach ($requiredFile in @("index.html", "main.js", "manifest.xml", "ribbon.xml")) {
        $requiredPath = Join-Path $PayloadPath $requiredFile
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "Payload entry file is missing: $requiredFile"
        }
    }

    $indexSource = Get-Content -LiteralPath (Join-Path $PayloadPath "index.html") -Raw -Encoding UTF8
    $expectedHostMarker = 'window.HSM_ENTRY_HOST = "' + $contract.entryHost + '"'
    if (-not $indexSource.Contains($expectedHostMarker)) {
        throw "Payload index host marker does not match $HostType ($($contract.entryHost))."
    }

    $mainSource = Get-Content -LiteralPath (Join-Path $PayloadPath "main.js") -Raw -Encoding UTF8
    foreach ($requiredScript in @($contract.requiredMainScripts)) {
        if (-not $mainSource.Contains($requiredScript)) {
            throw "Payload main.js is missing the required $HostType script: $requiredScript"
        }
    }
    foreach ($forbiddenScript in @($contract.forbiddenMainScripts)) {
        if ($mainSource.Contains($forbiddenScript)) {
            throw "Payload main.js contains a script for the wrong host: $forbiddenScript"
        }
    }

    [xml]$pluginManifest = Get-Content -LiteralPath (Join-Path $PayloadPath "manifest.xml") -Raw -Encoding UTF8
    $nameNode = $pluginManifest.SelectSingleNode("//*[local-name()='Name']")
    if ($null -eq $nameNode -or [string]$nameNode.InnerText -ne $PluginName) {
        throw "Payload manifest.xml name does not match $PluginName."
    }

    [xml]$ribbon = Get-Content -LiteralPath (Join-Path $PayloadPath "ribbon.xml") -Raw -Encoding UTF8
    $tabs = @($ribbon.SelectNodes("//*[local-name()='tabs']/*[local-name()='tab']"))
    if ($tabs.Count -ne 1 -or $tabs[0].GetAttribute("id") -ne $contract.ribbonTabId) {
        throw "Payload Ribbon contract does not match $HostType ($($contract.ribbonTabId))."
    }
}

function Write-HsmUtf8Json {
    param(
        [Parameter(Mandatory = $true)][object]$Value,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporaryPath = Join-Path $directory ("." + [IO.Path]::GetFileName($Path) + "." + [Guid]::NewGuid().ToString("N") + ".tmp")
    $replaceBackupPath = $temporaryPath + ".bak"
    try {
        [IO.File]::WriteAllText(
            $temporaryPath,
            ($Value | ConvertTo-Json -Depth 10),
            (New-Object Text.UTF8Encoding($false))
        )
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            [IO.File]::Replace($temporaryPath, $Path, $replaceBackupPath)
            Remove-Item -LiteralPath $replaceBackupPath -Force
        } else {
            [IO.File]::Move($temporaryPath, $Path)
        }
    } finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
        if (Test-Path -LiteralPath $replaceBackupPath -PathType Leaf) {
            Remove-Item -LiteralPath $replaceBackupPath -Force
        }
    }
}

function New-HsmPayloadManifest {
    param(
        [Parameter(Mandatory = $true)][string]$PayloadPath,
        [Parameter(Mandatory = $true)][string]$Product,
        [Parameter(Mandatory = $true)][string]$PluginName,
        [Parameter(Mandatory = $true)][string]$PluginVersion,
        [Parameter(Mandatory = $true)][ValidateSet("wps", "wpp")][string]$HostType
    )

    Assert-HsmPayloadEntryContract -PayloadPath $PayloadPath -HostType $HostType -PluginName $PluginName
    $files = @(Get-HsmPayloadFiles -PayloadPath $PayloadPath)
    $contract = Get-HsmEntryContract -HostType $HostType
    $manifest = [ordered]@{
        schemaVersion = 1
        product = $Product
        pluginName = $PluginName
        version = $PluginVersion
        hostType = $HostType
        entryContract = [ordered]@{
            entryHost = $contract.entryHost
            requiredMainScripts = @($contract.requiredMainScripts)
            forbiddenMainScripts = @($contract.forbiddenMainScripts)
            ribbonTabId = $contract.ribbonTabId
        }
        fileCount = $files.Count
        payloadSha256 = Get-HsmPayloadDigest -Files $files
        files = $files
    }
    $manifestPath = Join-Path $PayloadPath "PAYLOAD-MANIFEST.json"
    Write-HsmUtf8Json -Value $manifest -Path $manifestPath
    return [pscustomobject][ordered]@{
        Path = $manifestPath
        Sha256 = Get-HsmSha256 -Path $manifestPath
        PayloadSha256 = $manifest.payloadSha256
        FileCount = $files.Count
    }
}

function Test-HsmPayload {
    param(
        [Parameter(Mandatory = $true)][string]$PayloadPath,
        [Parameter(Mandatory = $true)][string]$ExpectedProduct,
        [Parameter(Mandatory = $true)][string]$ExpectedPluginName,
        [Parameter(Mandatory = $true)][string]$ExpectedVersion,
        [Parameter(Mandatory = $true)][ValidateSet("wps", "wpp")][string]$ExpectedHostType,
        [string]$ExpectedManifestSha256
    )

    if (-not (Test-Path -LiteralPath $PayloadPath -PathType Container)) {
        throw "Payload directory was not found: $PayloadPath"
    }
    $manifestPath = Join-Path $PayloadPath "PAYLOAD-MANIFEST.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Payload integrity manifest was not found: $manifestPath"
    }
    $manifestSha256 = Get-HsmSha256 -Path $manifestPath
    if ($ExpectedManifestSha256 -and $manifestSha256 -ne $ExpectedManifestSha256.ToLowerInvariant()) {
        throw "Payload manifest hash mismatch for $ExpectedPluginName."
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([int]$manifest.schemaVersion -ne 1 -or
        [string]$manifest.product -ne $ExpectedProduct -or
        [string]$manifest.pluginName -ne $ExpectedPluginName -or
        [string]$manifest.version -ne $ExpectedVersion -or
        [string]$manifest.hostType -ne $ExpectedHostType) {
        throw "Payload manifest identity mismatch for $ExpectedPluginName."
    }

    $expectedContract = Get-HsmEntryContract -HostType $ExpectedHostType
    if ([string]$manifest.entryContract.entryHost -ne $expectedContract.entryHost -or
        [string]$manifest.entryContract.ribbonTabId -ne $expectedContract.ribbonTabId) {
        throw "Payload entry contract identity mismatch for $ExpectedPluginName."
    }
    Assert-HsmPayloadEntryContract -PayloadPath $PayloadPath -HostType $ExpectedHostType -PluginName $ExpectedPluginName

    $manifestFiles = @($manifest.files)
    $actualFiles = @(Get-HsmPayloadFiles -PayloadPath $PayloadPath)
    if ([int]$manifest.fileCount -ne $manifestFiles.Count -or $manifestFiles.Count -ne $actualFiles.Count) {
        throw "Payload file-count mismatch for $ExpectedPluginName."
    }

    $expectedPaths = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $expectedByPath = @{}
    foreach ($record in $manifestFiles) {
        $relativePath = [string]$record.path
        if ([string]::IsNullOrWhiteSpace($relativePath) -or
            [IO.Path]::IsPathRooted($relativePath) -or
            $relativePath -match '(^|[\\/])\.\.([\\/]|$)' -or
            -not $expectedPaths.Add($relativePath)) {
            throw "Payload manifest contains an unsafe or duplicate path: $relativePath"
        }
        $expectedByPath[$relativePath] = $record
    }

    foreach ($actual in $actualFiles) {
        $relativePath = [string]$actual.path
        if (-not $expectedByPath.ContainsKey($relativePath)) {
            throw "Payload contains an unlisted file: $relativePath"
        }
        $expected = $expectedByPath[$relativePath]
        if ([long]$expected.bytes -ne [long]$actual.bytes -or
            ([string]$expected.sha256).ToLowerInvariant() -ne ([string]$actual.sha256).ToLowerInvariant()) {
            throw "Payload file hash mismatch: $relativePath"
        }
    }

    $payloadSha256 = Get-HsmPayloadDigest -Files $actualFiles
    if ($payloadSha256 -ne ([string]$manifest.payloadSha256).ToLowerInvariant()) {
        throw "Payload aggregate hash mismatch for $ExpectedPluginName."
    }

    return [pscustomobject][ordered]@{
        PluginName = $ExpectedPluginName
        HostType = $ExpectedHostType
        Version = $ExpectedVersion
        FileCount = $actualFiles.Count
        ManifestSha256 = $manifestSha256
        PayloadSha256 = $payloadSha256
    }
}

function Test-HsmPayloadEquivalent {
    param(
        [Parameter(Mandatory = $true)][string]$PayloadPath,
        [Parameter(Mandatory = $true)][string]$ExpectedProduct,
        [Parameter(Mandatory = $true)][string]$ExpectedPluginName,
        [Parameter(Mandatory = $true)][string]$ExpectedVersion,
        [Parameter(Mandatory = $true)][ValidateSet("wps", "wpp")][string]$ExpectedHostType,
        [Parameter(Mandatory = $true)][string]$ExpectedPayloadSha256
    )

    try {
        $result = Test-HsmPayload -PayloadPath $PayloadPath `
            -ExpectedProduct $ExpectedProduct `
            -ExpectedPluginName $ExpectedPluginName `
            -ExpectedVersion $ExpectedVersion `
            -ExpectedHostType $ExpectedHostType
        return $result.PayloadSha256 -eq $ExpectedPayloadSha256.ToLowerInvariant()
    } catch {
        return $false
    }
}
