/**
 * Usage Tracker — thin persistence layer.
 * 
 * With the language server API providing real-time quota data,
 * this module now only persists snapshots for history/analytics.
 */

import * as vscode from 'vscode';
import type { QuotaSnapshot } from './apiInterceptor';

const STORAGE_KEY = 'agmonitor.snapshotHistory';
const MAX_HISTORY = 500;

export interface StoredSnapshot {
    timestamp: string;
    models: Array<{
        label: string;
        modelId: string;
        remainingPercentage?: number;
        isExhausted: boolean;
        resetTime: string;
    }>;
    promptCredits?: {
        available: number;
        monthly: number;
    };
}

export class UsageTracker {
    private _history: StoredSnapshot[] = [];

    constructor(private readonly _globalState: vscode.Memento) {
        this._history = this._globalState.get<StoredSnapshot[]>(STORAGE_KEY, []);
    }

    /**
     * Store a quota snapshot for historical tracking.
     */
    recordSnapshot(snapshot: QuotaSnapshot): void {
        const stored: StoredSnapshot = {
            timestamp: snapshot.timestamp.toISOString(),
            models: snapshot.models.map(m => ({
                label: m.label,
                modelId: m.modelId,
                remainingPercentage: m.remainingPercentage,
                isExhausted: m.isExhausted,
                resetTime: m.resetTime.toISOString(),
            })),
            promptCredits: snapshot.promptCredits
                ? { available: snapshot.promptCredits.available, monthly: snapshot.promptCredits.monthly }
                : undefined,
        };

        this._history.push(stored);

        // Trim history
        if (this._history.length > MAX_HISTORY) {
            this._history = this._history.slice(-MAX_HISTORY);
        }

        this._persist();
    }

    getHistory(): StoredSnapshot[] {
        return [...this._history];
    }

    resetHistory(): void {
        this._history = [];
        this._persist();
    }

    exportToJson(): string {
        return JSON.stringify(this._history, null, 2);
    }

    private _persist(): void {
        this._globalState.update(STORAGE_KEY, this._history);
    }
}
