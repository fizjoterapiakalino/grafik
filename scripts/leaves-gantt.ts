// scripts/leaves-gantt.ts - Gantt View for Leaves Module
import type { Employee, LeaveEntry, LeavesMap } from './types';

/**
 * Leave type configuration for colors and labels
 */
const LEAVE_TYPES: Record<string, { label: string; color: string }> = {
    vacation: { label: 'Wypoczynkowy', color: '#3498db' },
    child_care_art_188: { label: 'Opieka nad zdrowym dzieckiem', color: '#f39c12' },
    sick_child_care: { label: 'Opieka nad chorym dzieckiem', color: '#e74c3c' },
    family_member_care: { label: 'Opieka nad chorym członkiem rodziny', color: '#9b59b6' },
    schedule_pickup: { label: 'Wybicie za święto', color: '#1abc9c' },
};

const MONTH_NAMES = [
    'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
    'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
];

const DAY_WIDTH = 24; // pixels per day

/**
 * Get number of days in a month
 */
const getDaysInMonth = (year: number, month: number): number => {
    return new Date(year, month + 1, 0).getDate();
};

/**
 * Check if a date is weekend (Saturday = 6, Sunday = 0)
 */
const isWeekend = (year: number, month: number, day: number): boolean => {
    const date = new Date(year, month, day);
    const dayOfWeek = date.getDay();
    return dayOfWeek === 0 || dayOfWeek === 6;
};

/**
 * Check if a date is today
 */
const isToday = (year: number, month: number, day: number): boolean => {
    const today = new Date();
    return today.getFullYear() === year &&
        today.getMonth() === month &&
        today.getDate() === day;
};

/**
 * Get day of year (0-indexed)
 */
const getDayOfYear = (date: Date): number => {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date.getTime() - start.getTime();
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);
};

/**
 * Parse date string to Date object
 */
const parseDate = (dateStr: string): Date => {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
};

/**
 * Render the Gantt timeline header (months + days)
 */
export const renderGanttHeader = (year: number): string => {
    let html = '';

    for (let month = 0; month < 12; month++) {
        const daysInMonth = getDaysInMonth(year, month);

        html += `<div class="gantt-month-group">`;
        html += `<div class="gantt-month-label">${MONTH_NAMES[month].substring(0, 3)}</div>`;
        html += `<div class="gantt-days-row">`;

        for (let day = 1; day <= daysInMonth; day++) {
            const weekend = isWeekend(year, month, day) ? 'weekend' : '';
            const today = isToday(year, month, day) ? 'today' : '';
            html += `<div class="gantt-day-header ${weekend} ${today}">${day}</div>`;
        }

        html += `</div></div>`;
    }

    return html;
};

/**
 * Calculate leave bar position and width
 */
const calculateLeaveBarPosition = (
    leave: LeaveEntry,
    year: number
): { left: number; width: number; visible: boolean } => {
    const startDate = parseDate(leave.startDate);
    const endDate = parseDate(leave.endDate);

    // Check if leave is in the current year
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);

    if (endDate < yearStart || startDate > yearEnd) {
        return { left: 0, width: 0, visible: false };
    }

    // Clamp dates to year boundaries
    const effectiveStart = startDate < yearStart ? yearStart : startDate;
    const effectiveEnd = endDate > yearEnd ? yearEnd : endDate;

    // Calculate position (day of year * day width)
    const startDayOfYear = getDayOfYear(effectiveStart);
    const endDayOfYear = getDayOfYear(effectiveEnd);

    const left = (startDayOfYear - 1) * DAY_WIDTH;
    const width = (endDayOfYear - startDayOfYear + 1) * DAY_WIDTH;

    return { left, width, visible: true };
};

/**
 * Render leave bars for an employee
 */
const renderLeaveBars = (leaves: LeaveEntry[], year: number): string => {
    if (!leaves || leaves.length === 0) return '';

    return leaves.map(leave => {
        const { left, width, visible } = calculateLeaveBarPosition(leave, year);

        if (!visible) return '';

        const leaveType = leave.type || 'vacation';
        const typeConfig = LEAVE_TYPES[leaveType] || LEAVE_TYPES.vacation;

        // Calculate number of days
        const startDate = parseDate(leave.startDate);
        const endDate = parseDate(leave.endDate);
        const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

        // Only show text if bar is wide enough
        const showText = width >= 40;
        const text = showText ? `${days}d` : '';

        return `
            <div class="gantt-leave-bar ${leaveType}" 
                 style="left: ${left}px; width: ${width}px;"
                 data-leave-id="${leave.id}"
                 data-start="${leave.startDate}"
                 data-end="${leave.endDate}"
                 title="${typeConfig.label}: ${leave.startDate} - ${leave.endDate} (${days} dni)">
                ${text}
            </div>
        `;
    }).join('');
};

/**
 * Render day cells for timeline row (for interaction)
 */
const renderDayCells = (year: number): string => {
    let html = '';

    for (let month = 0; month < 12; month++) {
        const daysInMonth = getDaysInMonth(year, month);

        for (let day = 1; day <= daysInMonth; day++) {
            const weekend = isWeekend(year, month, day) ? 'weekend' : '';
            const today = isToday(year, month, day) ? 'today' : '';
            const monthStart = day === 1 ? 'month-start' : '';

            html += `<div class="gantt-day-cell ${weekend} ${today} ${monthStart}" 
                         data-date="${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}">
                     </div>`;
        }
    }

    return html;
};

/**
 * Render a single employee row
 */
const renderEmployeeRow = (
    employeeName: string,
    leaves: LeaveEntry[],
    year: number
): string => {
    return `
        <div class="gantt-row" data-employee="${employeeName}">
            <div class="gantt-employee-cell">${employeeName}</div>
            <div class="gantt-timeline-row">
                ${renderDayCells(year)}
                ${renderLeaveBars(leaves, year)}
            </div>
        </div>
    `;
};

/**
 * Render the complete Gantt view
 */
export const renderGanttView = (
    employees: Record<string, Employee>,
    leaves: LeavesMap,
    year: number
): void => {
    const headerContainer = document.getElementById('ganttTimelineHeader');
    const bodyContainer = document.getElementById('ganttBody');

    if (!headerContainer || !bodyContainer) {
        console.error('Gantt containers not found');
        return;
    }

    // Render header
    headerContainer.innerHTML = renderGanttHeader(year);

    // Render employee rows
    const sortedEmployees = Object.entries(employees)
        .filter(([_, emp]) => !emp.isHidden && !emp.isScheduleOnly)
        .sort((a, b) => {
            const nameA = a[1].displayName || a[1].name || a[0];
            const nameB = b[1].displayName || b[1].name || b[0];
            return nameA.localeCompare(nameB, 'pl');
        });

    let rowsHtml = '';

    for (const [empId, emp] of sortedEmployees) {
        const employeeName = emp.displayName || emp.name || empId;
        const employeeLeaves = leaves[employeeName] || [];

        rowsHtml += renderEmployeeRow(employeeName, employeeLeaves, year);
    }

    bodyContainer.innerHTML = rowsHtml;

    // Sync horizontal scrolling between header and rows
    syncScroll();
};

/**
 * Sync horizontal scroll between header and body rows
 */
const syncScroll = (): void => {
    const header = document.getElementById('ganttTimelineHeader');
    const rows = document.querySelectorAll('.gantt-timeline-row');

    if (!header) return;

    // Scroll all rows when header scrolls
    header.addEventListener('scroll', () => {
        rows.forEach(row => {
            (row as HTMLElement).scrollLeft = header.scrollLeft;
        });
    });

    // Scroll header and other rows when any row scrolls
    rows.forEach(row => {
        row.addEventListener('scroll', () => {
            header.scrollLeft = (row as HTMLElement).scrollLeft;
            rows.forEach(otherRow => {
                if (otherRow !== row) {
                    (otherRow as HTMLElement).scrollLeft = (row as HTMLElement).scrollLeft;
                }
            });
        });
    });
};

/**
 * Render mobile list view
 */
export const renderMobileView = (
    employees: Record<string, Employee>,
    leaves: LeavesMap,
    year: number
): string => {
    const sortedEmployees = Object.entries(employees)
        .filter(([_, emp]) => !emp.isHidden && !emp.isScheduleOnly)
        .sort((a, b) => {
            const nameA = a[1].displayName || a[1].name || a[0];
            const nameB = b[1].displayName || b[1].name || b[0];
            return nameA.localeCompare(nameB, 'pl');
        });

    let html = '<div class="gantt-mobile-view">';

    for (const [empId, emp] of sortedEmployees) {
        const employeeName = emp.displayName || emp.name || empId;
        const employeeLeaves = (leaves[employeeName] || [])
            .filter(leave => {
                const startYear = parseInt(leave.startDate.split('-')[0]);
                const endYear = parseInt(leave.endDate.split('-')[0]);
                return startYear === year || endYear === year;
            });

        const leaveCount = employeeLeaves.length;

        html += `
            <div class="gantt-mobile-employee" data-employee="${employeeName}">
                <div class="gantt-mobile-employee-header">
                    <span>${employeeName}</span>
                    <span class="badge">${leaveCount} urlopów</span>
                    <i class="fas fa-chevron-down arrow"></i>
                </div>
                <div class="gantt-mobile-leaves-list">
        `;

        if (employeeLeaves.length === 0) {
            html += '<p class="no-leaves">Brak zaplanowanych urlopów</p>';
        } else {
            for (const leave of employeeLeaves) {
                const leaveType = leave.type || 'vacation';
                const typeConfig = LEAVE_TYPES[leaveType] || LEAVE_TYPES.vacation;

                html += `
                    <div class="gantt-mobile-leave-item" data-leave-id="${leave.id}">
                        <div class="gantt-mobile-leave-color" style="background: ${typeConfig.color}"></div>
                        <div class="gantt-mobile-leave-dates">${leave.startDate} - ${leave.endDate}</div>
                        <div class="gantt-mobile-leave-type">${typeConfig.label}</div>
                    </div>
                `;
            }
        }

        html += '</div></div>';
    }

    html += '</div>';
    return html;
};

/**
 * Setup mobile accordion toggle
 */
export const setupMobileAccordion = (): void => {
    document.querySelectorAll('.gantt-mobile-employee-header').forEach(header => {
        header.addEventListener('click', () => {
            const employee = header.closest('.gantt-mobile-employee');
            if (employee) {
                employee.classList.toggle('expanded');
            }
        });
    });
};

/**
 * Scroll to today's position in the Gantt chart
 */
export const scrollToToday = (): void => {
    const today = new Date();
    const dayOfYear = getDayOfYear(today);
    const scrollPosition = (dayOfYear - 10) * DAY_WIDTH; // 10 days before today

    const header = document.getElementById('ganttTimelineHeader');
    const rows = document.querySelectorAll('.gantt-timeline-row');

    if (header) {
        header.scrollLeft = Math.max(0, scrollPosition);
    }

    rows.forEach(row => {
        (row as HTMLElement).scrollLeft = Math.max(0, scrollPosition);
    });
};

// ============================================
// DRAG-TO-SELECT FUNCTIONALITY
// ============================================

interface DragState {
    isDragging: boolean;
    startDate: string | null;
    endDate: string | null;
    employeeName: string | null;
    startX: number;
    overlay: HTMLElement | null;
    timelineRow: HTMLElement | null;
}

let dragState: DragState = {
    isDragging: false,
    startDate: null,
    endDate: null,
    employeeName: null,
    startX: 0,
    overlay: null,
    timelineRow: null,
};

// Callback for when a new leave is created
let onLeaveCreatedCallback: ((employeeName: string, startDate: string, endDate: string, leaveType: string) => Promise<void>) | null = null;

/**
 * Set callback for leave creation
 */
export const setOnLeaveCreated = (callback: (employeeName: string, startDate: string, endDate: string, leaveType: string) => Promise<void>): void => {
    onLeaveCreatedCallback = callback;
};

/**
 * Setup drag-to-select on Gantt rows
 */
export const setupDragToSelect = (): void => {
    const ganttBody = document.getElementById('ganttBody');
    if (!ganttBody) return;

    // Remove existing listeners to avoid duplicates
    ganttBody.removeEventListener('mousedown', handleMouseDown);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    // Add new listeners
    ganttBody.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
};

/**
 * Handle mouse down on timeline
 */
const handleMouseDown = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;

    // Only start drag on day cells, not on leave bars
    const dayCell = target.closest('.gantt-day-cell') as HTMLElement;
    if (!dayCell) return;

    // Check if clicking on a leave bar
    if (target.closest('.gantt-leave-bar')) return;

    const timelineRow = dayCell.closest('.gantt-timeline-row') as HTMLElement;
    const ganttRow = dayCell.closest('.gantt-row') as HTMLElement;

    if (!timelineRow || !ganttRow) return;

    const employeeName = ganttRow.dataset.employee || '';
    const startDate = dayCell.dataset.date || '';

    e.preventDefault();

    // Start dragging
    dragState = {
        isDragging: true,
        startDate: startDate,
        endDate: startDate,
        employeeName: employeeName,
        startX: e.clientX,
        overlay: null,
        timelineRow: timelineRow,
    };

    // Create selection overlay
    createSelectionOverlay(timelineRow, dayCell);
};

/**
 * Handle mouse move during drag
 */
const handleMouseMove = (e: MouseEvent): void => {
    if (!dragState.isDragging || !dragState.overlay || !dragState.timelineRow) return;

    const rect = dragState.timelineRow.getBoundingClientRect();
    const scrollLeft = dragState.timelineRow.scrollLeft;

    // Calculate current date based on mouse position
    const relativeX = e.clientX - rect.left + scrollLeft;
    const dayIndex = Math.floor(relativeX / DAY_WIDTH);

    // Find the day cell at this position
    const dayCells = dragState.timelineRow.querySelectorAll('.gantt-day-cell');
    if (dayIndex >= 0 && dayIndex < dayCells.length) {
        const currentCell = dayCells[dayIndex] as HTMLElement;
        dragState.endDate = currentCell.dataset.date || dragState.startDate;
    }

    // Update overlay position and width
    updateSelectionOverlay();
};

/**
 * Handle mouse up - end drag and show popup
 */
const handleMouseUp = (e: MouseEvent): void => {
    if (!dragState.isDragging) return;

    const { startDate, endDate, employeeName } = dragState;

    // Reset state
    dragState.isDragging = false;

    // Validate selection
    if (!startDate || !endDate || !employeeName) {
        removeSelectionOverlay();
        return;
    }

    // Ensure dates are in correct order
    const start = new Date(startDate);
    const end = new Date(endDate);
    const finalStartDate = start <= end ? startDate : endDate;
    const finalEndDate = start <= end ? endDate : startDate;

    // Show leave type popup
    showLeaveTypePopup(employeeName, finalStartDate, finalEndDate, e.clientX, e.clientY);
};

/**
 * Create selection overlay element
 */
const createSelectionOverlay = (timelineRow: HTMLElement, startCell: HTMLElement): void => {
    // Remove any existing overlay
    removeSelectionOverlay();

    const overlay = document.createElement('div');
    overlay.className = 'gantt-selection-overlay';

    overlay.style.left = `${startCell.offsetLeft}px`;
    overlay.style.width = `${DAY_WIDTH}px`;

    timelineRow.appendChild(overlay);
    dragState.overlay = overlay;
};

/**
 * Update selection overlay based on current drag state
 */
const updateSelectionOverlay = (): void => {
    if (!dragState.overlay || !dragState.startDate || !dragState.endDate || !dragState.timelineRow) return;

    const dayCells = dragState.timelineRow.querySelectorAll('.gantt-day-cell');
    let startIndex = -1;
    let endIndex = -1;

    dayCells.forEach((cell, index) => {
        const cellDate = (cell as HTMLElement).dataset.date;
        if (cellDate === dragState.startDate) startIndex = index;
        if (cellDate === dragState.endDate) endIndex = index;
    });

    if (startIndex === -1 || endIndex === -1) return;

    // Ensure correct order
    const minIndex = Math.min(startIndex, endIndex);
    const maxIndex = Math.max(startIndex, endIndex);

    const left = minIndex * DAY_WIDTH;
    const width = (maxIndex - minIndex + 1) * DAY_WIDTH;

    dragState.overlay.style.left = `${left}px`;
    dragState.overlay.style.width = `${width}px`;
};

/**
 * Remove selection overlay
 */
const removeSelectionOverlay = (): void => {
    if (dragState.overlay) {
        dragState.overlay.remove();
        dragState.overlay = null;
    }
};

/**
 * Show leave type selection popup
 */
const showLeaveTypePopup = (employeeName: string, startDate: string, endDate: string, x: number, y: number): void => {
    // Remove any existing popup
    const existingPopup = document.querySelector('.gantt-leave-popup');
    if (existingPopup) existingPopup.remove();

    // Calculate days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Format dates for display
    const formatDate = (dateStr: string): string => {
        const [year, month, day] = dateStr.split('-');
        return `${day}.${month}.${year}`;
    };

    // Create popup
    const popup = document.createElement('div');
    popup.className = 'gantt-leave-popup';
    popup.innerHTML = `
        <div class="gantt-popup-header">
            <strong>${employeeName}</strong>
            <button class="gantt-popup-close">&times;</button>
        </div>
        <div class="gantt-popup-dates">
            ${formatDate(startDate)} - ${formatDate(endDate)} (${days} dni)
        </div>
        <div class="gantt-popup-types">
            ${Object.entries(LEAVE_TYPES).map(([type, config]) => `
                <button class="gantt-popup-type-btn" data-type="${type}" style="background: ${config.color}">
                    ${config.label}
                </button>
            `).join('')}
        </div>
        <div class="gantt-popup-footer">
            <button class="gantt-popup-cancel">Anuluj</button>
        </div>
    `;

    // Position popup
    popup.style.position = 'fixed';
    popup.style.left = `${Math.min(x, window.innerWidth - 320)}px`;
    popup.style.top = `${Math.min(y, window.innerHeight - 300)}px`;
    popup.style.zIndex = '1000';

    document.body.appendChild(popup);

    // Add event listeners
    popup.querySelector('.gantt-popup-close')?.addEventListener('click', () => {
        popup.remove();
        removeSelectionOverlay();
    });

    popup.querySelector('.gantt-popup-cancel')?.addEventListener('click', () => {
        popup.remove();
        removeSelectionOverlay();
    });

    popup.querySelectorAll('.gantt-popup-type-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const leaveType = (btn as HTMLElement).dataset.type || 'vacation';
            popup.remove();
            removeSelectionOverlay();

            if (onLeaveCreatedCallback) {
                await onLeaveCreatedCallback(employeeName, startDate, endDate, leaveType);
            }
        });
    });

    // Close popup when clicking outside
    const closeOnOutsideClick = (e: MouseEvent) => {
        if (!popup.contains(e.target as Node)) {
            popup.remove();
            removeSelectionOverlay();
            document.removeEventListener('mousedown', closeOnOutsideClick);
        }
    };

    setTimeout(() => {
        document.addEventListener('mousedown', closeOnOutsideClick);
    }, 100);
};

/**
 * Cleanup drag event listeners
 */
export const cleanupDragListeners = (): void => {
    const ganttBody = document.getElementById('ganttBody');
    if (ganttBody) {
        ganttBody.removeEventListener('mousedown', handleMouseDown);
    }
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    removeSelectionOverlay();
};
