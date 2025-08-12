// scripts/schedule-ui.js

const ScheduleUI = (() => {
    let _appState = null;

    const initialize = (appState) => {
        _appState = appState;
    };

    const getElementText = (element) => {
        if (!element || element.classList.contains('break-cell')) return '';
        const clone = element.cloneNode(true);
        const icons = clone.querySelectorAll('.cell-icon');
        icons.forEach(icon => icon.remove());
        const spans = clone.querySelectorAll('span');
        let text = '';
        if (spans.length > 0) {
            spans.forEach(span => { text += span.textContent + ' ' });
        } else {
            text = clone.textContent;
        }
        return text.trim();
    };

    const applyCellDataToDom = (cell, cellObj) => {
        cell.className = 'editable-cell';
        cell.innerHTML = '';
        delete cell.dataset.isMassage;
        delete cell.dataset.isPnf;

        if (cell.tagName === 'TH') {
             cell.textContent = cellObj.content || '';
             return;
        }

        if (cellObj.isBreak) {
            cell.textContent = AppConfig.schedule.breakText;
            cell.classList.add('break-cell');
            cell.style.backgroundColor = AppConfig.schedule.defaultCellColor;
        } else if (cellObj.isSplit) {
            const createPart = (content, isMassage, isPnf) => {
                const div = document.createElement('div');
                div.setAttribute('tabindex', '0');
                let htmlContent = `<span>${capitalizeFirstLetter(content || '')}</span>`;
                if (isMassage) {
                    div.classList.add('massage-text');
                    div.dataset.isMassage = 'true';
                }
                if (isPnf) {
                    div.classList.add('pnf-text');
                    div.dataset.isPnf = 'true';
                }
                div.innerHTML = htmlContent;
                return div;
            };
            cell.classList.add('split-cell');
            cell.style.backgroundColor = AppConfig.schedule.contentCellColor;
            cell.appendChild(createPart(cellObj.content1, cellObj.isMassage1, cellObj.isPnf1));
            cell.appendChild(createPart(cellObj.content2, cellObj.isMassage2, cellObj.isPnf2));
        } else {
            let htmlContent = `<span>${capitalizeFirstLetter(cellObj.content || '')}</span>`;
            if (cellObj.isMassage) {
                cell.classList.add('massage-text');
                cell.dataset.isMassage = 'true';
            }
             if (cellObj.isPnf) {
                cell.classList.add('pnf-text');
                cell.dataset.isPnf = 'true';
            }
            cell.innerHTML = htmlContent;
            cell.style.backgroundColor = (getElementText(cell).trim() !== '') ? AppConfig.schedule.contentCellColor : AppConfig.schedule.defaultCellColor;
        }

        const today = new Date().toISOString().split('T')[0];
        if (cellObj.isSplit) {
            if (cellObj.treatmentData1?.endDate && cellObj.treatmentData1.endDate <= today) {
                cell.children[0]?.classList.add('treatment-end-marker');
            }
            if (cellObj.treatmentData2?.endDate && cellObj.treatmentData2.endDate <= today) {
                cell.children[1]?.classList.add('treatment-end-marker');
            }
        } else if (cellObj.treatmentEndDate) {
            if (cellObj.treatmentEndDate <= today) {
                cell.classList.add('treatment-end-marker');
            }
        }
    };

    const refreshAllRowHeights = () => {
        document.querySelectorAll('#mainScheduleTable tbody tr').forEach(row => {
            row.style.height = 'auto';
        });
    };

    const renderTable = () => {
        const tableHeaderRow = document.getElementById('tableHeaderRow');
        const tbody = document.getElementById('mainScheduleTable').querySelector('tbody');
        const employees = EmployeeManager.getAll();
        tableHeaderRow.innerHTML = '<th>Godz.</th>';
        const employeeIndices = Object.keys(employees).sort((a, b) => parseInt(a) - parseInt(b));

        for (const i of employeeIndices) {
            const th = document.createElement('th');
            const headerText = employees[i]?.name || `Pracownik ${parseInt(i) + 1}`;
            th.textContent = capitalizeFirstLetter(headerText);
            th.setAttribute('data-employee-index', i);
            th.setAttribute('tabindex', '0');
            tableHeaderRow.appendChild(th);
        }

        tbody.innerHTML = '';
        for (let hour = AppConfig.schedule.startHour; hour <= AppConfig.schedule.endHour; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                if (hour === AppConfig.schedule.endHour && minute === 30) continue;
                const tr = tbody.insertRow();
                const timeString = `${hour}:${minute.toString().padStart(2, '0')}`;
                tr.insertCell().textContent = timeString;
                
                for (const i of employeeIndices) {
                    const cell = tr.insertCell();
                    const cellData = _appState.scheduleCells[timeString]?.[i] || {};
                    applyCellDataToDom(cell, cellData);
                    cell.setAttribute('data-time', timeString);
                    cell.setAttribute('data-employee-index', i);
                    cell.setAttribute('draggable', 'true');
                    cell.setAttribute('tabindex', '0');
                }
            }
        }
        refreshAllRowHeights();
    };

    return {
        initialize,
        render: renderTable,
        getElementText
    };
})();
