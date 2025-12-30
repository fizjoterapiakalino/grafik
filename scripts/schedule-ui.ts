// scripts/schedule-ui.ts
import { AppConfig, capitalizeFirstLetter } from './common.js';
import { EmployeeManager } from './employee-manager.js';
import { auth as authRaw } from './firebase-config.js';
import { ScheduleLogic } from './schedule-logic.js';
import type { FirebaseAuthWrapper } from './types/firebase';

const auth = authRaw as unknown as FirebaseAuthWrapper;

/**
 * Stan komórki
 */
interface CellData {
    content?: string;
    isSplit?: boolean;
    isBreak?: boolean;
    isMassage?: boolean;
    isPnf?: boolean;
    isEveryOtherDay?: boolean;
    [key: string]: unknown;
}

/**
 * Stan aplikacji
 */
interface AppState {
    scheduleCells: Record<string, Record<string, CellData>>;
}

/**
 * Interfejs publicznego API ScheduleUI
 */
interface ScheduleUIAPI {
    initialize(appState: AppState): void;
    render(): void;
    getElementText(element: HTMLElement | null): string;
    updatePatientCount(): void;
    destroy(): void;
}

/**
 * Moduł UI harmonogramu
 */
export const ScheduleUI: ScheduleUIAPI = (() => {
    let _appState: AppState | null = null;
    let _employeeTooltip: HTMLDivElement | null = null;
    let _currentTimeInterval: ReturnType<typeof setInterval> | null = null;

    const _createEmployeeTooltip = (): void => {
        const existing = document.getElementById('globalEmployeeTooltip') as HTMLDivElement | null;
        if (existing) {
            _employeeTooltip = existing;
            return;
        }

        _employeeTooltip = document.createElement('div');
        _employeeTooltip.id = 'globalEmployeeTooltip';
        _employeeTooltip.classList.add('employee-tooltip');
        document.body.appendChild(_employeeTooltip);
    };

    const _showEmployeeTooltip = (event: Event): void => {
        if (!_employeeTooltip) return;
        const th = event.currentTarget as HTMLTableCellElement;
        const fullName = th.dataset.fullName || '';
        const employeeNumber = th.dataset.employeeNumber || '';

        _employeeTooltip.innerHTML = '';

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
        _employeeTooltip.style.top = `${rect.top - _employeeTooltip.offsetHeight - 10}px`;
        _employeeTooltip.style.transform = 'translateX(-50%)';
        _employeeTooltip.style.display = 'block';
    };

    const _hideEmployeeTooltip = (): void => {
        if (_employeeTooltip) {
            _employeeTooltip.style.display = 'none';
        }
    };

    const initialize = (appState: AppState): void => {
        _appState = appState;
        _createEmployeeTooltip();

        let lastWidth = window.innerWidth;

        window.addEventListener('resize', () => {
            if (window.innerWidth !== lastWidth) {
                lastWidth = window.innerWidth;
                renderTable();
            }
        });
    };

    const getElementText = (element: HTMLElement | null): string => {
        if (!element || element.classList.contains('break-cell') || element.classList.contains('empty-slot')) return '';
        const clone = element.cloneNode(true) as HTMLElement;
        const icons = clone.querySelectorAll('.cell-icon');
        icons.forEach((icon) => icon.remove());
        const spans = clone.querySelectorAll('span');
        let text = '';
        if (spans.length > 0) {
            spans.forEach((span) => {
                text += span.textContent + ' ';
            });
        } else {
            text = clone.textContent || '';
        }
        return text.trim();
    };

    const applyCellDataToDom = (cell: HTMLTableCellElement, cellObj: CellData): void => {
        cell.className = 'editable-cell';
        cell.innerHTML = '';

        delete cell.dataset.isMassage;
        delete cell.dataset.isPnf;
        delete cell.dataset.isEveryOtherDay;

        if (cell.tagName === 'TH') {
            cell.textContent = cellObj.content || '';
            return;
        }

        const displayData = ScheduleLogic.getCellDisplayData(cellObj);

        if (displayData.classes.length > 0) {
            cell.classList.add(...displayData.classes);
        }

        if (displayData.styles.backgroundColor) {
            cell.style.backgroundColor = displayData.styles.backgroundColor;
        }

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

            if (cellObj.isMassage) cell.dataset.isMassage = 'true';
            if (cellObj.isPnf) cell.dataset.isPnf = 'true';
            if (cellObj.isEveryOtherDay) cell.dataset.isEveryOtherDay = 'true';
        }
    };

    const refreshAllRowHeights = (): void => {
        document.querySelectorAll<HTMLTableRowElement>('#mainScheduleTable tbody tr').forEach((row) => {
            row.style.height = 'auto';
        });
    };

    const renderMobileView = (employeeIndices: string[]): void => {
        let mobileContainer = document.querySelector('.mobile-schedule-container') as HTMLDivElement | null;
        if (!mobileContainer) {
            mobileContainer = document.createElement('div');
            mobileContainer.className = 'mobile-schedule-container';
            const table = document.getElementById('mainScheduleTable');
            if (table && table.parentNode) {
                table.parentNode.insertBefore(mobileContainer, table);
            }
        }
        mobileContainer.innerHTML = '';
        mobileContainer.style.display = 'flex';

        const table = document.getElementById('mainScheduleTable') as HTMLTableElement | null;
        if (table) table.style.display = 'none';

        const employeeIndex = employeeIndices[0];
        if (employeeIndex === undefined) {
            mobileContainer.textContent = 'Brak danych pracownika do wyświetlenia.';
            return;
        }

        if (!_appState) return;

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

                const cardHeader = document.createElement('div');
                cardHeader.className = 'card-header';
                cardHeader.textContent = timeString;
                card.appendChild(cardHeader);

                const cardBody = document.createElement('div');
                cardBody.className = 'card-body editable-cell';
                cardBody.setAttribute('data-time', timeString);
                cardBody.setAttribute('data-employee-index', employeeIndex);
                cardBody.setAttribute('tabindex', '0');

                if (displayData.text) {
                    cardBody.textContent = displayData.text;
                    if (displayData.classes.length > 0) cardBody.classList.add(...displayData.classes);
                    if (displayData.styles.backgroundColor)
                        cardBody.style.backgroundColor = displayData.styles.backgroundColor;
                } else if (displayData.isSplit) {
                    const part1 = displayData.parts[0];
                    const part2 = displayData.parts[1];
                    cardBody.innerHTML = `<div>${part1.text}</div><div style="border-top:1px solid #ccc; margin-top:4px; padding-top:4px;">${part2.text}</div>`;
                } else {
                    cardBody.textContent = 'Wolny termin';
                    cardBody.classList.add('empty-slot');
                }

                card.appendChild(cardBody);
                mobileContainer.appendChild(card);
            }
        }
    };

    const renderTable = (): void => {
        const mainTable = document.getElementById('mainScheduleTable') as HTMLTableElement | null;
        if (!mainTable || !_appState) return;

        const isMobile = window.innerWidth <= 768;

        let employeeIndices: string[] = [];
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
                }
            }
        } else {
            const allEmployees = EmployeeManager.getAll();
            employeeIndices = Object.keys(allEmployees)
                .filter((id) => !allEmployees[id].isHidden)
                .sort((a, b) => parseInt(a) - parseInt(b));
            isSingleUserView = false;
        }

        if (isMobile && !isAdmin) {
            renderMobileView(employeeIndices);
            return;
        }

        const mobileContainer = document.querySelector('.mobile-schedule-container') as HTMLElement | null;
        if (mobileContainer) mobileContainer.style.display = 'none';
        mainTable.style.display = 'table';

        const tableHeaderRow = document.getElementById('tableHeaderRow') as HTMLTableRowElement | null;
        const tbody = mainTable.querySelector('tbody');

        if (!tableHeaderRow || !tbody) {
            console.error('Table header row or tbody not found, cannot render schedule.');
            return;
        }

        tableHeaderRow.innerHTML = '';
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
            const employeeNumber = (employeeData as { employeeNumber?: string })?.employeeNumber || '';

            th.setAttribute('data-employee-index', i);
            th.setAttribute('tabindex', '0');
            th.classList.add('employee-header');

            const span = document.createElement('span');
            span.textContent = capitalizeFirstLetter(displayName);
            th.appendChild(span);

            th.dataset.fullName = fullName;
            th.dataset.employeeNumber = employeeNumber;
            tableHeaderRow.appendChild(th);

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
                    const cellData = _appState!.scheduleCells[timeString]?.[i] || {};
                    applyCellDataToDom(cell, cellData);
                    cell.setAttribute('data-time', timeString);
                    cell.setAttribute('data-employee-index', i);
                    cell.setAttribute('draggable', 'true');
                    cell.setAttribute('tabindex', '0');
                }
            }
        }
        refreshAllRowHeights();

        if (_currentTimeInterval) {
            clearInterval(_currentTimeInterval);
        }

        _currentTimeInterval = setInterval(() => {
            const now = new Date();
            const hours = now.getHours();
            const minutes = now.getMinutes();
            const roundedMinutes = minutes < 30 ? '00' : '30';
            const currentTimeString = `${hours}:${roundedMinutes}`;

            document.querySelectorAll('#mainScheduleTable tbody tr.current-time-row').forEach((row) => {
                row.classList.remove('current-time-row');
            });

            const allTimeCells = document.querySelectorAll('#mainScheduleTable tbody td:first-child');
            for (const cell of allTimeCells) {
                if ((cell as HTMLTableCellElement).textContent?.trim() === currentTimeString) {
                    cell.parentElement?.classList.add('current-time-row');
                    break;
                }
            }
        }, 60000);

        updatePatientCount();
    };

    const updatePatientCount = (): void => {
        const patientCountElement = document.getElementById('patientCount');
        if (!patientCountElement || !_appState) return;

        const therapyCount = ScheduleLogic.calculatePatientCount(_appState.scheduleCells);
        patientCountElement.textContent = `Terapie: ${therapyCount}`;
    };

    const destroy = (): void => {
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
declare global {
    interface Window {
        ScheduleUI: ScheduleUIAPI;
    }
}

window.ScheduleUI = ScheduleUI;
