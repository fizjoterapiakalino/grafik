// scripts/changes.ts
import { debugLog } from './common.js';
import { db as dbRaw } from './firebase-config.js';
import { AppConfig } from './common.js';
import { EmployeeManager } from './employee-manager.js';
import {
    PdfColors,
    PdfStyles,
    PdfDefaultStyle,
    PdfTableLayoutCompact,
    PdfPageConfig,
    PdfHeaderColors,
} from './pdf-config.js';
import type { FirestoreDbWrapper } from './types/firebase';

const db = dbRaw as unknown as FirestoreDbWrapper;

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
    let activeCell: HTMLTableCellElement | null = null;

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

        const row = cell.parentElement as HTMLTableRowElement;
        const period = row.dataset.startDate || '';
        const columnIndex = cell.cellIndex;

        // Zbierz pracowników już przypisanych w innych komórkach tego wiersza
        const employeesInOtherCells = new Set<string>();
        const periodCells = appState.changesCells[period] || {};
        for (const colIdx in periodCells) {
            if (Number(colIdx) !== columnIndex) {
                const otherCellEmployees = periodCells[Number(colIdx)]?.assignedEmployees || [];
                otherCellEmployees.forEach((empId: string) => employeesInOtherCells.add(empId));
            }
        }

        // Sprawdź czy któryś z wklejanych pracowników jest już przypisany gdzie indziej
        const conflictingEmployees = clipboard.filter(empId => employeesInOtherCells.has(empId));

        if (conflictingEmployees.length > 0) {
            // Filtruj pracowników - wklej tylko tych, którzy nie są w innych komórkach
            const validEmployees = clipboard.filter(empId => !employeesInOtherCells.has(empId));

            if (validEmployees.length === 0) {
                window.showToast('Wszyscy pracownicy są już przypisani w innych kolumnach tego okresu.', 3000);
                return;
            }

            // Wklej tylko dozwolonych pracowników
            const skippedNames = conflictingEmployees.map(id => EmployeeManager.getLastNameById(id)).join(', ');
            updateCellState(cell, (state) => {
                state.assignedEmployees = [...validEmployees];
            });
            window.showToast(`Wklejono. Pominięto już przypisanych: ${skippedNames}`, 3000);
        } else {
            // Wszyscy pracownicy są dozwoleni
            updateCellState(cell, (state) => {
                state.assignedEmployees = [...clipboard!];
            });
            window.showToast('Wklejono.');
        }
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
            if (!cell.classList.contains('leaves-cell') && (cell as HTMLTableCellElement).cellIndex !== 0) {
                const htmlCell = cell as HTMLTableCellElement;
                htmlCell.setAttribute('tabindex', '0');
                htmlCell.addEventListener('click', handleCellClick);
                htmlCell.addEventListener('dblclick', handleCellDblClick);
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

                        // Sprawdź czy urlop pokrywa się z tym okresem
                        if (leave.type === 'vacation' && !(leaveEnd < periodStart || leaveStart > periodEnd)) {
                            const lastName = EmployeeManager.getLastNameById(employeeId);

                            // Formatuj datę końca urlopu
                            const endDay = leaveEnd.getDate().toString().padStart(2, '0');
                            const endMonth = (leaveEnd.getMonth() + 1).toString().padStart(2, '0');

                            let dateRange = '';
                            let tooltipText = `Urlop: ${leave.startDate} - ${leave.endDate}`;

                            // Sprawdź czy urlop zaczął się PRZED początkiem tego okresu
                            if (leaveStart < periodStart) {
                                // Urlop zaczął się wcześniej - pokazuj "do XX.XX"
                                dateRange = `do ${endDay}.${endMonth}`;
                            } else {
                                // Urlop zaczyna się w tym okresie - pokazuj pełny zakres
                                const startDay = leaveStart.getDate().toString().padStart(2, '0');
                                const startMonth = (leaveStart.getMonth() + 1).toString().padStart(2, '0');

                                if (startMonth === endMonth) {
                                    // Ten sam miesiąc
                                    dateRange = `${startDay}-${endDay}.${startMonth}`;
                                } else {
                                    // Różne miesiące
                                    dateRange = `${startDay}.${startMonth}-${endDay}.${endMonth}`;
                                }
                            }

                            leavesHtml += `<span class="leave-entry" title="${tooltipText}">${lastName || employeeName} <small>(${dateRange})</small></span><br>`;
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

    /**
     * Ustawia aktywną (zaznaczoną) komórkę
     */
    const setActiveCell = (cell: HTMLTableCellElement | null): void => {
        // Usuń zaznaczenie z poprzedniej komórki
        if (activeCell) {
            activeCell.classList.remove('active-cell');
        }

        activeCell = cell;

        // Dodaj zaznaczenie do nowej komórki
        if (activeCell) {
            activeCell.classList.add('active-cell');
            activeCell.focus();
        }
    };

    /**
     * Obsługuje pojedyncze kliknięcie - zaznaczenie komórki
     */
    const handleCellClick = (event: Event): void => {
        const cell = (event.target as HTMLElement).closest('td') as HTMLTableCellElement | null;
        if (!cell || cell.cellIndex === 0) return; // Ignoruj pierwszą kolumnę (daty)

        setActiveCell(cell);
    };

    /**
     * Obsługuje podwójne kliknięcie - otwarcie modala
     */
    const handleCellDblClick = (event: Event): void => {
        const cell = (event.target as HTMLElement).closest('td') as HTMLTableCellElement | null;
        if (!cell || cell.cellIndex === 0) return;

        openEmployeeSelectionModal(cell);
    };

    /**
     * Obsługuje klawisze na zaznaczonej komórce
     */
    const handleKeyDown = (event: KeyboardEvent): void => {
        // Ctrl+C - Kopiuj
        if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
            if (activeCell && activeCell.cellIndex !== 0) {
                copyCell(activeCell);
            }
            return;
        }

        // Ctrl+V - Wklej
        if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
            event.preventDefault();
            if (activeCell && activeCell.cellIndex !== 0 && clipboard) {
                pasteCell(activeCell);
            } else if (!clipboard) {
                window.showToast('Brak skopiowanej komórki.', 2000);
            }
            return;
        }

        if (!activeCell) return;

        // Enter - Otwórz modal
        if (event.key === 'Enter') {
            event.preventDefault();
            if (activeCell.cellIndex !== 0) {
                openEmployeeSelectionModal(activeCell);
            }
            return;
        }

        // Delete/Backspace - Wyczyść komórkę
        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            if (activeCell.cellIndex !== 0) {
                clearCell(activeCell);
            }
            return;
        }

        // Escape - Odznacz komórkę
        if (event.key === 'Escape') {
            setActiveCell(null);
            return;
        }

        // Nawigacja strzałkami
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault();
            navigateWithArrows(event.key);
        }
    };

    /**
     * Nawigacja strzałkami między komórkami
     */
    const navigateWithArrows = (key: string): void => {
        if (!activeCell) return;

        const row = activeCell.parentElement as HTMLTableRowElement;
        const cellIndex = activeCell.cellIndex;
        let newCell: HTMLTableCellElement | null = null;

        switch (key) {
            case 'ArrowUp': {
                const prevRow = row.previousElementSibling as HTMLTableRowElement | null;
                if (prevRow) {
                    newCell = prevRow.cells[cellIndex] || null;
                }
                break;
            }
            case 'ArrowDown': {
                const nextRow = row.nextElementSibling as HTMLTableRowElement | null;
                if (nextRow) {
                    newCell = nextRow.cells[cellIndex] || null;
                }
                break;
            }
            case 'ArrowLeft': {
                if (cellIndex > 1) { // Pomijamy kolumnę dat (index 0)
                    newCell = row.cells[cellIndex - 1] || null;
                }
                break;
            }
            case 'ArrowRight': {
                if (cellIndex < row.cells.length - 1 && cellIndex < 8) { // Pomijamy kolumnę urlopów (index 8)
                    newCell = row.cells[cellIndex + 1] || null;
                }
                break;
            }
        }

        if (newCell && !newCell.classList.contains('leaves-cell') && newCell.cellIndex !== 0) {
            setActiveCell(newCell);
        }
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
        const row = cell.parentElement as HTMLTableRowElement;
        const period = row.dataset.startDate || '';
        const columnIndex = cell.cellIndex;
        const cellState = appState.changesCells[period]?.[columnIndex] || {};
        const assignedEmployees = new Set(cellState.assignedEmployees || []);

        // Zbierz wszystkich pracowników już przypisanych w innych komórkach tego wiersza
        const employeesInOtherCells = new Set<string>();
        const periodCells = appState.changesCells[period] || {};
        for (const colIdx in periodCells) {
            if (Number(colIdx) !== columnIndex) {
                const otherCellEmployees = periodCells[Number(colIdx)]?.assignedEmployees || [];
                otherCellEmployees.forEach((empId: string) => employeesInOtherCells.add(empId));
            }
        }

        for (const id in allEmployees) {
            const employeeEl = document.createElement('div');
            employeeEl.classList.add('employee-list-item');
            employeeEl.textContent = EmployeeManager.getFullNameById(id);
            employeeEl.dataset.employeeId = id;

            if (assignedEmployees.has(id)) {
                // Zaznaczony w tej komórce
                employeeEl.classList.add('selected-employee');
            } else if (employeesInOtherCells.has(id)) {
                // Przypisany do innej komórki w tym okresie - wyszarzony
                employeeEl.classList.add('disabled-employee');
                employeeEl.setAttribute('title', 'Pracownik jest już przypisany do innej kolumny w tym okresie');
            }

            employeeEl.addEventListener('click', () => {
                // Nie pozwól kliknąć na wyszarzonych
                if (employeeEl.classList.contains('disabled-employee')) return;
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

        const tableHeaders = Array.from(table.querySelectorAll('thead th')).map((th, index) => ({
            text: th.textContent || '',
            style: 'tableHeader',
            fillColor: index === 0 ? PdfHeaderColors.firstColumn : PdfHeaderColors.dataColumns,
            color: PdfHeaderColors.text,
        }));

        const tableBody = Array.from(table.querySelectorAll('tbody tr')).map((row) => {
            const tr = row as HTMLTableRowElement;
            return Array.from(tr.cells).map((cell, cellIndex) => {
                let textContent = '';

                if (cellIndex === 0) {
                    // Kolumna okresu - użyj textContent
                    textContent = cell.textContent || '';
                } else if (cellIndex === 8) {
                    // Kolumna urlopów - pobierz tekst z każdego .leave-entry lub użyj textContent
                    const leaveEntries = cell.querySelectorAll('.leave-entry');
                    if (leaveEntries.length > 0) {
                        textContent = Array.from(leaveEntries)
                            .map(entry => entry.textContent?.trim() || '')
                            .join('\n');
                    } else {
                        // Fallback - usuń tagi HTML
                        textContent = cell.textContent || '';
                    }
                } else {
                    const period = tr.dataset.startDate || '';
                    const cellState = appState.changesCells[period]?.[cellIndex];
                    if (cellState?.assignedEmployees) {
                        textContent = cellState.assignedEmployees.map((id) => EmployeeManager.getLastNameById(id)).join('\n');
                    }
                }

                return {
                    text: textContent,
                    fillColor: cellIndex === 0 ? PdfColors.slate100 : null,
                    alignment: cellIndex === 0 ? 'left' : 'center',
                };
            });
        });

        const docDefinition = {
            ...PdfPageConfig,
            content: [
                { text: `Grafik Zmian - ${currentYear}`, style: 'header' },
                {
                    style: 'tableExample',
                    table: {
                        headerRows: 1,
                        widths: ['auto', '*', '*', '*', '*', '*', '*', '*', '*'],
                        body: [tableHeaders, ...tableBody],
                    },
                    layout: PdfTableLayoutCompact,
                },
            ],
            styles: {
                ...PdfStyles,
                tableHeader: {
                    bold: true,
                    fontSize: 10,
                    alignment: 'center' as const,
                },
            },
            defaultStyle: PdfDefaultStyle,
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
        document.addEventListener('keydown', handleKeyDown);

        populateYearSelect();
        await refreshView();
        await EmployeeManager.load();

        // Setup mobile accordion
        setupMobileAccordion();

        const contextMenuItems = [
            { id: 'ctxCopyCell', action: (cell: HTMLElement) => copyCell(cell as HTMLTableCellElement) },
            { id: 'ctxPasteCell', action: (cell: HTMLElement) => pasteCell(cell as HTMLTableCellElement) },
            { id: 'ctxClearCell', action: (cell: HTMLElement) => clearCell(cell as HTMLTableCellElement) },
        ];
        window.initializeContextMenu('changesContextMenu', '#changesTableBody td:not(.leaves-cell)', contextMenuItems);
    };

    const setupMobileAccordion = (): void => {
        // Only setup on mobile screens
        if (window.innerWidth > 768) return;

        const tableBody = document.getElementById('changesTableBody');
        if (!tableBody) return;

        // Add click handlers for accordion toggle
        tableBody.addEventListener('click', (event: Event) => {
            const target = event.target as HTMLElement;
            const firstCell = target.closest('td:first-child');

            if (firstCell) {
                const row = firstCell.closest('tr');
                if (row) {
                    row.classList.toggle('expanded');
                }
                event.stopPropagation();
            }
        }, true);

        // Find and expand current period
        const today = new Date();
        today.setHours(0, 0, 0, 0);


        const rows = tableBody.querySelectorAll('tr');
        rows.forEach((row) => {
            const tr = row as HTMLTableRowElement;
            const startDateStr = tr.dataset.startDate;
            const endDateStr = tr.dataset.endDate;

            if (startDateStr && endDateStr) {
                const periodStart = new Date(startDateStr);
                const periodEnd = new Date(endDateStr);

                // Check if today falls within this period
                if (today >= periodStart && today <= periodEnd) {
                    tr.classList.add('expanded', 'current-period');
                    // Scroll to current period
                    setTimeout(() => {
                        tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                }
            }
        });
    };

    const destroy = (): void => {
        const printButton = document.getElementById('printChangesTable');
        document.removeEventListener('app:search', handleAppSearch);
        document.removeEventListener('keydown', handleKeyDown);
        if (printButton) {
            printButton.removeEventListener('click', printChangesTableToPdf);
        }
        if (window.destroyContextMenu) {
            window.destroyContextMenu('changesContextMenu');
        }
        setActiveCell(null);
        debugLog('Changes module destroyed');
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
