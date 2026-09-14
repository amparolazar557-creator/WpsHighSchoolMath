param(
    [switch]$Elevated
)

$ErrorActionPreference = "Stop"

$pluginName = "__PLUGIN_NAME__"
$pptPluginName = "__PPT_PLUGIN_NAME__"
$pluginVersion = "__PLUGIN_VERSION__"
$plugins = @(
    @{ Name = $pluginName; Type = "wps"; FolderName = "${pluginName}_${pluginVersion}"; ManifestSha256 = "__WRITER_PAYLOAD_MANIFEST_SHA256__" },
    @{ Name = $pptPluginName; Type = "wpp"; FolderName = "${pptPluginName}_${pluginVersion}"; ManifestSha256 = "__PPT_PAYLOAD_MANIFEST_SHA256__" }
)
$stalePluginNames = @($pluginName, "${pluginName}E2E3", $pptPluginName)

$integrityScript = Join-Path $PSScriptRoot "payload-integrity.ps1"
if (-not (Test-Path -LiteralPath $integrityScript -PathType Leaf)) {
    throw "Payload integrity helper was not found: $integrityScript"
}
. $integrityScript

$uninstallRegistrationScript = Join-Path $PSScriptRoot "uninstall-registration.ps1"
if (-not (Test-Path -LiteralPath $uninstallRegistrationScript -PathType Leaf)) {
    throw "Uninstall registration helper was not found: $uninstallRegistrationScript"
}
. $uninstallRegistrationScript

function Save-XmlDocument {
    param(
        [xml]$Document,
        [string]$Path
    )

    $settings = New-Object System.Xml.XmlWriterSettings
    $settings.Indent = $true
    $settings.Encoding = New-Object System.Text.UTF8Encoding($false)
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporaryPath = Join-Path $directory ("." + [IO.Path]::GetFileName($Path) + "." + [Guid]::NewGuid().ToString("N") + ".tmp")
    $replaceBackupPath = $temporaryPath + ".bak"
    $writer = [System.Xml.XmlWriter]::Create($temporaryPath, $settings)
    try {
        $Document.Save($writer)
    } finally {
        $writer.Dispose()
    }
    try {
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

function Write-Utf8TextAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [AllowEmptyString()][string]$Content
    )

    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporaryPath = Join-Path $directory ("." + [IO.Path]::GetFileName($Path) + "." + [Guid]::NewGuid().ToString("N") + ".tmp")
    $replaceBackupPath = $temporaryPath + ".bak"
    try {
        [IO.File]::WriteAllText($temporaryPath, $Content, (New-Object Text.UTF8Encoding($false)))
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

function Copy-FileAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    $directory = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporaryPath = Join-Path $directory ("." + [IO.Path]::GetFileName($Destination) + "." + [Guid]::NewGuid().ToString("N") + ".tmp")
    $replaceBackupPath = $temporaryPath + ".bak"
    try {
        Copy-Item -LiteralPath $Source -Destination $temporaryPath -Force
        if (Test-Path -LiteralPath $Destination -PathType Leaf) {
            [IO.File]::Replace($temporaryPath, $Destination, $replaceBackupPath)
            Remove-Item -LiteralPath $replaceBackupPath -Force
        } else {
            [IO.File]::Move($temporaryPath, $Destination)
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

function Set-IniValue {
    param(
        [string]$Content,
        [string]$Section,
        [string]$Key,
        [string]$Value
    )

    $newline = "`r`n"
    $sectionName = [regex]::Escape($Section)
    $keyName = [regex]::Escape($Key)
    $sectionPattern = "(?ims)(^\s*\[$sectionName\]\s*\r?\n)(.*?)(?=^\s*\[|\z)"
    $sectionRegex = New-Object regex($sectionPattern)

    if (-not $sectionRegex.IsMatch($Content)) {
        return $Content.TrimEnd() + $newline + $newline + "[$Section]" + $newline + "$Key=$Value" + $newline
    }

    return $sectionRegex.Replace($Content, {
        param($match)

        $header = $match.Groups[1].Value
        $body = $match.Groups[2].Value
        $keyPattern = "(?im)^\s*$keyName\s*=.*$"
        if ([regex]::IsMatch($body, $keyPattern)) {
            $body = [regex]::Replace($body, $keyPattern, "$Key=$Value")
        } else {
            $body = $body.TrimEnd() + $newline + "$Key=$Value" + $newline
        }
        return $header + $body
    }, 1)
}

function Get-WpsOemIniPath {
    $command = (Get-ItemProperty -LiteralPath "Registry::HKEY_CLASSES_ROOT\KWPS.Document.12\shell\open\command")."(default)"
    $match = [regex]::Match([string]$command, '"([^"]+\.exe)"|^([^\s]+\.exe)', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) {
        return $null
    }

    $wpsExe = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
    return Join-Path (Split-Path -Parent $wpsExe) "cfgs\oem.ini"
}

function Set-ObjectPropertyValue {
    param(
        [object]$Object,
        [string]$Name,
        [object]$Value
    )

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
    } else {
        $property.Value = $Value
    }
}

function Update-AuthorizationCache {
    param(
        [string]$Path,
        [object[]]$Plugins,
        [string]$JsAddonsPath
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    try {
        $authorization = Get-Content -LiteralPath $Path -Encoding UTF8 -Raw | ConvertFrom-Json
    } catch {
        Write-Warning "WPS add-in authorization cache could not be read. Existing entries were left unchanged."
        return
    }

    $changed = $false
    foreach ($pluginInfo in $Plugins) {
        $hostName = [string]$pluginInfo.Type
        $pluginNameToUpdate = [string]$pluginInfo.Name
        $hostProperty = $authorization.PSObject.Properties[$hostName]
        if ($null -eq $hostProperty) {
            continue
        }

        $hostCache = $hostProperty.Value
        if ($null -eq $hostCache) {
            continue
        }

        $matchingProperties = @(
            $hostCache.PSObject.Properties |
                Where-Object {
                    $_.Name -ne "namelist" -and
                    $null -ne $_.Value -and
                    [string]$_.Value.name -eq $pluginNameToUpdate
                }
        )
        if ($matchingProperties.Count -eq 0) {
            continue
        }

        $targetPath = (Join-Path $JsAddonsPath ([string]$pluginInfo.FolderName)).Replace('\', '/')
        $normalizedTargetPath = $targetPath.TrimEnd('/').ToLowerInvariant()
        $preserveApproval = [bool]$pluginInfo.PreserveApproval
        $currentProperties = @()
        if ($preserveApproval) {
            $currentProperties = @(
                $matchingProperties |
                    Where-Object {
                        $candidatePath = ([string]$_.Value.path).Replace('\', '/').TrimEnd('/').ToLowerInvariant()
                        [string]$_.Value.mode -eq "1" -and
                        [string]$_.Value.path -notmatch '^https?://' -and
                        $candidatePath -eq $normalizedTargetPath
                    }
            )
        }

        # A WPS trust fingerprint is tied to the exact local package. Carrying a
        # fingerprint from an older version into a new folder makes WPS show a
        # "modified" warning without fully loading the ribbon. Preserve a
        # current-package approval, but remove stale approvals so WPS can create
        # a fresh fingerprint after the user confirms the normal trust prompt.
        $selectedProperty = if ($currentProperties.Count -gt 0) { $currentProperties[0] } else { $null }
        $selectedKey = if ($null -eq $selectedProperty) { "" } else { [string]$selectedProperty.Name }

        $keysToRemove = @(
            $matchingProperties |
                Where-Object { -not $selectedKey -or $_.Name -ne $selectedKey } |
                ForEach-Object { $_.Name }
        )
        foreach ($key in $keysToRemove) {
            [void]$hostCache.PSObject.Properties.Remove($key)
            $changed = $true
        }

        $nameListProperty = $hostCache.PSObject.Properties["namelist"]
        $existingNameList = if ($null -eq $nameListProperty) { "" } else { [string]$nameListProperty.Value }
        $seenKeys = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        $remainingKeys = @(
            ($existingNameList -split ";") |
                Where-Object {
                    $_ -and
                    $keysToRemove -notcontains $_ -and
                    $seenKeys.Add($_)
                }
        )
        if ($selectedKey -and -not $seenKeys.Contains($selectedKey)) {
            $remainingKeys += $selectedKey
        }
        $updatedNameList = $remainingKeys -join ";"
        if ($updatedNameList -ne $existingNameList) {
            Set-ObjectPropertyValue -Object $hostCache -Name "namelist" -Value $updatedNameList
            $changed = $true
        }
    }

    if (-not $changed) {
        return
    }

    $backupPath = "$Path.math-plugin-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -LiteralPath $Path -Destination $backupPath -Force
    $json = $authorization | ConvertTo-Json -Depth 16
    Write-Utf8TextAtomic -Path $Path -Content $json
}

function Stop-LocalEditorHosts {
    param([string[]]$AllowedRoots)

    $normalizedRoots = @(
        $AllowedRoots |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            ForEach-Object {
                [IO.Path]::GetFullPath($_).TrimEnd(
                    [IO.Path]::DirectorySeparatorChar,
                    [IO.Path]::AltDirectorySeparatorChar
                ) + [IO.Path]::DirectorySeparatorChar
            }
    )
    foreach ($process in @(Get-Process -Name "WpsHighSchoolMathEditorHost" -ErrorAction SilentlyContinue)) {
        $processPath = $null
        try { $processPath = $process.Path } catch { $processPath = $null }
        if (-not $processPath) {
            continue
        }
        $fullProcessPath = [IO.Path]::GetFullPath($processPath)
        $isOwnedHost = @(
            $normalizedRoots |
                Where-Object { $fullProcessPath.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }
        ).Count -gt 0
        if (-not $isOwnedHost) {
            continue
        }
        $processId = $process.Id
        Stop-Process -Id $processId -Force -ErrorAction Stop
        Wait-Process -Id $processId -Timeout 5 -ErrorAction SilentlyContinue
    }
}

function Test-WpsProcessHasUserWindow {
    param([Parameter(Mandatory = $true)][object]$Process)

    try {
        if ($Process.PSObject.Methods.Name -contains "Refresh") {
            $Process.Refresh()
        }
        return [int64]$Process.MainWindowHandle -ne 0
    } catch {
        # If the process cannot be inspected, block installation rather than risk
        # changing add-in files while a document window may still be open.
        return $true
    }
}

function Stop-WpsBackgroundHosts {
    param([object[]]$Processes)

    foreach ($process in @($Processes)) {
        if (Test-WpsProcessHasUserWindow -Process $process) {
            continue
        }
        try {
            $processId = [int]$process.Id
            Stop-Process -Id $processId -Force -ErrorAction Stop
            Wait-Process -Id $processId -Timeout 5 -ErrorAction SilentlyContinue
        } catch {
            Write-Verbose "Unable to stop a headless WPS background process: $($_.Exception.Message)"
        }
    }
}

function Assert-HsmChildPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root
    )

    $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
    $fullPath = [IO.Path]::GetFullPath($Path)
    $rootPrefix = $fullRoot + [IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the WPS jsaddons root: $fullPath"
    }
    return $fullPath
}

function Remove-HsmSafeDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    $safePath = Assert-HsmChildPath -Path $Path -Root $Root
    Remove-Item -LiteralPath $safePath -Recurse -Force
}

function Update-HsmPublishRegistration {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object[]]$Plugins,
        [Parameter(Mandatory = $true)][string[]]$StaleNames,
        [Parameter(Mandatory = $true)][string]$Version
    )

    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        [xml]$publishXml = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    } else {
        [xml]$publishXml = "<jsplugins />"
    }
    $root = $publishXml.DocumentElement
    foreach ($name in $StaleNames) {
        @($root.SelectNodes("*[@name='$name']")) | ForEach-Object {
            [void]$root.RemoveChild($_)
        }
    }
    foreach ($pluginInfo in $Plugins) {
        $plugin = $publishXml.CreateElement("jsplugin")
        $attributes = [ordered]@{
            name = $pluginInfo.Name
            type = $pluginInfo.Type
            url = $pluginInfo.FolderName
            version = $Version
            enable = "enable_dev"
            install = "null"
            customDomain = ""
        }
        foreach ($entry in $attributes.GetEnumerator()) {
            $plugin.SetAttribute($entry.Key, [string]$entry.Value)
        }
        [void]$root.AppendChild($plugin)
    }
    Save-XmlDocument -Document $publishXml -Path $Path
}

function Test-HsmInstalledState {
    param(
        [Parameter(Mandatory = $true)][string]$JsAddonsPath,
        [Parameter(Mandatory = $true)][string]$PublishPath,
        [Parameter(Mandatory = $true)][object[]]$Plugins,
        [Parameter(Mandatory = $true)][string]$Product,
        [Parameter(Mandatory = $true)][string]$Version
    )

    if (-not (Test-Path -LiteralPath $PublishPath -PathType Leaf)) {
        throw "publish.xml was not created by the install transaction."
    }
    [xml]$publishXml = Get-Content -LiteralPath $PublishPath -Raw -Encoding UTF8
    $root = $publishXml.DocumentElement
    $results = @()
    foreach ($pluginInfo in $Plugins) {
        $payloadPath = Join-Path $JsAddonsPath $pluginInfo.FolderName
        $payloadResult = Test-HsmPayload `
            -PayloadPath $payloadPath `
            -ExpectedProduct $Product `
            -ExpectedPluginName $pluginInfo.Name `
            -ExpectedVersion $Version `
            -ExpectedHostType $pluginInfo.Type `
            -ExpectedManifestSha256 $pluginInfo.ManifestSha256
        $nodes = @($root.SelectNodes("*[@name='$($pluginInfo.Name)']"))
        if ($nodes.Count -ne 1) {
            throw "Expected exactly one publish.xml entry for $($pluginInfo.Name); found $($nodes.Count)."
        }
        $node = $nodes[0]
        if ($node.GetAttribute("type") -ne $pluginInfo.Type -or
            $node.GetAttribute("url") -ne $pluginInfo.FolderName -or
            $node.GetAttribute("version") -ne $Version -or
            $node.GetAttribute("enable") -ne "enable_dev") {
            throw "publish.xml registration is inconsistent with the installed $($pluginInfo.Type) payload."
        }
        $results += $payloadResult
    }
    return @($results)
}

function Invoke-HsmInstallTransaction {
    param(
        [Parameter(Mandatory = $true)][string]$InstallerRoot,
        [Parameter(Mandatory = $true)][string]$JsAddonsPath,
        [Parameter(Mandatory = $true)][string]$PublishPath,
        [Parameter(Mandatory = $true)][string]$AuthorizationPath,
        [Parameter(Mandatory = $true)][object[]]$Plugins,
        [Parameter(Mandatory = $true)][string[]]$StaleNames,
        [Parameter(Mandatory = $true)][string]$Product,
        [Parameter(Mandatory = $true)][string]$Version,
        [scriptblock]$TestCheckpoint
    )

    $transactionRoot = Join-Path $JsAddonsPath (".hsm-install-" + [Guid]::NewGuid().ToString("N"))
    [void](Assert-HsmChildPath -Path $transactionRoot -Root $JsAddonsPath)
    $stageRoot = Join-Path $transactionRoot "new"
    $backupRoot = Join-Path $transactionRoot "backup"
    $backupPayloadRoot = Join-Path $backupRoot "payloads"
    $failedRoot = Join-Path $transactionRoot "failed"
    New-Item -ItemType Directory -Path $stageRoot, $backupPayloadRoot -Force | Out-Null

    $publishSnapshot = Join-Path $backupRoot "publish.xml"
    $authorizationSnapshot = Join-Path $backupRoot "authaddin.json"
    $publishExisted = Test-Path -LiteralPath $PublishPath -PathType Leaf
    $authorizationExisted = Test-Path -LiteralPath $AuthorizationPath -PathType Leaf
    $rollbackErrors = @()

    try {
        $sourceResults = @{}
        foreach ($pluginInfo in $Plugins) {
            $sourcePath = Join-Path $InstallerRoot "payload\$($pluginInfo.FolderName)"
            $sourceResult = Test-HsmPayload `
                -PayloadPath $sourcePath `
                -ExpectedProduct $Product `
                -ExpectedPluginName $pluginInfo.Name `
                -ExpectedVersion $Version `
                -ExpectedHostType $pluginInfo.Type `
                -ExpectedManifestSha256 $pluginInfo.ManifestSha256
            $sourceResults[$pluginInfo.Name] = $sourceResult

            $existingExactPath = Join-Path $JsAddonsPath $pluginInfo.FolderName
            $pluginInfo["PreserveApproval"] = $false
            if (Test-Path -LiteralPath $existingExactPath -PathType Container) {
                $pluginInfo["PreserveApproval"] = Test-HsmPayloadEquivalent `
                    -PayloadPath $existingExactPath `
                    -ExpectedProduct $Product `
                    -ExpectedPluginName $pluginInfo.Name `
                    -ExpectedVersion $Version `
                    -ExpectedHostType $pluginInfo.Type `
                    -ExpectedPayloadSha256 $sourceResult.PayloadSha256
            }

            $stagePath = Join-Path $stageRoot $pluginInfo.FolderName
            Copy-Item -LiteralPath $sourcePath -Destination $stagePath -Recurse -Force
            [void](Test-HsmPayload `
                -PayloadPath $stagePath `
                -ExpectedProduct $Product `
                -ExpectedPluginName $pluginInfo.Name `
                -ExpectedVersion $Version `
                -ExpectedHostType $pluginInfo.Type `
                -ExpectedManifestSha256 $pluginInfo.ManifestSha256)
        }
        if ($TestCheckpoint) { & $TestCheckpoint "after-stage" }

        if ($publishExisted) {
            Copy-Item -LiteralPath $PublishPath -Destination $publishSnapshot -Force
        }
        if ($authorizationExisted) {
            Copy-Item -LiteralPath $AuthorizationPath -Destination $authorizationSnapshot -Force
        }

        $seenFolders = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        foreach ($pluginInfo in $Plugins) {
            foreach ($existingDirectory in @(
                Get-ChildItem -LiteralPath $JsAddonsPath -Directory -Filter "$($pluginInfo.Name)_*" -ErrorAction SilentlyContinue
            )) {
                if (-not $seenFolders.Add($existingDirectory.Name)) {
                    continue
                }
                if (($existingDirectory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                    throw "Refusing to replace a reparse-point add-in directory: $($existingDirectory.FullName)"
                }
                $safeExistingPath = Assert-HsmChildPath -Path $existingDirectory.FullName -Root $JsAddonsPath
                Move-Item -LiteralPath $safeExistingPath -Destination (Join-Path $backupPayloadRoot $existingDirectory.Name)
            }
        }
        if ($TestCheckpoint) { & $TestCheckpoint "after-backup" }

        $switchedPayloadCount = 0
        foreach ($pluginInfo in $Plugins) {
            $stagePath = Join-Path $stageRoot $pluginInfo.FolderName
            $finalPath = Join-Path $JsAddonsPath $pluginInfo.FolderName
            [void](Assert-HsmChildPath -Path $stagePath -Root $JsAddonsPath)
            [void](Assert-HsmChildPath -Path $finalPath -Root $JsAddonsPath)
            Move-Item -LiteralPath $stagePath -Destination $finalPath
            $switchedPayloadCount += 1
            if ($TestCheckpoint) { & $TestCheckpoint ("after-payload-switch-" + $switchedPayloadCount) }
        }

        Update-AuthorizationCache -Path $AuthorizationPath -Plugins $Plugins -JsAddonsPath $JsAddonsPath
        if ($TestCheckpoint) { & $TestCheckpoint "after-auth" }
        Update-HsmPublishRegistration -Path $PublishPath -Plugins $Plugins -StaleNames $StaleNames -Version $Version
        if ($TestCheckpoint) { & $TestCheckpoint "after-publish" }
        $installedResults = @(Test-HsmInstalledState `
            -JsAddonsPath $JsAddonsPath `
            -PublishPath $PublishPath `
            -Plugins $Plugins `
            -Product $Product `
            -Version $Version)
        if ($TestCheckpoint) { & $TestCheckpoint "after-validate" }

        Remove-HsmSafeDirectory -Path $transactionRoot -Root $JsAddonsPath
        return @($installedResults)
    } catch {
        $installError = $_
        try { New-Item -ItemType Directory -Path $failedRoot -Force | Out-Null } catch { $rollbackErrors += $_.Exception.Message }

        foreach ($pluginInfo in $Plugins) {
            $finalPath = Join-Path $JsAddonsPath $pluginInfo.FolderName
            if (Test-Path -LiteralPath $finalPath -PathType Container) {
                try {
                    $safeFinalPath = Assert-HsmChildPath -Path $finalPath -Root $JsAddonsPath
                    Move-Item -LiteralPath $safeFinalPath -Destination (Join-Path $failedRoot $pluginInfo.FolderName) -Force
                } catch {
                    $rollbackErrors += $_.Exception.Message
                }
            }
        }

        if (Test-Path -LiteralPath $backupPayloadRoot -PathType Container) {
            foreach ($backupDirectory in @(Get-ChildItem -LiteralPath $backupPayloadRoot -Directory -ErrorAction SilentlyContinue)) {
                try {
                    $restorePath = Join-Path $JsAddonsPath $backupDirectory.Name
                    [void](Assert-HsmChildPath -Path $restorePath -Root $JsAddonsPath)
                    Move-Item -LiteralPath $backupDirectory.FullName -Destination $restorePath
                } catch {
                    $rollbackErrors += $_.Exception.Message
                }
            }
        }

        foreach ($snapshot in @(
            @{ Existed = $publishExisted; Source = $publishSnapshot; Destination = $PublishPath },
            @{ Existed = $authorizationExisted; Source = $authorizationSnapshot; Destination = $AuthorizationPath }
        )) {
            try {
                if ($snapshot.Existed) {
                    Copy-FileAtomic -Source $snapshot.Source -Destination $snapshot.Destination
                } elseif (Test-Path -LiteralPath $snapshot.Destination -PathType Leaf) {
                    Remove-Item -LiteralPath $snapshot.Destination -Force
                }
            } catch {
                $rollbackErrors += $_.Exception.Message
            }
        }

        if ($rollbackErrors.Count -eq 0) {
            try { Remove-HsmSafeDirectory -Path $transactionRoot -Root $JsAddonsPath } catch { $rollbackErrors += $_.Exception.Message }
        }
        if ($rollbackErrors.Count -gt 0) {
            throw "Install failed: $($installError.Exception.Message) Rollback also failed; recovery data was kept at $transactionRoot. $($rollbackErrors -join ' | ')"
        }
        throw "Install failed and the previous Writer/PPT installation was restored: $($installError.Exception.Message)"
    }
}

$wpsProcesses = @(Get-Process -Name "wps", "wpp" -ErrorAction SilentlyContinue)
$openWpsProcesses = @($wpsProcesses | Where-Object { Test-WpsProcessHasUserWindow -Process $_ })
if ($openWpsProcesses.Count -gt 0) {
    throw "Close all WPS Writer and Presentation windows before installing this add-in."
}
Stop-WpsBackgroundHosts -Processes $wpsProcesses

$jsAddonsPath = Join-Path $env:APPDATA "kingsoft\wps\jsaddons"
$publishPath = Join-Path $jsAddonsPath "publish.xml"
$authorizationPath = Join-Path $jsAddonsPath "authaddin.json"
New-Item -ItemType Directory -Path $jsAddonsPath -Force | Out-Null

$licenseStatePath = Join-Path $env:APPDATA "WpsHighSchoolMath"
$machineIdPath = Join-Path $licenseStatePath "machine-id.txt"
New-Item -ItemType Directory -Path $licenseStatePath -Force | Out-Null
Stop-LocalEditorHosts -AllowedRoots @($jsAddonsPath, $licenseStatePath)

$machineId = ""
if (Test-Path -LiteralPath $machineIdPath) {
    $machineId = ([string](Get-Content -LiteralPath $machineIdPath -Raw)).Trim().ToUpperInvariant()
}
if ($machineId -notmatch '^HSM[A-Z0-9]{10}$') {
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $seedBytes = [Text.Encoding]::UTF8.GetBytes(([Guid]::NewGuid().ToString("N")) + "|" + [Environment]::MachineName + "|" + [Environment]::UserName)
        $hashBytes = $sha256.ComputeHash($seedBytes)
        $machineId = "HSM" + (([BitConverter]::ToString($hashBytes)).Replace("-", "").Substring(0, 10))
    } finally {
        $sha256.Dispose()
    }
    [IO.File]::WriteAllText($machineIdPath, $machineId, (New-Object Text.UTF8Encoding($false)))
}

$installedResults = @(Invoke-HsmInstallTransaction `
    -InstallerRoot $PSScriptRoot `
    -JsAddonsPath $jsAddonsPath `
    -PublishPath $publishPath `
    -AuthorizationPath $authorizationPath `
    -Plugins $plugins `
    -StaleNames $stalePluginNames `
    -Product $pluginName `
    -Version $pluginVersion)

$uninstallRegistration = Register-HsmUninstaller `
    -Version $pluginVersion `
    -SourceRoot $PSScriptRoot `
    -JsAddonsPath $jsAddonsPath

$oemPath = Get-WpsOemIniPath
$oemConfigured = $false
if ($oemPath -and (Test-Path -LiteralPath $oemPath)) {
    try {
        $oemBackupPath = "$oemPath.math-plugin-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        Copy-Item -LiteralPath $oemPath -Destination $oemBackupPath -Force
        $oemContent = Get-Content -LiteralPath $oemPath -Raw
        $oemContent = Set-IniValue -Content $oemContent -Section "Support" -Key "JsApiPlugin" -Value "true"
        $oemContent = Set-IniValue -Content $oemContent -Section "Support" -Key "JsApiShowWebDebugger" -Value "false"
        Write-Utf8TextAtomic -Path $oemPath -Content $oemContent
        $oemConfigured = $true
    } catch {
        $configurationScript = Join-Path $PSScriptRoot "configure-wps.ps1"
        if (Test-Path -LiteralPath $configurationScript -PathType Leaf) {
            try {
                $arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$configurationScript`""
                $configurationProcess = Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $arguments -Wait -PassThru
                $oemConfigured = $configurationProcess.ExitCode -eq 0
            } catch {
                Write-Warning "The add-in is installed, but the optional WPS debugger-button configuration was not approved."
            }
        }
    }
} else {
    Write-Warning "WPS oem.ini was not found. The plugin was installed, but the JS debugger button could not be disabled."
}
if (-not $oemConfigured) {
    Write-Warning "The add-in is installed and usable, but WPS may still show its JS debugger button."
}

Write-Host ""
Write-Host "WPS High School Math $pluginVersion was installed for Writer and Presentation."
foreach ($result in $installedResults) {
    Write-Host ("Verified {0}: {1} files, payload {2}" -f $result.HostType, $result.FileCount, $result.PayloadSha256)
}
Write-Host "Machine code: $machineId"
Write-Host "Free trial: 14 days with all features; after expiry, only Writer exam-paper tools remain available."
Write-Host "Windows uninstall entry: $($uninstallRegistration.DisplayName) $($uninstallRegistration.Version)"
Write-Host "Restart all WPS Writer and Presentation windows to load the plugin and hide the JS debugger button."
Write-Host "On the first Writer and Presentation launch after an upgrade, click Confirm when WPS asks whether to trust the add-in."
try {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show(
        "安装完成。`r`n`r`n首次打开插件后可免费试用 14 天，试用期间全部功能可用。第 15 天起，试卷功能仍可使用，其他功能需要激活。`r`n`r`n卸载入口：Windows 设置 → 应用 → 已安装的应用 → WPS 高中数学工具插件。",
        "WPS 高中数学工具插件",
        [Windows.Forms.MessageBoxButtons]::OK,
        [Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
} catch {
    Write-Verbose "Unable to show the installation summary: $($_.Exception.Message)"
}
