/* AG Monitor — Sidebar Dashboard */
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();
    let currentData = null;

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.command === 'update') {
            currentData = message;
            render(message);
        }
    });

    // Tell the extension we're ready
    vscode.postMessage({ command: 'ready' });

    function render(data) {
        const root = document.getElementById('root');
        if (!root) return;

        root.innerHTML = '';

        // Header
        const header = el('div', 'header');
        header.innerHTML = `
            <h2>AG Monitor</h2>
            <button class="refresh-btn" title="Refresh now">⟳</button>
        `;
        header.querySelector('.refresh-btn').addEventListener('click', () => {
            vscode.postMessage({ command: 'refresh' });
        });
        root.appendChild(header);

        // Prompt Credits Card
        if (data.promptCredits) {
            const pc = data.promptCredits;
            const card = el('div', 'credits-card');
            card.innerHTML = `
                <div class="credits-label">Prompt Credits</div>
                <div class="credits-value">${pc.available.toLocaleString()} / ${pc.monthly.toLocaleString()}</div>
                <div class="quota-bar">
                    <div class="quota-bar-fill" style="width: ${pc.remainingPercentage}%; background: var(--ag-accent);"></div>
                </div>
                <div class="credits-pct">${Math.round(pc.remainingPercentage)}% remaining</div>
            `;
            root.appendChild(card);
        }

        // Group Panels
        const groupsContainer = el('div', 'groups-container');
        for (const group of data.groups) {
            if (!group.enabled) continue;
            groupsContainer.appendChild(renderGroup(group));
        }
        root.appendChild(groupsContainer);

        // All Models Detail (collapsible)
        if (data.allModels && data.allModels.length > 0) {
            const section = el('div', 'section collapsible');
            const sectionHeader = el('div', 'section-header');
            sectionHeader.innerHTML = `<span class="collapse-arrow">▶</span> All Models (${data.allModels.length})`;
            sectionHeader.addEventListener('click', () => {
                section.classList.toggle('open');
            });
            section.appendChild(sectionHeader);

            const sectionBody = el('div', 'section-body');
            for (const model of data.allModels) {
                const row = el('div', 'model-row');
                const pct = model.remainingPct !== null ? model.remainingPct : '?';
                const exhaustedClass = model.isExhausted ? ' exhausted' : '';
                row.innerHTML = `
                    <div class="model-label${exhaustedClass}">${model.label}</div>
                    <div class="model-pct">${pct}%</div>
                `;
                sectionBody.appendChild(row);
            }
            section.appendChild(sectionBody);
            root.appendChild(section);
        }

        // Last updated
        const footer = el('div', 'footer');
        const ts = new Date(data.timestamp);
        footer.textContent = `Updated: ${ts.toLocaleTimeString()}`;
        root.appendChild(footer);
    }

    function renderGroup(group) {
        const panel = el('div', `group-panel light-${group.light}`);
        if (group.isLongReset) {
            panel.classList.add('long-reset');
        }

        // Header row
        const header = el('div', 'group-header');
        header.innerHTML = `
            <div class="traffic-light ${group.light}"></div>
            <span class="group-name">${group.name}</span>
            <span class="group-pct">${group.worstPct}%</span>
            <button class="eye-btn" title="Toggle visibility">👁</button>
        `;
        header.querySelector('.eye-btn').addEventListener('click', e => {
            e.stopPropagation();
            vscode.postMessage({ command: 'toggleGroup', groupId: group.id });
        });
        panel.appendChild(header);

        // Quota bar (usage remaining)
        const bar = el('div', 'quota-bar');
        const fill = el('div', `quota-bar-fill ${group.light}`);
        fill.style.width = `${group.worstPct}%`;
        bar.appendChild(fill);
        panel.appendChild(bar);

        // Reset countdown bar (blue, 5hr = 100%, 0 = 0%)
        if (group.models.length > 0) {
            const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
            const resetMs = group.models[0].timeUntilResetMs;
            const resetFormatted = group.models[0].resetFormatted;
            const isReady = resetFormatted === 'Ready' || resetMs <= 0;
            const resetPct = isReady ? 0 : Math.min(100, Math.round((resetMs / FIVE_HOURS_MS) * 100));

            const resetBar = el('div', 'quota-bar');
            const resetFill = el('div', 'quota-bar-fill reset-bar');
            resetFill.style.width = `${resetPct}%`;
            resetBar.appendChild(resetFill);
            panel.appendChild(resetBar);

            // Reset time label (same prominence as the % number)
            const resetLabel = el('div', 'group-reset-label');
            resetLabel.textContent = isReady ? 'Ready' : `Resets in: ${resetFormatted}`;
            panel.appendChild(resetLabel);

            // Per-model rows (name + percentage only)
            const modelList = el('div', 'group-models');
            for (const m of group.models) {
                const row = el('div', 'model-row-compact');
                const exhausted = m.isExhausted ? ' exhausted' : '';
                const pctVal = m.remainingPct !== null ? m.remainingPct : null;
                // Show if unknown (?) or if it differs from the group's worst percentage
                const showPct = pctVal === null || pctVal !== group.worstPct;

                row.innerHTML = `
                    <span class="model-name${exhausted}">${m.label}</span>
                    ${showPct ? `<span class="model-info">${pctVal !== null ? pctVal + '%' : '?'}</span>` : ''}
                `;
                modelList.appendChild(row);
            }
            panel.appendChild(modelList);
        } else {
            const empty = el('div', 'group-empty');
            empty.textContent = 'No models detected';
            panel.appendChild(empty);
        }

        return panel;
    }

    function el(tag, className) {
        const e = document.createElement(tag);
        if (className) e.className = className;
        return e;
    }
})();
