# Antigravity Quota Viewer

A VS Code extension that monitors your Google Antigravity AI model usage quota in real-time, displaying traffic-light indicators in the status bar and a detailed dashboard in the sidebar.

![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.85.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## How It Works

This extension connects to the **local Antigravity language server** running on your machine. It:

1. **Detects** the `language_server` process and extracts connection parameters (port + CSRF token)
2. **Queries** the `GetUserStatus` gRPC API endpoint at `127.0.0.1`
3. **Parses** per-model `remainingFraction`, reset timers, and prompt credits
4. **Displays** live quota data in both the status bar and a sidebar dashboard

No API keys are needed — the extension reads directly from Antigravity's own language server.

## Features

### 🚦 Traffic Light Status Bar
Per-group status bar indicators that change color based on remaining quota:
- 🟢 **Green** — Quota healthy (above 40%)
- 🟡 **Yellow** — Quota getting low (20%–40%)
- 🔴 **Red** — Quota critical (below 20%)

Thresholds are fully customizable.

### 📊 Sidebar Dashboard
- **Prompt Credits** card showing total available vs. monthly allocation
- **Model Groups** (Premium, Pro, Flash) with quota bars and traffic lights
- **Per-model detail** rows showing remaining % and reset countdown
- **Collapsible "All Models"** section for full visibility

### 🔄 Auto-Refresh
Polls the language server every 30 seconds. Manual refresh available via the ⟳ button or command palette.

### 🎯 Model Groups
Models are automatically categorized into three groups:

| Group | Models | Icon |
|-------|--------|------|
| **Premium** | Claude Opus, Sonnet, GPT-OSS | 💎 |
| **Pro** | Gemini 3 Pro variants | ⚡ |
| **Flash** | Gemini 3 Flash variants | 🔥 |

## Installation

### From VSIX (Recommended)
1. Download the latest `.vsix` from [Releases](https://github.com/Awesomeguys9000/Antigravity-Quota-Viewer/releases)
2. In VS Code/Antigravity: `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. Select the downloaded file and reload

### Build from Source
```bash
git clone https://github.com/Awesomeguys9000/Antigravity-Quota-Viewer.git
cd Antigravity-Quota-Viewer
npm install
npm run compile
npx @vscode/vsce package --no-dependencies --allow-missing-repository
```

## Commands

| Command | Description |
|---------|-------------|
| `AG Monitor: Show Dashboard` | Open the sidebar dashboard |
| `AG Monitor: Refresh` | Force a quota refresh |
| `AG Monitor: Reset History` | Clear stored snapshot history |
| `AG Monitor: Export History` | Export history as JSON |
| `AG Monitor: Toggle Model Groups` | Show/hide model groups in status bar |

## Configuration

Configure via `Settings → Extensions → AG Monitor`:

| Setting | Default | Description |
|---------|---------|-------------|
| `agmonitor.modelGroups` | `{}` | Per-group visibility and threshold overrides |
| `agmonitor.modelGroups.{id}.enabled` | `true` | Show/hide a model group |
| `agmonitor.modelGroups.{id}.limits.yellow` | `40` | % threshold for yellow status |
| `agmonitor.modelGroups.{id}.limits.red` | `20` | % threshold for red status |

## Platform Support

| Platform | Process Detection | Port Discovery |
|----------|------------------|----------------|
| **Windows** | PowerShell `Get-CimInstance` (WMIC fallback) | `Get-NetTCPConnection` (netstat fallback) |
| **macOS** | `pgrep -fl` | `lsof` |
| **Linux** | `pgrep -af` | `ss` / `lsof` |

## Privacy & Security

- All communication is **local only** (`127.0.0.1`) — no external network requests
- No API keys are stored or transmitted
- Uses nonces for webview script injection (CSP)
- Only reads quota status; does not modify any Antigravity settings

## Credits & Sources

This extension was built with significant reference to the following open-source projects, which pioneered the approach of querying Antigravity's local language server:

- **[AntigravityQuota](https://github.com/Henrik-3/AntigravityQuota)** by Henrik-3 — Process detection strategy, platform command patterns, and the `GetUserStatus` API usage were directly referenced from this project
- **[AntigravityQuotaWatcher](https://github.com/wusimpl/AntigravityQuotaWatcher)** by wusimpl — Original research into the language server API that Henrik-3's project built upon
- **[antigravity-panel](https://github.com/n2ns/antigravity-panel)** by n2ns (Toolkit for Antigravity) — Dashboard design patterns and quota grouping concepts

The language server API endpoint (`/exa.language_server_pb.LanguageServerService/GetUserStatus`) and CSRF token authentication were documented by the community in these projects.

### Tools Used
- [VS Code Extension API](https://code.visualstudio.com/api)
- [TypeScript](https://www.typescriptlang.org/)
- [@vscode/vsce](https://github.com/microsoft/vscode-vsce) for packaging
- Built with assistance from **Google Antigravity** AI coding assistant

## Disclaimer

This extension is not affiliated with, endorsed by, or officially connected to Google or the Antigravity project. It interacts with a locally running process and does not access any remote Google services directly.

## License

MIT
