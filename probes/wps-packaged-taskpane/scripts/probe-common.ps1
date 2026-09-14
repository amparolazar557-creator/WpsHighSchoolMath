Set-StrictMode -Version Latest

$script:ProbeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$script:Utf8NoBom = New-Object Text.UTF8Encoding($false)

function Get-PackagedProbeManifest {
    return Get-Content -LiteralPath (Join-Path $script:ProbeRoot "probe-manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-PackagedProbeDefinitions {
    $manifest = Get-PackagedProbeManifest
    return @(
        [pscustomobject]@{ Host = "writer"; Name = [string]$manifest.writer.name; Type = [string]$manifest.writer.type; Folder = [string]$manifest.writer.folder },
        [pscustomobject]@{ Host = "presentation"; Name = [string]$manifest.presentation.name; Type = [string]$manifest.presentation.type; Folder = [string]$manifest.presentation.folder }
    )
}

function Assert-PackagedProbeWpsClosed {
    if (@(Get-Process -Name "wps", "wpp" -ErrorAction SilentlyContinue).Count -gt 0) {
        throw "Close all WPS Writer and Presentation processes before changing the packaged-task-pane probe."
    }
}

function Assert-PackagedProbeChildPath([string]$Path, [string]$Root) {
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $pathFull = [IO.Path]::GetFullPath($Path)
    if (-not $pathFull.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Probe path escapes the jsaddons root: $pathFull"
    }
    return $pathFull
}

function Write-PackagedProbeUtf8Atomic([string]$Path, [string]$Content) {
    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $temporary = "$Path.tmp-$([Guid]::NewGuid().ToString('N'))"
    $backup = "$Path.bak-$([Guid]::NewGuid().ToString('N'))"
    try {
        [IO.File]::WriteAllText($temporary, $Content, $script:Utf8NoBom)
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            [IO.File]::Replace($temporary, $Path, $backup, $true)
        } else {
            [IO.File]::Move($temporary, $Path)
        }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
    }
}

function Save-PackagedProbeXmlAtomic([xml]$Document, [string]$Path) {
    $settings = New-Object Xml.XmlWriterSettings
    $settings.OmitXmlDeclaration = $true
    $settings.Indent = $true
    $settings.NewLineChars = "`r`n"
    $builder = New-Object Text.StringBuilder
    $writer = [Xml.XmlWriter]::Create($builder, $settings)
    try { $Document.Save($writer) } finally { $writer.Dispose() }
    Write-PackagedProbeUtf8Atomic -Path $Path -Content ("<?xml version=`"1.0`" encoding=`"UTF-8`"?>`r`n" + $builder.ToString())
}

function Set-PackagedProbePublish([string]$Path, [object[]]$Definitions, [string]$Version) {
    [xml]$document = if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    } else { "<jsplugins />" }
    foreach ($definition in $Definitions) {
        @($document.DocumentElement.SelectNodes("*[@name='$($definition.Name)']")) | ForEach-Object {
            [void]$document.DocumentElement.RemoveChild($_)
        }
        $node = $document.CreateElement("jsplugin")
        $node.SetAttribute("name", $definition.Name)
        $node.SetAttribute("type", $definition.Type)
        $node.SetAttribute("url", $definition.Folder)
        $node.SetAttribute("version", $Version)
        $node.SetAttribute("enable", "enable_dev")
        $node.SetAttribute("install", "null")
        $node.SetAttribute("customDomain", "")
        [void]$document.DocumentElement.AppendChild($node)
    }
    Save-PackagedProbeXmlAtomic -Document $document -Path $Path
}

function Remove-PackagedProbePublish([string]$Path, [object[]]$Definitions) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    [xml]$document = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $changed = $false
    foreach ($definition in $Definitions) {
        @($document.DocumentElement.SelectNodes("*[@name='$($definition.Name)']")) | ForEach-Object {
            [void]$document.DocumentElement.RemoveChild($_)
            $changed = $true
        }
    }
    if ($changed) { Save-PackagedProbeXmlAtomic -Document $document -Path $Path }
}

function Remove-PackagedProbeAuthorization([string]$Path, [object[]]$Definitions) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    try { $data = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return }
    $changed = $false
    foreach ($definition in $Definitions) {
        $hostProperty = $data.PSObject.Properties[$definition.Type]
        if ($null -eq $hostProperty -or $null -eq $hostProperty.Value) { continue }
        $hostData = $hostProperty.Value
        $removeKeys = @(
            $hostData.PSObject.Properties |
                Where-Object { $_.Name -ne "namelist" -and $null -ne $_.Value -and [string]$_.Value.name -eq $definition.Name } |
                ForEach-Object { $_.Name }
        )
        foreach ($key in $removeKeys) {
            [void]$hostData.PSObject.Properties.Remove($key)
            $changed = $true
        }
        $nameList = $hostData.PSObject.Properties["namelist"]
        if ($null -ne $nameList) {
            $old = [string]$nameList.Value
            $new = @(($old -split ";") | Where-Object { $_ -and $removeKeys -notcontains $_ }) -join ";"
            if ($new -ne $old) { $nameList.Value = $new; $changed = $true }
        }
    }
    if ($changed) { Write-PackagedProbeUtf8Atomic -Path $Path -Content ($data | ConvertTo-Json -Depth 16) }
}
