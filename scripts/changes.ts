// scripts/changes.ts
import { db as dbRaw } from './firebase-config.js';
import { AppConfig } from './common.js';
import { EmployeeManager } from './employee-manager.js';
import type { FirestoreDbWrapper } from './types/firebase';

const db = dbRaw as unknown as FirestoreDbWrapper;

// pdfMake type declaration (external library)
declare const pdfMake: {
    createPdf(docDefinition: unknown): { download(filename: string): void };
};

/**
 * Stan komórki w harmonogramie zmian
 */
interface ChangesCellState {
    assignedEmployees?: string[];
}

/**
 * Stan aplikacji
 */
interface AppState {
    changesCells: Record<string, Record<number, ChangesCellState>>;
}

/**
 * Okres dwutygodniowy
 */
interface Period {
    start: string;
    end: string;
}

/**
 * Interfejs publicznego API Changes
 */
interface ChangesAPI {
    init(): Promise<void>;
    destroy(): void;
}

/**
 * Moduł harmonogramu zmian
 */
export const Changes: ChangesAPI = (() => {
    let changesTableBody: HTMLElement | null = null;
    let changesHeaderRow: HTMLElement | null = null;
    let appState: AppState = { changesCells: {} };

    let currentYear = new Date().getUTCFullYear();
    let yearSelect: HTMLSelectElement | null = null;
    let clipboard: string[] | null = null;

    const isWeekend = (date: Date): boolean => {
        const day = date.getUTCDay();
        return day === 0 || day === 6;
    };

    const handleAppSearch = (e: Event): void => {
        const { searchTerm } = (e as CustomEvent<{ searchTerm: string }>).detail;
        const lowerCaseSearchTerm = searchTerm.toLowerCase();
        document.querySelectorAll('#changesTableBody tr').forEach((row) => {
            const hasEmployee = Array.from((row as HTMLTableRowElement).cells).some((cell, index) => {
                if (index === 0) return false;
                return cell.textContent?.toLowerCase().includes(lowerCaseSearchTerm) || false;
            });
            (row as HTMLElement).style.display = hasEmployee || lowerCaseSearchTerm === '' ? '' : 'none';
        });
    };

    const copyCell = (cell: HTMLTableCellElement): void => {
        if (!cell) return;
        const period = (cell.parentElement as HTMLTableRowElement).dataset.startDate;
        if (!period) return;
        const columnIndex = cell.cellIndex;
        const cellState = appState.changesCells[period]?.[columnIndex];

        if (cellState?.assignedEmployees) {
            clipboard = [...cellState.assignedEmployees];
            window.showToast('Skopiowano.');
        } else {
            clipboard = [];
            window.showToast('Skopiowano pustą komórkę.');
        }
    };

    const pasteCell = (cell: HTMLTableCellElement): void => {
        if (!cell || !clipboard) return;

        updateCellState(cell, (state) => {
            state.assignedEmployees = [...clipboard!];
        });
        window.showToast('Wklejono.');
    };

    const clearCell = (cell: HTMLTableCellElement): void => {
        if (!cell) return;
        updateCellState(cell, (state) => {
            state.assignedEmployees = [];
        });
        window.showToast('Wyczyszczono.');
    };

    const generateTwoWeekPeriods = (year: number): Period[] => {
        const periods: Period[] = [];
        let currentDate = new Date(Date.UTC(year, 0, 1));

        while (currentDate.getUTCDay() !== 1) {
            currentDate.setUTCDate(currentDate.getUTCDate() - 1);
        }

        while (currentDate.getUTCFullYear() <= year) {
            const startDate = new Date(currentDate);
            let endDate = new Date(startDate);
            let workDaysCount = 0;

            while (workDaysCount < 10) {
                if (!isWeekend(endDate)) {
                    workDaysCount++;
                }
                if (workDaysCount < 10) {
                    endDate.setUTCDate(endDate.getUTCDate() + 1);
                }
            }

            periods.push({
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0],
            });

            currentDate = new Date(endDate);
            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            while (isWeekend(currentDate)) {
                currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            }
        }
        return periods;
    };

    const renderTable = (periods: Period[]): void => {
        if (!changesHeaderRow || !changesTableBody) return;

        changesHeaderRow.innerHTML = '';
        const headers = [
            'Okres', 'HYDRO 7:00-14:30', 'MASAŻ 7-14:30', 'FIZYKO 7-14:30', 'SALA 7-14:30',
            'MASAŻ 10:30-18:00', 'FIZYKO 10:30-18:00', 'SALA 10:30-18:00', 'URLOPY',
        ];
        headers.forEach((headerText) => {
            const th = document.createElement('th');
            th.textContent = headerText;
            changesHeaderRow!.appendChild(th);
        });

        changesTableBody.innerHTML = '';
        periods.forEach((period) => {
            const tr = document.createElement('tr');
            tr.dataset.startDate = period.start;
            tr.dataset.endDate = period.end;
            const start = new Date(period.start);
            const end = new Date(period.end);
            tr.innerHTML = `
                <td>${start.getUTCDate()}.${(start.getUTCMonth() + 1).toString().padStart(2, '0')} - ${end.getUTCDate()}.${(end.getUTCMonth() + 1).toString().padStart(2, '0')}</td>
                <td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                <td class="leaves-cell"></td>
            `;
            changesTableBody!.appendChild(tr);
        });

        document.querySelectorAll('#changesTableBody td').forEach((cell) => {
            if (!cell.classList.contains('leaves-cell')) {
                cell.addEventListener('click', handleCellClick);
            }
        });
    };

    const getAllLeavesData = async (): Promise<Record<string, unknown>> => {
        try {
            const docRef = db.collection(AppConfig.firestore.collections.leaves).doc(AppConfig.firestore.docs.mainLeaves);
            const docSnap = await docRef.get();
            return docSnap.exists ? (docSnap.data() as Record<string, unknown>) || {} : {};
        } catch (error) {
            console.error('Błąd podczas ładowania danych o urlopach z Firestore:', error);
            window.showToast('Wystąpił błąd podczas ładowania danych o urlopach. Spróbuj ponownie.', 5000);
            return {};
        }
    };

    interface LeaveEntry {
        startDate: string;
        endDate: string;
        type: string;
    }

    const populateLeavesColumn = (allLeavesData: Record<string, unknown>): void => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        document.querySelectorAll('#changesTableBody tr').forEach((row) => {
            const tr = row as HTMLTableRowElement;
            const periodStart = new Date(tr.dataset.startDate || '');
            const periodEnd = new Date(tr.dataset.endDate || '');
            const leavesCell = tr.querySelector('.leaves-cell');
            if (!leavesCell) return;

            let leavesHtml = '';
            const employees = EmployeeManager.getAll();

            for (const employeeId in employees) {
                const employee = employees[employeeId];
                if (employee.isHidden || employee.isScheduleOnly) continue;

                const employeeName = employee.displayName || employee.name;
                if (!employeeName) continue;
                const employeeLeaves = allLeavesData[employeeName] as LeaveEntry[] | undefined;

                if (Array.isArray(employeeLeaves)) {
                    employeeLeaves.forEach((leave) => {
                        const leaveStart = new Date(leave.startDate);
                        const leaveEnd = new Date(leave.endDate);

                        if (leave.type === 'vacation' && !(leaveEnd < periodStart || leaveStart > periodEnd)) {
                            const lastName = EmployeeManager.getLastNameById(employeeId);
                            leavesHtml += `${lastName || employeeName}<br>`;
                        }
                    });
                }
            }
            leavesCell.innerHTML = leavesHtml;

            if (periodEnd < today) {
                tr.classList.add('past-period');
            }
        });
    };

    const handleCellClick = (event: Event): void => {
        const cell = (event.target as HTMLElement).closest('td') as HTMLTableCellElement | null;
        if (!cell) return;
        openEmployeeSelectionModal(cell);
    };

    const openEmployeeSelectionModal = (cell: HTMLTableCellElement): void => {
        const modal = document.getElementById('employeeSelectionModal');
        const employeeListDiv = document.getElementById('employeeList');
        const saveBtn = document.getElementById('saveEmployeeSelection');
        const cancelBtn = document.getElementById('cancelEmployeeSelection');
        const searchInput = document.getElementById('employeeSearchInput') as HTMLInputElement | null;

        if (!modal || !employeeListDiv || !saveBtn || !cancelBtn || !searchInput) return;

        employeeListDiv.innerHTML = '';
        searchInput.value = '';

        const allEmployees = Object.fromEntries(
            Object.entries(EmployeeManager.getAll()).filter(([, employee]) => !employee.isHidden && !employee.isScheduleOnly)
        );
        const period = (cell.parentElement as HTMLTableRowElement).dataset.startDate || '';
        const columnIndex = cell.cellIndex;
        const cellState = appState.changesCells[period]?.[columnIndex] || {};
        const assignedEmployees = new Set(cellState.assignedEmployees || []);

        for (const id in allEmployees) {
            const employeeEl = document.createElement('div');
            employeeEl.classList.add('employee-list-item');
            employeeEl.textContent = EmployeeManager.getFullNameById(id);
            employeeEl.dataset.employeeId = id;

            if (assignedEmployees.has(id)) {
                employeeEl.classList.add('selected-employee');
            }

            employeeEl.addEventListener('click', () => {
                employeeEl.classList.toggle('selected-employee');
            });

            employeeListDiv.appendChild(employeeEl);
        }

        const filterEmployees = (): void => {
            const searchTerm = searchInput.value.toLowerCase();
            employeeListDiv.querySelectorAll('.employee-list-item').forEach((item) => {
                const el = item as HTMLElement;
                el.style.display = el.textContent?.toLowerCase().includes(searchTerm) ? '' : 'none';
            });
        };

        searchInput.addEventListener('input', filterEmployees);
        modal.style.display = 'flex';

        const closeModal = (): void => {
            modal.style.display = 'none';
            saveBtn.onclick = null;
            cancelBtn.onclick = null;
            searchInput.removeEventListener('input', filterEmployees);
        };

        saveBtn.onclick = (): void => {
            const selectedEmployees: string[] = [];
            employeeListDiv.querySelectorAll('.selected-employee').forEach((el) => {
                const empEl = el as HTMLElement;
                if (empEl.dataset.employeeId) {
                    selectedEmployees.push(empEl.dataset.employeeId);
                }
            });

            updateCellState(cell, (state) => {
                state.assignedEmployees = selectedEmployees;
            });
            window.showToast('Zapisano zmiany.');
            closeModal();
        };

        cancelBtn.onclick = closeModal;
    };

    const updateCellState = (cell: HTMLTableCellElement, updateFn: (state: ChangesCellState) => void): void => {
        if (!cell) return;
        const period = (cell.parentElement as HTMLTableRowElement).dataset.startDate;
        if (!period) return;
        const columnIndex = cell.cellIndex;
        if (!appState.changesCells[period]) appState.changesCells[period] = {};
        let cellState = appState.changesCells[period][columnIndex] || {};

        updateFn(cellState);

        appState.changesCells[period][columnIndex] = cellState;
        renderChangesAndSave();
    };

    const saveChanges = async (): Promise<void> => {
        try {
            await db.collection(AppConfig.firestore.collections.schedules)
                .doc(`changesSchedule_${currentYear}`)
                .set(appState, { merge: true });
            window.setSaveStatus('saved');
        } catch (error) {
            console.error('Error saving changes to Firestore:', error);
            window.setSaveStatus('error');
        }
    };

    const loadChanges = async (): Promise<void> => {
        try {
            const docRef = db.collection(AppConfig.firestore.collections.schedules).doc(`changesSchedule_${currentYear}`);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                const savedData = docSnap.data() as AppState | undefined;
                appState.changesCells = savedData?.changesCells || {};
            } else {
                appState.changesCells = {};
            }
        } catch (error) {
            console.error('Error loading changes from Firestore:', error);
        }
    };

    const renderChangesContent = (): void => {
        document.querySelectorAll('#changesTableBody tr').forEach((row) => {
            const tr = row as HTMLTableRowElement;
            const period = tr.dataset.startDate || '';
            Array.from(tr.cells).forEach((cell, index) => {
                if (appState.changesCells[period]?.[index]?.assignedEmployees) {
                    const employeeNames = appState.changesCells[period][index].assignedEmployees!
                        .map((id) => EmployeeManager.getFullNameById(id))
                        .join('<br>');
                    cell.innerHTML = employeeNames;
                }
            });
        });
    };

    const renderChangesAndSave = (): void => {
        renderChangesContent();
        saveChanges();
    };

    const printChangesTableToPdf = (): void => {
        const table = document.getElementById('changesTable');
        if (!table) return;

        const tableHeaders = Array.from(table.querySelectorAll('thead th')).map((th) => ({
            text: th.textContent || '',
            style: 'tableHeader',
        }));

        const tableBody = Array.from(table.querySelectorAll('tbody tr')).map((row) => {
            const tr = row as HTMLTableRowElement;
            return Array.from(tr.cells).map((cell, cellIndex) => {
                if (cellIndex === 0 || cellIndex === 8) {
                    return cell.innerHTML.replace(/<br\s*[/]?>>/gi, '\n');
                }
                const period = tr.dataset.startDate || '';
                const cellState = appState.changesCells[period]?.[cellIndex];
                if (cellState?.assignedEmployees) {
                    return cellState.assignedEmployees.map((id) => EmployeeManager.getLastNameById(id)).join('\n');
                }
                return '';
            });
        });

        const docDefinition = {
            pageOrientation: 'landscape',
            content: [
                { text: 'Grafik Zmian', style: 'header' },
                {
                    style: 'tableExample',
                    table: { headerRows: 1, body: [tableHeaders, ...tableBody] },
                    layout: {
                        fillColor: function (rowIndex: number) {
                            return rowIndex === 0 ? '#4CAF50' : null;
                        },
                    },
                },
            ],
            styles: {
                header: { fontSize: 18, bold: true, margin: [0, 0, 0, 10] },
                tableExample: { margin: [0, 5, 0, 15] },
                tableHeader: { bold: true, fontSize: 10, color: 'white' },
            },
            defaultStyle: { font: 'Roboto' },
        };

        pdfMake.createPdf(docDefinition).download(`grafik-zmian-${currentYear}.pdf`);
    };

    const populateYearSelect = (): void => {
        if (!yearSelect) return;
        const yearNow = new Date().getUTCFullYear();
        const startYear = yearNow - 2;
        const endYear = yearNow + 5;

        yearSelect.innerHTML = '';

        for (let year = startYear; year <= endYear; year++) {
            const option = document.createElement('option');
            option.value = String(year);
            option.textContent = String(year);
            if (year === currentYear) {
                option.selected = true;
            }
            yearSelect.appendChild(option);
        }
        yearSelect.addEventListener('change', handleYearChange);
    };

    const handleYearChange = async (e: Event): Promise<void> => {
        currentYear = parseInt((e.target as HTMLSelectElement).value, 10);
        await refreshView();
    };

    const refreshView = async (): Promise<void> => {
        const periods = generateTwoWeekPeriods(currentYear);
        renderTable(periods);
        await loadChanges();
        renderChangesContent();
        const allLeaves = await getAllLeavesData();
        populateLeavesColumn(allLeaves);
    };

    const init = async (): Promise<void> => {
        const getElements = (): boolean => {
            changesTableBody = document.getElementById('changesTableBody');
            changesHeaderRow = document.getElementById('changesHeaderRow');
            yearSelect = document.getElementById('changesYearSelect') as HTMLSelectElement | null;
            return !!(changesTableBody && changesHeaderRow && yearSelect);
        };

        if (!getElements()) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            if (!getElements()) {
                await new Promise((resolve) => setTimeout(resolve, 100));
                if (!getElements()) {
                    console.error('Changes module: Required elements not found. Aborting initialization.');
                    return;
                }
            }
        }

        const printButton = document.getElementById('printChangesTable');
        if (printButton) {
            printButton.addEventListener('click', printChangesTableToPdf);
        }

        document.addEventListener('app:search', handleAppSearch);

        populateYearSelect();
        await refreshView();
        await EmployeeManager.load();

        const contextMenuItems = [
            { id: 'ctxCopyCell', action: (cell: HTMLElement) => copyCell(cell as HTMLTableCellElement) },
            { id: 'ctxPasteCell', action: (cell: HTMLElement) => pasteCell(cell as HTMLTableCellElement) },
            { id: 'ctxClearCell', action: (cell: HTMLElement) => clearCell(cell as HTMLTableCellElement) },
        ];
        window.initializeContextMenu('changesContextMenu', '#changesTableBody td:not(.leaves-cell)', contextMenuItems);
    };

    const destroy = (): void => {
        const printButton = document.getElementById('printChangesTable');
        document.removeEventListener('app:search', handleAppSearch);
        if (printButton) {
            printButton.removeEventListener('click', printChangesTableToPdf);
        }
        if (window.destroyContextMenu) {
            window.destroyContextMenu('changesContextMenu');
        }
        console.log('Changes module destroyed');
    };

    return { init, destroy };
})();

// Backward compatibility
declare global {
    interface Window {
        Changes: ChangesAPI;
    }
}

window.Changes = Changes;
