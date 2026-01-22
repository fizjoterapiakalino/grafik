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

const DAY_WIDTH = 32; // pixels per day (increased for better visibility)

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
    // Build months row
    let monthsHtml = '<div class="gantt-months-row">';
    let daysHtml = '<div class="gantt-days-row">';

    for (let month = 0; month < 12; month++) {
        const daysInMonth = getDaysInMonth(year, month);
        const width = daysInMonth * DAY_WIDTH;

        monthsHtml += `<div class="gantt-month-header" style="width: ${width}px; min-width: ${width}px;">${MONTH_NAMES[month].substring(0, 3)}</div>`;

        for (let day = 1; day <= daysInMonth; day++) {
            const weekend = isWeekend(year, month, day) ? 'weekend' : '';
            const today = isToday(year, month, day) ? 'today' : '';
            daysHtml += `<div class="gantt-day-header ${weekend} ${today}">${day}</div>`;
        }
    }

    monthsHtml += '</div>';
    daysHtml += '</div>';

    return monthsHtml + daysHtml;
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
const renderLeaveBars = (leaves: LeaveEntry[], year: number, employeeName: string): string => {
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

        // Format date range for display (DD-DD or DD.MM-DD.MM if cross-month)
        const startDay = startDate.getDate().toString().padStart(2, '0');
        const endDay = endDate.getDate().toString().padStart(2, '0');
        const startMonth = (startDate.getMonth() + 1).toString().padStart(2, '0');
        const endMonth = (endDate.getMonth() + 1).toString().padStart(2, '0');

        let text = '';
        if (width >= 80) {
            // Full date range for wider bars
            if (startDate.getMonth() === endDate.getMonth()) {
                text = `${startDay}-${endDay}`;
            } else {
                text = `${startDay}.${startMonth}-${endDay}.${endMonth}`;
            }
        } else if (width >= 50) {
            // Just days for medium bars
            text = `${startDay}-${endDay}`;
        }
        // No text for narrow bars

        return `
            <div class="gantt-leave-bar ${leaveType}" 
                 style="left: ${left}px; width: ${width}px;"
                 data-leave-id="${leave.id}"
                 data-employee="${employeeName}"
                 data-type="${leaveType}"
                 data-start="${leave.startDate}"
                 data-end="${leave.endDate}"
                 title="${typeConfig.label}: ${leave.startDate} - ${leave.endDate} (${days} dni)">
                <div class="resize-handle left" data-side="left"></div>
                <span class="leave-bar-text">${text}</span>
                <div class="resize-handle right" data-side="right"></div>
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
 * Render a single timeline row (without employee cell - separate now)
 */
const renderTimelineRow = (
    employeeName: string,
    leaves: LeaveEntry[],
    year: number
): string => {
    return `
        <div class="gantt-timeline-row" data-employee="${employeeName}">
            ${renderDayCells(year)}
            ${renderLeaveBars(leaves, year, employeeName)}
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
    const employeesList = document.getElementById('ganttEmployeesList');
    const timelineBody = document.getElementById('ganttTimelineBody');
    const scrollWrapper = document.getElementById('ganttScrollWrapper');

    if (!headerContainer || !employeesList || !timelineBody) {
        console.error('Gantt containers not found');
        return;
    }

    // Render header
    headerContainer.innerHTML = renderGanttHeader(year);

    // Get sorted employees
    const sortedEmployees = Object.entries(employees)
        .filter(([_, emp]) => !emp.isHidden && !emp.isScheduleOnly)
        .sort((a, b) => {
            const nameA = a[1].displayName || a[1].name || a[0];
            const nameB = b[1].displayName || b[1].name || b[0];
            return nameA.localeCompare(nameB, 'pl');
        });

    // Render employee names in fixed column
    let employeesHtml = '';
    let timelineHtml = '';

    for (const [empId, emp] of sortedEmployees) {
        const employeeName = emp.displayName || emp.name || empId;
        const employeeLeaves = leaves[employeeName] || [];

        employeesHtml += `<div class="gantt-employee-cell" data-employee="${employeeName}">${employeeName}</div>`;
        timelineHtml += renderTimelineRow(employeeName, employeeLeaves, year);
    }

    employeesList.innerHTML = employeesHtml;
    timelineBody.innerHTML = timelineHtml;

    // Sync vertical scroll between employees list and timeline
    if (scrollWrapper) {
        syncVerticalScroll(employeesList, scrollWrapper);
    }
};

/**
 * Sync vertical scroll between employees list and timeline body
 */
const syncVerticalScroll = (employeesList: HTMLElement, scrollWrapper: HTMLElement): void => {
    // When timeline scrolls vertically, sync employee list
    scrollWrapper.addEventListener('scroll', () => {
        employeesList.scrollTop = scrollWrapper.scrollTop;
    });

    // When employee list scrolls, sync timeline
    employeesList.addEventListener('scroll', () => {
        scrollWrapper.scrollTop = employeesList.scrollTop;
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

    const scrollWrapper = document.getElementById('ganttScrollWrapper');

    if (scrollWrapper) {
        scrollWrapper.scrollLeft = Math.max(0, scrollPosition);
    }
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
    const timelineBody = document.getElementById('ganttTimelineBody');
    if (!timelineBody) return;

    // Remove existing listeners to avoid duplicates
    timelineBody.removeEventListener('mousedown', handleMouseDown);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    // Add new listeners
    timelineBody.addEventListener('mousedown', handleMouseDown);
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

// ============================================
// LEAVE BAR EDITING (RESIZE + CLICK TO EDIT)
// ============================================

interface ResizeState {
    isResizing: boolean;
    leaveId: string | null;
    employeeName: string | null;
    side: 'left' | 'right' | null;
    originalStart: string | null;
    originalEnd: string | null;
    leaveBar: HTMLElement | null;
    timelineRow: HTMLElement | null;
}

let resizeState: ResizeState = {
    isResizing: false,
    leaveId: null,
    employeeName: null,
    side: null,
    originalStart: null,
    originalEnd: null,
    leaveBar: null,
    timelineRow: null,
};

// Callbacks for leave operations
let onLeaveUpdatedCallback: ((employeeName: string, leaveId: string, startDate: string, endDate: string) => Promise<void>) | null = null;
let onLeaveDeletedCallback: ((employeeName: string, leaveId: string) => Promise<void>) | null = null;
let onLeaveTypeChangedCallback: ((employeeName: string, leaveId: string, newType: string) => Promise<void>) | null = null;

/**
 * Set callbacks for leave editing operations
 */
export const setOnLeaveUpdated = (callback: (employeeName: string, leaveId: string, startDate: string, endDate: string) => Promise<void>): void => {
    onLeaveUpdatedCallback = callback;
};

export const setOnLeaveDeleted = (callback: (employeeName: string, leaveId: string) => Promise<void>): void => {
    onLeaveDeletedCallback = callback;
};

export const setOnLeaveTypeChanged = (callback: (employeeName: string, leaveId: string, newType: string) => Promise<void>): void => {
    onLeaveTypeChangedCallback = callback;
};

/**
 * Setup leave bar click and resize handlers
 */
export const setupLeaveBarInteractions = (): void => {
    const ganttBody = document.getElementById('ganttBody');
    if (!ganttBody) return;

    // Handle clicks on leave bars for editing
    ganttBody.addEventListener('click', handleLeaveBarClick);

    // Handle resize start
    ganttBody.addEventListener('mousedown', handleResizeStart);
};

/**
 * Cleanup leave bar interactions
 */
export const cleanupLeaveBarInteractions = (): void => {
    const ganttBody = document.getElementById('ganttBody');
    if (ganttBody) {
        ganttBody.removeEventListener('click', handleLeaveBarClick);
        ganttBody.removeEventListener('mousedown', handleResizeStart);
    }
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
};

/**
 * Handle click on leave bar to show edit popup
 */
const handleLeaveBarClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    const leaveBar = target.closest('.gantt-leave-bar') as HTMLElement;

    // Don't show popup if clicking on resize handle
    if (target.closest('.resize-handle')) return;

    if (!leaveBar) return;

    e.stopPropagation();

    const leaveId = leaveBar.dataset.leaveId || '';
    const employeeName = leaveBar.dataset.employee || '';
    const startDate = leaveBar.dataset.start || '';
    const endDate = leaveBar.dataset.end || '';
    const leaveType = leaveBar.dataset.type || 'vacation';

    showEditPopup(employeeName, leaveId, startDate, endDate, leaveType, e.clientX, e.clientY);
};

/**
 * Handle resize start (mousedown on resize handle)
 */
const handleResizeStart = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    const handle = target.closest('.resize-handle') as HTMLElement;

    if (!handle) return;

    const leaveBar = handle.closest('.gantt-leave-bar') as HTMLElement;
    const timelineRow = leaveBar?.closest('.gantt-timeline-row') as HTMLElement;

    if (!leaveBar || !timelineRow) return;

    e.preventDefault();
    e.stopPropagation();

    resizeState = {
        isResizing: true,
        leaveId: leaveBar.dataset.leaveId || null,
        employeeName: leaveBar.dataset.employee || null,
        side: handle.dataset.side as 'left' | 'right',
        originalStart: leaveBar.dataset.start || null,
        originalEnd: leaveBar.dataset.end || null,
        leaveBar: leaveBar,
        timelineRow: timelineRow,
    };

    // Add temporary listeners for resize
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);

    // Visual feedback
    leaveBar.style.opacity = '0.7';
};

/**
 * Handle resize move
 */
const handleResizeMove = (e: MouseEvent): void => {
    if (!resizeState.isResizing || !resizeState.leaveBar || !resizeState.timelineRow) return;

    const rect = resizeState.timelineRow.getBoundingClientRect();
    const scrollLeft = resizeState.timelineRow.scrollLeft;

    // Calculate day index from mouse position
    const relativeX = e.clientX - rect.left + scrollLeft;
    const dayIndex = Math.floor(relativeX / DAY_WIDTH);

    // Find the corresponding date
    const dayCells = resizeState.timelineRow.querySelectorAll('.gantt-day-cell');
    if (dayIndex < 0 || dayIndex >= dayCells.length) return;

    const targetCell = dayCells[dayIndex] as HTMLElement;
    const targetDate = targetCell.dataset.date;
    if (!targetDate) return;

    // Update the leave bar visually based on which side is being resized
    if (resizeState.side === 'left') {
        // Don't allow start date to go past end date
        if (resizeState.originalEnd && targetDate > resizeState.originalEnd) return;
        resizeState.leaveBar.dataset.start = targetDate;
    } else if (resizeState.side === 'right') {
        // Don't allow end date to go before start date
        if (resizeState.originalStart && targetDate < resizeState.originalStart) return;
        resizeState.leaveBar.dataset.end = targetDate;
    }

    // Update visual position
    updateLeaveBarVisual(resizeState.leaveBar);
};

/**
 * Handle resize end
 */
const handleResizeEnd = async (): Promise<void> => {
    if (!resizeState.isResizing) return;

    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);

    const { leaveId, employeeName, leaveBar } = resizeState;

    if (leaveBar) {
        leaveBar.style.opacity = '1';

        const newStart = leaveBar.dataset.start || '';
        const newEnd = leaveBar.dataset.end || '';

        // Save if dates changed
        if (onLeaveUpdatedCallback && leaveId && employeeName &&
            (newStart !== resizeState.originalStart || newEnd !== resizeState.originalEnd)) {
            await onLeaveUpdatedCallback(employeeName, leaveId, newStart, newEnd);
        }
    }

    // Reset state
    resizeState = {
        isResizing: false,
        leaveId: null,
        employeeName: null,
        side: null,
        originalStart: null,
        originalEnd: null,
        leaveBar: null,
        timelineRow: null,
    };
};

/**
 * Update leave bar visual position/width
 */
const updateLeaveBarVisual = (leaveBar: HTMLElement): void => {
    const startDateStr = leaveBar.dataset.start;
    const endDateStr = leaveBar.dataset.end;

    if (!startDateStr || !endDateStr) return;

    const timelineRow = leaveBar.closest('.gantt-timeline-row');
    if (!timelineRow) return;

    const dayCells = timelineRow.querySelectorAll('.gantt-day-cell');
    let startIndex = -1;
    let endIndex = -1;

    dayCells.forEach((cell, index) => {
        const cellDate = (cell as HTMLElement).dataset.date;
        if (cellDate === startDateStr) startIndex = index;
        if (cellDate === endDateStr) endIndex = index;
    });

    if (startIndex === -1 || endIndex === -1) return;

    const left = startIndex * DAY_WIDTH;
    const width = (endIndex - startIndex + 1) * DAY_WIDTH;

    leaveBar.style.left = `${left}px`;
    leaveBar.style.width = `${width}px`;

    // Update text
    const days = endIndex - startIndex + 1;
    const textSpan = leaveBar.querySelector('.leave-bar-text');
    if (textSpan) {
        textSpan.textContent = width >= 40 ? `${days}d` : '';
    }
};

/**
 * Show edit popup for a leave
 */
const showEditPopup = (
    employeeName: string,
    leaveId: string,
    startDate: string,
    endDate: string,
    currentType: string,
    x: number,
    y: number
): void => {
    // Remove any existing popup
    const existingPopup = document.querySelector('.gantt-leave-popup');
    if (existingPopup) existingPopup.remove();

    // Calculate days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Format dates
    const formatDate = (dateStr: string): string => {
        const [year, month, day] = dateStr.split('-');
        return `${day}.${month}.${year}`;
    };

    const currentTypeConfig = LEAVE_TYPES[currentType] || LEAVE_TYPES.vacation;

    // Create popup
    const popup = document.createElement('div');
    popup.className = 'gantt-leave-popup gantt-edit-popup';
    popup.innerHTML = `
        <div class="gantt-popup-header">
            <strong>${employeeName}</strong>
            <button class="gantt-popup-close">&times;</button>
        </div>
        <div class="gantt-popup-dates">
            ${formatDate(startDate)} - ${formatDate(endDate)} (${days} dni)
        </div>
        <div class="gantt-popup-current-type">
            <span class="type-indicator" style="background: ${currentTypeConfig.color}"></span>
            ${currentTypeConfig.label}
        </div>
        <div class="gantt-popup-actions">
            <button class="gantt-popup-action-btn change-type-btn">
                <i class="fas fa-exchange-alt"></i> Zmień typ
            </button>
            <button class="gantt-popup-action-btn delete-btn danger">
                <i class="fas fa-trash"></i> Usuń urlop
            </button>
        </div>
        <div class="gantt-popup-type-selector" style="display: none;">
            <p>Wybierz nowy typ:</p>
            ${Object.entries(LEAVE_TYPES).map(([type, config]) => `
                <button class="gantt-popup-type-btn ${type === currentType ? 'current' : ''}" 
                        data-type="${type}" 
                        style="background: ${config.color}">
                    ${config.label}
                </button>
            `).join('')}
        </div>
        <div class="gantt-popup-footer">
            <button class="gantt-popup-cancel">Zamknij</button>
        </div>
    `;

    // Position popup
    popup.style.position = 'fixed';
    popup.style.left = `${Math.min(x, window.innerWidth - 320)}px`;
    popup.style.top = `${Math.min(y, window.innerHeight - 400)}px`;
    popup.style.zIndex = '1000';

    document.body.appendChild(popup);

    // Event listeners
    popup.querySelector('.gantt-popup-close')?.addEventListener('click', () => popup.remove());
    popup.querySelector('.gantt-popup-cancel')?.addEventListener('click', () => popup.remove());

    // Change type button
    popup.querySelector('.change-type-btn')?.addEventListener('click', () => {
        const typeSelector = popup.querySelector('.gantt-popup-type-selector') as HTMLElement;
        typeSelector.style.display = typeSelector.style.display === 'none' ? 'block' : 'none';
    });

    // Type selection
    popup.querySelectorAll('.gantt-popup-type-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const newType = (btn as HTMLElement).dataset.type || 'vacation';
            if (newType !== currentType && onLeaveTypeChangedCallback) {
                popup.remove();
                await onLeaveTypeChangedCallback(employeeName, leaveId, newType);
            } else {
                popup.remove();
            }
        });
    });

    // Delete button - show inline confirmation
    const deleteBtn = popup.querySelector('.delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            // Show inline confirmation
            const actionsDiv = popup.querySelector('.gantt-popup-actions');
            if (actionsDiv) {
                actionsDiv.innerHTML = `
                    <p style="margin: 0 0 10px; color: var(--color-danger); font-weight: 500;">
                        Czy na pewno usunąć ten urlop?
                    </p>
                    <div style="display: flex; gap: 8px;">
                        <button class="gantt-popup-action-btn confirm-delete-btn danger" style="flex: 1;">
                            <i class="fas fa-check"></i> Tak, usuń
                        </button>
                        <button class="gantt-popup-action-btn cancel-delete-btn" style="flex: 1;">
                            <i class="fas fa-times"></i> Anuluj
                        </button>
                    </div>
                `;

                // Confirm delete
                actionsDiv.querySelector('.confirm-delete-btn')?.addEventListener('click', async () => {
                    popup.remove();
                    if (onLeaveDeletedCallback) {
                        await onLeaveDeletedCallback(employeeName, leaveId);
                    }
                });

                // Cancel delete
                actionsDiv.querySelector('.cancel-delete-btn')?.addEventListener('click', () => {
                    popup.remove();
                });
            }
        });
    }

    // Close on outside click
    const closeOnOutsideClick = (e: MouseEvent) => {
        if (!popup.contains(e.target as Node)) {
            popup.remove();
            document.removeEventListener('mousedown', closeOnOutsideClick);
        }
    };

    setTimeout(() => {
        document.addEventListener('mousedown', closeOnOutsideClick);
    }, 100);
};
