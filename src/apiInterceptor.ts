import * as vscode from 'vscode';
import * as https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as process from 'process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

// ── Types ────────────────────────────────────────────────────────────

export interface ProcessInfo {
    pid: number;
    extensionPort: number;
    connectPort: number;
    csrfToken: string;
}

export interface ModelQuotaInfo {
    label: string;
    modelId: string;
    remainingFraction?: number;
    remainingPercentage?: number;
    isExhausted: boolean;
    resetTime: Date;
    timeUntilReset: number;
    timeUntilResetFormatted: string;
}

export interface PromptCreditsInfo {
    available: number;
    monthly: number;
    usedPercentage: number;
    remainingPercentage: number;
}

export interface QuotaSnapshot {
    timestamp: Date;
    promptCredits?: PromptCreditsInfo;
    models: ModelQuotaInfo[];
}

// ── Process Finder ───────────────────────────────────────────────────

function getProcessName(): string {
    // Note: This function is kept for reference but we now use broader search terms
    if (process.platform === 'win32') {
        return 'language_server_windows_x64.exe';
    } else if (process.platform === 'darwin') {
        return `language_server_macos${process.arch === 'arm64' ? '_arm' : ''}`;
    } else {
        return `language_server_linux${process.arch === 'arm64' ? '_arm' : '_x64'}`;
    }
}

async function findAntigravityProcess(log: (msg: string) => void): Promise<ProcessInfo | null> {
    log(`Looking for Antigravity/Language Server processes...`);

    let candidates: ProcessCandidate[] = [];

    try {
        if (process.platform === 'win32') {
            candidates = await findProcessesWindows(log);
        } else {
            candidates = await findProcessesUnix(log);
        }
    } catch (err: any) {
        log(`Process detection failed: ${err.message}`);
        return null;
    }

    if (candidates.length === 0) {
        log('No Antigravity processes found');
        return null;
    }

    log(`Found ${candidates.length} candidate process(es). Testing connections...`);

    for (const candidate of candidates) {
        const { pid, cmdLine } = candidate;

        // Extract CSRF token and extension port - these vary by version but usually present
        const portMatch = cmdLine.match(/--extension_server_port[=\s]+(\d+)/);
        const tokenMatch = cmdLine.match(/--csrf_token[=\s]+([a-f0-9\-]+)/i);

        if (!tokenMatch || !tokenMatch[1]) {
            // log(`  Skipping PID ${pid}: CSRF token not found`); 
            continue;
        }

        const extensionPort = portMatch ? parseInt(portMatch[1], 10) : 0;
        const csrfToken = tokenMatch[1];

        log(`Checking PID ${pid} (ExtensionPort=${extensionPort})...`);

        // Find listening ports for this specific process
        let ports: number[] = [];
        try {
            if (process.platform === 'win32') {
                ports = await getListeningPortsWindows(pid, log);
            } else {
                ports = await getListeningPortsUnix(pid, log);
            }
        } catch (e: any) {
            log(`  Failed to get ports for PID ${pid}: ${e.message}`);
            continue;
        }

        if (ports.length === 0) {
            log(`  PID ${pid} has no listening ports`);
            continue;
        }

        // Test ports
        const connectPort = await findWorkingPort(ports, csrfToken, log);
        if (connectPort) {
            log(`✅ Connected using PID=${pid}, ConnectPort=${connectPort}`);
            return { pid, extensionPort, connectPort, csrfToken };
        }
    }

    log('❌ Could not connect to any Antigravity process');
    return null;
}

interface ProcessCandidate {
    pid: number;
    cmdLine: string;
}

// ── Windows Implementation ───────────────────────────────────────────

async function runPowerShellScript(script: string): Promise<string> {
    const tempDir = os.tmpdir();
    const scriptPath = path.join(tempDir, `ag_detect_${Date.now()}_${Math.random().toString(36).substring(7)}.ps1`);

    try {
        await fs.promises.writeFile(scriptPath, script, 'utf8');
        const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`;
        const { stdout } = await execAsync(cmd);
        return stdout;
    } finally {
        // Cleanup asynchronously
        fs.unlink(scriptPath, () => { });
    }
}

async function findProcessesWindows(log: (msg: string) => void): Promise<ProcessCandidate[]> {
    const scriptContent = `
$ErrorActionPreference = 'SilentlyContinue'
$candidates = @()

function Test-IsAntigravity {
    param($cl)
    if (-not $cl) { return $false }
    if ($cl -match 'antigravity') { return $true }
    if ($cl -match 'language_server') { return $true }
    if ($cl -match 'codeium') { return $true }
    return $false
}

# 1. Try CIM (modern/faster)
try {
    $procs = Get-CimInstance Win32_Process -Filter "Name like '%antigravity%' OR Name like '%language_server%'"
    foreach ($p in $procs) {
        if (Test-IsAntigravity $p.CommandLine) {
            $candidates += [PSCustomObject]@{ PID = $p.ProcessId; CmdLine = $p.CommandLine }
        }
    }
} catch {
    # 2. Fallback to WMI (if CIM unavailable)
    try {
        $procs = Get-WmiObject Win32_Process -Filter "Name like '%antigravity%' OR Name like '%language_server%'"
        foreach ($p in $procs) {
            if (Test-IsAntigravity $p.CommandLine) {
                $candidates += [PSCustomObject]@{ PID = $p.ProcessId; CmdLine = $p.CommandLine }
            }
        }
    } catch {}
}

$candidates | ConvertTo-Json -Depth 2
`;

    try {
        const output = await runPowerShellScript(scriptContent);
        if (!output.trim()) return [];

        let data: any;
        try {
            data = JSON.parse(output);
        } catch {
            // sometimes ConvertTo-Json outputs nothing or invalid multiple objects if not handled right
            return [];
        }

        const items = Array.isArray(data) ? data : [data];

        return items.map((i: any) => ({
            pid: i.PID,
            cmdLine: i.CmdLine || ''
        }));
    } catch (e: any) {
        log(`Windows process lookup failed: ${e.message}`);
        return [];
    }
}

async function getListeningPortsWindows(pid: number, log: (msg: string) => void): Promise<number[]> {
    // Method 1: PowerShell Get-NetTCPConnection (Windows 8/Server 2012+)
    const scriptContent = `
$ErrorActionPreference = 'SilentlyContinue'
Get-NetTCPConnection -OwningProcess ${pid} -State Listen | Select-Object -ExpandProperty LocalPort | ConvertTo-Json
`;

    try {
        const output = await runPowerShellScript(scriptContent);
        if (output.trim()) {
            const data = JSON.parse(output);
            let ports: number[] = [];
            if (Array.isArray(data)) {
                ports = data.map((p: any) => Number(p));
            } else {
                ports = [Number(data)];
            }
            return ports.filter(n => !isNaN(n)).sort((a, b) => a - b);
        }
    } catch {
        // Fallback to netstat below
    }

    // Method 2: netstat (Legacy/Universally available)
    try {
        const cmd = `netstat -ano`;
        const { stdout } = await execAsync(cmd);
        const ports: number[] = [];
        // Match lines ending with the PID
        // TCP    0.0.0.0:12345    0.0.0.0:0    LISTENING    1234
        const lines = stdout.split('\n');
        for (const line of lines) {
            if (line.trim().endsWith(`${pid}`)) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2 && (parts[0].startsWith('TCP') || parts[0].startsWith('UDP'))) {
                    // Extract port from local address (2nd column: 0.0.0.0:12345)
                    const localAddr = parts[1];
                    const portMsg = localAddr.split(':').pop();
                    if (portMsg) {
                        const p = parseInt(portMsg, 10);
                        if (!ports.includes(p)) ports.push(p);
                    }
                }
            }
        }
        return ports.sort((a, b) => a - b);
    } catch (e: any) {
        log(`Failed to get listening ports via netstat: ${e.message}`);
        return [];
    }
}


// ── Unix Implementation ──────────────────────────────────────────────

async function findProcessesUnix(log: (msg: string) => void): Promise<ProcessCandidate[]> {
    const candidates: ProcessCandidate[] = [];

    // Search for both 'antigravity' and 'language_server' to be safe
    const searchTerms = ['antigravity', 'language_server'];
    const processedPids = new Set<number>();

    // On MacOS, -fl provides PID and full command line.
    // On Linux, -fla provides PID and full command line.
    const flags = process.platform === 'darwin' ? '-fl' : '-fla';

    for (const term of searchTerms) {
        try {
            const cmd = `pgrep ${flags} "${term}"`;
            const { stdout } = await execAsync(cmd);
            const lines = stdout.split('\n');

            for (const line of lines) {
                if (!line.trim()) continue;

                // Output format: <pid> <command line>
                const match = line.trim().match(/^(\d+)\s+(.+)$/);
                if (match) {
                    const pid = parseInt(match[1], 10);
                    const cmdLine = match[2];

                    if (!processedPids.has(pid) && isAntigravityProcess(cmdLine)) {
                        candidates.push({ pid, cmdLine });
                        processedPids.add(pid);
                    }
                }
            }
        } catch (e) {
            // pgrep returns exit code 1 if no processes found
        }
    }

    return candidates;
}

// Helper to get ports on Unix
async function getListeningPortsUnix(pid: number, log: (msg: string) => void): Promise<number[]> {
    const portCmd = process.platform === 'darwin'
        ? `lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid}`
        : `ss -tlnp 2>/dev/null | grep "pid=${pid}" || lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null`;

    try {
        const { stdout: portOut } = await execAsync(portCmd);
        const ports: number[] = [];

        // Match lsof format: ... TCP *:12345 (LISTEN)
        const lsofRegex = /(?:TCP|UDP)\s+(?:.*?):(\d+)\s+\(LISTEN\)/gi;
        let match;
        while ((match = lsofRegex.exec(portOut)) !== null) {
            const p = parseInt(match[1], 10);
            if (!ports.includes(p)) ports.push(p);
        }

        // Match ss format: ... 127.0.0.1:12345 ...
        // Note: ss output for `ss -tlnp` looks like: 
        // LISTEN 0 128 127.0.0.1:12345 0.0.0.0:* users:(("name",pid=123,fd=4))
        const ssRegex = /(?:127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\*):(\d+)/g;
        while ((match = ssRegex.exec(portOut)) !== null) {
            const p = parseInt(match[1], 10);
            if (!ports.includes(p)) ports.push(p);
        }

        return ports.sort((a, b) => a - b);
    } catch {
        return [];
    }
}

function isAntigravityProcess(commandLine: string): boolean {
    const lower = commandLine.toLowerCase();

    // Check for specific arguments that indicate it's the right process
    if (/--app_data_dir\s+antigravity\b/i.test(commandLine)) { return true; }

    // Also check for path segments if arg check fails (fallback)
    if (lower.includes('\\antigravity\\') || lower.includes('/antigravity/')) { return true; }

    return false;
}


async function findWorkingPort(ports: number[], csrfToken: string, log: (msg: string) => void): Promise<number | null> {
    for (const port of ports) {
        const ok = await testPort(port, csrfToken);
        if (ok) {
            return port;
        }
        log(`Port ${port} did not respond`);
    }
    return null;
}

function testPort(port: number, csrfToken: string): Promise<boolean> {
    return new Promise(resolve => {
        const options: https.RequestOptions = {
            hostname: '127.0.0.1',
            port,
            path: '/exa.language_server_pb.LanguageServerService/GetUnleashData',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Codeium-Csrf-Token': csrfToken,
                'Connect-Protocol-Version': '1',
            },
            rejectUnauthorized: false,
            timeout: 5000,
        };

        const req = https.request(options, res => {
            let body = '';
            res.on('data', chunk => (body += chunk));
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try { JSON.parse(body); resolve(true); } catch { resolve(false); }
                } else {
                    resolve(false);
                }
            });
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.write(JSON.stringify({ wrapper_data: {} }));
        req.end();
    });
}

// ── Quota Fetcher ────────────────────────────────────────────────────

function fetchQuota(port: number, csrfToken: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            metadata: {
                ideName: 'antigravity',
                extensionName: 'antigravity',
                locale: 'en',
            },
        });

        const options: https.RequestOptions = {
            hostname: '127.0.0.1',
            port,
            path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'Connect-Protocol-Version': '1',
                'X-Codeium-Csrf-Token': csrfToken,
            },
            rejectUnauthorized: false,
            timeout: 5000,
        };

        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => (data += chunk));
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { reject(new Error('Invalid JSON response')); }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(body);
        req.end();
    });
}

function parseQuotaResponse(data: any): QuotaSnapshot {
    const userStatus = data.userStatus || {};
    const planInfo = userStatus.planStatus?.planInfo;
    const availableCredits = userStatus.planStatus?.availablePromptCredits;

    let promptCredits: PromptCreditsInfo | undefined;
    if (planInfo && availableCredits !== undefined) {
        const monthly = Number(planInfo.monthlyPromptCredits);
        const available = Number(availableCredits);
        if (monthly > 0) {
            promptCredits = {
                available,
                monthly,
                usedPercentage: ((monthly - available) / monthly) * 100,
                remainingPercentage: (available / monthly) * 100,
            };
        }
    }

    const rawModels = userStatus.cascadeModelConfigData?.clientModelConfigs || [];
    const models: ModelQuotaInfo[] = rawModels
        .filter((m: any) => m.quotaInfo)
        .map((m: any) => {
            const resetTime = new Date(m.quotaInfo.resetTime);
            const now = new Date();
            const diff = resetTime.getTime() - now.getTime();

            return {
                label: m.label || 'Unknown',
                modelId: m.modelOrAlias?.model || 'unknown',
                remainingFraction: m.quotaInfo.remainingFraction,
                remainingPercentage: m.quotaInfo.remainingFraction !== undefined
                    ? m.quotaInfo.remainingFraction * 100
                    : undefined,
                isExhausted: m.quotaInfo.remainingFraction === 0,
                resetTime,
                timeUntilReset: diff,
                timeUntilResetFormatted: formatResetTime(diff, resetTime),
            };
        });

    return { timestamp: new Date(), promptCredits, models };
}

function formatResetTime(ms: number, resetTime: Date): string {
    if (ms <= 0) { return 'Ready'; }
    const mins = Math.ceil(ms / 60000);
    let duration: string;
    if (mins < 60) {
        duration = `${mins}m`;
    } else {
        const hours = Math.floor(mins / 60);
        duration = `${hours}h ${mins % 60}m`;
    }
    const dateStr = resetTime.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = resetTime.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${duration} (${dateStr} ${timeStr})`;
}

// ── Main Service ─────────────────────────────────────────────────────

export class QuotaService {
    private _outputChannel: vscode.OutputChannel;
    private _processInfo: ProcessInfo | null = null;
    private _pollingTimer?: NodeJS.Timeout;
    private _onUpdate = new vscode.EventEmitter<QuotaSnapshot>();
    private _onError = new vscode.EventEmitter<Error>();
    public readonly onUpdate = this._onUpdate.event;
    public readonly onError = this._onError.event;
    private _lastSnapshot?: QuotaSnapshot;
    private _consecutiveFailures = 0;

    constructor() {
        this._outputChannel = vscode.window.createOutputChannel('AG Monitor');
    }

    get lastSnapshot(): QuotaSnapshot | undefined {
        return this._lastSnapshot;
    }

    /**
     * Detect the Antigravity language server process and start polling.
     */
    async initialize(): Promise<boolean> {
        this._log('Initializing — detecting Antigravity language server...');
        this._processInfo = await findAntigravityProcess(msg => this._log(msg));

        if (!this._processInfo) {
            this._log('❌ Antigravity language server not found');
            this._onError.fire(new Error('Antigravity language server not found. Is Antigravity running?'));
            return false;
        }

        this._log(`✅ Connected: port=${this._processInfo.connectPort}`);
        return true;
    }

    /**
     * Start polling the language server for quota data.
     */
    startPolling(intervalMs: number = 30_000): void {
        this.stopPolling();
        this._fetchAndEmit();
        this._pollingTimer = setInterval(() => this._fetchAndEmit(), intervalMs);
        this._log(`Polling started (every ${intervalMs / 1000}s)`);
    }

    stopPolling(): void {
        if (this._pollingTimer) {
            clearInterval(this._pollingTimer);
            this._pollingTimer = undefined;
        }
    }

    async refresh(): Promise<void> {
        await this._fetchAndEmit();
    }

    private async _fetchAndEmit(): Promise<void> {
        if (!this._processInfo) {
            // Not initialized yet — try to connect
            await this._reconnect();
            return;
        }

        try {
            const raw = await fetchQuota(this._processInfo.connectPort, this._processInfo.csrfToken);
            this._consecutiveFailures = 0;
            const snapshot = parseQuotaResponse(raw);
            this._lastSnapshot = snapshot;
            this._onUpdate.fire(snapshot);
        } catch (err: any) {
            this._consecutiveFailures++;
            const isConnectionError = err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' ||
                err.code === 'ETIMEDOUT' || err.message?.includes('timeout') ||
                err.message?.includes('socket hang up');

            if (isConnectionError) {
                this._log(`Connection lost (${err.code || err.message}) — attempting reconnect...`);
                const reconnected = await this._reconnect();
                if (reconnected) {
                    // Retry the fetch immediately with new connection info
                    try {
                        const raw = await fetchQuota(this._processInfo!.connectPort, this._processInfo!.csrfToken);
                        this._consecutiveFailures = 0;
                        const snapshot = parseQuotaResponse(raw);
                        this._lastSnapshot = snapshot;
                        this._onUpdate.fire(snapshot);
                        return;
                    } catch (retryErr: any) {
                        this._log(`Retry after reconnect also failed: ${retryErr.message}`);
                    }
                }
            } else {
                this._log(`Fetch error: ${err.message}`);
            }

            this._onError.fire(err);
        }
    }

    /**
     * Re-detect the language server process (port may have changed).
     */
    private async _reconnect(): Promise<boolean> {
        this._log('Reconnecting — re-detecting language server...');
        this._processInfo = await findAntigravityProcess(msg => this._log(msg));

        if (this._processInfo) {
            this._log(`✅ Reconnected: port=${this._processInfo.connectPort}`);
            return true;
        } else {
            this._log('❌ Reconnect failed — language server not found');
            return false;
        }
    }

    private _log(msg: string): void {
        this._outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
    }

    dispose(): void {
        this.stopPolling();
        this._onUpdate.dispose();
        this._onError.dispose();
        this._outputChannel.dispose();
    }
}
