const https = require('https');
const { execSync } = require('child_process');

function runPowerShellScript(script) {
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`;
    return execSync(cmd, { encoding: 'utf8' });
}

async function getProcessInfo() {
    const script = `
        $procs = Get-CimInstance Win32_Process -Filter "Name like '%antigravity%' OR Name like '%language_server%'"
        foreach ($p in $procs) {
            if ($p.CommandLine -match 'antigravity') {
                [PSCustomObject]@{ PID = $p.ProcessId; CmdLine = $p.CommandLine }
            }
        }
    `;
    const output = runPowerShellScript(script);
    const matches = output.match(/PID\s*:\s*(\d+)/g);
    if (!matches) return null;
    
    // We already know from the user's log that PID=51472 and connectPort=65386.
    // However, the port might have changed. Let's extract the CSRF token.
    const tokenMatch = output.match(/--csrf_token[=\s]+([a-f0-9\-]+)/i);
    const csrfToken = tokenMatch ? tokenMatch[1] : null;

    if (!csrfToken) return null;

    // Get listening ports for all Antigravity processes
    const pids = [...new Set(matches.map(m => m.match(/(\d+)/)[1]))];
    
    for (const pid of pids) {
        const netstat = execSync('netstat -ano', { encoding: 'utf8' });
        const lines = netstat.split('\n');
        for (const line of lines) {
            if (line.trim().endsWith(pid)) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2 && parts[0] === 'TCP') {
                    const portMsg = parts[1].split(':').pop();
                    if (portMsg) {
                        const port = parseInt(portMsg, 10);
                        const ok = await testPort(port, csrfToken);
                        if (ok) return { port, csrfToken };
                    }
                }
            }
        }
    }
    return null;
}

function testPort(port, csrfToken) {
    return new Promise(resolve => {
        const options = {
            hostname: '127.0.0.1', port, path: '/exa.language_server_pb.LanguageServerService/GetUserStatus', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'X-Codeium-Csrf-Token': csrfToken },
            rejectUnauthorized: false, timeout: 1000,
        };
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(res.statusCode === 200));
        });
        req.on('error', () => resolve(false));
        req.write(JSON.stringify({ metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' } }));
        req.end();
    });
}

function fetchQuota(port, csrfToken) {
    return new Promise(resolve => {
        const options = {
            hostname: '127.0.0.1', port, path: '/exa.language_server_pb.LanguageServerService/GetUserStatus', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'X-Codeium-Csrf-Token': csrfToken },
            rejectUnauthorized: false
        };
        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.write(JSON.stringify({ metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' } }));
        req.end();
    });
}

(async () => {
    try {
        const info = await getProcessInfo();
        if (!info) {
            console.log("Could not find language server");
            return;
        }
        console.log("Found LS on port " + info.port);
        const data = await fetchQuota(info.port, info.csrfToken);
        console.log(JSON.stringify(data.userStatus.planStatus, null, 2));
    } catch (e) {
        console.error(e);
    }
})();
