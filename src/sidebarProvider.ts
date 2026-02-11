import * as vscode from 'vscode';
import type { QuotaService, QuotaSnapshot } from './apiInterceptor';
import { MODEL_GROUPS, getGroupConfig, getTrafficLight, getTrafficEmoji, groupModels, getWorstRemainingInGroup } from './modelGroups';

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'agmonitor.dashboard';
    private _view?: vscode.WebviewView;
    private _disposables: vscode.Disposable[] = [];
    private _lastSnapshot?: QuotaSnapshot;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _quotaService: QuotaService,
    ) { }

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'media')],
        };

        webviewView.webview.html = this._getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'ready':
                    if (this._lastSnapshot) {
                        this._sendUpdate(this._lastSnapshot);
                    }
                    break;
                case 'toggleGroup':
                    this._toggleGroup(message.groupId);
                    break;
                case 'updateThresholds':
                    this._updateThresholds(message.groupId, message.yellow, message.red);
                    break;
                case 'refresh':
                    this._quotaService.refresh();
                    break;
            }
        }, undefined, this._disposables);
    }

    /**
     * Called by extension.ts when a new quota snapshot arrives.
     */
    pushUpdate(snapshot: QuotaSnapshot): void {
        this._lastSnapshot = snapshot;
        if (this._view?.visible) {
            this._sendUpdate(snapshot);
        }
    }

    private _sendUpdate(snapshot: QuotaSnapshot): void {
        if (!this._view) { return; }

        const grouped = groupModels(snapshot.models);
        const groupData = MODEL_GROUPS.map(g => {
            const models = grouped.get(g.id) || [];
            const config = getGroupConfig(g.id);
            const worstPct = getWorstRemainingInGroup(models);
            const light = getTrafficLight(worstPct, config.limits);

            return {
                id: g.id,
                name: g.name,
                color: g.color,
                enabled: config.enabled,
                light,
                worstPct: Math.round(worstPct),
                models: models.map(m => ({
                    label: m.label,
                    modelId: m.modelId,
                    remainingPct: m.remainingPercentage !== undefined ? Math.round(m.remainingPercentage) : null,
                    isExhausted: m.isExhausted,
                    resetFormatted: m.timeUntilResetFormatted,
                    timeUntilResetMs: m.timeUntilReset,
                })),
            };
        });

        this._view.webview.postMessage({
            command: 'update',
            timestamp: snapshot.timestamp.toISOString(),
            promptCredits: snapshot.promptCredits,
            groups: groupData,
            allModels: snapshot.models.map(m => ({
                label: m.label,
                modelId: m.modelId,
                remainingPct: m.remainingPercentage !== undefined ? Math.round(m.remainingPercentage) : null,
                isExhausted: m.isExhausted,
                resetFormatted: m.timeUntilResetFormatted,
            })),
        });
    }

    private async _toggleGroup(groupId: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('agmonitor');
        const groups = config.get<Record<string, any>>('modelGroups', {});
        if (groups[groupId]) {
            groups[groupId].enabled = !groups[groupId].enabled;
        }
        await config.update('modelGroups', groups, vscode.ConfigurationTarget.Global);
        if (this._lastSnapshot) { this._sendUpdate(this._lastSnapshot); }
        vscode.commands.executeCommand('agmonitor.refreshStatusBar');
    }

    private async _updateThresholds(groupId: string, yellow: number, red: number): Promise<void> {
        const config = vscode.workspace.getConfiguration('agmonitor');
        const groups = config.get<Record<string, any>>('modelGroups', {});
        if (groups[groupId]) {
            groups[groupId].limits = { yellow, red };
        }
        await config.update('modelGroups', groups, vscode.ConfigurationTarget.Global);
        if (this._lastSnapshot) { this._sendUpdate(this._lastSnapshot); }
    }

    private _getHtml(webview: vscode.Webview): string {
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'sidebar.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'sidebar.js'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link rel="stylesheet" href="${cssUri}">
    <title>AG Monitor</title>
</head>
<body>
    <div id="root">
        <div class="loading">
            <div class="loading-spinner"></div>
            <p>Connecting to Antigravity...</p>
        </div>
    </div>
    <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
    }

    dispose(): void {
        for (const d of this._disposables) { d.dispose(); }
    }
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}
