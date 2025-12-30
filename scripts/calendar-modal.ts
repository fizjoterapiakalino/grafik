// scripts/calendar-modal.ts
import { AppConfig, months, isHoliday } from './common.js';

/**
 * Granice urlopowe
 */
interface LeaveLimits {
    totalLimit?: number;
}

/**
 * Wpis urlopowy do zwrotu
 */
interface LeaveResult {
    id: string;
    startDate: string;
    endDate: string;
    type: string;
}

/**
 * Wpis urlopowy wejściowy
 */
interface LeaveInput {
    startDate: string;
    endDate: string;
    type?: string;
}

/**
 * Interfejs publicznego API CalendarModal
 */
interface CalendarModalAPI {
    init(): void;
    open(
        employeeName: string,
        existingLeaves: LeaveInput[],
        monthIndex: number,
        year?: number,
        limits?: LeaveLimits
    ): Promise<LeaveResult[]>;
}

/**
 * Moduł kalendarza modalnego
 */
export const CalendarModal: CalendarModalAPI = (() => {
    let modal: HTMLElement | null = null;
    let prevMonthBtn: HTMLElement | null = null;
    let nextMonthBtn: HTMLElement | null = null;
    let confirmBtn: HTMLElement | null = null;
    let cancelBtn: HTMLElement | null = null;
    let clearSelectionBtn: HTMLElement | null = null;
    let startDatePreview: HTMLElement | null = null;
    let endDatePreview: HTMLElement | null = null;
    let calendarSlider: HTMLElement | null = null;
    let workdaysCounter: HTMLElement | null = null;
    let leaveTypeSelect: HTMLSelectElement | null = null;
    let leaveTypeColorIndicator: HTMLElement | null = null;

    let currentYear = new Date().getUTCFullYear();
    let currentVacationLimit = 0;

    let selectionStartDate: string | null = null;
    let hoverEndDate: string | null = null;
    let singleSelectedDays = new Set<string>();
    let isRangeSelectionActive = false;
    let dateToTypeMap = new Map<string, string>();

    let _resolvePromise: ((value: LeaveResult[]) => void) | null = null;
    let _rejectPromise: ((reason: string) => void) | null = null;

    const toUTCDate = (dateString: string): Date => {
        const [year, month, day] = dateString.split('-').map(Number);
        return new Date(Date.UTC(year, month - 1, day));
    };

    const toDateString = (date: Date): string => {
        return date.toISOString().split('T')[0];
    };

    const countWorkdaysInSet = (datesSet: Set<string>): number => {
        let workdays = 0;
        datesSet.forEach((dateString) => {
            if (!dateString.startsWith(`${currentYear}-`)) return;
            const date = new Date(dateString + 'T00:00:00Z');
            const day = date.getUTCDay();
            if (day !== 0 && day !== 6 && !isHoliday(date)) {
                workdays++;
            }
        });
        return workdays;
    };

    const countVacationUsage = (): number => {
        let used = 0;
        const currentType = leaveTypeSelect?.value || 'vacation';
        const isVacationSelected = currentType === 'vacation';
        const yearPrefix = `${currentYear}-`;

        dateToTypeMap.forEach((type, dateString) => {
            if (singleSelectedDays.has(dateString)) return;
            if (type === 'vacation' && dateString.startsWith(yearPrefix)) {
                const date = new Date(dateString + 'T00:00:00Z');
                const day = date.getUTCDay();
                if (day !== 0 && day !== 6 && !isHoliday(date)) used++;
            }
        });

        if (isVacationSelected) {
            singleSelectedDays.forEach(dateString => {
                if (dateString.startsWith(yearPrefix)) {
                    const date = new Date(dateString + 'T00:00:00Z');
                    const day = date.getUTCDay();
                    if (day !== 0 && day !== 6 && !isHoliday(date)) used++;
                }
            });
        }

        return used;
    };

    const resetSelection = (): void => {
        selectionStartDate = null;
        hoverEndDate = null;
        singleSelectedDays.clear();
        isRangeSelectionActive = false;
        updateSelectionPreview();
    };

    const loadEmployeeLeavesForModal = (employeeLeaves: LeaveInput[]): void => {
        singleSelectedDays.clear();
        dateToTypeMap.clear();

        employeeLeaves.forEach((leave) => {
            const start = toUTCDate(leave.startDate);
            const end = toUTCDate(leave.endDate);
            for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
                const dateString = toDateString(d);
                dateToTypeMap.set(dateString, leave.type || 'vacation');
            }
        });
        generateInitialCalendars();
        updateSelectionPreview();
    };

    const createCalendar = (year: number, month: number): HTMLElement => {
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
            dayCell.textContent = String(i);

            const date = new Date(Date.UTC(year, month, i));
            dayCell.dataset.date = toDateString(date);

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

    const generateInitialCalendars = (): void => {
        if (!calendarSlider) return;
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

    const updateAllDayCells = (): void => {
        document.querySelectorAll('#calendarModal .day-cell-calendar').forEach((cell) => {
            const el = cell as HTMLElement;
            if (el.dataset.date) updateDayCellSelection(el);
        });

        dateToTypeMap.forEach((_, dateString) => {
            const cell = document.querySelector(`#calendarModal .day-cell-calendar[data-date="${dateString}"]`) as HTMLElement | null;
            if (cell) updateDayCellSelection(cell);
        });
    };

    const updateDayCellSelection = (dayCell: HTMLElement): void => {
        const dateString = dayCell.dataset.date;
        if (!dateString) return;

        const isHolidayCell = dayCell.classList.contains('holiday');
        dayCell.className = 'day-cell-calendar';
        if (isHolidayCell) dayCell.classList.add('holiday');
        dayCell.style.backgroundColor = '';
        dayCell.style.color = '';

        let startStr = selectionStartDate;
        let endStr = hoverEndDate;
        if (startStr && endStr && startStr > endStr) [startStr, endStr] = [endStr, startStr];

        const isInRange = isRangeSelectionActive && startStr && endStr && dateString >= startStr && dateString <= endStr;
        const isSelected = singleSelectedDays.has(dateString);
        const isApplied = dateToTypeMap.has(dateString);

        if (isSelected || isInRange || isApplied) {
            const leaveType = (isSelected || isInRange) ? (leaveTypeSelect?.value || 'vacation') : (dateToTypeMap.get(dateString) || 'vacation');
            const colors = AppConfig.leaves.leaveTypeColors as unknown as Record<string, string>;
            const color = colors[leaveType] || colors['default'] || '#4CAF50';

            dayCell.classList.add('selected');
            dayCell.style.backgroundColor = color;
            dayCell.style.color = 'white';

            const isStartDate = dateString === startStr ||
                (isSelected && !singleSelectedDays.has(toDateString(new Date(toUTCDate(dateString).getTime() - 86400000))));
            const isEndDate = dateString === endStr ||
                (isSelected && !singleSelectedDays.has(toDateString(new Date(toUTCDate(dateString).getTime() + 86400000))));

            if (isInRange && dateString !== startStr && dateString !== endStr) {
                dayCell.classList.add('in-range');
            }
            if (isStartDate) dayCell.classList.add('start-date');
            if (isEndDate) dayCell.classList.add('end-date');
        }
    };

    const updateLeaveTypeIndicator = (): void => {
        if (!leaveTypeColorIndicator || !leaveTypeSelect) return;

        const selectedType = leaveTypeSelect.value;
        const colors = AppConfig.leaves.leaveTypeColors as unknown as Record<string, string>;
        const color = colors[selectedType] || colors['default'] || '#4CAF50';

        leaveTypeColorIndicator.style.backgroundColor = color;
        updateSelectionPreview();
    };

    const handleDayClick = (event: Event): void => {
        const mouseEvent = event as MouseEvent;
        const target = (mouseEvent.target as HTMLElement).closest('.day-cell-calendar') as HTMLElement | null;
        if (!target || !target.dataset.date) return;
        const clickedDate = target.dataset.date;
        const currentType = leaveTypeSelect?.value || 'vacation';

        // Validation for child care art 188
        if (currentType === 'child_care_art_188') {
            const selectedArt188Days = Array.from(singleSelectedDays).filter((date) => {
                const type = dateToTypeMap.get(date);
                return type === 'child_care_art_188' || !type;
            });
            const isAddingNewDay = !singleSelectedDays.has(clickedDate);
            if (selectedArt188Days.length >= 2 && isAddingNewDay) {
                window.showToast('Wykorzystano maksymalną liczbę 2 dni opieki nad zdrowym dzieckiem.', 3000);
                return;
            }
        }

        // Validation for vacation limit
        if (currentType === 'vacation' && !singleSelectedDays.has(clickedDate) && !mouseEvent.ctrlKey && !mouseEvent.metaKey) {
            const currentUsage = countVacationUsage();
            const d = new Date(clickedDate + 'T00:00:00Z');
            const day = d.getUTCDay();
            const isWorkDay = day !== 0 && day !== 6 && !isHoliday(d);

            if (isWorkDay && currentUsage >= currentVacationLimit) {
                window.showToast(`Osiągnięto limit urlopu wypoczynkowego (${currentVacationLimit} dni).`, 3000);
                return;
            }
        }

        if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
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
                let start = selectionStartDate!;
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

    const handleDayMouseOver = (event: Event): void => {
        const target = (event.target as HTMLElement).closest('.day-cell-calendar') as HTMLElement | null;
        if (!target || !target.dataset.date || !isRangeSelectionActive) return;
        if (hoverEndDate !== target.dataset.date) {
            hoverEndDate = target.dataset.date;
            updateAllDayCells();
        }
    };

    const updateSelectionPreview = (): void => {
        const dates = Array.from(singleSelectedDays).sort();
        if (startDatePreview) startDatePreview.textContent = dates.length > 0 ? dates[0] : '-';
        if (endDatePreview) endDatePreview.textContent = dates.length > 0 ? dates[dates.length - 1] : '-';

        if (workdaysCounter) {
            if ((leaveTypeSelect?.value || 'vacation') === 'vacation') {
                const used = countVacationUsage();
                workdaysCounter.textContent = `${used} / ${currentVacationLimit}`;

                const remaining = currentVacationLimit - used;
                if (remaining <= 5) {
                    workdaysCounter.classList.add('limit-warning');
                } else {
                    workdaysCounter.classList.remove('limit-warning');
                }
            } else {
                const count = countWorkdaysInSet(singleSelectedDays);
                workdaysCounter.textContent = String(count);
                workdaysCounter.classList.remove('limit-warning');
            }
        }
    };

    const confirmSelection = (): void => {
        if (singleSelectedDays.size > 0) {
            const selectedLeaveType = leaveTypeSelect?.value || 'vacation';
            singleSelectedDays.forEach(dateString => {
                dateToTypeMap.set(dateString, selectedLeaveType);
            });
        }

        const sortedDays = Array.from(dateToTypeMap.keys()).sort();
        const newLeaves: LeaveResult[] = [];

        if (sortedDays.length > 0) {
            let rangeStart = sortedDays[0];
            let rangeEnd = sortedDays[0];
            let leaveType = dateToTypeMap.get(rangeStart) || 'vacation';

            for (let i = 1; i < sortedDays.length; i++) {
                const prevDay = toUTCDate(sortedDays[i - 1]);
                const currentDay = toUTCDate(sortedDays[i]);
                const diff = (currentDay.getTime() - prevDay.getTime()) / (1000 * 60 * 60 * 24);
                const nextType = dateToTypeMap.get(sortedDays[i]) || 'vacation';

                if (diff === 1 && leaveType === nextType) {
                    rangeEnd = sortedDays[i];
                } else {
                    newLeaves.push({
                        id: String(toUTCDate(rangeStart).getTime()),
                        startDate: rangeStart,
                        endDate: rangeEnd,
                        type: leaveType,
                    });
                    rangeStart = sortedDays[i];
                    rangeEnd = sortedDays[i];
                    leaveType = nextType;
                }
            }
            newLeaves.push({
                id: String(toUTCDate(rangeStart).getTime()),
                startDate: rangeStart,
                endDate: rangeEnd,
                type: leaveType,
            });
        }

        if (_resolvePromise) {
            _resolvePromise(newLeaves);
        }
        closeModal();
    };

    const closeModal = (): void => {
        if (modal) modal.style.display = 'none';
        if (_rejectPromise) {
            _rejectPromise('Modal closed without confirmation');
        }
        _resolvePromise = null;
        _rejectPromise = null;
    };

    const setupEventListeners = (): void => {
        if (!calendarSlider || !confirmBtn || !cancelBtn || !clearSelectionBtn || !modal || !leaveTypeSelect) return;

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

        leaveTypeSelect.addEventListener('change', updateLeaveTypeIndicator);
    };

    const init = (): void => {
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
        leaveTypeSelect = document.getElementById('leaveTypeSelect') as HTMLSelectElement | null;
        leaveTypeColorIndicator = document.getElementById('leaveTypeColorIndicator');

        if (modal) {
            setupEventListeners();
        }
    };

    const open = (
        _employeeName: string,
        existingLeaves: LeaveInput[],
        _monthIndex: number,
        year?: number,
        limits: LeaveLimits = {}
    ): Promise<LeaveResult[]> => {
        currentYear = year || new Date().getUTCFullYear();
        currentVacationLimit = limits.totalLimit || 26;

        if (prevMonthBtn) prevMonthBtn.style.display = 'none';
        if (nextMonthBtn) nextMonthBtn.style.display = 'none';

        resetSelection();
        loadEmployeeLeavesForModal(existingLeaves);
        updateLeaveTypeIndicator();
        if (modal) modal.style.display = 'flex';

        return new Promise((resolve, reject) => {
            _resolvePromise = resolve;
            _rejectPromise = reject;
        });
    };

    return { init, open };
})();

// Backward compatibility
declare global {
    interface Window {
        CalendarModal: CalendarModalAPI;
    }
}

window.CalendarModal = CalendarModal;
