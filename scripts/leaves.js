const Leaves = (() => {
    // --- SELEKTORY I ZMIENNE GLOBALNE ---
    let loadingOverlay, leavesTableBody, leavesHeaderRow, searchInput, clearSearchBtn,
        monthlyViewBtn, summaryViewBtn, careViewBtn, monthlyViewContainer, careViewContainer,
        clearFiltersBtn, leavesFilterContainer;
    
    const months = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"];

    let currentYear = new Date().getUTCFullYear();
    let activeCell = null;
    let activeFilters = new Set();

    // --- Nazwane funkcje obsługi zdarzeń ---
    const _handleAppSearch = (e) => {
        const { searchTerm } = e.detail;
        const lowerCaseSearchTerm = searchTerm.toLowerCase();
        document.querySelectorAll('#leavesTableBody tr').forEach(row => {
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
                if (currentIndexInRow > 1) { // Blokada przed przejściem na komórkę z nazwą pracownika
                    nextElement = currentRow.cells[currentIndexInRow - 1];
                }
                break;
            case 'ArrowDown':
                const nextRow = currentRow.nextElementSibling;
                if (nextRow) {
                    nextElement = nextRow.cells[currentIndexInRow];
                }
                break;
            case 'ArrowUp':
                const prevRow = currentRow.previousElementSibling;
                if (prevRow) {
                    nextElement = prevRow.cells[currentIndexInRow];
                }
                break;
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

    // --- GŁÓWNA LOGIKA APLIKACJI ---

    const generateLegendAndFilters = () => {
        const legendContainer = document.getElementById('leavesLegend');
        if (!legendContainer) return;
        legendContainer.innerHTML = '<strong>Filtruj wg typu:</strong>';
        const leaveTypeSelect = document.getElementById('leaveTypeSelect');
        
        // Jeśli activeFilters jest puste, zainicjuj je wszystkimi typami urlopów
        if (activeFilters.size === 0) {
            Array.from(leaveTypeSelect.options).forEach(option => {
                activeFilters.add(option.value);
            });
        }

        legendContainer.innerHTML = '<strong>Filtruj wg typu:</strong>'; // Wyczyść kontener przed ponownym generowaniem

        Array.from(leaveTypeSelect.options).forEach(option => {
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

        // Usuń poprzednie nasłuchiwacze, aby uniknąć wielokrotnego przypisania
        const oldLegendContainer = legendContainer.cloneNode(true);
        legendContainer.parentNode.replaceChild(oldLegendContainer, legendContainer);
        const newLegendContainer = document.getElementById('leavesLegend');

        newLegendContainer.addEventListener('change', async (e) => {
            if (e.target.classList.contains('filter-checkbox')) {
                if (e.target.checked) {
                    activeFilters.add(e.target.value);
                } else {
                    activeFilters.delete(e.target.value);
                }
                const allLeaves = await getAllLeavesData();
                renderAllEmployeeLeaves(allLeaves);
            }
        });
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
        leavesFilterContainer = document.getElementById('leavesFilterContainer'); // Inicjalizuj tutaj

        // Inicjalizacja modułów zależnych
        CalendarModal.init();

        if (loadingOverlay) loadingOverlay.style.display = 'flex';
        try {
            await EmployeeManager.load();
            generateLegendAndFilters(); // Generuj filtry przed pierwszym renderowaniem
            clearFiltersBtn = document.getElementById('clearFiltersBtn'); // Inicjalizuj tutaj po wygenerowaniu filtrów
            setupEventListeners(); // Ustaw nasłuchiwacze po wygenerowaniu filtrów
            await showMonthlyView(); // Wywołaj showMonthlyView po załadowaniu filtrów

            // --- Inicjalizacja Menu Kontekstowego ---
            const contextMenuItems = [
                { id: 'contextOpenCalendar', action: (cell) => openCalendarForCell(cell) },
                { id: 'contextClearCell', action: (cell) => clearCellLeaves(cell) }
            ];
            window.initializeContextMenu('contextMenu', '.day-cell', contextMenuItems);

        } catch (error) {
            console.error("Błąd inicjalizacji strony urlopów:", error);
            window.showToast("Wystąpił krytyczny błąd inicjalizacji. Odśwież stronę.", 5000);
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

        if (window.destroyContextMenu) {
            window.destroyContextMenu('contextMenu');
        }
        activeCell = null;
        console.log("Leaves module destroyed");
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
            console.log("Operacja w kalendarzu została anulowana.", error);
            window.showToast("Anulowano zmiany.", 2000);
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
        if (clearFiltersBtn) { // Dodaj sprawdzenie istnienia elementu
            clearFiltersBtn.addEventListener('click', handleClearFilters);
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
        months.forEach(month => {
            const th = document.createElement('th');
            th.textContent = month;
            leavesHeaderRow.appendChild(th);
        });
    };

    const generateTableRows = (employees) => {
        leavesTableBody.innerHTML = '';
        const sortedEmployeeNames = Object.values(employees)
            .filter(emp => !emp.isHidden)
            .map(emp => emp.displayName || emp.name)
            .filter(Boolean)
            .sort();
        sortedEmployeeNames.forEach(name => {
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
            const docRef = db.collection(AppConfig.firestore.collections.leaves).doc(AppConfig.firestore.docs.mainLeaves);
            const doc = await docRef.get();
            return doc.exists ? doc.data() : {};
        } catch (error) {
            console.error("Błąd podczas ładowania danych o urlopach z Firestore:", error);
            window.showToast("Wystąpił błąd podczas ładowania danych o urlopach. Spróbuj ponownie.", 5000);
            return {};
        }
    };

    const saveLeavesData = async (employeeName, leaves) => {
        try {
            await db.collection(AppConfig.firestore.collections.leaves).doc(AppConfig.firestore.docs.mainLeaves).set({ [employeeName]: leaves }, { merge: true });
            window.showToast('Urlopy zapisane pomyślnie.', 2000);
        } catch (error) {
            console.error('Błąd podczas zapisu urlopów do Firestore:', error);
            window.showToast('Wystąpił błąd podczas zapisu urlopów. Spróbuj ponownie.', 5000);
        }
    };

    const renderAllEmployeeLeaves = (allLeaves) => {
        Object.keys(allLeaves).forEach(employeeName => {
            renderSingleEmployeeLeaves(employeeName, allLeaves[employeeName] || []);
        });
    };

    const renderSingleEmployeeLeaves = (employeeName, leaves) => {
        const employeeRow = leavesTableBody.querySelector(`tr[data-employee="${employeeName}"]`);
        if (!employeeRow) return;
        employeeRow.querySelectorAll('.day-cell').forEach(cell => { cell.innerHTML = ''; });

        const filteredLeaves = leaves.filter(leave => activeFilters.has(leave.type || 'vacation'));

        filteredLeaves.forEach(leave => {
            if (!leave.id || !leave.startDate || !leave.endDate) return;
            
            const bgColor = AppConfig.leaves.leaveTypeColors[leave.type] || AppConfig.leaves.leaveTypeColors.default;
            const start = toUTCDate(leave.startDate);
            const end = toUTCDate(leave.endDate);
            let currentMonth = -1;
            for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
                if (d.getUTCFullYear() !== currentYear) continue;
                if (d.getUTCMonth() !== currentMonth) {
                    currentMonth = d.getUTCMonth();
                    const cell = employeeRow.querySelector(`td[data-month="${currentMonth}"]`);
                    if (!cell) continue;
                    const monthStart = new Date(Math.max(start, Date.UTC(currentYear, currentMonth, 1)));
                    const monthEnd = new Date(Math.min(end, Date.UTC(currentYear, currentMonth + 1, 0)));
                    const div = document.createElement('div');
                    div.classList.add('leave-block');
                    const leaveTypeName = document.querySelector(`#leaveTypeSelect option[value="${leave.type || 'vacation'}"]`).textContent;
                    div.setAttribute('title', leaveTypeName);
                    div.style.backgroundColor = bgColor;
                    let text = '';
                    if (start < monthStart) text += `<span class="arrow">←</span> `;
                    text += `${monthStart.getUTCDate()}`;
                    if (monthStart.getTime() !== monthEnd.getTime()) text += `-${monthEnd.getUTCDate()}`;
                    if (end > monthEnd) text += ` <span class="arrow">→</span>`;
                    div.innerHTML = text;
                    cell.appendChild(div);
                }
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
            const remainingLeaves = employeeLeaves.filter(leave => {
                const start = toUTCDate(leave.startDate);
                const end = toUTCDate(leave.endDate);
                return end.getUTCMonth() < monthToClear || start.getUTCMonth() > monthToClear;
            });
            await saveLeavesData(employeeName, remainingLeaves);
            renderSingleEmployeeLeaves(employeeName, remainingLeaves);
        } catch (error) {
            console.error("Błąd podczas czyszczenia urlopów w komórce:", error);
            window.showToast("Wystąpił błąd podczas czyszczenia urlopów. Spróbuj ponownie.", 5000);
        }
    };

    return {
        init,
        destroy
    };
})();