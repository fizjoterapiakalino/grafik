// scripts/leaves.js
import { db } from './firebase-config.js';
import { AppConfig, hideLoadingOverlay, UndoManager } from './common.js';
import { EmployeeManager } from './employee-manager.js';
import { LeavesSummary } from './leaves-summary.js';
import { LeavesCareSummary } from './leaves-care-summary.js';
import { CalendarModal } from './calendar-modal.js';

export const Leaves = (() => {
    // --- SELEKTORY I ZMIENNE GLOBALNE ---
    let loadingOverlay,
        leavesTableBody,
        leavesHeaderRow,
        searchInput,
        clearSearchBtn,
        monthlyViewBtn,
        summaryViewBtn,
        careViewBtn,
        monthlyViewContainer,
        careViewContainer,
        clearFiltersBtn,
        leavesFilterContainer,
        yearSelect,
        currentYearBtn,
        printLeavesNavbarBtn;

    const months = [
        'Styczeń',
        'Luty',
        'Marzec',
        'Kwiecień',
        'Maj',
        'Czerwiec',
        'Lipiec',
        'Sierpień',
        'Wrzesień',
        'Październik',
        'Listopad',
        'Grudzień',
    ];

    let currentYear = new Date().getUTCFullYear();
    let activeCell = null;
    let activeFilters = new Set();

    // Undo
    let undoManager;
    let appState = {
        leaves: {}
    };

    // --- Nazwane funkcje obsługi zdarzeń ---
    const _handleAppSearch = (e) => {
        const { searchTerm } = e.detail;
        const lowerCaseSearchTerm = searchTerm.toLowerCase();
        document.querySelectorAll('#leavesTableBody tr').forEach((row) => {
            row.style.display = row.dataset.employee.toLowerCase().includes(lowerCaseSearchTerm) ? '' : 'none';
        });
    };

    const _handleTableDblClick = (event) => {
        const targetCell = event.target.closest('.day-cell');
        openCalendarForCell(targetCell);
    };

    const _handleTableClick = (event) => {
        const target = event.target.closest('.day-cell');
        if (target) {
            setActiveCell(target);
        } else {
            setActiveCell(null);
        }
    };

    const setActiveCell = (cell) => {
        if (activeCell) {
            activeCell.classList.remove('active-cell');
        }
        activeCell = cell;
        if (activeCell) {
            activeCell.classList.add('active-cell');
            activeCell.focus();
        }
    };

    const _handleArrowNavigation = (key) => {
        if (!activeCell) return;

        let nextElement = null;
        const currentRow = activeCell.closest('tr');
        const currentIndexInRow = Array.from(currentRow.cells).indexOf(activeCell);

        switch (key) {
            case 'ArrowRight':
                nextElement = currentRow.cells[currentIndexInRow + 1];
                break;
            case 'ArrowLeft':
                if (currentIndexInRow > 1) {
                    // Blokada przed przejściem na komórkę z nazwą pracownika
                    nextElement = currentRow.cells[currentIndexInRow - 1];
                }
                break;
            case 'ArrowDown': {
                const nextRow = currentRow.nextElementSibling;
                if (nextRow) {
                    nextElement = nextRow.cells[currentIndexInRow];
                }
                break;
            }
            case 'ArrowUp': {
                const prevRow = currentRow.previousElementSibling;
                if (prevRow) {
                    nextElement = prevRow.cells[currentIndexInRow];
                }
                break;
            }
        }

        if (nextElement && nextElement.classList.contains('day-cell')) {
            setActiveCell(nextElement);
        }
    };

    const _handleKeyDown = (event) => {
        if (!activeCell) return;

        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault();
            _handleArrowNavigation(event.key);
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            openCalendarForCell(activeCell);
        }

        if (event.ctrlKey && event.key === 'z') {
            event.preventDefault();
            undoLastAction();
            return;
        }

        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            clearCellLeaves(activeCell);
        }
    };

    const undoLastAction = () => {
        const prevState = undoManager.undo();
        if (prevState) {
            // Restore functionality needs to be smart.
            // Since we save partial updates to Firestore, we might need to restore full state.
            // But here we rely on getAllLeavesData to refresh, or we can restore the local state and save it back.
            // A simple approach: Restore local state object, then save *that entire object* to Firestore?
            // "mainLeaves" doc contains all users.

            // Actually, we should probably save the entire mainLeaves doc state in undo stack.
            const restoredLeaves = prevState.leaves;

            // We need to re-save this entire object to Firestore to be consistent?
            // Yes, "Undo" in a multi-user app is tricky. 
            // For now, let's assume last-write-wins and we overwrite with old state.

            saveAllLeavesData(restoredLeaves).then(() => {
                refreshCurrentView();
                window.showToast('Cofnięto ostatnią zmianę.', 2000);
            });
        } else {
            window.showToast('Brak akcji do cofnięcia.', 2000);
        }
    };

    // --- FUNKCJE POMOCNICZE UTC ---
    const toUTCDate = (dateString) => {
        const [year, month, day] = dateString.split('-').map(Number);
        return new Date(Date.UTC(year, month - 1, day));
    };

    const refreshCurrentView = async () => {
        if (monthlyViewBtn.classList.contains('active')) {
            await showMonthlyView();
        } else if (summaryViewBtn.classList.contains('active')) {
            await showSummaryView();
        } else if (careViewBtn.classList.contains('active')) {
            await showCareView();
        }
    };

    const handleYearChange = async (e) => {
        currentYear = parseInt(e.target.value, 10);
        await refreshCurrentView();
    };

    const populateYearSelect = () => {
        const currentYear = new Date().getUTCFullYear();
        const startYear = currentYear - 5; // 5 years back
        const endYear = currentYear + 10; // 10 years forward (increased for better planning)

        yearSelect.innerHTML = ''; // Clear existing options

        for (let year = startYear; year <= endYear; year++) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            if (year === currentYear) {
                option.selected = true;
            }
            yearSelect.appendChild(option);
        }
        yearSelect.addEventListener('change', handleYearChange);
    };

    // --- GŁÓWNA LOGIKA APLIKACJI ---

    const generateLegendAndFilters = () => {
        const legendContainer = document.getElementById('leavesLegend');
        if (!legendContainer) return;
        legendContainer.innerHTML = '<strong>Filtruj wg typu:</strong>';
        const leaveTypeSelect = document.getElementById('leaveTypeSelect');

        // Jeśli activeFilters jest puste, zainicjuj je wszystkimi typami urlopów
        if (activeFilters.size === 0) {
            Array.from(leaveTypeSelect.options).forEach((option) => {
                activeFilters.add(option.value);
            });
        }

        legendContainer.innerHTML = '<strong>Filtruj wg typu:</strong>'; // Wyczyść kontener przed ponownym generowaniem

        Array.from(leaveTypeSelect.options).forEach((option) => {
            const key = option.value;
            const color = AppConfig.leaves.leaveTypeColors[key] || AppConfig.leaves.leaveTypeColors.default;

            const filterItem = document.createElement('label');
            filterItem.className = 'legend-item filter-label';
            filterItem.innerHTML = `
                <input type="checkbox" class="filter-checkbox" value="${key}" ${activeFilters.has(key) ? 'checked' : ''}>
                <span class="legend-color-box" style="background-color: ${color};"></span> ${option.textContent}
            `;
            legendContainer.appendChild(filterItem);
        });

        // Use a named function for the event listener to avoid duplication issues
        const handleFilterChange = async (e) => {
            if (e.target.classList.contains('filter-checkbox')) {
                if (e.target.checked) {
                    activeFilters.add(e.target.value);
                } else {
                    activeFilters.delete(e.target.value);
                }
                const allLeaves = await getAllLeavesData();
                renderAllEmployeeLeaves(allLeaves);
            }
        };

        // Remove existing listener if any (though we are replacing the container content, 
        // it's safer to attach to the container which persists or is re-queried)
        // Since we are clearing innerHTML, we lose the listeners on children, but the container itself is stable?
        // Actually, in the original code, we were cloning the container to remove listeners.
        // Let's stick to a simpler approach: just add the listener to the container once in init, 
        // or ensure we don't add it multiple times.

        // Better approach: Attach listener to leavesFilterContainer ONCE in init, and delegate.
        // But here we are inside generateLegendAndFilters which might be called multiple times.
        // Let's check if we already attached the listener.
        if (!legendContainer.hasAttribute('data-listener-attached')) {
            legendContainer.addEventListener('change', handleFilterChange);
            legendContainer.setAttribute('data-listener-attached', 'true');
        }
    };

    const init = async () => {
        // --- Inicjalizacja selektorów ---
        loadingOverlay = document.getElementById('loadingOverlay');
        leavesTableBody = document.getElementById('leavesTableBody');
        leavesHeaderRow = document.getElementById('leavesHeaderRow');
        searchInput = document.getElementById('searchInput');
        clearSearchBtn = document.getElementById('clearSearch');
        monthlyViewBtn = document.getElementById('monthlyViewBtn');
        summaryViewBtn = document.getElementById('summaryViewBtn');
        careViewBtn = document.getElementById('careViewBtn');
        monthlyViewContainer = document.getElementById('leavesTable');
        careViewContainer = document.getElementById('careViewContainer');
        leavesFilterContainer = document.getElementById('leavesFilterContainer');
        yearSelect = document.getElementById('yearSelect');
        currentYearBtn = document.getElementById('currentYearBtn');
        printLeavesNavbarBtn = document.getElementById('printLeavesNavbarBtn');

        // Inicjalizacja modułów zależnych
        CalendarModal.init();

        if (loadingOverlay) loadingOverlay.style.display = 'flex';
        try {
            await EmployeeManager.load();
            populateYearSelect(); // Nowa funkcja do wypełniania i ustawiania nasłuchiwacza
            generateLegendAndFilters();
            clearFiltersBtn = document.getElementById('clearFiltersBtn');
            setupEventListeners();

            // Load initial data for UndoManager
            const allLeaves = await getAllLeavesData();
            appState.leaves = allLeaves;

            undoManager = new UndoManager({ maxStates: 20 });
            undoManager.initialize(appState);

            await showMonthlyView();
            highlightCurrentMonth();

            // --- Inicjalizacja Menu Kontekstowego ---
            const contextMenuItems = [
                { id: 'contextOpenCalendar', action: (cell) => openCalendarForCell(cell) },
                { id: 'contextClearCell', action: (cell) => clearCellLeaves(cell) },
            ];
            window.initializeContextMenu('contextMenu', '.day-cell', contextMenuItems);
        } catch (error) {
            console.error('Błąd inicjalizacji strony urlopów:', error);
            window.showToast('Wystąpił krytyczny błąd inicjalizacji. Odśwież stronę.', 5000);
        } finally {
            if (loadingOverlay) hideLoadingOverlay(loadingOverlay);
        }
    };

    const destroy = () => {
        monthlyViewBtn.removeEventListener('click', showMonthlyView);
        summaryViewBtn.removeEventListener('click', showSummaryView);
        careViewBtn.removeEventListener('click', showCareView);
        leavesTableBody.removeEventListener('dblclick', _handleTableDblClick);
        leavesTableBody.removeEventListener('click', _handleTableClick);
        document.removeEventListener('keydown', _handleKeyDown);
        document.removeEventListener('app:search', _handleAppSearch);
        clearFiltersBtn.removeEventListener('click', handleClearFilters);
        yearSelect.removeEventListener('change', handleYearChange);
        if (currentYearBtn) currentYearBtn.removeEventListener('click', handleCurrentYearClick);
        if (printLeavesNavbarBtn) printLeavesNavbarBtn.removeEventListener('click', printLeavesTableToPdf);

        if (window.destroyContextMenu) {
            window.destroyContextMenu('contextMenu');
        }
        activeCell = null;
        console.log('Leaves module destroyed');
    };

    const openCalendarForCell = async (cell) => {
        if (!cell) return;
        const tr = cell.closest('tr');
        const employeeName = tr.dataset.employee;
        const employeeId = tr.dataset.id;
        const monthIndex = parseInt(cell.dataset.month, 10);

        try {
            const allLeaves = await getAllLeavesData();
            const existingLeaves = allLeaves[employeeName] || [];

            const leaveInfo = EmployeeManager.getLeaveInfoById(employeeId, currentYear);
            const totalLimit = (parseInt(leaveInfo.entitlement, 10) || 0) + (parseInt(leaveInfo.carriedOver, 10) || 0);

            const updatedLeaves = await CalendarModal.open(
                employeeName,
                existingLeaves,
                monthIndex,
                currentYear,
                { totalLimit: totalLimit }
            );

            // Push state before saving changes
            // Note: getAllLeavesData called above gives us the 'before' state of *all* leaves? 
            // Yes, existingLeaves is just for one employee. We need full state.
            appState.leaves = allLeaves; // Update local state with fresh data
            undoManager.pushState(appState);

            await saveLeavesData(employeeName, updatedLeaves);
            renderSingleEmployeeLeaves(employeeName, updatedLeaves);
        } catch (error) {
            console.log('Operacja w kalendarzu została anulowana.', error);
            if (error !== 'Modal closed without confirmation') {
                window.showToast('Anulowano zmiany.', 2000);
            }
        }
    };

    const setupEventListeners = () => {
        monthlyViewBtn.addEventListener('click', showMonthlyView);
        summaryViewBtn.addEventListener('click', showSummaryView);
        careViewBtn.addEventListener('click', showCareView);
        leavesTableBody.addEventListener('dblclick', _handleTableDblClick);
        leavesTableBody.addEventListener('click', _handleTableClick);
        document.addEventListener('keydown', _handleKeyDown);
        document.addEventListener('app:search', _handleAppSearch);
        if (clearFiltersBtn) {
            clearFiltersBtn.addEventListener('click', handleClearFilters);
        }
        if (currentYearBtn) {
            currentYearBtn.addEventListener('click', handleCurrentYearClick);
        }
        if (printLeavesNavbarBtn) {
            printLeavesNavbarBtn.addEventListener('click', printLeavesTableToPdf);
        }
    };

    const handleClearFilters = async () => {
        activeFilters.clear(); // Wyczyść wszystkie aktywne filtry
        generateLegendAndFilters(); // Ponownie wygeneruj legendę, aby odznaczyć wszystkie checkboxy
        const allLeaves = await getAllLeavesData();
        renderAllEmployeeLeaves(allLeaves);
    };

    const showMonthlyView = async () => {
        monthlyViewBtn.classList.add('active');
        summaryViewBtn.classList.remove('active');
        careViewBtn.classList.remove('active');

        monthlyViewContainer.style.display = '';
        careViewContainer.style.display = 'none';
        leavesFilterContainer.style.display = 'flex'; // Pokaż kontener filtrów

        generateTableHeaders();
        const employees = EmployeeManager.getAll();
        generateTableRows(employees);
        const allLeaves = await getAllLeavesData();
        renderAllEmployeeLeaves(allLeaves);
        highlightCurrentMonth();
    };

    const handleCurrentYearClick = async () => {
        const now = new Date();
        const thisYear = now.getUTCFullYear();
        if (currentYear !== thisYear) {
            currentYear = thisYear;
            yearSelect.value = currentYear;
            await refreshCurrentView();
        } else {
            // If already on current year, just ensure highlight is correct (maybe re-render or just highlight)
            highlightCurrentMonth();
        }
    };

    const highlightCurrentMonth = () => {
        // Remove existing highlights
        document.querySelectorAll('.current-month-column').forEach(el => el.classList.remove('current-month-column'));
        document.querySelectorAll('.past-month-column').forEach(el => el.classList.remove('past-month-column'));

        const now = new Date();
        const actualYear = now.getUTCFullYear();
        const actualMonthIndex = now.getUTCMonth();

        // Jeśli przeglądamy rok wcześniejszy niż obecny - wyszarzamy wszystkie miesiące
        if (currentYear < actualYear) {
            months.forEach((_, monthIndex) => {
                _applyPastMonthHighlight(monthIndex);
            });
        }
        // Jeśli przeglądamy rok obecny - wyszarzamy miesiące poprzednie i podświetlamy obecny
        else if (currentYear === actualYear) {
            months.forEach((_, monthIndex) => {
                if (monthIndex < actualMonthIndex) {
                    _applyPastMonthHighlight(monthIndex);
                } else if (monthIndex === actualMonthIndex) {
                    _applyCurrentMonthHighlight(monthIndex);
                }
            });
        }
        // Jeśli rok przyszły - nic nie wyszarzamy
    };

    const _applyCurrentMonthHighlight = (monthIndex) => {
        if (leavesHeaderRow && leavesHeaderRow.children[monthIndex + 1]) {
            leavesHeaderRow.children[monthIndex + 1].classList.add('current-month-column');
        }
        document.querySelectorAll(`td[data-month="${monthIndex}"]`).forEach(cell => {
            cell.classList.add('current-month-column');
        });
    };

    const _applyPastMonthHighlight = (monthIndex) => {
        if (leavesHeaderRow && leavesHeaderRow.children[monthIndex + 1]) {
            leavesHeaderRow.children[monthIndex + 1].classList.add('past-month-column');
        }
        document.querySelectorAll(`td[data-month="${monthIndex}"]`).forEach(cell => {
            cell.classList.add('past-month-column');
        });
    };

    const showSummaryView = async () => {
        monthlyViewBtn.classList.remove('active');
        summaryViewBtn.classList.add('active');
        careViewBtn.classList.remove('active');

        monthlyViewContainer.style.display = ''; // Podsumowanie roczne używa tej samej tabeli
        careViewContainer.style.display = 'none';
        leavesFilterContainer.style.display = 'none'; // Ukryj kontener filtrów

        const allLeaves = await getAllLeavesData();
        LeavesSummary.render(leavesHeaderRow, leavesTableBody, allLeaves, currentYear);
    };

    const showCareView = async () => {
        monthlyViewBtn.classList.remove('active');
        summaryViewBtn.classList.remove('active');
        careViewBtn.classList.add('active');

        monthlyViewContainer.style.display = 'none';
        careViewContainer.style.display = 'block';
        leavesFilterContainer.style.display = 'none'; // Ukryj kontener filtrów

        const allLeaves = await getAllLeavesData();
        LeavesCareSummary.render(careViewContainer, allLeaves, currentYear);
    };

    const printLeavesTableToPdf = () => {
        const table = document.getElementById('leavesTable');
        if (!table) return;

        // Clone headers to avoid modifying the DOM or getting stuck with references
        const headers = Array.from(table.querySelectorAll('thead th')).map((th, index) => ({
            text: th.textContent,
            style: 'tableHeader',
            // Make the first column (Employee Name) a bit wider, others auto or fixed
            width: index === 0 ? 100 : '*',
        }));

        // Extract body data
        const body = Array.from(table.querySelectorAll('tbody tr')).map((row) => {
            return Array.from(row.cells).map((cell, index) => {
                // If it's a day cell with leave blocks, extract text
                if (index > 0) {
                    const blocks = Array.from(cell.querySelectorAll('.leave-block'));
                    if (blocks.length > 0) {
                        return blocks.map(b => b.textContent).join('\n');
                    }
                }
                return cell.textContent.trim();
            });
        });

        const docDefinition = {
            pageOrientation: 'landscape',
            pageSize: 'A3', // Use A3 for wide monthly view or A4 if enough
            pageMargins: [20, 20, 20, 20],
            content: [
                { text: `Grafik Urlopów - ${currentYear}`, style: 'header' },
                {
                    style: 'tableExample',
                    table: {
                        headerRows: 1,
                        // defined widths in headers object instead
                        widths: headers.map(h => h.width),
                        body: [
                            headers,
                            ...body
                        ],
                    },
                    layout: {
                        fillColor: function (rowIndex, node, columnIndex) {
                            return rowIndex === 0 ? '#4CAF50' : null;
                        },
                        hLineWidth: function (i, node) { return 0.5; },
                        vLineWidth: function (i, node) { return 0.5; },
                    },
                },
            ],
            styles: {
                header: {
                    fontSize: 18,
                    bold: true,
                    margin: [0, 0, 0, 10],
                },
                tableExample: {
                    margin: [0, 5, 0, 15],
                },
                tableHeader: {
                    bold: true,
                    fontSize: 10,
                    color: 'white',
                    alignment: 'center'
                },
            },
            defaultStyle: {
                font: 'Roboto',
                fontSize: 8 // Smaller font for big table
            },
        };

        pdfMake.createPdf(docDefinition).download(`grafik-urlopow-${currentYear}.pdf`);
    };

    const generateTableHeaders = () => {
        leavesHeaderRow.innerHTML = `<th>Pracownik / ${currentYear}</th>`;
        months.forEach((month) => {
            const th = document.createElement('th');
            th.textContent = month;
            leavesHeaderRow.appendChild(th);
        });
    };

    const generateTableRows = (employees) => {
        leavesTableBody.innerHTML = '';
        const sortedEmployees = Object.entries(employees)
            .map(([id, emp]) => ({ ...emp, id }))
            .filter((emp) => !emp.isHidden && !emp.isScheduleOnly)
            .sort((a, b) => EmployeeManager.compareEmployees(a, b));

        sortedEmployees.forEach((emp) => {
            const name = emp.displayName || emp.name;
            const tr = document.createElement('tr');
            tr.dataset.employee = name;
            tr.dataset.id = emp.id; // Store ID for lookup

            const nameTd = document.createElement('td');
            nameTd.textContent = EmployeeManager.getFullNameById(emp.id);
            nameTd.classList.add('employee-name-cell');
            tr.appendChild(nameTd);
            months.forEach((_, monthIndex) => {
                const monthTd = document.createElement('td');
                monthTd.classList.add('day-cell');
                monthTd.dataset.month = monthIndex;
                monthTd.setAttribute('data-label', months[monthIndex]); // Dodanie etykiety dla RWD
                monthTd.setAttribute('tabindex', '0');
                tr.appendChild(monthTd);
            });
            leavesTableBody.appendChild(tr);
        });
    };

    const getAllLeavesData = async () => {
        try {
            const docRef = db
                .collection(AppConfig.firestore.collections.leaves)
                .doc(AppConfig.firestore.docs.mainLeaves);
            const doc = await docRef.get();
            return doc.exists ? doc.data() : {};
        } catch (error) {
            console.error('Błąd podczas ładowania danych o urlopach z Firestore:', error);
            window.showToast('Wystąpił błąd podczas ładowania danych o urlopach. Spróbuj ponownie.', 5000);
            return {};
        }
    };

    const saveLeavesData = async (employeeName, leaves) => {
        try {
            await db
                .collection(AppConfig.firestore.collections.leaves)
                .doc(AppConfig.firestore.docs.mainLeaves)
                .set({ [employeeName]: leaves }, { merge: true });
            window.showToast('Urlopy zapisane pomyślnie.', 2000);
        } catch (error) {
            console.error('Błąd podczas zapisu urlopów do Firestore:', error);
            window.showToast('Wystąpił błąd podczas zapisu urlopów. Spróbuj ponownie.', 5000);
        }
    };

    const renderAllEmployeeLeaves = (allLeaves) => {
        Object.keys(allLeaves).forEach((employeeName) => {
            renderSingleEmployeeLeaves(employeeName, allLeaves[employeeName] || []);
        });
    };

    const renderSingleEmployeeLeaves = (employeeName, leaves) => {
        const employeeRow = leavesTableBody.querySelector(`tr[data-employee="${employeeName}"]`);
        if (!employeeRow) return;

        // Clear all cells first
        employeeRow.querySelectorAll('.day-cell').forEach((cell) => {
            cell.innerHTML = '';
            cell.classList.remove('has-content');
        });

        // 1. FILTER & SORT
        const filteredLeaves = leaves
            .filter((leave) => {
                if (!leave.id || !leave.startDate || !leave.endDate) return false;
                if (!activeFilters.has(leave.type || 'vacation')) return false;

                const start = toUTCDate(leave.startDate);
                const end = toUTCDate(leave.endDate);

                // Optimization: Only keep leaves that overlap with the current year
                if (end.getUTCFullYear() < currentYear || start.getUTCFullYear() > currentYear) return false;
                return true;
            })
            .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

        // 2. SWIMLANE ASSIGNMENT
        // lanes[laneIndex][monthIndex] = leaveObject | null
        const lanes = [];

        filteredLeaves.forEach((leave) => {
            const start = toUTCDate(leave.startDate);
            const end = toUTCDate(leave.endDate);

            // Determine month range (0-11) for the current year
            let startMonthIndex = 0;
            let endMonthIndex = 11;

            if (start.getUTCFullYear() === currentYear) startMonthIndex = start.getUTCMonth();
            else if (start.getUTCFullYear() > currentYear) startMonthIndex = 12; // Out of bounds right

            if (end.getUTCFullYear() === currentYear) endMonthIndex = end.getUTCMonth();
            else if (end.getUTCFullYear() < currentYear) endMonthIndex = -1; // Out of bounds left

            // Clamp locally to 0-11 for matrix usage
            const effectiveStart = Math.max(0, startMonthIndex);
            const effectiveEnd = Math.min(11, endMonthIndex);

            if (effectiveStart > effectiveEnd) return; // Should have been caught by filter, but safety first

            // Find the first lane that is empty for all months in [effectiveStart, effectiveEnd]
            let laneIndex = 0;
            while (true) {
                if (!lanes[laneIndex]) lanes[laneIndex] = new Array(12).fill(null);

                let isLaneFree = true;
                for (let m = effectiveStart; m <= effectiveEnd; m++) {
                    if (lanes[laneIndex][m] !== null && lanes[laneIndex][m] !== undefined) {
                        isLaneFree = false;
                        break;
                    }
                }

                if (isLaneFree) {
                    // Place items in the matrix
                    for (let m = effectiveStart; m <= effectiveEnd; m++) {
                        lanes[laneIndex][m] = leave;
                    }
                    break;
                }
                laneIndex++;
            }
        });

        // 3. RENDER
        // Iterate through each month (column)
        for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
            const cell = employeeRow.querySelector(`td[data-month="${monthIndex}"]`);
            if (!cell) continue;

            const monthStart = new Date(Date.UTC(currentYear, monthIndex, 1));
            const monthEnd = new Date(Date.UTC(currentYear, monthIndex + 1, 0));

            // Find highest occupied lane for this month to know how many rows to render
            let maxLaneForMonth = -1;
            for (let l = 0; l < lanes.length; l++) {
                if (lanes[l] && lanes[l][monthIndex]) {
                    maxLaneForMonth = l;
                }
            }

            // Render each lane up to maxLaneForMonth
            for (let l = 0; l <= maxLaneForMonth; l++) {
                const leave = lanes[l] ? lanes[l][monthIndex] : null;

                if (leave) {
                    const bgColor = AppConfig.leaves.leaveTypeColors[leave.type] || AppConfig.leaves.leaveTypeColors.default;
                    const start = toUTCDate(leave.startDate);
                    const end = toUTCDate(leave.endDate);

                    const div = document.createElement('div');
                    div.classList.add('leave-block');
                    const leaveOption = document.querySelector(`#leaveTypeSelect option[value="${leave.type || 'vacation'}"]`);
                    const leaveTypeName = leaveOption ? leaveOption.textContent : 'Urlop';

                    div.setAttribute('title', leaveTypeName);
                    div.style.backgroundColor = bgColor;

                    // Continuity logic
                    if (start < monthStart) {
                        div.classList.add('continues-left');
                    }
                    if (end > monthEnd) {
                        div.classList.add('continues-right');
                    }

                    let text = '';
                    const displayStart = start > monthStart ? start.getUTCDate() : monthStart.getUTCDate();
                    text += `${displayStart}`;
                    const displayEnd = end < monthEnd ? end.getUTCDate() : monthEnd.getUTCDate();

                    if (displayStart !== displayEnd) {
                        text += `-${displayEnd}`;
                    }

                    div.innerHTML = text;
                    cell.appendChild(div);
                    cell.classList.add('has-content'); // Mark cell as having content for CSS filtering
                } else {
                    // Render SPACER
                    const spacer = document.createElement('div');
                    spacer.classList.add('leave-spacer');
                    spacer.innerHTML = '&nbsp;';
                    cell.appendChild(spacer);
                }
            }
        }
    };

    const clearCellLeaves = async (cell) => {
        if (!cell) return;
        const employeeName = cell.closest('tr').dataset.employee;
        const monthToClear = parseInt(cell.dataset.month, 10);
        try {
            const allLeaves = await getAllLeavesData();

            // Push state before modification
            appState.leaves = allLeaves;
            undoManager.pushState(appState);

            const employeeLeaves = allLeaves[employeeName] || [];
            const remainingLeaves = employeeLeaves.filter((leave) => {
                const start = toUTCDate(leave.startDate);
                const end = toUTCDate(leave.endDate);
                return end.getUTCMonth() < monthToClear || start.getUTCMonth() > monthToClear;
            });
            await saveLeavesData(employeeName, remainingLeaves);
            renderSingleEmployeeLeaves(employeeName, remainingLeaves);
        } catch (error) {
            console.error('Błąd podczas czyszczenia urlopów w komórce:', error);
            window.showToast('Wystąpił błąd podczas czyszczenia urlopów. Spróbuj ponownie.', 5000);
        }
    };

    // Helper to save full state (for undo)
    const saveAllLeavesData = async (allLeavesData) => {
        try {
            await db
                .collection(AppConfig.firestore.collections.leaves)
                .doc(AppConfig.firestore.docs.mainLeaves)
                .set(allLeavesData); // Overwrite entire doc
            // Update local appState to match
            appState.leaves = allLeavesData;
        } catch (error) {
            console.error('Błąd podczas przywracania urlopów:', error);
            throw error;
        }
    };

    return {
        init,
        destroy,
    };
})();

// Backward compatibility
window.Leaves = Leaves;
