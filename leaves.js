document.addEventListener('DOMContentLoaded', () => {
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

    let activeCell = null;
    let currentDate = new Date();
    let selectedDays = [];
    let lastSelectedDay = null;

    const months = [
        'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
        'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
    ];

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

    const getEmployeeNames = async () => {
        try {
            const doc = await db.collection("appData").doc("employees").get();
            if (doc.exists) {
                return doc.data().names || [];
            }
            return [];
        } catch (error) {
            console.error("Błąd pobierania pracowników:", error);
            return [];
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
                monthTd.setAttribute('contenteditable', 'false');
                tr.appendChild(monthTd);
            });
            leavesTableBody.appendChild(tr);
        });
    };

    const saveLeavesData = async () => {
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
            await db.collection("appData").doc("leaves").set(leavesData);
            console.log("Dane urlopów zapisane!");
        } catch (error) {
            console.error('Błąd zapisu urlopów:', error);
        }
    };

    const loadLeavesData = async () => {
        try {
            const doc = await db.collection("appData").doc("leaves").get();
            if (doc.exists) {
                const leavesData = doc.data();
                document.querySelectorAll('#leavesTableBody tr').forEach(row => {
                    const employeeName = row.cells[0].textContent;
                    if (leavesData[employeeName]) {
                        Array.from(row.cells).slice(1).forEach(cell => {
                            const monthIndex = cell.dataset.month;
                            if (leavesData[employeeName][monthIndex]) {
                                cell.textContent = leavesData[employeeName][monthIndex];
                            }
                        });
                    }
                });
            }
        } catch (error) {
            console.error('Błąd wczytywania urlopów:', error);
        }
    };

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
            saveLeavesData();
        }
        closeModal();
    });

    cancelBtn.addEventListener('click', closeModal);

    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });

    const initializePage = async () => {
        generateTableHeaders();
        const employeeNames = await getEmployeeNames();
        generateTableRows(employeeNames);
        await loadLeavesData();
    };

    const hideLoadingOverlay = () => {
        if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
            setTimeout(() => {
                if (loadingOverlay.parentNode) {
                    loadingOverlay.parentNode.removeChild(loadingOverlay);
                }
            }, 300);
        }
    };

    initializePage().catch(err => {
        console.error("Błąd inicjalizacji strony urlopów:", err);
    }).finally(() => {
        hideLoadingOverlay();
    });
});
