document.addEventListener('DOMContentLoaded', () => {
    // --- SELEKTORY I ZMIENNE GLOBALNE ---
    const loadingOverlay = document.getElementById('loadingOverlay');
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

    let activeCell = null;
    let currentDate = new Date();
    let selectedDays = [];
    let lastSelectedDay = null;

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
        activeCell = cell;
        const monthIndex = parseInt(cell.dataset.month, 10);
        const year = new Date().getFullYear();
        selectedDays = parseDaysFromString(activeCell.textContent);
        lastSelectedDay = null;
        generateCalendar(year, monthIndex);
        modal.style.display = 'flex';
    };

    const closeModal = () => {
        modal.style.display = 'none';
        selectedDays = [];
        activeCell = null;
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
        try {
            const response = await fetch(WEB_APP_URL);
            if (!response.ok) throw new Error(`Błąd HTTP: ${response.status}`);
            const savedData = await response.json();
            if (savedData && savedData.employeeHeaders && Object.keys(savedData.employeeHeaders).length > 0) {
                return Object.values(savedData.employeeHeaders);
            }
            throw new Error('Brak zapisanych nagłówków pracowników.');
        } catch (error) {
            console.error('Nie udało się pobrać nazwisk pracowników:', error);
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
                monthTd.setAttribute('contenteditable', 'false'); // Wyłączamy domyślną edycję
                tr.appendChild(monthTd);
            });
            leavesTableBody.appendChild(tr);
        });
    };

    const filterAndHighlightTable = (searchTerm) => {
        const rows = leavesTableBody.querySelectorAll('tr');
        const regex = new RegExp(searchTerm, 'gi'); // 'gi' dla globalnego i ignorującego wielkość liter

        rows.forEach(row => {
            const employeeNameCell = row.querySelector('.employee-name-cell');
            const dayCells = row.querySelectorAll('.day-cell');
            let rowMatches = false;

            // Usuń poprzednie podświetlenia
            row.querySelectorAll('.search-highlight').forEach(span => {
                span.outerHTML = span.innerHTML; // Przywróć oryginalny tekst
            });

            // Sprawdź nazwę pracownika
            let originalEmployeeName = employeeNameCell.textContent;
            if (searchTerm && regex.test(originalEmployeeName)) {
                employeeNameCell.innerHTML = originalEmployeeName.replace(regex, `<span class="search-highlight">$&</span>`);
                rowMatches = true;
            } else {
                employeeNameCell.textContent = originalEmployeeName; // Przywróć oryginalny tekst
            }


            // Sprawdź komórki z dniami urlopów
            dayCells.forEach(cell => {
                let originalCellContent = cell.textContent;
                if (searchTerm && regex.test(originalCellContent)) {
                    cell.innerHTML = originalCellContent.replace(regex, `<span class="search-highlight">$&</span>`);
                    rowMatches = true;
                } else {
                    cell.textContent = originalCellContent; // Przywróć oryginalny tekst
                }
            });

            if (searchTerm === '' || rowMatches) {
                row.style.display = ''; // Pokaż wiersz
            } else {
                row.style.display = 'none'; // Ukryj wiersz
            }
        });
    };

    // --- EVENT LISTENERS ---
    leavesTableBody.addEventListener('click', (event) => {
        if (event.target.classList.contains('day-cell')) {
            openModal(event.target);
        }
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
        if (activeCell) {
            activeCell.textContent = formatDaysToString(selectedDays);
            saveLeavesData(); // Wywołaj funkcję zapisu
        }
        closeModal();
    });

    cancelBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });

    // --- EVENT LISTENERS DLA WYSZUKIWANIA ---
    searchInput.addEventListener('input', (event) => {
        const searchTerm = event.target.value.trim();
        filterAndHighlightTable(searchTerm);
        if (searchTerm.length > 0) {
            clearSearchBtn.style.display = 'block';
        } else {
            clearSearchBtn.style.display = 'none';
        }
    });

    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        filterAndHighlightTable(''); // Pokaż wszystkie wiersze i usuń podświetlenia
    });

    // Add event listener for delete key
    document.addEventListener('keydown', (event) => {
        // Check if a day cell is currently focused or active for editing
        // (though contenteditable is false, we might still have a concept of an 'active' cell)
        // For now, let's assume the modal being open implies an interaction with a cell.
        // A more robust solution would track focus if cells were contenteditable or had tabindex.

        // A simpler approach: if the modal is NOT open, and a TD is focused, clear it.
        // This requires making the TDs focusable.
        // Let's add tabindex="0" to the day cells when they are generated.

        // If the target of the keydown is a .day-cell and the key is Delete or Backspace
        if (event.target.classList.contains('day-cell') && (event.key === 'Delete' || event.key === 'Backspace')) {
            event.preventDefault(); // Prevent default browser behavior (like navigating back)
            event.target.textContent = ''; // Clear the cell content
            saveLeavesData(); // Save the change
        }
    });

    // --- FUNKCJE ZAPISU I WCZYTYWANIA DANYCH URLOPÓW (DO IMPLEMENTACJI) ---

    const saveLeavesData = async () => {
        console.log("Rozpoczynanie zapisu danych o urlopach..."); // Tymczasowy log
        // Ta funkcja jest szkieletem - wymaga implementacji logiki do zbierania
        // danych z tabeli i wysyłania ich do Google Apps Script.
        // Przykład:
        /*
        const leavesData = {};
        document.querySelectorAll('#leavesTableBody tr').forEach(row => {
            const employeeName = row.cells[0].textContent;
            leavesData[employeeName] = {};
            Array.from(row.cells).slice(1).forEach(cell => {
                if (cell.textContent.trim() !== '') {
                    leavesData[employeeName][cell.dataset.month] = cell.textContent.trim();
                }
            });
        });

        try {
            // UWAGA: Potrzebny będzie dedykowany endpoint lub parametr w URL
            const response = await fetch(WEB_APP_URL + '?action=saveLeaves', {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(leavesData)
            });
            console.log("Dane urlopów zapisane!");
        } catch (error) {
            console.error('Błąd zapisu urlopów:', error);
        }
        */
    };

    const initializePage = async () => {
        generateTableHeaders();
        const employeeNames = await getEmployeeNames();
        generateTableRows(employeeNames);
        // Add tabindex to day cells after generating rows
        document.querySelectorAll('.day-cell').forEach(cell => {
            cell.setAttribute('tabindex', '0');
        });
    };

    const hideLoadingOverlay = () => {
        if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
            setTimeout(() => {
                if (loadingOverlay.parentNode) {
                    loadingOverlay.parentNode.removeChild(loadingOverlay);
                }
            }, 300); // Czas musi pasować do transition w CSS
        }
    };

    initializePage().catch(err => {
        console.error("Błąd inicjalizacji strony urlopów:", err);
    }).finally(() => {
        hideLoadingOverlay();
    });
});
