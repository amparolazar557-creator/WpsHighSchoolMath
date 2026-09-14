Set-StrictMode -Version Latest

$script:ProbeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$script:Utf8NoBom = New-Object Text.UTF8Encoding($false)

function Get-NativeProbeManifest {
    $path = Join-Path $script:ProbeRoot "probe-manifest.json"
    return Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Write-NativeProbeUtf8Atomic {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Content)
    $directory = Split-Path -Parent $Path
    if ($directory) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    $transactionId = [Guid]::NewGuid().ToString('N')
    $temporary = "$Path.tmp-$transactionId"
    $backup = "$Path.bak-$transactionId"
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

function Save-NativeProbeXmlAtomic {
    param([Parameter(Mandatory = $true)][xml]$Document, [Parameter(Mandatory = $true)][string]$Path)
    $settings = New-Object Xml.XmlWriterSettings
    $settings.OmitXmlDeclaration = $true
    $settings.Indent = $true
    $settings.NewLineChars = "`r`n"
    $settings.NewLineHandling = [Xml.NewLineHandling]::Replace
    $builder = New-Object Text.StringBuilder
    $writer = [Xml.XmlWriter]::Create($builder, $settings)
    try { $Document.Save($writer) } finally { $writer.Dispose() }
    $content = "<?xml version=`"1.0`" encoding=`"UTF-8`"?>`r`n" + $builder.ToString()
    Write-NativeProbeUtf8Atomic -Path $Path -Content $content
}

function Assert-NativeProbeChildPath {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Root)
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $pathFull = [IO.Path]::GetFullPath($Path)
    if (-not $pathFull.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Probe path escapes the jsaddons root: $pathFull"
    }
    return $pathFull
}

function Assert-NativeProbeWpsClosed {
    if (@(Get-Process -Name "wps", "wpp" -ErrorAction SilentlyContinue).Count -gt 0) {
        throw "Close all WPS Writer and Presentation windows. The probe does not terminate host processes."
    }
}

function Get-NativeProbeDefinitions {
    $manifest = Get-NativeProbeManifest
    return @(
        [pscustomobject]@{ Host = "writer"; Name = [string]$manifest.writer.name; Type = [string]$manifest.writer.type; Folder = [string]$manifest.writer.folder },
        [pscustomobject]@{ Host = "presentation"; Name = [string]$manifest.presentation.name; Type = [string]$manifest.presentation.type; Folder = [string]$manifest.presentation.folder }
    )
}

function Get-NativeProbeNativeXPaths {
    $manifest = Get-NativeProbeManifest
    $sourceRelative = ([string]$manifest.hardGate.nativeXBinary).Replace('/', [IO.Path]::DirectorySeparatorChar)
    return [pscustomobject]@{
        Module = [string]$manifest.hardGate.nativeXModule
        Entry = [string]$manifest.hardGate.nativeXEntry
        Source = Join-Path $script:ProbeRoot $sourceRelative
        Target = Join-Path $env:APPDATA "WpsHighSchoolMath\native-capability-probe\nativex\x86\hsmmathnativeprobe.dll"
        Config = Join-Path $env:APPDATA "kingsoft\wps\jsaddons\binary\WPSNativeX.conf"
    }
}

function Set-NativeProbeNativeXRegistration {
    param([Parameter(Mandatory = $true)][object]$NativeX)
    if (-not (Test-Path -LiteralPath $NativeX.Source -PathType Leaf)) {
        throw "NativeX probe DLL is missing. Run build-native-dialog-probe.ps1 first: $($NativeX.Source)"
    }
    $targetDirectory = Split-Path -Parent $NativeX.Target
    New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
    Copy-Item -LiteralPath $NativeX.Source -Destination $NativeX.Target -Force

    $content = if (Test-Path -LiteralPath $NativeX.Config -PathType Leaf) {
        Get-Content -LiteralPath $NativeX.Config -Raw -Encoding UTF8
    } else { "" }
    $sectionPattern = "(?ms)^\[" + [Regex]::Escape($NativeX.Module) + "\]\r?\n.*?(?=^\[|\z)"
    $sectionRegex = New-Object Regex($sectionPattern)
    $targetPath = ([IO.Path]::GetFullPath($NativeX.Target)).Replace('\', '/')
    $section = "[$($NativeX.Module)]`r`ncrash=false`r`npath=$targetPath`r`ninproc=true`r`n"
    if ($sectionRegex.IsMatch($content)) {
        $content = $sectionRegex.Replace($content, $section, 1)
    } else {
        if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) { $content += "`r`n" }
        $content += $section
    }
    Write-NativeProbeUtf8Atomic -Path $NativeX.Config -Content $content
}

function Remove-NativeProbeNativeXRegistration {
    param([Parameter(Mandatory = $true)][object]$NativeX)
    if (Test-Path -LiteralPath $NativeX.Config -PathType Leaf) {
        $content = Get-Content -LiteralPath $NativeX.Config -Raw -Encoding UTF8
        $sectionPattern = "(?ms)^\[" + [Regex]::Escape($NativeX.Module) + "\]\r?\n.*?(?=^\[|\z)"
        $content = (New-Object Regex($sectionPattern)).Replace($content, "", 1).TrimStart("`r", "`n")
        if ([string]::IsNullOrWhiteSpace($content)) {
            Remove-Item -LiteralPath $NativeX.Config -Force
        } else {
            Write-NativeProbeUtf8Atomic -Path $NativeX.Config -Content $content
        }
    }
    if (Test-Path -LiteralPath $NativeX.Target -PathType Leaf) {
        Remove-Item -LiteralPath $NativeX.Target -Force
    }
}

function New-NativeProbePayload {
    param(
        [Parameter(Mandatory = $true)][object]$Definition,
        [Parameter(Mandatory = $true)][ValidateSet("Full", "Compat")][string]$Mode,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    $source = Join-Path (Join-Path $script:ProbeRoot "src") $Definition.Host
    New-Item -ItemType Directory -Path (Join-Path $Destination "js") -Force | Out-Null
    foreach ($name in @("index.html", "main.js", "manifest.xml")) {
        Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $Destination $name) -Force
    }
    $ribbonName = if ($Mode -eq "Compat") { "ribbon.compat.xml" } else { "ribbon.xml" }
    Copy-Item -LiteralPath (Join-Path $source $ribbonName) -Destination (Join-Path $Destination "ribbon.xml") -Force
    Copy-Item -LiteralPath (Join-Path $script:ProbeRoot "src\shared\probe.js") -Destination (Join-Path $Destination "js\probe.js") -Force
}

function Assert-NativeProbePayloadFiles {
    param([Parameter(Mandatory = $true)][string]$Path)
    $manifest = Get-NativeProbeManifest
    $actual = @(
        Get-ChildItem -LiteralPath $Path -Recurse -File |
            ForEach-Object { $_.FullName.Substring($Path.Length).TrimStart('\', '/').Replace('\', '/') } |
            Sort-Object
    )
    $expected = @($manifest.installedFiles | ForEach-Object { [string]$_ } | Sort-Object)
    if (($actual -join "`n") -ne ($expected -join "`n")) {
        throw "Probe payload file set mismatch. Actual: $($actual -join ', ')"
    }
}

function Set-NativeProbePublishRegistration {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object[]]$Definitions,
        [Parameter(Mandatory = $true)][string]$Version
    )
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        [xml]$document = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    } else {
        [xml]$document = "<jsplugins />"
    }
    $root = $document.DocumentElement
    foreach ($definition in $Definitions) {
        @($root.SelectNodes("*[@name='$($definition.Name)']")) | ForEach-Object { [void]$root.RemoveChild($_) }
        $node = $document.CreateElement("jsplugin")
        $node.SetAttribute("name", $definition.Name)
        $node.SetAttribute("type", $definition.Type)
        $node.SetAttribute("url", $definition.Folder)
        $node.SetAttribute("version", $Version)
        $node.SetAttribute("enable", "enable_dev")
        $node.SetAttribute("install", "null")
        $node.SetAttribute("customDomain", "")
        [void]$root.AppendChild($node)
    }
    Save-NativeProbeXmlAtomic -Document $document -Path $Path
}

function Remove-NativeProbePublishRegistration {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][object[]]$Definitions)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    [xml]$document = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    $changed = $false
    foreach ($definition in $Definitions) {
        @($document.DocumentElement.SelectNodes("*[@name='$($definition.Name)']")) | ForEach-Object {
            [void]$document.DocumentElement.RemoveChild($_)
            $changed = $true
        }
    }
    if ($changed) { Save-NativeProbeXmlAtomic -Document $document -Path $Path }
}

function Remove-NativeProbeAuthorizationEntries {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][object[]]$Definitions)
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
    if ($changed) { Write-NativeProbeUtf8Atomic -Path $Path -Content ($data | ConvertTo-Json -Depth 16) }
}
