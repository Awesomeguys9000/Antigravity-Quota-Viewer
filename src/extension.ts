import * as vscode from 'vscode';
import { QuotaService, QuotaSnapshot } from './apiInterceptor';
import { UsageTracker } from './usageTracker';
import { SidebarProvider } from './sidebarProvider';
import { MODEL_GROUPS, getGroupConfig, getGroupForModel, getWorstRemainingInGroup, getTrafficLight, getTrafficEmoji, groupModels } from './modelGroups';

// ── Status Bar Items ─────────────────────────────────────────────────

interface GroupStatusBarItem {
    groupId: string;
    item: vscode.StatusBarItem;
}

let globalStatusBarItem: vscode.StatusBarItem;
let groupStatusBarItems: GroupStatusBarItem[] = [];

// ── Activation ───────────────────────────────────────────────────────

export async function activate(context: vscode.ExtensionContext) {
    console.log('[AG Monitor] Extension activating...');

    const tracker = new UsageTracker(context.globalState);
    const quotaService = new QuotaService();
    const sidebarProvider = new SidebarProvider(context.extensionUri, quotaService);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider)
    );

    // ── Global Status Bar Item ───────────────────────────────────────
    globalStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 200);
    globalStatusBarItem.command = 'agmonitor.showDashboard';
    globalStatusBarItem.tooltip = 'AG Monitor — Click to open dashboard';
    globalStatusBarItem.text = '$(sync~spin) AG Monitor...';
    globalStatusBarItem.show();
    context.subscriptions.push(globalStatusBarItem);

    // ── Per-Group Status Bar Items ───────────────────────────────────
    createGroupStatusBarItems(context);

    // ── Listen for quota updates ─────────────────────────────────────
    quotaService.onUpdate(snapshot => {
        tracker.recordSnapshot(snapshot);
        updateStatusBar(snapshot);
        sidebarProvider.pushUpdate(snapshot);
    });

    quotaService.onError(err => {
        globalStatusBarItem.text = '$(warning) AG Monitor: Error';
        globalStatusBarItem.tooltip = `AG Monitor Error: ${err.message}`;
    });

    // ── Commands ─────────────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('agmonitor.showDashboard', () => {
            vscode.commands.executeCommand('agmonitor.dashboard.focus');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agmonitor.logUsage', async () => {
            // Manual refresh
            vscode.window.showInformationMessage('AG Monitor: Refreshing quota...');
            await quotaService.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agmonitor.resetUsage', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Reset AG Monitor history data?',
                { modal: true },
                'Reset'
            );
            if (confirm === 'Reset') {
                tracker.resetHistory();
                vscode.window.showInformationMessage('AG Monitor: History cleared.');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agmonitor.exportUsage', async () => {
            const json = tracker.exportToJson();
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file('agmonitor-history.json'),
                filters: { 'JSON': ['json'] },
            });
            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf-8'));
                vscode.window.showInformationMessage(`AG Monitor: History exported to ${uri.fsPath}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agmonitor.toggleModelGroup', async () => {
            const items = MODEL_GROUPS.map(g => {
                const config = getGroupConfig(g.id);
                return {
                    label: `${g.icon} ${g.name}`,
                    description: config.enabled ? '✅ Visible' : '❌ Hidden',
                    groupId: g.id,
                    picked: config.enabled,
                };
            });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Toggle model group visibility',
                title: 'AG Monitor: Toggle Model Groups',
                canPickMany: true,
            });

            if (selected) {
                const config = vscode.workspace.getConfiguration('agmonitor');
                const groups = config.get<Record<string, any>>('modelGroups', {});
                for (const g of MODEL_GROUPS) {
                    if (groups[g.id]) {
                        groups[g.id].enabled = selected.some(s => s.groupId === g.id);
                    }
                }
                await config.update('modelGroups', groups, vscode.ConfigurationTarget.Global);
                recreateGroupStatusBarItems(context);
                if (quotaService.lastSnapshot) {
                    updateStatusBar(quotaService.lastSnapshot);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('agmonitor.refreshStatusBar', () => {
            recreateGroupStatusBarItems(context);
            if (quotaService.lastSnapshot) {
                updateStatusBar(quotaService.lastSnapshot);
            }
        })
    );

    // Watch for config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('agmonitor')) {
                recreateGroupStatusBarItems(context);
                if (quotaService.lastSnapshot) {
                    updateStatusBar(quotaService.lastSnapshot);
                }
            }
        })
    );

    // Clean up
    context.subscriptions.push({
        dispose: () => {
            quotaService.dispose();
            sidebarProvider.dispose();
            disposeGroupStatusBarItems();
        },
    });

    // ── Start the quota service ──────────────────────────────────────
    const connected = await quotaService.initialize();
    if (connected) {
        quotaService.startPolling(30_000); // Poll every 30 seconds
        globalStatusBarItem.text = '$(pulse) AG Monitor';
        console.log('[AG Monitor] Connected to language server, polling started');
    } else {
        globalStatusBarItem.text = '$(warning) AG Monitor: Not connected';
        globalStatusBarItem.tooltip = 'AG Monitor — Language server not found. Is Antigravity running?';
        vscode.window.showWarningMessage(
            'AG Monitor: Could not find Antigravity language server. Make sure Antigravity is running.',
            'Retry'
        ).then(action => {
            if (action === 'Retry') {
                vscode.commands.executeCommand('agmonitor.logUsage');
            }
        });
    }

    console.log('[AG Monitor] Extension activated');
}

// ── Status Bar Helpers ───────────────────────────────────────────────

function createGroupStatusBarItems(context: vscode.ExtensionContext): void {
    let priority = 199;
    for (const group of MODEL_GROUPS) {
        const config = getGroupConfig(group.id);
        if (!config.enabled) { continue; }

        const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, priority--);
        item.command = 'agmonitor.showDashboard';
        item.tooltip = `${group.name} model group — Click to open dashboard`;
        context.subscriptions.push(item);
        groupStatusBarItems.push({ groupId: group.id, item });
    }
}

function recreateGroupStatusBarItems(context: vscode.ExtensionContext): void {
    disposeGroupStatusBarItems();
    createGroupStatusBarItems(context);
}

function disposeGroupStatusBarItems(): void {
    for (const g of groupStatusBarItems) {
        g.item.dispose();
    }
    groupStatusBarItems = [];
}

function updateStatusBar(snapshot: QuotaSnapshot): void {
    const grouped = groupModels(snapshot.models);

    // Global item — show prompt credits if available
    if (snapshot.promptCredits) {
        const pct = Math.round(snapshot.promptCredits.remainingPercentage);
        globalStatusBarItem.text = `$(pulse) Credits: ${pct}% · ${snapshot.models.length} models`;
    } else {
        globalStatusBarItem.text = `$(pulse) AG Monitor · ${snapshot.models.length} models`;
    }
    globalStatusBarItem.show();

    // Per-group items
    for (const gItem of groupStatusBarItems) {
        const models = grouped.get(gItem.groupId);
        if (!models || models.length === 0) {
            gItem.item.text = `${getTrafficEmoji('green')} ${getGroupLabel(gItem.groupId)}: --`;
            gItem.item.show();
            continue;
        }

        const worstPct = getWorstRemainingInGroup(models);
        const config = getGroupConfig(gItem.groupId);
        const light = getTrafficLight(worstPct, config.limits);
        const emoji = getTrafficEmoji(light);
        const label = getGroupLabel(gItem.groupId);

        gItem.item.text = `${emoji} ${label}: ${Math.round(worstPct)}%`;

        // Build tooltip: shared reset time at top, models listed below
        const sharedReset = models[0]?.timeUntilResetFormatted ?? 'Unknown';
        const modelLines = models.map(m =>
            `  • ${m.label}: ${m.remainingPercentage !== undefined ? Math.round(m.remainingPercentage) + '%' : '?'}`
        ).join('\n');
        gItem.item.tooltip = `${label} — ${Math.round(worstPct)}% remaining\nResets in: ${sharedReset}\n\nModels:\n${modelLines}`;

        // Colour the background
        if (light === 'red') {
            gItem.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else if (light === 'yellow') {
            gItem.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            gItem.item.backgroundColor = undefined;
        }

        gItem.item.show();
    }
}

function getGroupLabel(groupId: string): string {
    const group = MODEL_GROUPS.find(g => g.id === groupId);
    return group?.name ?? groupId;
}

export function deactivate() {
    disposeGroupStatusBarItems();
}
