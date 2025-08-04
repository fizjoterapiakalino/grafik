document.addEventListener('DOMContentLoaded', () => {
    // --- SELEKTORY I ZMIENNE GLOBALNE ---
    const loadingOverlay = document.getElementById('loadingOverlay');
    const leavesTable = document.getElementById('leavesTable');
    const leavesTableBody = document.getElementById('leavesTableBody');
    const leavesHeaderRow = document.getElementById('leavesHeaderRow');
    const modal = document.getElementById('calendarModal');
    const monthAndYear = document.getElementById('monthAndYear');
    const calendarGrid = document.getElementById('calendarGrid');
    const prevMonthBtn = document.getElementById('prevMonthBtn');
    const nextMonthBtn = document.getElementById('nextMonthBtn');
    const confirmBtn = document.getElementById('confirmSelectionBtn');
    const cancelBtn = document.getElementById('cancelSelectionBtn');
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearch');
    const contextMenu = document.getElementById('contextMenu');
    const contextClearCell = document.getElementById('contextClearCell');
    const contextOpenCalendar = document.getElementById('contextOpenCalendar');
    const undoButton = document.getElementById('undoButton');

    let activeCell = null; // Obecnie aktywna komórka (TD)
    let cellForModal = null; // Komórka, dla której otwarty jest modal
    let currentDate = new Date();
    let selectedDays = [];
    let lastSelectedDay = null;

    const undoManager = new UndoManager({
        maxStates: MAX_UNDO_STATES,
        onUpdate: (manager) => {
            undoButton.disabled = !manager.canUndo();
        }
    });

    const setActiveCell = (cell) => {
        if (activeCell) {
            activeCell.classList.remove('active-cell');
            const oldIcon = activeCell.querySelector('.calendar-icon');
            if (oldIcon) oldIcon.remove();
        }
        
        activeCell = cell;

        if (activeCell) {
            activeCell.classList.add('active-cell');
            activeCell.focus();

            // Dodaj ikonę kalendarza
            if (!activeCell.querySelector('.calendar-icon')) {
                const icon = document.createElement('i');
                icon.className = 'fas fa-calendar-alt calendar-icon';
                activeCell.appendChild(icon);
            }
        }
    };

    // --- EDYCJA KOMÓREK ---
    const enterEditMode = (element, clearContent = false, initialChar = '') => {
        if (!element || element.getAttribute('contenteditable') === 'true') return;

        undoManager.pushState(getCurrentTableState());
        
        element.dataset.originalValue = element.textContent;
        element.setAttribute('contenteditable', 'true');

        if (clearContent) {
            element.textContent = initialChar;
        } else if (initialChar) {
            element.textContent += initialChar;
        }

        element.focus();
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(element);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    };

    const exitEditMode = (element) => {
        if (!element || element.getAttribute('contenteditable') !== 'true') return;

        const originalText = element.dataset.originalValue || '';
        const newText = capitalizeFirstLetter(element.textContent.trim());

        element.setAttribute('contenteditable', 'false');
        element.textContent = newText;

        if (originalText !== newText) {
            saveLeavesData();
            undoManager.pushState(getCurrentTableState());
        }
    };

    // --- FUNKCJE KALENDARZA ---
    const generateCalendar = (year, month) => {
        calendarGrid.innerHTML = `
            <div class="day-name">Pon</div><div class="day-name">Wto</div><div class="day-name">Śro</div>
            <div class="day-name">Czw</div><div class="day-name">Pią</div><div class="day-name">Sob</div>
            <div class="day-name">Nie</div>`;
        monthAndYear.textContent = `${months[month]} ${year}`;
        currentDate = new Date(year, month);
        const firstDayOfMonth = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const startingDay = (firstDayOfMonth === 0) ? 6 : firstDayOfMonth - 1;
        for (let i = 0; i < startingDay; i++) {
            const emptyCell = document.createElement('div');
            emptyCell.classList.add('day-cell-calendar', 'empty');
            calendarGrid.appendChild(emptyCell);
        }
        for (let i = 1; i <= daysInMonth; i++) {
            const dayCell = document.createElement('div');
            dayCell.classList.add('day-cell-calendar');
            dayCell.textContent = i;
            dayCell.dataset.day = i;
            if (selectedDays.includes(i)) {
                dayCell.classList.add('selected');
            }
            calendarGrid.appendChild(dayCell);
        }
    };

    const openModal = (cell) => {
        cellForModal = cell;
        const monthIndex = parseInt(cell.dataset.month, 10);
        const year = new Date().getFullYear();
        selectedDays = parseDaysFromString(cellForModal.textContent);
        lastSelectedDay = null;
        generateCalendar(year, monthIndex);
        modal.style.display = 'flex';
    };

    const closeModal = () => {
        modal.style.display = 'none';
        selectedDays = [];
        cellForModal = null;
    };

    const formatDaysToString = (days) => {
        if (days.length === 0) return '';
        days.sort((a, b) => a - b);
        const ranges = [];
        let start = days[0];
        let end = days[0];
        for (let i = 1; i < days.length; i++) {
            if (days[i] === end + 1) {
                end = days[i];
            } else {
                ranges.push(start === end ? `${start}` : `${start}-${end}`);
                start = end = days[i];
            }
        }
        ranges.push(start === end ? `${start}` : `${start}-${end}`);
        return ranges.join(', ');
    };

    const parseDaysFromString = (str) => {
        if (!str) return [];
        const days = new Set();
        str.split(',').forEach(part => {
            const trimmedPart = part.trim();
            if (trimmedPart.includes('-')) {
                const [start, end] = trimmedPart.split('-').map(Number);
                for (let i = start; i <= end; i++) {
                    days.add(i);
                }
            } else if (trimmedPart) {
                days.add(Number(trimmedPart));
            }
        });
        return Array.from(days);
    };

    // --- LOGIKA POBIERANIA DANYCH I GENEROWANIA TABELI ---
    const getEmployeeNames = async () => {
        const cachedNames = sessionStorage.getItem('employeeNames');
        if (cachedNames) {
            return JSON.parse(cachedNames);
        }

        try {
            const docRef = db.collection("schedules").doc("mainSchedule");
            const doc = await docRef.get();
            if (doc.exists) {
                const data = doc.data();
                if (data.employeeHeaders && Object.keys(data.employeeHeaders).length > 0) {
                    const employeeNames = Object.values(data.employeeHeaders);
                    sessionStorage.setItem('employeeNames', JSON.stringify(employeeNames));
                    return employeeNames;
                }
            }
            throw new Error('Brak zapisanych nagłówków pracowników w Firestore.');
        } catch (error) {
            console.error('Nie udało się pobrać nazwisk pracowników z Firestore:', error);
            let fallbackNames = [];
            for (let i = 0; i < 13; i++) {
                fallbackNames.push(`Pracownik ${i + 1}`);
            }
            return fallbackNames;
        }
    };

    const generateTableHeaders = () => {
        leavesHeaderRow.innerHTML = '<th>Pracownik</th>';
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
            const nameTd = document.createElement('td');
            nameTd.textContent = name;
            nameTd.classList.add('employee-name-cell');
            tr.appendChild(nameTd);
            months.forEach((month, monthIndex) => {
                const monthTd = document.createElement('td');
                monthTd.classList.add('day-cell');
                monthTd.dataset.employee = name;
                monthTd.dataset.month = monthIndex;
                monthTd.setAttribute('tabindex', '0');
                tr.appendChild(monthTd);
            });
            leavesTableBody.appendChild(tr);
        });
    };

    // --- WYSZUKIWANIE ---
    const filterTable = (searchTerm) => {
        searchAndHighlight(searchTerm, '#leavesTable', '.employee-name-cell, .day-cell');
    };

    // --- UNDO/REDO ---
    const getCurrentTableState = () => {
        const state = {};
        document.querySelectorAll('#leavesTableBody .day-cell').forEach(cell => {
            const key = `${cell.dataset.employee}-${cell.dataset.month}`;
            state[key] = cell.textContent;
        });
        return state;
    };

    const applyTableState = (state) => {
        if (!state) return;
        document.querySelectorAll('#leavesTableBody .day-cell').forEach(cell => {
            const key = `${cell.dataset.employee}-${cell.dataset.month}`;
            cell.textContent = state[key] || '';
        });
        saveLeavesData();
    };

    const undoLastAction = () => {
        const prevState = undoManager.undo();
        if (prevState) {
            applyTableState(prevState);
        }
    };

    // --- EVENT LISTENERS ---
    leavesTable.addEventListener('click', (event) => {
        const targetCell = event.target.closest('.day-cell');
        if (targetCell) {
            if (event.target.classList.contains('calendar-icon')) {
                openModal(targetCell);
            } else {
                setActiveCell(targetCell);
            }
        } else {
            if (activeCell && activeCell.getAttribute('contenteditable') === 'true') {
                exitEditMode(activeCell);
            }
            setActiveCell(null);
        }
    });

    leavesTable.addEventListener('dblclick', (event) => {
        const targetCell = event.target.closest('.day-cell');
        if (targetCell) {
            enterEditMode(targetCell);
        }
    });

    leavesTable.addEventListener('contextmenu', (event) => {
        const targetCell = event.target.closest('.day-cell');
        if (targetCell) {
            event.preventDefault();
            setActiveCell(targetCell);
            contextMenu.classList.add('visible');
            contextMenu.style.left = `${event.pageX}px`;
            contextMenu.style.top = `${event.pageY}px`;
        }
    });

    document.addEventListener('click', (event) => {
        if (!contextMenu.contains(event.target)) {
            contextMenu.classList.remove('visible');
        }
        if (!event.target.closest('.active-cell')) {
             if (activeCell && activeCell.getAttribute('contenteditable') === 'true') {
                exitEditMode(activeCell);
            }
            setActiveCell(null);
        }
    });

    contextClearCell.addEventListener('click', () => {
        if (activeCell) {
            undoManager.pushState(getCurrentTableState());
            activeCell.textContent = '';
            saveLeavesData();
            undoManager.pushState(getCurrentTableState());
        }
        contextMenu.classList.remove('visible');
    });

    contextOpenCalendar.addEventListener('click', () => {
        if (activeCell) {
            openModal(activeCell);
        }
        contextMenu.classList.remove('visible');
    });

    calendarGrid.addEventListener('click', (event) => {
        const target = event.target;
        if (!target.classList.contains('day-cell-calendar') || target.classList.contains('empty')) return;
        const day = parseInt(target.dataset.day, 10);
        target.classList.toggle('selected');
        if (event.shiftKey && lastSelectedDay !== null) {
            const start = Math.min(day, lastSelectedDay);
            const end = Math.max(day, lastSelectedDay);
            selectedDays = [...new Set([...selectedDays, ...Array.from({ length: end - start + 1 }, (_, i) => start + i)])];
        } else {
            if (selectedDays.includes(day)) {
                selectedDays = selectedDays.filter(d => d !== day);
            } else {
                selectedDays.push(day);
            }
        }
        lastSelectedDay = day;
        generateCalendar(currentDate.getFullYear(), currentDate.getMonth());
    });

    prevMonthBtn.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        generateCalendar(currentDate.getFullYear(), currentDate.getMonth());
    });

    nextMonthBtn.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        generateCalendar(currentDate.getFullYear(), currentDate.getMonth());
    });

    confirmBtn.addEventListener('click', () => {
        if (cellForModal) {
            undoManager.pushState(getCurrentTableState());
            cellForModal.textContent = formatDaysToString(selectedDays);
            saveLeavesData();
            undoManager.pushState(getCurrentTableState());
        }
        closeModal();
    });

    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });

    searchInput.addEventListener('input', (event) => {
        const searchTerm = event.target.value.trim();
        filterTable(searchTerm);
        clearSearchBtn.style.display = searchTerm ? 'block' : 'none';
    });

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        filterTable('');
    });

    undoButton.addEventListener('click', undoLastAction);

    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
            event.preventDefault();
            undoLastAction();
            return;
        }

        const isEditing = document.activeElement.getAttribute('contenteditable') === 'true';

        if (isEditing) {
            if (event.key === 'Escape') exitEditMode(document.activeElement);
            if (event.key === 'Enter') {
                 event.preventDefault();
                 exitEditMode(document.activeElement);
            }
            return;
        }
        
        if (!activeCell) return;

        if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            undoManager.pushState(getCurrentTableState());
            activeCell.textContent = '';
            saveLeavesData();
            undoManager.pushState(getCurrentTableState());
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            enterEditMode(activeCell);
            return;
        }
        
        if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault();
            enterEditMode(activeCell, true, event.key);
            return;
        }

        let nextElement = null;
        const currentRow = activeCell.closest('tr');
        const currentIndexInRow = Array.from(currentRow.cells).indexOf(activeCell);

        switch (event.key) {
            case 'ArrowRight':
                nextElement = currentRow.cells[currentIndexInRow + 1];
                break;
            case 'ArrowLeft':
                nextElement = currentRow.cells[currentIndexInRow - 1];
                break;
            case 'ArrowDown':
                const nextRow = currentRow.nextElementSibling;
                if (nextRow) nextElement = nextRow.cells[currentIndexInRow];
                break;
            case 'ArrowUp':
                const prevRow = currentRow.previousElementSibling;
                if (prevRow) nextElement = prevRow.cells[currentIndexInRow];
                break;
        }

        if (nextElement && nextElement.classList.contains('day-cell')) {
            event.preventDefault();
            setActiveCell(nextElement);
        }
    });

    // --- FIRESTORE SAVE AND LOAD ---
    const saveLeavesData = async () => {
        const leavesData = {};
        document.querySelectorAll('#leavesTableBody tr').forEach(row => {
            const employeeName = row.cells[0].textContent;
            if (employeeName) {
                leavesData[employeeName] = {};
                Array.from(row.cells).slice(1).forEach(cell => {
                    if (cell.textContent.trim() !== '') {
                        const monthIndex = cell.dataset.month;
                        leavesData[employeeName][monthIndex] = cell.textContent.trim();
                    }
                });
            }
        });

        try {
            await db.collection("leaves").doc("mainLeaves").set({ leavesData });
            window.showToast('Zapisano urlopy w Firestore!', 2000);
        } catch (error) {
            console.error('Błąd zapisu urlopów do Firestore:', error);
            window.showToast('Błąd zapisu urlopów!', 5000);
        }
    };
    
    const loadLeavesData = async () => {
        try {
            const docRef = db.collection("leaves").doc("mainLeaves");
            const doc = await docRef.get();
            if (doc.exists) {
                const data = doc.data().leavesData;
                if (data) {
                    Object.keys(data).forEach(employeeName => {
                        const row = Array.from(leavesTableBody.querySelectorAll('tr')).find(r => r.cells[0].textContent === employeeName);
                        if (row) {
                            Object.keys(data[employeeName]).forEach(monthIndex => {
                                const cell = row.cells[parseInt(monthIndex) + 1];
                                if (cell) {
                                    cell.textContent = data[employeeName][monthIndex];
                                }
                            });
                        }
                    });
                }
            }
        } catch (error) {
            console.error("Błąd ładowania danych o urlopach z Firestore:", error);
            window.showToast("Błąd ładowania urlopów.", 5000);
        }
    };

    // --- INICJALIZACJA ---
    const initializePage = async () => {
        generateTableHeaders();
        const employeeNames = await getEmployeeNames();
        generateTableRows(employeeNames);
        await loadLeavesData();
        undoManager.initialize(getCurrentTableState());
    };

    initializePage().catch(err => {
        console.error("Błąd inicjalizacji strony urlopów:", err);
    }).finally(() => {
        hideLoadingOverlay(loadingOverlay);
    });
});
