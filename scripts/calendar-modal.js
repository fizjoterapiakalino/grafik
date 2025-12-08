// scripts/calendar-modal.js
import { AppConfig, months } from './common.js';

export const CalendarModal = (() => {
    // --- SELEKTORY I ZMIENNE WEWNĘTRZNE MODUŁU ---
    let modal,
        prevMonthBtn,
        nextMonthBtn,
        confirmBtn,
        cancelBtn,
        clearSelectionBtn,
        startDatePreview,
        endDatePreview,
        calendarSlider,
        workdaysCounter,
        leaveTypeSelect,
        leaveTypeLegend;

    let currentEmployee = null;
    let currentYear = new Date().getUTCFullYear();

    let selectionStartDate = null;
    let hoverEndDate = null;
    let singleSelectedDays = new Set();
    let isRangeSelectionActive = false;
    let isAnimating = false;
    let dateToTypeMap = new Map();

    let _resolvePromise;
    let _rejectPromise;



    // --- FUNKCJE WEWNĘTRZNE MODUŁU ---

    // [REMOVED] populateYearSelect and handleYearChange were removed as year selector is gone.

    const toUTCDate = (dateString) => {
        const [year, month, day] = dateString.split('-').map(Number);
        return new Date(Date.UTC(year, month - 1, day));
    };

    const toDateString = (date) => {
        return date.toISOString().split('T')[0];
    };

    const countWorkdaysInSet = (datesSet) => {
        let workdays = 0;
        datesSet.forEach((dateString) => {
            // Check if the date belongs to the currently selected year
            if (!dateString.startsWith(`${currentYear}-`)) return;

            const day = new Date(dateString + 'T00:00:00Z').getUTCDay();
            if (day !== 0 && day !== 6) {
                workdays++;
            }
        });
        return workdays;
    };

    const resetSelection = () => {
        selectionStartDate = null;
        hoverEndDate = null;
        singleSelectedDays.clear();
        isRangeSelectionActive = false;
        updateSelectionPreview();
    };

    const loadEmployeeLeavesForModal = (employeeLeaves) => {
        singleSelectedDays.clear(); // Clear manual selections
        dateToTypeMap.clear();      // Clear mapping

        employeeLeaves.forEach((leave) => {
            const start = toUTCDate(leave.startDate);
            const end = toUTCDate(leave.endDate);
            for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
                // Ensure we only load leaves for the current year context if we want to avoid clutter,
                // BUT the leaves data usually spans multiple years. 
                // The calendar view filters by year, but here we load state.
                // It is safer to load all, so they are preserved if we save back.
                const dateString = toDateString(d);
                dateToTypeMap.set(dateString, leave.type || 'vacation');

                // IMPORTANT: Do NOT add to singleSelectedDays. 
                // singleSelectedDays should only contain days the USER has clicked/selected in this session 
                // or explicitly wants to change.
            }
        });
        generateInitialCalendars();
        updateSelectionPreview();
    };

    const getEasterDate = (year) => {
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed month
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(Date.UTC(year, month, day));
    };

    const isHoliday = (date) => {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth(); // 0-11
        const day = date.getUTCDate();

        // Stałe święta
        const fixedHolidays = [
            '0-1',   // Nowy Rok
            '0-6',   // Trzech Króli
            '4-1',   // Święto Pracy (Maj 1)
            '4-3',   // Święto Konstytucji 3 Maja
            '7-15',  // Wniebowzięcie NMP (Sierpień 15)
            '10-1',  // Wszystkich Świętych (Listopad 1)
            '10-11', // Święto Niepodległości (Listopad 11)
            '11-25', // Boże Narodzenie (Grudzień 25)
            '11-26', // Drugi dzień świąt (Grudzień 26)
        ];

        if (fixedHolidays.includes(`${month}-${day}`)) return true;

        // Wielkanoc (Ruchome)
        const easter = getEasterDate(year);
        const easterMonday = new Date(easter);
        easterMonday.setUTCDate(easter.getUTCDate() + 1);

        const bozeCialo = new Date(easter);
        bozeCialo.setUTCDate(easter.getUTCDate() + 60);

        const zieloneSwiatki = new Date(easter); // Zesłanie Ducha Świętego (7. niedziela po Wielkanocy, czyli +49 dni)
        zieloneSwiatki.setUTCDate(easter.getUTCDate() + 49);

        const checkDate = (d) => d.getUTCMonth() === month && d.getUTCDate() === day;

        if (checkDate(easter)) return true;
        if (checkDate(easterMonday)) return true;
        if (checkDate(bozeCialo)) return true;
        if (checkDate(zieloneSwiatki)) return true;

        return false;
    };

    const createCalendar = (year, month) => {
        const calendarWrapper = document.createElement('div');
        calendarWrapper.className = 'calendar-wrapper';
        const header = document.createElement('h2');
        header.textContent = `${months[month]} ${year}`;
        const grid = document.createElement('div');
        grid.className = 'calendar-grid';
        grid.innerHTML = `<div class="day-name">Po</div><div class="day-name">Wt</div><div class="day-name">Śr</div><div class="day-name">Cz</div><div class="day-name">Pi</div><div class="day-name">So</div><div class="day-name">Ni</div>`;
        const firstDayOfMonth = new Date(Date.UTC(year, month, 1));
        const startingDay = firstDayOfMonth.getUTCDay() === 0 ? 6 : firstDayOfMonth.getUTCDay() - 1;
        for (let i = 0; i < startingDay; i++) {
            grid.insertAdjacentHTML('beforeend', `<div class="day-cell-calendar other-month"></div>`);
        }
        const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        for (let i = 1; i <= daysInMonth; i++) {
            const dayCell = document.createElement('div');
            dayCell.className = 'day-cell-calendar';
            dayCell.textContent = i;

            const date = new Date(Date.UTC(year, month, i));
            dayCell.dataset.date = toDateString(date);

            // Add holiday class
            if (isHoliday(date)) {
                dayCell.classList.add('holiday');
                dayCell.title = "Święto";
            }

            grid.appendChild(dayCell);
        }
        calendarWrapper.appendChild(header);
        calendarWrapper.appendChild(grid);
        return calendarWrapper;
    };

    const generateInitialCalendars = () => {
        calendarSlider.innerHTML = '';
        calendarSlider.style.display = 'grid';
        calendarSlider.style.gridTemplateColumns = 'repeat(4, 1fr)';
        calendarSlider.style.gap = '20px';
        calendarSlider.style.width = '100%';
        calendarSlider.style.transform = 'none';

        for (let i = 0; i < 12; i++) {
            calendarSlider.appendChild(createCalendar(currentYear, i));
        }
        updateAllDayCells();
    };

    const updateAllDayCells = () => {
        document.querySelectorAll('#calendarModal .day-cell-calendar').forEach((cell) => {
            if (cell.dataset.date) updateDayCellSelection(cell);
        });

        // Also update days that are in dateToTypeMap but NOT in singleSelectedDays (already applied leaves)
        dateToTypeMap.forEach((type, dateString) => {
            const cell = document.querySelector(`#calendarModal .day-cell-calendar[data-date="${dateString}"]`);
            if (cell) updateDayCellSelection(cell);
        });
    };

    const updateDayCellSelection = (dayCell) => {
        const dateString = dayCell.dataset.date;
        dayCell.className = 'day-cell-calendar';
        dayCell.style.backgroundColor = '';
        dayCell.style.color = '';

        let startStr = selectionStartDate;
        let endStr = hoverEndDate;
        if (startStr && endStr && startStr > endStr) [startStr, endStr] = [endStr, startStr];

        const isInRange =
            isRangeSelectionActive && startStr && endStr && dateString >= startStr && dateString <= endStr;
        const isSelected = singleSelectedDays.has(dateString);
        const isApplied = dateToTypeMap.has(dateString);

        if (isSelected || isInRange || isApplied) {
            const leaveType = isApplied ? dateToTypeMap.get(dateString) : leaveTypeSelect.value;
            const color = AppConfig.leaves.leaveTypeColors[leaveType] || AppConfig.leaves.leaveTypeColors.default;

            dayCell.classList.add('selected');
            dayCell.style.backgroundColor = color;
            dayCell.style.color = 'white';

            const isStartDate =
                dateString === startStr ||
                (isSelected &&
                    !singleSelectedDays.has(toDateString(new Date(toUTCDate(dateString).getTime() - 86400000))));
            const isEndDate =
                dateString === endStr ||
                (isSelected &&
                    !singleSelectedDays.has(toDateString(new Date(toUTCDate(dateString).getTime() + 86400000))));

            if (isInRange && dateString !== startStr && dateString !== endStr) {
                dayCell.classList.add('in-range');
            }
            if (isStartDate) dayCell.classList.add('start-date');
            if (isEndDate) dayCell.classList.add('end-date');
        }
    };

    const updateLeaveTypeLegend = () => {
        if (!leaveTypeLegend || !leaveTypeSelect) return;

        leaveTypeLegend.innerHTML = ''; // Clear existing legend

        const selectedType = leaveTypeSelect.value;

        // Create a legend item for the currently selected type
        const selectedOption = leaveTypeSelect.querySelector(`option[value="${selectedType}"]`);
        if (selectedOption) {
            const key = selectedOption.value;
            const color = AppConfig.leaves.leaveTypeColors[key] || AppConfig.leaves.leaveTypeColors.default;
            const text = selectedOption.textContent;

            const legendItem = document.createElement('div');
            legendItem.className = 'legend-item';
            legendItem.innerHTML = `<span class="legend-color-box" style="background-color: ${color};"></span> <strong>${text}</strong>`;
            leaveTypeLegend.appendChild(legendItem);
        }
    };

    const handleDayClick = (event) => {
        const target = event.target.closest('.day-cell-calendar');
        if (!target || !target.dataset.date) return;
        const clickedDate = target.dataset.date;

        // Walidacja dla opieki nad zdrowym dzieckiem (art. 188)
        if (leaveTypeSelect.value === 'child_care_art_188') {
            const selectedArt188Days = Array.from(singleSelectedDays).filter((date) => {
                const type = dateToTypeMap.get(date);
                return type === 'child_care_art_188' || !type; // Uwzględnij nowo wybrane i już istniejące
            });

            // Sprawdź, czy próbujemy dodać dzień, który już jest na liście
            const isAddingNewDay = !singleSelectedDays.has(clickedDate);

            if (selectedArt188Days.length >= 2 && isAddingNewDay) {
                window.showToast('Wykorzystano maksymalną liczbę 2 dni opieki nad zdrowym dzieckiem.', 3000, 'error');
                return; // Zablokuj dodanie kolejnego dnia
            }
        }

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

                // Ponowna walidacja dla zaznaczenia zakresu
                if (leaveTypeSelect.value === 'child_care_art_188') {
                    let tempDayCount = 0;
                    for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
                        if (!singleSelectedDays.has(toDateString(d))) {
                            tempDayCount++;
                        }
                    }
                    const totalDaysAfterAdd =
                        Array.from(singleSelectedDays).filter(
                            (d) => dateToTypeMap.get(d) === 'child_care_art_188' || !dateToTypeMap.has(d),
                        ).length + tempDayCount;
                    if (totalDaysAfterAdd > 2) {
                        window.showToast(
                            'Przekroczono limit 2 dni opieki nad zdrowym dzieckiem w zaznaczonym zakresie.',
                            4000,
                            'error',
                        );
                        // Resetuj zaznaczenie zakresu, aby uniknąć nieprawidłowego stanu
                        isRangeSelectionActive = false;
                        selectionStartDate = null;
                        hoverEndDate = null;
                        updateAllDayCells();
                        return;
                    }
                }

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
        workdaysCounter.textContent = countWorkdaysInSet(singleSelectedDays);
    };



    const confirmSelection = () => {
        // First, ensure any currently selected days are also applied (if user didn't click Apply first)
        if (singleSelectedDays.size > 0) {
            const selectedLeaveType = leaveTypeSelect.value;
            singleSelectedDays.forEach(dateString => {
                dateToTypeMap.set(dateString, selectedLeaveType);
            });
        }

        // Now generate the leaves list from the map
        const sortedDays = Array.from(dateToTypeMap.keys()).sort();
        const newLeaves = [];

        if (sortedDays.length > 0) {
            let rangeStart = sortedDays[0];
            let rangeEnd = sortedDays[0];
            let currentType = dateToTypeMap.get(rangeStart);

            for (let i = 1; i < sortedDays.length; i++) {
                const prevDay = toUTCDate(sortedDays[i - 1]);
                const currentDay = toUTCDate(sortedDays[i]);
                const diff = (currentDay - prevDay) / (1000 * 60 * 60 * 24);
                const nextType = dateToTypeMap.get(sortedDays[i]);

                if (diff === 1 && currentType === nextType) {
                    rangeEnd = sortedDays[i];
                } else {
                    newLeaves.push({
                        id: toUTCDate(rangeStart).getTime().toString(),
                        startDate: rangeStart,
                        endDate: rangeEnd,
                        type: currentType,
                    });
                    rangeStart = sortedDays[i];
                    rangeEnd = sortedDays[i];
                    currentType = nextType;
                }
            }
            // Push the last segment
            newLeaves.push({
                id: toUTCDate(rangeStart).getTime().toString(),
                startDate: rangeStart,
                endDate: rangeEnd,
                type: currentType,
            });
        }

        if (_resolvePromise) {
            _resolvePromise(newLeaves);
        }
        closeModal();
    };

    const closeModal = () => {
        modal.style.display = 'none';
        if (_rejectPromise) {
            _rejectPromise('Modal closed without confirmation');
        }
        _resolvePromise = null;
        _rejectPromise = null;
    };

    const setupEventListeners = () => {
        calendarSlider.addEventListener('click', handleDayClick);
        calendarSlider.addEventListener('mouseover', handleDayMouseOver);
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

        leaveTypeSelect.addEventListener('change', updateLeaveTypeLegend);
    };

    const init = () => {
        modal = document.getElementById('calendarModal');
        prevMonthBtn = document.getElementById('prevMonthBtn');
        nextMonthBtn = document.getElementById('nextMonthBtn');
        confirmBtn = document.getElementById('confirmSelectionBtn');
        cancelBtn = document.getElementById('cancelSelectionBtn');
        clearSelectionBtn = document.getElementById('clearSelectionBtn');
        startDatePreview = document.getElementById('startDatePreview');
        endDatePreview = document.getElementById('endDatePreview');
        calendarSlider = document.querySelector('.calendar-slider');
        workdaysCounter = document.getElementById('workdaysCounter');
        leaveTypeSelect = document.getElementById('leaveTypeSelect');

        leaveTypeLegend = document.getElementById('leaveTypeLegend');

        if (modal) {
            // Only setup listeners if the modal exists on the page
            setupEventListeners();
        }
    };


    const open = (employeeName, existingLeaves, monthIndex, year) => {
        currentEmployee = employeeName;
        currentYear = year || new Date().getUTCFullYear();

        if (prevMonthBtn) prevMonthBtn.style.display = 'none';
        if (nextMonthBtn) nextMonthBtn.style.display = 'none';

        resetSelection();
        loadEmployeeLeavesForModal(existingLeaves);
        updateLeaveTypeLegend(); // Call this after leaveTypeSelect is potentially set
        modal.style.display = 'flex';
        return new Promise((resolve, reject) => {
            _resolvePromise = resolve;
            _rejectPromise = reject;
        });
    };

    return {
        init,
        open,
    };
})();

// Backward compatibility
window.CalendarModal = CalendarModal;
