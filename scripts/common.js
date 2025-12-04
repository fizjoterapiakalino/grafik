// scripts/common.js

export const AppConfig = {
    schedule: {
        startHour: 7,
        endHour: 17,
        breakText: 'Przerwa',
        defaultCellColor: '#e0e0e0',
        contentCellColor: '#ffffff',
    },
    changes: {
        employeeColors: [
            '#FFADAD',
            '#FFD6A5',
            '#FDFFB6',
            '#CAFFBF',
            '#9BF6FF',
            '#A0C4FF',
            '#BDB2FF',
            '#FFC6FF',
            '#F44336',
            '#FF9800',
            '#FFEB3B',
            '#4CAF50',
            '#2196F3',
            '#3F51B5',
            '#9C27B0',
            '#E91E63',
        ],
    },
    leaves: {
        careLimits: {
            child_care_art_188: 2,
            sick_child_care: 60,
            family_member_care: 14,
        },
        leaveTypeColors: {
            vacation: '#80deea',
            child_care_art_188: '#ffcc80',
            sick_child_care: '#f48fb1',
            family_member_care: '#cf93d9',
            default: '#e6ee9b',
        },
    },
    firestore: {
        collections: {
            schedules: 'schedules',
            leaves: 'leaves',
        },
        docs: {
            mainSchedule: 'mainSchedule',
            mainLeaves: 'mainLeaves',
        },
    },
    undoManager: {
        maxStates: 20,
    },
};

export const months = [
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

export function showToast(message, duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('show');
    }, 100);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (container.contains(toast)) {
                container.removeChild(toast);
            }
        }, 500);
    }, duration);
}

export function hideLoadingOverlay(overlay) {
    if (overlay) {
        overlay.style.display = 'none';
    }
}

export function capitalizeFirstLetter(string) {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1);
}

export function searchAndHighlight(searchTerm, tableSelector, cellSelector) {
    const table = document.querySelector(tableSelector);
    if (!table) return;
    const lowerCaseSearchTerm = searchTerm.toLowerCase();

    // Pokaż wszystkie wiersze przed rozpoczęciem wyszukiwania
    table.querySelectorAll('tbody tr').forEach((row) => {
        row.style.display = '';
    });

    table.querySelectorAll(cellSelector).forEach((cell) => {
        const cellText = cell.textContent.toLowerCase();
        if (searchTerm && cellText.includes(lowerCaseSearchTerm)) {
            cell.classList.add('search-highlight');
        } else {
            cell.classList.remove('search-highlight');
        }
    });
}

export class UndoManager {
    constructor({ maxStates = 20, onUpdate = () => {} }) {
        this.maxStates = maxStates;
        this.onUpdate = onUpdate;
        this.stack = [];
        this.currentIndex = -1;
    }

    initialize(initialState) {
        this.stack = [JSON.parse(JSON.stringify(initialState))];
        this.currentIndex = 0;
        this.onUpdate(this);
    }

    pushState(state) {
        if (this.currentIndex < this.stack.length - 1) {
            this.stack = this.stack.slice(0, this.currentIndex + 1);
        }
        this.stack.push(JSON.parse(JSON.stringify(state)));
        if (this.stack.length > this.maxStates) {
            this.stack.shift();
        }
        this.currentIndex = this.stack.length - 1;
        this.onUpdate(this);
    }

    undo() {
        if (this.canUndo()) {
            this.currentIndex--;
            this.onUpdate(this);
            return JSON.parse(JSON.stringify(this.stack[this.currentIndex]));
        }
        return null;
    }

    canUndo() {
        return this.currentIndex > 0;
    }
}

export function countWorkdays(startDate, endDate) {
    let count = 0;
    const start = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');

    let current = new Date(start);

    while (current <= end) {
        const day = current.getUTCDay(); // 0 = Niedziela, 1 = Poniedziałek, ..., 6 = Sobota
        if (day !== 0 && day !== 6) {
            count++;
        }
        current.setUTCDate(current.getUTCDate() + 1);
    }
    return count;
}

// Backward compatibility
window.AppConfig = AppConfig;
window.months = months;
window.showToast = showToast;
window.hideLoadingOverlay = hideLoadingOverlay;
window.capitalizeFirstLetter = capitalizeFirstLetter;
window.searchAndHighlight = searchAndHighlight;
window.UndoManager = UndoManager;
window.countWorkdays = countWorkdays;
