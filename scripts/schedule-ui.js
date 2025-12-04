// scripts/schedule-ui.js
import { AppConfig, capitalizeFirstLetter } from './common.js';
import { EmployeeManager } from './employee-manager.js';
import { Shared } from './shared.js';
import { auth } from './firebase-config.js';
import { ScheduleLogic } from './schedule-logic.js';

export const ScheduleUI = (() => {
    let _appState = null;
    let _employeeTooltip = null; // Globalny element tooltipa
    let _currentTimeInterval = null;

    const _createEmployeeTooltip = () => {
        if (document.getElementById('globalEmployeeTooltip')) {
            _employeeTooltip = document.getElementById('globalEmployeeTooltip');
            return;
        }

        _employeeTooltip = document.createElement('div');
        _employeeTooltip.id = 'globalEmployeeTooltip';
        _employeeTooltip.classList.add('employee-tooltip');
        document.body.appendChild(_employeeTooltip);
    };

    const _showEmployeeTooltip = (event) => {
        const th = event.currentTarget;
        const fullName = th.dataset.fullName;
        const employeeNumber = th.dataset.employeeNumber;

        _employeeTooltip.innerHTML = ''; // Clear previous content

        const nameP = document.createElement('p');
        nameP.textContent = fullName;
        _employeeTooltip.appendChild(nameP);

        if (employeeNumber) {
            const numberP = document.createElement('p');
            numberP.classList.add('employee-number-tooltip');
            const strong = document.createElement('strong');
            strong.textContent = employeeNumber;
            numberP.appendChild(document.createTextNode('Numer: '));
            numberP.appendChild(strong);
            _employeeTooltip.appendChild(numberP);
        }

        const rect = th.getBoundingClientRect();
        _employeeTooltip.style.left = `${rect.left + rect.width / 2}px`;
        _employeeTooltip.style.top = `${rect.top - _employeeTooltip.offsetHeight - 10}px`; // 10px odstępu od góry nagłówka
        _employeeTooltip.style.transform = 'translateX(-50%)';
        _employeeTooltip.style.display = 'block';
    };

    const _hideEmployeeTooltip = () => {
        _employeeTooltip.style.display = 'none';
    };

    const initialize = (appState) => {
        _appState = appState;
        _createEmployeeTooltip(); // Utwórz globalny tooltip przy inicjalizacji

        let lastWidth = window.innerWidth;

        window.addEventListener('resize', () => {
            // Only re-render if width changes (e.g. orientation change), ignoring height changes (keyboard open)
            if (window.innerWidth !== lastWidth) {
                lastWidth = window.innerWidth;
                renderTable();
            }
        });
    };

    const getElementText = (element) => {
        if (!element || element.classList.contains('break-cell') || element.classList.contains('empty-slot')) return '';
        const clone = element.cloneNode(true);
        const icons = clone.querySelectorAll('.cell-icon');
        icons.forEach((icon) => icon.remove());
        const spans = clone.querySelectorAll('span');
        let text = '';
        if (spans.length > 0) {
            spans.forEach((span) => {
                text += span.textContent + ' ';
            });
        } else {
            text = clone.textContent;
        }
        return text.trim();
    };

    const applyCellDataToDom = (cell, cellObj) => {
        cell.className = 'editable-cell';
        cell.innerHTML = ''; // Clear content safely

        // Remove legacy data attributes just in case
        delete cell.dataset.isMassage;
        delete cell.dataset.isPnf;
        delete cell.dataset.isEveryOtherDay;

        if (cell.tagName === 'TH') {
            cell.textContent = cellObj.content || '';
            return;
        }

        const displayData = ScheduleLogic.getCellDisplayData(cellObj);

        // Apply Classes
        if (displayData.classes.length > 0) {
            cell.classList.add(...displayData.classes);
        }

        // Apply Styles
        if (displayData.styles.backgroundColor) {
            cell.style.backgroundColor = displayData.styles.backgroundColor;
        }

        // Apply Content
        if (displayData.isBreak) {
            cell.textContent = displayData.text;
        } else if (displayData.isSplit) {
            const wrapper = document.createElement('div');
            wrapper.className = 'split-cell-wrapper';

            displayData.parts.forEach((part) => {
                const div = document.createElement('div');
                div.setAttribute('tabindex', '0');

                const span = document.createElement('span');
                span.textContent = part.text;
                div.appendChild(span);

                if (part.classes.length > 0) {
                    div.classList.add(...part.classes);
                }

                // Add data attributes for specific styling if needed by CSS
                if (part.isMassage) div.dataset.isMassage = 'true';
                if (part.isPnf) div.dataset.isPnf = 'true';
                if (part.isEveryOtherDay) div.dataset.isEveryOtherDay = 'true';

                wrapper.appendChild(div);
            });
            cell.appendChild(wrapper);
        } else {
            const span = document.createElement('span');
            span.textContent = displayData.text;
            cell.appendChild(span);

            // Add data attributes for specific styling if needed by CSS
            if (cellObj.isMassage) cell.dataset.isMassage = 'true';
            if (cellObj.isPnf) cell.dataset.isPnf = 'true';
            if (cellObj.isEveryOtherDay) cell.dataset.isEveryOtherDay = 'true';
        }
    };

    const refreshAllRowHeights = () => {
        document.querySelectorAll('#mainScheduleTable tbody tr').forEach((row) => {
            row.style.height = 'auto';
        });
    };

    const renderMobileView = (employeeIndices) => {
        const container = document.getElementById('app-root'); // Or a specific container if exists
        // Ideally we should have a specific container for the schedule content
        // Let's assume we are appending to the main container or replacing the table

        let mobileContainer = document.querySelector('.mobile-schedule-container');
        if (!mobileContainer) {
            mobileContainer = document.createElement('div');
            mobileContainer.className = 'mobile-schedule-container';
            const table = document.getElementById('mainScheduleTable');
            table.parentNode.insertBefore(mobileContainer, table);
        }
        mobileContainer.innerHTML = ''; // Clear
        mobileContainer.style.display = 'flex';

        const table = document.getElementById('mainScheduleTable');
        table.style.display = 'none'; // Ensure table is hidden

        // For mobile, we usually focus on the logged-in user or the first selected employee
        // If multiple employees, we might need a selector. For now, let's take the first one (Single User View logic)
        const employeeIndex = employeeIndices[0];
        if (employeeIndex === undefined) {
            mobileContainer.textContent = 'Brak danych pracownika do wyświetlenia.';
            return;
        }

        const employeeData = EmployeeManager.getById(employeeIndex);
        const header = document.createElement('h3');
        header.textContent = `Grafik: ${capitalizeFirstLetter(employeeData?.displayName || 'Pracownik')}`;
        header.style.textAlign = 'center';
        header.style.color = 'var(--color-primary-700)';
        mobileContainer.appendChild(header);

        for (let hour = AppConfig.schedule.startHour; hour <= AppConfig.schedule.endHour; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                if (hour === AppConfig.schedule.endHour && minute === 30) continue;

                const timeString = `${hour}:${minute.toString().padStart(2, '0')}`;
                const cellData = _appState.scheduleCells[timeString]?.[employeeIndex] || {};
                const displayData = ScheduleLogic.getCellDisplayData(cellData);

                const card = document.createElement('div');
                card.className = 'appointment-card';

                // Header
                const cardHeader = document.createElement('div');
                cardHeader.className = 'card-header';
                cardHeader.textContent = timeString;
                card.appendChild(cardHeader);

                // Body
                const cardBody = document.createElement('div');
                cardBody.className = 'card-body';

                // Attributes for interaction (same as table cell)
                cardBody.setAttribute('data-time', timeString);
                cardBody.setAttribute('data-employee-index', employeeIndex);
                cardBody.setAttribute('tabindex', '0'); // Ensure focusable for better mobile support
                cardBody.className += ' editable-cell'; // Reuse logic

                if (displayData.text) {
                    cardBody.textContent = displayData.text;
                    if (displayData.classes.length > 0) cardBody.classList.add(...displayData.classes);
                    if (displayData.styles.backgroundColor)
                        cardBody.style.backgroundColor = displayData.styles.backgroundColor;
                } else if (displayData.isSplit) {
                    // Simplified split view for mobile - just stack them
                    const part1 = displayData.parts[0];
                    const part2 = displayData.parts[1];
                    cardBody.innerHTML = `<div>${part1.text}</div><div style="border-top:1px solid #ccc; margin-top:4px; padding-top:4px;">${part2.text}</div>`;
                    // Note: Full split styling on mobile card might need more CSS, keeping it simple for now
                } else {
                    cardBody.textContent = 'Wolny termin';
                    cardBody.classList.add('empty-slot');
                }

                card.appendChild(cardBody);
                mobileContainer.appendChild(card);
            }
        }
    };

    const renderTable = () => {
        const mainTable = document.getElementById('mainScheduleTable');
        if (!mainTable) return;

        // Check for mobile view
        const isMobile = window.innerWidth <= 768;

        let employeeIndices = [];
        let isSingleUserView = false;
        let isAdmin = false;

        const currentUser = auth.currentUser;
        if (currentUser) {
            if (EmployeeManager.isUserAdmin(currentUser.uid)) {
                isAdmin = true;
                const allEmployees = EmployeeManager.getAll();
                employeeIndices = Object.keys(allEmployees)
                    .filter((id) => !allEmployees[id].isHidden)
                    .sort((a, b) => parseInt(a) - parseInt(b));
                isSingleUserView = false;
            } else {
                const employee = EmployeeManager.getEmployeeByUid(currentUser.uid);
                if (employee) {
                    employeeIndices.push(employee.id);
                    isSingleUserView = true;
                } else {
                    // Handle unassigned
                }
            }
        } else {
            const allEmployees = EmployeeManager.getAll();
            employeeIndices = Object.keys(allEmployees)
                .filter((id) => !allEmployees[id].isHidden)
                .sort((a, b) => parseInt(a) - parseInt(b));
            isSingleUserView = false;
        }

        // Only switch to mobile view if NOT admin
        if (isMobile && !isAdmin) {
            renderMobileView(employeeIndices);
            return;
        }

        // Desktop View Cleanup
        const mobileContainer = document.querySelector('.mobile-schedule-container');
        if (mobileContainer) mobileContainer.style.display = 'none';
        mainTable.style.display = 'table';

        const tableHeaderRow = document.getElementById('tableHeaderRow');
        const tbody = mainTable.querySelector('tbody');

        if (!tableHeaderRow || !tbody) {
            console.error('Table header row or tbody not found, cannot render schedule.');
            return;
        }

        tableHeaderRow.innerHTML = ''; // Clear header safely
        const thTime = document.createElement('th');
        thTime.textContent = 'Godz.';
        tableHeaderRow.appendChild(thTime);

        tbody.innerHTML = '';

        mainTable.classList.toggle('single-user-view', isSingleUserView);

        for (const i of employeeIndices) {
            const th = document.createElement('th');
            const employeeData = EmployeeManager.getById(i);
            const displayName = employeeData?.displayName || employeeData?.name || `Pracownik ${parseInt(i) + 1}`;
            const fullName = EmployeeManager.getFullNameById(i);
            const employeeNumber = employeeData?.employeeNumber || '';

            th.setAttribute('data-employee-index', i);
            th.setAttribute('tabindex', '0');
            th.classList.add('employee-header'); // Dodaj klasę dla identyfikacji

            const span = document.createElement('span');
            span.textContent = capitalizeFirstLetter(displayName);
            th.appendChild(span);

            th.dataset.fullName = fullName;
            th.dataset.employeeNumber = employeeNumber;
            tableHeaderRow.appendChild(th);

            // Dodaj event listenery dla nowego podejścia do tooltipa
            th.addEventListener('mouseover', _showEmployeeTooltip);
            th.addEventListener('mouseout', _hideEmployeeTooltip);
        }

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

        // Usuń ewentualny stary interwał, aby uniknąć duplikatów
        if (_currentTimeInterval) {
            clearInterval(_currentTimeInterval);
        }

        // Ustaw nowy interwał, który będzie aktualizował podświetlenie
        _currentTimeInterval = setInterval(() => {
            const now = new Date();
            const hours = now.getHours();
            const minutes = now.getMinutes();
            const roundedMinutes = minutes < 30 ? '00' : '30';
            const timeString = `${hours}:${roundedMinutes}`;

            // Usuń podświetlenie ze wszystkich wierszy
            document.querySelectorAll('#mainScheduleTable tbody tr.current-time-row').forEach((row) => {
                row.classList.remove('current-time-row');
            });

            // Znajdź i podświetl nowy, właściwy wiersz
            const allTimeCells = document.querySelectorAll('#mainScheduleTable tbody td:first-child');
            for (const cell of allTimeCells) {
                if (cell.textContent.trim() === timeString) {
                    cell.parentElement.classList.add('current-time-row');
                    break;
                }
            }
        }, 60000); // Uruchamiaj co minutę

        updatePatientCount(); // Zaktualizuj liczbę pacjentów po renderowaniu tabeli
    };

    const updatePatientCount = () => {
        const patientCountElement = document.getElementById('patientCount');
        if (!patientCountElement) return;

        // Use pure logic instead of DOM scraping
        const therapyCount = ScheduleLogic.calculatePatientCount(_appState.scheduleCells);
        patientCountElement.textContent = `Terapie: ${therapyCount}`;
    };

    const destroy = () => {
        if (_currentTimeInterval) {
            clearInterval(_currentTimeInterval);
            _currentTimeInterval = null;
        }
    };

    return {
        initialize,
        render: renderTable,
        getElementText,
        updatePatientCount,
        destroy,
    };
})();

// Backward compatibility
window.ScheduleUI = ScheduleUI;
