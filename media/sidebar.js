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
                    <div class="model-reset">${model.resetFormatted}</div>
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

        // Header row
        const header = el('div', 'group-header');
        header.innerHTML = `
            <div class="traffic-light ${group.light}"></div>
            <span class="group-icon">${group.icon}</span>
            <span class="group-name">${group.name}</span>
            <span class="group-pct">${group.worstPct}%</span>
            <button class="eye-btn" title="Toggle visibility">👁</button>
        `;
        header.querySelector('.eye-btn').addEventListener('click', e => {
            e.stopPropagation();
            vscode.postMessage({ command: 'toggleGroup', groupId: group.id });
        });
        panel.appendChild(header);

        // Quota bar
        const bar = el('div', 'quota-bar');
        const fill = el('div', `quota-bar-fill ${group.light}`);
        fill.style.width = `${group.worstPct}%`;
        bar.appendChild(fill);
        panel.appendChild(bar);

        // Per-model rows
        if (group.models.length > 0) {
            const modelList = el('div', 'group-models');
            for (const m of group.models) {
                const row = el('div', 'model-row-compact');
                const pct = m.remainingPct !== null ? m.remainingPct : '?';
                const exhausted = m.isExhausted ? ' exhausted' : '';
                row.innerHTML = `
                    <span class="model-name${exhausted}">${m.label}</span>
                    <span class="model-info">${pct}% · ${m.resetFormatted}</span>
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
