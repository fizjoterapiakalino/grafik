document.addEventListener('DOMContentLoaded', () => {
    // --- SELEKTORY I ZMIENNE GLOBALNE ---
    const loadingOverlay = document.getElementById('loadingOverlay');
    const leavesTableBody = document.getElementById('leavesTableBody');
    const leavesHeaderRow = document.getElementById('leavesHeaderRow');
    const modal = document.getElementById('calendarModal');
    const prevMonthBtn = document.getElementById('prevMonthBtn');
    const nextMonthBtn = document.getElementById('nextMonthBtn');
    const confirmBtn = document.getElementById('confirmSelectionBtn');
    const cancelBtn = document.getElementById('cancelSelectionBtn');
    const clearSelectionBtn = document.getElementById('clearSelectionBtn');
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearch');
    const contextMenu = document.getElementById('contextMenu');
    const contextClearCell = document.getElementById('contextClearCell');
    const contextOpenCalendar = document.getElementById('contextOpenCalendar');

    // Nowe selektory dla modala z dwoma kalendarzami
    const leftMonthAndYear = document.getElementById('leftMonthAndYear');
    const rightMonthAndYear = document.getElementById('rightMonthAndYear');
    const leftCalendarGrid = document.getElementById('leftCalendarGrid');
    const rightCalendarGrid = document.getElementById('rightCalendarGrid');
    const startDatePreview = document.getElementById('startDatePreview');
    const endDatePreview = document.getElementById('endDatePreview');

    let currentEmployee = null;
    let currentYear = new Date().getUTCFullYear();
    let leftCalendarDate = new Date(Date.UTC(currentYear, new Date().getUTCMonth(), 1));
    
    // Zmienne do zarządzania stanem wyboru w kalendarzu
    let selectionStartDate = null;
    let hoverEndDate = null;
    let singleSelectedDays = new Set();
    let isRangeSelectionActive = false;
    let activeContextMenuCell = null;

    // --- FUNKCJE POMOCNICZE UTC ---
    const toUTCDate = (dateString) => {
        const [year, month, day] = dateString.split('-').map(Number);
        return new Date(Date.UTC(year, month - 1, day));
    };

    const toDateString = (date) => {
        return date.toISOString().split('T')[0];
    };

    // --- GŁÓWNA LOGIKA APLIKACJI ---

    const initializePage = async () => {
        generateTableHeaders();
        const employeeNames = await getEmployeeNames();
        generateTableRows(employeeNames);
        await loadAllLeavesData();
        hideLoadingOverlay(loadingOverlay);
    };

    const getEmployeeNames = async () => {
        const cachedNames = sessionStorage.getItem('employeeNames');
        if (cachedNames) return JSON.parse(cachedNames);
        try {
            const docRef = db.collection("schedules").doc("mainSchedule");
            const doc = await docRef.get();
            if (doc.exists) {
                const employeeNames = Object.values(doc.data().employeeHeaders || {});
                if (employeeNames.length > 0) {
                    sessionStorage.setItem('employeeNames', JSON.stringify(employeeNames));
                    return employeeNames;
                }
            }
            return [];
        } catch (error) {
            console.error('Nie udało się pobrać nazwisk pracowników:', error);
            return [];
        }
    };

    const generateTableHeaders = () => {
        leavesHeaderRow.innerHTML = `<th>Pracownik / ${currentYear}</th>`;
        months.forEach(month => {
            const th = document.createElement('th');
            th.textContent = month;
            leavesHeaderRow.appendChild(th);
        });
    };

    const generateTableRows = (employeeNames) => {
        leavesTableBody.innerHTML = '';
        employeeNames.forEach(name => {
            if (!name) return;
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

    // --- LOGIKA DANYCH URLOPOWYCH (FIRESTORE) ---

    const loadAllLeavesData = async () => {
        try {
            const docRef = db.collection("leaves").doc("mainLeaves");
            const doc = await docRef.get();
            if (doc.exists) {
                const allLeaves = doc.data();
                Object.keys(allLeaves).forEach(employeeName => {
                    const leaves = allLeaves[employeeName] || [];
                    renderEmployeeLeaves(employeeName, leaves);
                });
            }
        } catch (error) {
            console.error("Błąd ładowania danych o urlopach:", error);
            window.showToast("Błąd ładowania urlopów.", 5000);
        }
    };

    const saveLeavesData = async (employeeName, leaves) => {
        try {
            await db.collection("leaves").doc("mainLeaves").set({
                [employeeName]: leaves
            }, { merge: true });
            window.showToast('Zapisano urlopy!', 2000);
        } catch (error) {
            console.error('Błąd zapisu urlopów do Firestore:', error);
            window.showToast('Błąd zapisu urlopów!', 5000);
        }
    };

    // --- RENDEROWANIE URLOPÓW W TABELI ---

    const renderEmployeeLeaves = (employeeName, leaves) => {
        const employeeRow = leavesTableBody.querySelector(`tr[data-employee="${employeeName}"]`);
        if (!employeeRow) return;

        employeeRow.querySelectorAll('.day-cell').forEach(cell => { cell.innerHTML = ''; });

        const leaveColors = {};
        const colors = ['#ffab91', '#ffcc80', '#e6ee9b', '#80deea', '#cf93d9', '#f48fb1'];
        let colorIndex = 0;

        leaves.forEach(leave => {
            if (!leave.id || !leave.startDate || !leave.endDate) return;

            if (!leaveColors[leave.id]) {
                leaveColors[leave.id] = colors[colorIndex % colors.length];
                colorIndex++;
            }
            const bgColor = leaveColors[leave.id];

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

    // --- LOGIKA MODALA I KALENDARZA ---

    const openModal = (cell) => {
        if (!cell) return;
        currentEmployee = cell.closest('tr').dataset.employee;
        const monthIndex = parseInt(cell.dataset.month, 10);
        leftCalendarDate = new Date(Date.UTC(currentYear, monthIndex, 1));

        resetSelection();
        loadEmployeeLeavesForModal();
        
        modal.style.display = 'flex';
    };

    const closeModal = () => {
        modal.style.display = 'none';
        currentEmployee = null;
    };

    const resetSelection = () => {
        selectionStartDate = null;
        hoverEndDate = null;
        singleSelectedDays.clear();
        isRangeSelectionActive = false;
    };

    const loadEmployeeLeavesForModal = async () => {
        try {
            const docRef = db.collection("leaves").doc("mainLeaves");
            const doc = await docRef.get();
            if (doc.exists) {
                const employeeLeaves = doc.data()[currentEmployee] || [];
                employeeLeaves.forEach(leave => {
                    const start = toUTCDate(leave.startDate);
                    const end = toUTCDate(leave.endDate);
                    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
                        singleSelectedDays.add(toDateString(d));
                    }
                });
            }
        } catch (error) {
            console.error("Błąd ładowania urlopów pracownika:", error);
        } finally {
            generateCalendars();
            updateSelectionPreview();
        }
    };

    const generateCalendars = () => {
        const rightCalendarDate = new Date(leftCalendarDate);
        rightCalendarDate.setUTCMonth(rightCalendarDate.getUTCMonth() + 1);
        generateCalendar(leftCalendarGrid, leftMonthAndYear, leftCalendarDate.getUTCFullYear(), leftCalendarDate.getUTCMonth());
        generateCalendar(rightCalendarGrid, rightMonthAndYear, rightCalendarDate.getUTCFullYear(), rightCalendarDate.getUTCMonth());
    };

    const generateCalendar = (grid, header, year, month) => {
        grid.innerHTML = `<div class="day-name">Po</div><div class="day-name">Wt</div><div class="day-name">Śr</div><div class="day-name">Cz</div><div class="day-name">Pi</div><div class="day-name">So</div><div class="day-name">Ni</div>`;
        header.textContent = `${months[month]} ${year}`;

        const firstDayOfMonth = new Date(Date.UTC(year, month, 1));
        const startingDay = (firstDayOfMonth.getUTCDay() === 0) ? 6 : firstDayOfMonth.getUTCDay() - 1;
        for (let i = 0; i < startingDay; i++) {
            grid.insertAdjacentHTML('beforeend', `<div class="day-cell-calendar other-month"></div>`);
        }

        const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        for (let i = 1; i <= daysInMonth; i++) {
            const dayCell = document.createElement('div');
            dayCell.classList.add('day-cell-calendar');
            dayCell.textContent = i;
            dayCell.dataset.date = toDateString(new Date(Date.UTC(year, month, i)));
            grid.appendChild(dayCell);
        }
        updateAllDayCells();
    };

    const updateAllDayCells = () => {
        document.querySelectorAll('#calendarModal .day-cell-calendar').forEach(cell => {
            if (cell.dataset.date) {
                updateDayCellSelection(cell);
            }
        });
    };

    const updateDayCellSelection = (dayCell) => {
        const dateString = dayCell.dataset.date;
        dayCell.className = 'day-cell-calendar'; // Reset classes

        let startStr = selectionStartDate;
        let endStr = hoverEndDate;
        if (startStr && endStr && startStr > endStr) [startStr, endStr] = [endStr, startStr];

        const isInRange = isRangeSelectionActive && startStr && endStr && dateString >= startStr && dateString <= endStr;
        
        if (singleSelectedDays.has(dateString) || isInRange) {
            dayCell.classList.add('selected');
            
            const isStartDate = dateString === startStr || (singleSelectedDays.has(dateString) && !singleSelectedDays.has(toDateString(new Date(toUTCDate(dateString).getTime() - 86400000))));
            const isEndDate = dateString === endStr || (singleSelectedDays.has(dateString) && !singleSelectedDays.has(toDateString(new Date(toUTCDate(dateString).getTime() + 86400000))));

            if (isInRange && dateString !== startStr && dateString !== endStr) dayCell.classList.add('in-range');
            if (isStartDate) dayCell.classList.add('start-date');
            if (isEndDate) dayCell.classList.add('end-date');
        }
    };

    const handleDayClick = (event) => {
        const target = event.target.closest('.day-cell-calendar');
        if (!target || !target.dataset.date) return;
        const clickedDate = target.dataset.date;

        if (event.ctrlKey || event.metaKey) {
            isRangeSelectionActive = false;
            selectionStartDate = null;
            if (singleSelectedDays.has(clickedDate)) {
                singleSelectedDays.delete(clickedDate);
            } else {
                singleSelectedDays.add(clickedDate);
            }
        } else {
            if (!isRangeSelectionActive) {
                isRangeSelectionActive = true;
                selectionStartDate = clickedDate;
            } else {
                let start = selectionStartDate;
                let end = clickedDate;
                if (start > end) [start, end] = [end, start];
                
                const startDate = toUTCDate(start);
                const endDate = toUTCDate(end);

                for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
                    singleSelectedDays.add(toDateString(d));
                }
                isRangeSelectionActive = false;
                selectionStartDate = null;
            }
        }
        
        hoverEndDate = null;
        updateAllDayCells();
        updateSelectionPreview();
    };

    const handleDayMouseOver = (event) => {
        const target = event.target.closest('.day-cell-calendar');
        if (!target || !target.dataset.date || !isRangeSelectionActive) return;
        
        if (hoverEndDate !== target.dataset.date) {
            hoverEndDate = target.dataset.date;
            updateAllDayCells();
        }
    };

    const updateSelectionPreview = () => {
        const dates = Array.from(singleSelectedDays).sort();
        startDatePreview.textContent = dates.length > 0 ? dates[0] : '-';
        endDatePreview.textContent = dates.length > 0 ? dates[dates.length - 1] : '-';
    };

    const confirmSelection = async () => {
        if (!currentEmployee) return;

        const sortedDays = Array.from(singleSelectedDays).sort();
        const newLeaves = [];
        
        if (sortedDays.length > 0) {
            let rangeStart = sortedDays[0];
            let rangeEnd = sortedDays[0];

            for (let i = 1; i < sortedDays.length; i++) {
                const prevDay = toUTCDate(sortedDays[i-1]);
                const currentDay = toUTCDate(sortedDays[i]);
                
                const diff = (currentDay - prevDay) / (1000 * 60 * 60 * 24);

                if (diff === 1) {
                    rangeEnd = sortedDays[i];
                } else {
                    newLeaves.push({ id: toUTCDate(rangeStart).getTime().toString(), startDate: rangeStart, endDate: rangeEnd });
                    rangeStart = sortedDays[i];
                    rangeEnd = sortedDays[i];
                }
            }
            newLeaves.push({ id: toUTCDate(rangeStart).getTime().toString(), startDate: rangeStart, endDate: rangeEnd });
        }

        await saveLeavesData(currentEmployee, newLeaves);
        renderEmployeeLeaves(currentEmployee, newLeaves);
        closeModal();
    };

    const clearCellLeaves = async (cell) => {
        if (!cell) return;
        const employeeName = cell.closest('tr').dataset.employee;
        const monthToClear = parseInt(cell.dataset.month, 10);

        try {
            const docRef = db.collection("leaves").doc("mainLeaves");
            const doc = await docRef.get();
            if (!doc.exists) return;

            const allLeaves = doc.data();
            const employeeLeaves = allLeaves[employeeName] || [];
            
            const remainingLeaves = employeeLeaves.filter(leave => {
                const start = toUTCDate(leave.startDate);
                const end = toUTCDate(leave.endDate);
                return end.getUTCMonth() < monthToClear || start.getUTCMonth() > monthToClear;
            });

            await saveLeavesData(employeeName, remainingLeaves);
            renderEmployeeLeaves(employeeName, remainingLeaves);

        } catch (error) {
            console.error("Błąd podczas czyszczenia komórki:", error);
            window.showToast("Błąd podczas czyszczenia komórki.", 5000);
        }
    };

    // --- OBSŁUGA ZDARZEŃ ---
    leavesTableBody.addEventListener('click', (event) => {
        const targetCell = event.target.closest('.day-cell');
        if (targetCell) openModal(targetCell);
    });

    leavesTableBody.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        const targetCell = event.target.closest('.day-cell');
        if (targetCell) {
            activeContextMenuCell = targetCell;
            contextMenu.style.top = `${event.pageY}px`;
            contextMenu.style.left = `${event.pageX}px`;
            contextMenu.classList.add('visible');
        }
    });

    document.addEventListener('click', (e) => {
        if (!contextMenu.contains(e.target)) {
            contextMenu.classList.remove('visible');
            activeContextMenuCell = null;
        }
    });

    contextClearCell.addEventListener('click', () => {
        clearCellLeaves(activeContextMenuCell);
        contextMenu.classList.remove('visible');
    });

    contextOpenCalendar.addEventListener('click', () => {
        openModal(activeContextMenuCell);
        contextMenu.classList.remove('visible');
    });
    prevMonthBtn.addEventListener('click', () => {
        leftCalendarDate.setUTCMonth(leftCalendarDate.getUTCMonth() - 1);
        generateCalendars();
    });
    nextMonthBtn.addEventListener('click', () => {
        leftCalendarDate.setUTCMonth(leftCalendarDate.getUTCMonth() + 1);
        generateCalendars();
    });
    [leftCalendarGrid, rightCalendarGrid].forEach(grid => {
        grid.addEventListener('click', handleDayClick);
        grid.addEventListener('mouseover', handleDayMouseOver);
    });
    confirmBtn.addEventListener('click', confirmSelection);
    cancelBtn.addEventListener('click', closeModal);
    clearSelectionBtn.addEventListener('click', () => {
        resetSelection();
        updateAllDayCells();
        updateSelectionPreview();
    });
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });
    searchInput.addEventListener('input', (event) => {
        const searchTerm = event.target.value.trim().toLowerCase();
        document.querySelectorAll('#leavesTableBody tr').forEach(row => {
            row.style.display = row.dataset.employee.toLowerCase().includes(searchTerm) ? '' : 'none';
        });
        clearSearchBtn.style.display = searchTerm ? 'block' : 'none';
    });
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
    });

    // --- INICJALIZACJA ---
    initializePage().catch(err => {
        console.error("Błąd inicjalizacji strony urlopów:", err);
    });
});
