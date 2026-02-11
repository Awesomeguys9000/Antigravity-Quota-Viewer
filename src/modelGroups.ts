import * as vscode from 'vscode';
import type { ModelQuotaInfo } from './apiInterceptor';

// ── Model Group Definitions ──────────────────────────────────────────

export interface ModelGroup {
    id: string;
    name: string;
    /** Substrings to match against server model labels (case-insensitive) */
    labelPatterns: string[];
    icon: string;
    color: string;
}

export const MODEL_GROUPS: ModelGroup[] = [
    {
        id: 'premium',
        name: 'Premium',
        labelPatterns: [
            'opus', 'sonnet', 'gpt-oss', 'gpt oss', '120b',
        ],
        icon: '💎',
        color: '#a78bfa', // purple
    },
    {
        id: 'pro',
        name: 'Pro',
        labelPatterns: [
            'gemini 3 pro', 'gemini-3-pro', 'pro (high', 'pro (low',
        ],
        icon: '⚡',
        color: '#60a5fa', // blue
    },
    {
        id: 'flash',
        name: 'Flash',
        labelPatterns: [
            'flash', 'gemini 3 flash', 'gemini-3-flash',
        ],
        icon: '🔥',
        color: '#34d399', // green
    },
];

// ── Group Classification ─────────────────────────────────────────────

/**
 * Determines which group a server model belongs to.
 */
export function getGroupForModel(label: string): ModelGroup | undefined {
    const lower = label.toLowerCase().trim();
    for (const group of MODEL_GROUPS) {
        for (const pattern of group.labelPatterns) {
            if (lower.includes(pattern.toLowerCase())) {
                return group;
            }
        }
    }
    return undefined;
}

/**
 * Groups server model quota info by our model group categories.
 * Each group takes the WORST (lowest) remaining fraction among its models.
 */
export function groupModels(models: ModelQuotaInfo[]): Map<string, ModelQuotaInfo[]> {
    const grouped = new Map<string, ModelQuotaInfo[]>();
    for (const model of models) {
        const group = getGroupForModel(model.label);
        const groupId = group?.id ?? 'other';
        if (!grouped.has(groupId)) {
            grouped.set(groupId, []);
        }
        grouped.get(groupId)!.push(model);
    }
    return grouped;
}

/**
 * Finds the worst (lowest) remaining percentage across models in a group.
 */
export function getWorstRemainingInGroup(models: ModelQuotaInfo[]): number {
    let worst = 100;
    for (const m of models) {
        if (m.remainingPercentage !== undefined && m.remainingPercentage < worst) {
            worst = m.remainingPercentage;
        }
    }
    return worst;
}

// ── Traffic Light Logic ──────────────────────────────────────────────

export type TrafficLight = 'green' | 'yellow' | 'red';

export interface TrafficThresholds {
    yellow: number; // Percentage below which → yellow (default: 40)
    red: number;    // Percentage below which → red (default: 20)
}

/**
 * Determines traffic light status based on remaining percentage.
 */
export function getTrafficLight(remainingPct: number, thresholds?: TrafficThresholds): TrafficLight {
    const t = thresholds ?? { yellow: 40, red: 20 };
    if (remainingPct <= t.red) { return 'red'; }
    if (remainingPct <= t.yellow) { return 'yellow'; }
    return 'green';
}

export function getTrafficEmoji(light: TrafficLight): string {
    switch (light) {
        case 'green': return '🟢';
        case 'yellow': return '🟡';
        case 'red': return '🔴';
    }
}

// ── Config Helpers ───────────────────────────────────────────────────

export function getGroupConfig(groupId: string): { enabled: boolean; limits: TrafficThresholds } {
    const config = vscode.workspace.getConfiguration('agmonitor');
    const groups = config.get<Record<string, { enabled: boolean; limits: TrafficThresholds }>>('modelGroups', {});
    const groupConf = groups[groupId];
    if (groupConf) {
        return {
            enabled: groupConf.enabled !== false,
            limits: {
                yellow: groupConf.limits?.yellow ?? 40,
                red: groupConf.limits?.red ?? 20,
            },
        };
    }
    return { enabled: true, limits: { yellow: 40, red: 20 } };
}
