// scripts/leaves.js
import { db } from './firebase-config.js';
import { AppConfig, hideLoadingOverlay } from './common.js';
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
        currentYearBtn;

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

        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            clearCellLeaves(activeCell);
        }
    };

    // --- FUNKCJE POMOCNICZE UTC ---
    const toUTCDate = (dateString) => {
        const [year, month, day] = dateString.split('-').map(Number);
        return new Date(Date.UTC(year, month - 1, day));
    };

    const handleYearChange = async (e) => {
        currentYear = parseInt(e.target.value, 10);
        await showMonthlyView(); // Re-render the monthly view for the new year
    };

    const populateYearSelect = () => {
        const currentYear = new Date().getUTCFullYear();
        const startYear = currentYear - 5; // 5 years back
        const endYear = currentYear + 5; // 5 years forward

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

        // Inicjalizacja modułów zależnych
        CalendarModal.init();

        if (loadingOverlay) loadingOverlay.style.display = 'flex';
        try {
            await EmployeeManager.load();
            populateYearSelect(); // Nowa funkcja do wypełniania i ustawiania nasłuchiwacza
            generateLegendAndFilters();
            clearFiltersBtn = document.getElementById('clearFiltersBtn');
            setupEventListeners();
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

        if (window.destroyContextMenu) {
            window.destroyContextMenu('contextMenu');
        }
        activeCell = null;
        console.log('Leaves module destroyed');
    };

    const openCalendarForCell = async (cell) => {
        if (!cell) return;
        const employeeName = cell.closest('tr').dataset.employee;
        const monthIndex = parseInt(cell.dataset.month, 10);

        try {
            const allLeaves = await getAllLeavesData();
            const existingLeaves = allLeaves[employeeName] || [];
            const updatedLeaves = await CalendarModal.open(employeeName, existingLeaves, monthIndex);

            await saveLeavesData(employeeName, updatedLeaves);
            renderSingleEmployeeLeaves(employeeName, updatedLeaves);
        } catch (error) {
            console.log('Operacja w kalendarzu została anulowana.', error);
            window.showToast('Anulowano zmiany.', 2000);
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
            await showMonthlyView();
        } else {
            // If already on current year, just ensure highlight is correct (maybe re-render or just highlight)
            highlightCurrentMonth();
        }
    };

    const highlightCurrentMonth = () => {
        // Remove existing highlights
        document.querySelectorAll('.current-month-column').forEach(el => el.classList.remove('current-month-column'));

        const now = new Date();
        if (currentYear === now.getUTCFullYear()) {
            const currentMonthIndex = now.getUTCMonth();
            // Highlight header (index + 1 because of employee name column)
            if (leavesHeaderRow && leavesHeaderRow.children[currentMonthIndex + 1]) {
                leavesHeaderRow.children[currentMonthIndex + 1].classList.add('current-month-column');
            }
            // Highlight cells
            document.querySelectorAll(`td[data-month="${currentMonthIndex}"]`).forEach(cell => {
                cell.classList.add('current-month-column');
            });
        }
    };

    const showSummaryView = async () => {
        monthlyViewBtn.classList.remove('active');
        summaryViewBtn.classList.add('active');
        careViewBtn.classList.remove('active');

        monthlyViewContainer.style.display = ''; // Podsumowanie roczne używa tej samej tabeli
        careViewContainer.style.display = 'none';
        leavesFilterContainer.style.display = 'none'; // Ukryj kontener filtrów

        const allLeaves = await getAllLeavesData();
        LeavesSummary.render(leavesHeaderRow, leavesTableBody, allLeaves);
    };

    const showCareView = async () => {
        monthlyViewBtn.classList.remove('active');
        summaryViewBtn.classList.remove('active');
        careViewBtn.classList.add('active');

        monthlyViewContainer.style.display = 'none';
        careViewContainer.style.display = 'block';
        leavesFilterContainer.style.display = 'none'; // Ukryj kontener filtrów

        const allLeaves = await getAllLeavesData();
        LeavesCareSummary.render(careViewContainer, allLeaves);
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
        const sortedEmployeeNames = Object.values(employees)
            .filter((emp) => !emp.isHidden)
            .map((emp) => emp.displayName || emp.name)
            .filter(Boolean)
            .sort();
        sortedEmployeeNames.forEach((name) => {
            const tr = document.createElement('tr');
            tr.dataset.employee = name;
            const nameTd = document.createElement('td');
            nameTd.textContent = name;
            nameTd.classList.add('employee-name-cell');
            tr.appendChild(nameTd);
            months.forEach((_, monthIndex) => {
                const monthTd = document.createElement('td');
                monthTd.classList.add('day-cell');
                monthTd.dataset.month = monthIndex;
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
        employeeRow.querySelectorAll('.day-cell').forEach((cell) => {
            cell.innerHTML = '';
        });

        const filteredLeaves = leaves.filter((leave) => activeFilters.has(leave.type || 'vacation'));

        filteredLeaves.forEach((leave) => {
            if (!leave.id || !leave.startDate || !leave.endDate) return;

            const bgColor = AppConfig.leaves.leaveTypeColors[leave.type] || AppConfig.leaves.leaveTypeColors.default;
            const start = toUTCDate(leave.startDate);
            const end = toUTCDate(leave.endDate);

            // Optimization: Only iterate through months that overlap with the current year
            if (end.getUTCFullYear() < currentYear || start.getUTCFullYear() > currentYear) return;

            let startMonthIndex = 0;
            let endMonthIndex = 11;

            if (start.getUTCFullYear() === currentYear) startMonthIndex = start.getUTCMonth();
            if (end.getUTCFullYear() === currentYear) endMonthIndex = end.getUTCMonth();

            for (let monthIndex = startMonthIndex; monthIndex <= endMonthIndex; monthIndex++) {
                const cell = employeeRow.querySelector(`td[data-month="${monthIndex}"]`);
                if (!cell) continue;

                const monthStart = new Date(Date.UTC(currentYear, monthIndex, 1));
                const monthEnd = new Date(Date.UTC(currentYear, monthIndex + 1, 0));

                // Check if leave actually overlaps with this month (should be true by loop logic, but good for safety)
                if (start > monthEnd || end < monthStart) continue;

                const div = document.createElement('div');
                div.classList.add('leave-block');
                const leaveOption = document.querySelector(`#leaveTypeSelect option[value="${leave.type || 'vacation'}"]`);
                const leaveTypeName = leaveOption ? leaveOption.textContent : 'Urlop';

                div.setAttribute('title', leaveTypeName);
                div.style.backgroundColor = bgColor;

                let text = '';
                // Arrow if starts before this month
                if (start < monthStart) text += `<span class="arrow">←</span> `;

                // Start day in this month
                const displayStart = start > monthStart ? start.getUTCDate() : monthStart.getUTCDate();
                text += `${displayStart}`;

                // End day in this month
                const displayEnd = end < monthEnd ? end.getUTCDate() : monthEnd.getUTCDate();

                if (displayStart !== displayEnd) {
                    text += `-${displayEnd}`;
                }

                // Arrow if ends after this month
                if (end > monthEnd) text += ` <span class="arrow">→</span>`;

                div.innerHTML = text;
                cell.appendChild(div);
            }
        });
    };

    const clearCellLeaves = async (cell) => {
        if (!cell) return;
        const employeeName = cell.closest('tr').dataset.employee;
        const monthToClear = parseInt(cell.dataset.month, 10);
        try {
            const allLeaves = await getAllLeavesData();
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

    return {
        init,
        destroy,
    };
})();

// Backward compatibility
window.Leaves = Leaves;
