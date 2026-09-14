$ErrorActionPreference = "Stop"

function Get-WpsOemIniPath {
    $command = (Get-ItemProperty -LiteralPath "Registry::HKEY_CLASSES_ROOT\KWPS.Document.12\shell\open\command")."(default)"
    $match = [regex]::Match([string]$command, '"([^"]+\.exe)"|^([^\s]+\.exe)', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if (-not $match.Success) { throw "WPS Writer executable could not be located." }
    $wpsExe = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
    $wpsRoot = [IO.Path]::GetFullPath((Split-Path -Parent $wpsExe)).TrimEnd("\") + "\"
    $oemPath = [IO.Path]::GetFullPath((Join-Path $wpsRoot "cfgs\oem.ini"))
    if (-not $oemPath.StartsWith($wpsRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to update a configuration file outside the WPS installation directory."
    }
    return $oemPath
}

function Set-IniValue {
    param([string]$Content, [string]$Section, [string]$Key, [string]$Value)
    $newline = "`r`n"
    $sectionPattern = "(?ims)(^\s*\[$([regex]::Escape($Section))\]\s*\r?\n)(.*?)(?=^\s*\[|\z)"
    $sectionRegex = New-Object regex($sectionPattern)
    if (-not $sectionRegex.IsMatch($Content)) {
        return $Content.TrimEnd() + $newline + $newline + "[$Section]" + $newline + "$Key=$Value" + $newline
    }
    return $sectionRegex.Replace($Content, {
        param($match)
        $header = $match.Groups[1].Value
        $body = $match.Groups[2].Value
        $keyPattern = "(?im)^\s*$([regex]::Escape($Key))\s*=.*$"
        if ([regex]::IsMatch($body, $keyPattern)) {
            $body = [regex]::Replace($body, $keyPattern, "$Key=$Value")
        } else {
            $body = $body.TrimEnd() + $newline + "$Key=$Value" + $newline
        }
        return $header + $body
    }, 1)
}

$oemPath = Get-WpsOemIniPath
if (-not (Test-Path -LiteralPath $oemPath -PathType Leaf)) { throw "WPS oem.ini was not found." }
$backupPath = "$oemPath.math-plugin-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -LiteralPath $oemPath -Destination $backupPath -Force
$content = Get-Content -LiteralPath $oemPath -Raw
$content = Set-IniValue -Content $content -Section "Support" -Key "JsApiPlugin" -Value "true"
$content = Set-IniValue -Content $content -Section "Support" -Key "JsApiShowWebDebugger" -Value "false"
[IO.File]::WriteAllText($oemPath, $content, (New-Object Text.UTF8Encoding($false)))
