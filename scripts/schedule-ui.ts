// scripts/schedule-ui.ts
import { AppConfig, capitalizeFirstLetter } from './common.js';
import { EmployeeManager } from './employee-manager.js';
import { auth as authRaw, db as dbRaw } from './firebase-config.js';
import { ScheduleLogic } from './schedule-logic.js';
import { toUTCDate } from './utils.js';
import type { FirebaseAuthWrapper, FirestoreDbWrapper } from './types/firebase';
import type { LeaveEntry } from './types/index.js';

const auth = authRaw as unknown as FirebaseAuthWrapper;
const db = dbRaw as unknown as FirestoreDbWrapper;

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
    let _leavesData: Record<string, LeaveEntry[]> = {};
    let _leavesLoaded = false;

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

    /**
     * Pobiera dane o urlopach z Firebase
     */
    const _loadLeavesData = async (): Promise<void> => {
        if (_leavesLoaded) return;
        try {
            const docRef = db.collection(AppConfig.firestore.collections.leaves).doc(AppConfig.firestore.docs.mainLeaves);
            const docSnap = await docRef.get();
            _leavesData = docSnap.exists ? (docSnap.data() as Record<string, LeaveEntry[]>) || {} : {};
            _leavesLoaded = true;
        } catch (error) {
            console.error('Błąd podczas ładowania danych o urlopach:', error);
            _leavesData = {};
        }
    };

    /**
     * Sprawdza czy pracownik ma urlop w dzisiejszym dniu
     * @param employeeDisplayName - wyświetlana nazwa pracownika (klucz w danych urlopowych)
     * @returns true jeśli pracownik ma urlop dzisiaj
     */
    const _isEmployeeOnLeaveToday = (employeeDisplayName: string): boolean => {
        const leaves = _leavesData[employeeDisplayName] || [];
        if (leaves.length === 0) return false;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const leave of leaves) {
            if (!leave.startDate || !leave.endDate) continue;

            const start = toUTCDate(leave.startDate);
            const end = toUTCDate(leave.endDate);

            // Sprawdź czy dzisiaj jest w zakresie urlopu
            const startTime = start.getTime();
            const endTime = end.getTime();

            // Używamy UTC do porównania, więc dopasujmy dzisiejszą datę
            const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
            const todayUTCTime = todayUTC.getTime();

            if (todayUTCTime >= startTime && todayUTCTime <= endTime) {
                return true;
            }
        }
        return false;
    };

    const initialize = (appState: AppState): void => {
        _appState = appState;
        _createEmployeeTooltip();

        // Załaduj dane o urlopach w tle
        _loadLeavesData().then(() => {
            // Po załadowaniu urlopów, odśwież tabelę żeby wyświetlić badge'y
            renderTable();
        });

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

            displayData.parts.forEach((part, index) => {
                const div = document.createElement('div');
                div.setAttribute('tabindex', '0');
                div.setAttribute('draggable', 'true');
                div.setAttribute('data-split-part', String(index + 1)); // 1 = górna, 2 = dolna

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

        if (employeeIndices.length === 0) {
            mobileContainer.textContent = 'Brak danych pracownika do wyświetlenia.';
            return;
        }

        if (!_appState) return;

        // Get selected employee index from container's data attribute, or default to first
        let selectedEmployeeIndex = mobileContainer.dataset.selectedEmployee || employeeIndices[0];

        // Validate that selected employee is still in the list
        if (!employeeIndices.includes(selectedEmployeeIndex)) {
            selectedEmployeeIndex = employeeIndices[0];
        }

        // Add employee selector if multiple employees
        if (employeeIndices.length > 1) {
            const selectorWrapper = document.createElement('div');
            selectorWrapper.className = 'mobile-employee-selector';

            const label = document.createElement('label');
            label.textContent = 'Wybierz pracownika: ';
            label.htmlFor = 'mobileEmployeeSelect';
            selectorWrapper.appendChild(label);

            const select = document.createElement('select');
            select.id = 'mobileEmployeeSelect';
            select.className = 'employee-select';

            employeeIndices.forEach((empId) => {
                const option = document.createElement('option');
                option.value = empId;
                const empData = EmployeeManager.getById(empId);
                option.textContent = capitalizeFirstLetter(empData?.displayName || `Pracownik ${parseInt(empId) + 1}`);
                if (empId === selectedEmployeeIndex) {
                    option.selected = true;
                }
                select.appendChild(option);
            });

            select.addEventListener('change', (e) => {
                const newEmployeeId = (e.target as HTMLSelectElement).value;
                mobileContainer!.dataset.selectedEmployee = newEmployeeId;
                renderMobileView(employeeIndices);
            });

            selectorWrapper.appendChild(select);
            mobileContainer.appendChild(selectorWrapper);
        }

        const employeeData = EmployeeManager.getById(selectedEmployeeIndex);
        const header = document.createElement('h3');
        header.textContent = `Grafik: ${capitalizeFirstLetter(employeeData?.displayName || 'Pracownik')}`;
        header.style.textAlign = 'center';
        header.style.color = 'var(--color-primary-700)';
        mobileContainer.appendChild(header);

        for (let hour = AppConfig.schedule.startHour; hour <= AppConfig.schedule.endHour; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                if (hour === AppConfig.schedule.endHour && minute === 30) continue;

                const timeString = `${hour}:${minute.toString().padStart(2, '0')}`;
                const cellData = _appState.scheduleCells[timeString]?.[selectedEmployeeIndex] || {};
                const displayData = ScheduleLogic.getCellDisplayData(cellData);

                const card = document.createElement('div');
                card.className = 'appointment-card';
                card.setAttribute('data-time', timeString);

                const cardHeader = document.createElement('div');
                cardHeader.className = 'card-header';
                cardHeader.textContent = timeString;

                // Add click handler for accordion toggle
                cardHeader.addEventListener('click', (e) => {
                    e.stopPropagation();
                    card.classList.toggle('expanded');
                });

                card.appendChild(cardHeader);

                const cardBody = document.createElement('div');
                cardBody.className = 'card-body editable-cell';
                cardBody.setAttribute('data-time', timeString);
                cardBody.setAttribute('data-employee-index', selectedEmployeeIndex);
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

        // Auto-expand all cards from current time onwards
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes() < 30 ? 0 : 30;
        const currentTimeString = `${currentHour}:${currentMinute.toString().padStart(2, '0')}`;

        let foundCurrent = false;
        const allCards = mobileContainer.querySelectorAll('.appointment-card');
        allCards.forEach((card) => {
            const cardTime = card.getAttribute('data-time');
            if (cardTime === currentTimeString) {
                foundCurrent = true;
                card.classList.add('current-time');
            }
            // Expand all cards from current time onwards
            if (foundCurrent) {
                card.classList.add('expanded');
            }
        });

        // Scroll to current time card
        const currentCard = mobileContainer.querySelector('.current-time') as HTMLElement;
        if (currentCard) {
            setTimeout(() => {
                currentCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    };

    const renderTable = (): void => {
        const mainTable = document.getElementById('mainScheduleTable') as HTMLTableElement | null;
        if (!mainTable || !_appState) return;

        const isMobile = window.innerWidth <= 768;

        let employeeIndices: string[] = [];
        let isSingleUserView = false;

        const currentUser = auth.currentUser;
        if (currentUser) {
            if (EmployeeManager.isUserAdmin(currentUser.uid)) {
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

        if (isMobile) {
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

            // Sprawdź czy pracownik ma urlop dzisiaj i dodaj odpowiednią klasę
            const isOnLeave = _isEmployeeOnLeaveToday(displayName);
            if (isOnLeave) {
                span.classList.add('on-leave');
                th.classList.add('employee-on-leave');
            }

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
