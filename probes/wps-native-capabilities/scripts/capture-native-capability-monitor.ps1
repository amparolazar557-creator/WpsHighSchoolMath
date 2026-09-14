param(
    [Parameter(Mandatory = $true)][string]$RunId,
    [Parameter(Mandatory = $true)][string]$WriterExe,
    [Parameter(Mandatory = $true)][string]$PresentationExe,
    [Parameter(Mandatory = $true)][string]$EvidencePath,
    [Parameter(Mandatory = $true)][string]$ReadyPath,
    [Parameter(Mandatory = $true)][string]$StopSignalPath,
    [ValidateRange(20, 75)][int]$SampleIntervalMs = 50,
    [ValidateRange(1, 60)][int]$MaxMinutes = 30
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$utf8NoBom = New-Object Text.UTF8Encoding($false)

function Get-FullPath([string]$Path) {
    return [IO.Path]::GetFullPath($Path)
}

function Write-JsonAtomic([string]$Path, [object]$Value) {
    $full = Get-FullPath $Path
    $parent = Split-Path -Parent $full
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $temporary = "$full.tmp-$([Guid]::NewGuid().ToString('N'))"
    try {
        [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 12), $utf8NoBom)
        if (Test-Path -LiteralPath $full -PathType Leaf) {
            $backup = "$full.bak-$([Guid]::NewGuid().ToString('N'))"
            try { [IO.File]::Replace($temporary, $full, $backup, $true) }
            finally { if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force } }
        } else {
            [IO.File]::Move($temporary, $full)
        }
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

[Guid]$parsedRunId = [Guid]::Empty
if (-not [Guid]::TryParse($RunId, [ref]$parsedRunId) -or $parsedRunId -eq [Guid]::Empty) {
    throw "RunId must be a non-empty GUID."
}
$RunId = $parsedRunId.ToString("D")
$WriterExe = Get-FullPath $WriterExe
$PresentationExe = Get-FullPath $PresentationExe
$EvidencePath = Get-FullPath $EvidencePath
$ReadyPath = Get-FullPath $ReadyPath
$StopSignalPath = Get-FullPath $StopSignalPath
if (-not (Test-Path -LiteralPath $WriterExe -PathType Leaf) -or
    [IO.Path]::GetFileName($WriterExe) -ine "wps.exe") {
    throw "WriterExe must identify an existing wps.exe."
}
if (-not (Test-Path -LiteralPath $PresentationExe -PathType Leaf) -or
    [IO.Path]::GetFileName($PresentationExe) -ine "wpp.exe") {
    throw "PresentationExe must identify an existing wpp.exe."
}
foreach ($path in @($EvidencePath, $ReadyPath)) {
    if (Test-Path -LiteralPath $path) { throw "Refusing to overwrite an existing monitor artifact: $path" }
}
if (Test-Path -LiteralPath $StopSignalPath) {
    throw "Stop signal already exists; use a fresh run directory: $StopSignalPath"
}

$monitorSource = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;

public sealed class HsmMonitorSnapshotV1
{
    public int WpsProcessCount { get; set; }
    public int UnexpectedHelperCount { get; set; }
    public int ListenerCount { get; set; }
    public int LoopbackConnectionCount { get; set; }
    public string[] UnexpectedHelpers { get; set; }
    public string[] Listeners { get; set; }
    public string[] LoopbackConnections { get; set; }
}

public static class HsmNativeProbeMonitorV1
{
    private const uint TH32CS_SNAPPROCESS = 0x00000002;
    private const uint INVALID_HANDLE_VALUE = 0xffffffff;
    private const int AF_INET = 2;
    private const int AF_INET6 = 23;
    private const uint NO_ERROR = 0;
    private const uint ERROR_INSUFFICIENT_BUFFER = 122;
    private const int MIB_TCP_STATE_LISTEN = 2;

    private enum TCP_TABLE_CLASS
    {
        TCP_TABLE_BASIC_LISTENER,
        TCP_TABLE_BASIC_CONNECTIONS,
        TCP_TABLE_BASIC_ALL,
        TCP_TABLE_OWNER_PID_LISTENER,
        TCP_TABLE_OWNER_PID_CONNECTIONS,
        TCP_TABLE_OWNER_PID_ALL
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PROCESSENTRY32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MIB_TCPROW_OWNER_PID
    {
        public uint state;
        public uint localAddr;
        public uint localPort;
        public uint remoteAddr;
        public uint remotePort;
        public uint owningPid;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MIB_TCP6ROW_OWNER_PID
    {
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 16)] public byte[] localAddr;
        public uint localScopeId;
        public uint localPort;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 16)] public byte[] remoteAddr;
        public uint remoteScopeId;
        public uint remotePort;
        public uint state;
        public uint owningPid;
    }

    private sealed class TcpRow
    {
        public int Pid;
        public int State;
        public IPAddress LocalAddress;
        public int LocalPort;
        public IPAddress RemoteAddress;
        public int RemotePort;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32First(IntPtr snapshot, ref PROCESSENTRY32 entry);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Process32Next(IntPtr snapshot, ref PROCESSENTRY32 entry);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("iphlpapi.dll", SetLastError = true)]
    private static extern uint GetExtendedTcpTable(
        IntPtr tcpTable,
        ref int outputBufferLength,
        bool order,
        int ipVersion,
        TCP_TABLE_CLASS tableClass,
        uint reserved);

    private static Dictionary<int, int> ParentMap()
    {
        var result = new Dictionary<int, int>();
        IntPtr snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snapshot == IntPtr.Zero || snapshot.ToInt64() == -1 || unchecked((uint)snapshot.ToInt64()) == INVALID_HANDLE_VALUE)
            throw new InvalidOperationException("CreateToolhelp32Snapshot failed: " + Marshal.GetLastWin32Error());
        try
        {
            var entry = new PROCESSENTRY32();
            entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
            if (!Process32First(snapshot, ref entry))
                throw new InvalidOperationException("Process32First failed: " + Marshal.GetLastWin32Error());
            do
            {
                result[(int)entry.th32ProcessID] = (int)entry.th32ParentProcessID;
                entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
            } while (Process32Next(snapshot, ref entry));
        }
        finally { CloseHandle(snapshot); }
        return result;
    }

    private static string ProcessPath(Process process)
    {
        try { return Path.GetFullPath(process.MainModule.FileName); }
        catch { return String.Empty; }
    }

    private static int DecodePort(uint value)
    {
        return (ushort)IPAddress.NetworkToHostOrder(unchecked((short)value));
    }

    private static List<TcpRow> TcpRows(int family)
    {
        int length = 0;
        uint first = GetExtendedTcpTable(IntPtr.Zero, ref length, false, family, TCP_TABLE_CLASS.TCP_TABLE_OWNER_PID_ALL, 0);
        if (first != ERROR_INSUFFICIENT_BUFFER && first != NO_ERROR)
            throw new InvalidOperationException("GetExtendedTcpTable size failed: " + first);
        IntPtr buffer = Marshal.AllocHGlobal(length);
        try
        {
            uint error = GetExtendedTcpTable(buffer, ref length, false, family, TCP_TABLE_CLASS.TCP_TABLE_OWNER_PID_ALL, 0);
            if (error != NO_ERROR) throw new InvalidOperationException("GetExtendedTcpTable failed: " + error);
            int count = Marshal.ReadInt32(buffer);
            IntPtr rowPointer = IntPtr.Add(buffer, sizeof(uint));
            var rows = new List<TcpRow>(count);
            if (family == AF_INET)
            {
                int size = Marshal.SizeOf(typeof(MIB_TCPROW_OWNER_PID));
                for (int i = 0; i < count; i++)
                {
                    var raw = (MIB_TCPROW_OWNER_PID)Marshal.PtrToStructure(IntPtr.Add(rowPointer, i * size), typeof(MIB_TCPROW_OWNER_PID));
                    rows.Add(new TcpRow {
                        Pid = (int)raw.owningPid, State = (int)raw.state,
                        LocalAddress = new IPAddress((long)raw.localAddr), LocalPort = DecodePort(raw.localPort),
                        RemoteAddress = new IPAddress((long)raw.remoteAddr), RemotePort = DecodePort(raw.remotePort)
                    });
                }
            }
            else
            {
                int size = Marshal.SizeOf(typeof(MIB_TCP6ROW_OWNER_PID));
                for (int i = 0; i < count; i++)
                {
                    var raw = (MIB_TCP6ROW_OWNER_PID)Marshal.PtrToStructure(IntPtr.Add(rowPointer, i * size), typeof(MIB_TCP6ROW_OWNER_PID));
                    rows.Add(new TcpRow {
                        Pid = (int)raw.owningPid, State = (int)raw.state,
                        LocalAddress = new IPAddress(raw.localAddr, raw.localScopeId), LocalPort = DecodePort(raw.localPort),
                        RemoteAddress = new IPAddress(raw.remoteAddr, raw.remoteScopeId), RemotePort = DecodePort(raw.remotePort)
                    });
                }
            }
            return rows;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static bool IsLoopback(IPAddress address)
    {
        if (address == null) return false;
        if (IPAddress.IsLoopback(address)) return true;
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        byte[] bytes = address.GetAddressBytes();
        return bytes.Length == 4 && bytes[0] == 127;
    }

    private static string Endpoint(IPAddress address, int port)
    {
        return address + ":" + port;
    }

    public static HsmMonitorSnapshotV1 Capture(string writerExe, string presentationExe)
    {
        string writer = Path.GetFullPath(writerExe);
        string presentation = Path.GetFullPath(presentationExe);
        var parents = ParentMap();
        var processPaths = new Dictionary<int, string>();
        var processNames = new Dictionary<int, string>();
        foreach (Process process in Process.GetProcesses())
        {
            try
            {
                string name = process.ProcessName ?? String.Empty;
                processNames[process.Id] = name;
                bool pathRequired = String.Equals(name, "wps", StringComparison.OrdinalIgnoreCase) ||
                    String.Equals(name, "wpp", StringComparison.OrdinalIgnoreCase) ||
                    name.IndexOf("WpsHighSchoolMath", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    name.IndexOf("HsmNativeCapability", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    name.IndexOf("EditorHost", StringComparison.OrdinalIgnoreCase) >= 0;
                if (pathRequired) processPaths[process.Id] = ProcessPath(process);
            }
            finally { process.Dispose(); }
        }

        var targets = new HashSet<int>();
        foreach (var pair in processPaths)
        {
            if (String.Equals(pair.Value, writer, StringComparison.OrdinalIgnoreCase) ||
                String.Equals(pair.Value, presentation, StringComparison.OrdinalIgnoreCase))
                targets.Add(pair.Key);
        }
        bool changed;
        do
        {
            changed = false;
            foreach (var pair in parents)
            {
                if (!targets.Contains(pair.Key) && targets.Contains(pair.Value))
                {
                    targets.Add(pair.Key);
                    changed = true;
                }
            }
        } while (changed);

        var helpers = new List<string>();
        foreach (var pair in processNames)
        {
            string path;
            processPaths.TryGetValue(pair.Key, out path);
            bool productPath = !String.IsNullOrEmpty(path) && path.IndexOf("WpsHighSchoolMath", StringComparison.OrdinalIgnoreCase) >= 0;
            bool productName = pair.Value.IndexOf("WpsHighSchoolMath", StringComparison.OrdinalIgnoreCase) >= 0 ||
                pair.Value.IndexOf("HsmNativeCapability", StringComparison.OrdinalIgnoreCase) >= 0;
            bool isHostRoot = String.Equals(path, writer, StringComparison.OrdinalIgnoreCase) ||
                String.Equals(path, presentation, StringComparison.OrdinalIgnoreCase);
            if ((productPath || productName) && !isHostRoot)
            {
                helpers.Add(pair.Key + "|" + pair.Value + "|" + path);
                targets.Add(pair.Key);
            }
        }

        var listeners = new List<string>();
        var loopbacks = new List<string>();
        foreach (TcpRow row in TcpRows(AF_INET).Concat(TcpRows(AF_INET6)))
        {
            if (!targets.Contains(row.Pid)) continue;
            if (row.State == MIB_TCP_STATE_LISTEN)
                listeners.Add(row.Pid + "|" + Endpoint(row.LocalAddress, row.LocalPort));
            else if (IsLoopback(row.RemoteAddress))
                loopbacks.Add(row.Pid + "|" + Endpoint(row.LocalAddress, row.LocalPort) + "->" + Endpoint(row.RemoteAddress, row.RemotePort));
        }

        return new HsmMonitorSnapshotV1 {
            WpsProcessCount = targets.Count - helpers.Count,
            UnexpectedHelperCount = helpers.Count,
            ListenerCount = listeners.Count,
            LoopbackConnectionCount = loopbacks.Count,
            UnexpectedHelpers = helpers.ToArray(),
            Listeners = listeners.ToArray(),
            LoopbackConnections = loopbacks.ToArray()
        };
    }
}
'@

Add-Type -TypeDefinition $monitorSource -Language CSharp

$samples = New-Object 'Collections.Generic.List[object]'
$startedAt = [DateTimeOffset]::UtcNow
$watch = [Diagnostics.Stopwatch]::StartNew()
$deadline = [TimeSpan]::FromMinutes($MaxMinutes)
$nextDueMs = [double]0
$previousAt = $null
[double]$observedMaximumGapMs = 0
$droppedSamples = 0
$scanErrors = New-Object Collections.ArrayList
$maximumHelpers = 0
$maximumListeners = 0
$maximumLoopbacks = 0
$stoppedBySignal = $false

Write-JsonAtomic $ReadyPath ([ordered]@{
    schema = "WpsHighSchoolMathNativeCapabilityMonitorReady"
    version = 1
    runId = $RunId
    startedAt = $startedAt.ToString("o")
    processId = $PID
    sampleIntervalMs = $SampleIntervalMs
})

try {
    while ($watch.Elapsed -lt $deadline) {
        $signalObserved = Test-Path -LiteralPath $StopSignalPath -PathType Leaf
        $at = [DateTimeOffset]::UtcNow
        if ($null -ne $previousAt) {
            $gap = ($at - $previousAt).TotalMilliseconds
            if ($gap -gt $observedMaximumGapMs) { $observedMaximumGapMs = $gap }
            if ($gap -le 0 -or $gap -gt 100) { $droppedSamples += 1 }
        }
        $previousAt = $at
        try {
            $snapshot = [HsmNativeProbeMonitorV1]::Capture($WriterExe, $PresentationExe)
            $maximumHelpers = [Math]::Max($maximumHelpers, $snapshot.UnexpectedHelperCount)
            $maximumListeners = [Math]::Max($maximumListeners, $snapshot.ListenerCount)
            $maximumLoopbacks = [Math]::Max($maximumLoopbacks, $snapshot.LoopbackConnectionCount)
            $samples.Add([ordered]@{
                at = $at.ToString("o")
                unexpectedHelperCount = [int]$snapshot.UnexpectedHelperCount
                listenerCount = [int]$snapshot.ListenerCount
                loopbackConnectionCount = [int]$snapshot.LoopbackConnectionCount
                wpsProcessCount = [int]$snapshot.WpsProcessCount
                unexpectedHelpers = @($snapshot.UnexpectedHelpers)
                listeners = @($snapshot.Listeners)
                loopbackConnections = @($snapshot.LoopbackConnections)
            })
        } catch {
            $droppedSamples += 1
            [void]$scanErrors.Add($_.Exception.Message)
            $maximumHelpers = [Math]::Max($maximumHelpers, 1)
            $samples.Add([ordered]@{
                at = $at.ToString("o")
                unexpectedHelperCount = 1
                listenerCount = 0
                loopbackConnectionCount = 0
                wpsProcessCount = 0
                scanError = $_.Exception.Message
            })
        }
        if ($signalObserved) {
            $stoppedBySignal = $true
            break
        }
        $nextDueMs += $SampleIntervalMs
        $remaining = [int][Math]::Floor($nextDueMs - $watch.Elapsed.TotalMilliseconds)
        if ($remaining -gt 0) { [Threading.Thread]::Sleep($remaining) }
    }
} finally {
    $endedAt = [DateTimeOffset]::UtcNow
    $coverageComplete = $stoppedBySignal -and $samples.Count -ge 2
    $continuous = $coverageComplete -and $droppedSamples -eq 0 -and $observedMaximumGapMs -le 100 -and $scanErrors.Count -eq 0
    $reportedGap = [Math]::Max(1, [int][Math]::Ceiling($observedMaximumGapMs))
    $result = [ordered]@{
        schema = "WpsHighSchoolMathNativeCapabilityMonitorEvidence"
        version = 1
        runId = $RunId
        startedAt = $startedAt.ToString("o")
        endedAt = $endedAt.ToString("o")
        continuousSampling = [bool]$continuous
        coverageComplete = [bool]$coverageComplete
        maxSampleIntervalMs = [int]$reportedGap
        requestedSampleIntervalMs = $SampleIntervalMs
        sampleCount = $samples.Count
        droppedSamples = $droppedSamples
        samples = [object[]]$samples.ToArray()
        processTree = [ordered]@{
            sampled = ($samples.Count -gt 0 -and $scanErrors.Count -eq 0)
            unexpectedHelperCount = $maximumHelpers
        }
        network = [ordered]@{
            sampled = ($samples.Count -gt 0 -and $scanErrors.Count -eq 0)
            listenerCount = $maximumListeners
            loopbackConnectionCount = $maximumLoopbacks
        }
        scanErrors = [object[]]$scanErrors.ToArray()
    }
    Write-JsonAtomic $EvidencePath $result
}

if (-not $continuous -or $maximumHelpers -ne 0 -or $maximumListeners -ne 0 -or $maximumLoopbacks -ne 0) {
    [Console]::Error.WriteLine("Native capability monitor evidence is incomplete or contains a violation: $EvidencePath")
    exit 1
}
Write-Output "Native capability monitor evidence written: $EvidencePath"
exit 0
