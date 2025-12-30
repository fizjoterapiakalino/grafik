// scripts/common.ts

/**
 * Konfiguracja aplikacji
 */
interface ScheduleConfig {
    startHour: number;
    endHour: number;
    breakText: string;
    defaultCellColor: string;
    contentCellColor: string;
}

interface ChangesConfig {
    employeeColors: string[];
}

interface CareLimits {
    child_care_art_188: number;
    sick_child_care: number;
    family_member_care: number;
}

interface LeaveTypeColors {
    vacation: string;
    child_care_art_188: string;
    sick_child_care: string;
    family_member_care: string;
    schedule_pickup: string;
    default: string;
}

interface LeavesConfig {
    careLimits: CareLimits;
    leaveTypeColors: LeaveTypeColors;
}

interface FirestoreConfig {
    collections: {
        schedules: string;
        leaves: string;
    };
    docs: {
        mainSchedule: string;
        mainLeaves: string;
    };
}

interface UndoConfig {
    maxStates: number;
}

export interface AppConfigType {
    schedule: ScheduleConfig;
    changes: ChangesConfig;
    leaves: LeavesConfig;
    firestore: FirestoreConfig;
    undoManager: UndoConfig;
    debug?: boolean;
}

export const AppConfig: AppConfigType = {
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
            schedule_pickup: '#b39ddb',
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

export const months: readonly string[] = [
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
] as const;

/**
 * Wyświetla powiadomienie toast
 */
export function showToast(message: string, duration: number = 3000): void {
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

/**
 * Ukrywa overlay ładowania
 */
export function hideLoadingOverlay(overlay: HTMLElement | null): void {
    if (overlay) {
        overlay.style.display = 'none';
    }
}

/**
 * Zamienia pierwszą literę na wielką
 */
export function capitalizeFirstLetter(str: string): string {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Wyszukuje i podświetla tekst w tabeli
 */
export function searchAndHighlight(
    searchTerm: string,
    tableSelector: string,
    cellSelector: string
): void {
    const table = document.querySelector(tableSelector);
    if (!table) return;

    const lowerCaseSearchTerm = searchTerm.toLowerCase();

    // Pokaż wszystkie wiersze przed rozpoczęciem wyszukiwania
    table.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row) => {
        row.style.display = '';
    });

    table.querySelectorAll<HTMLElement>(cellSelector).forEach((cell) => {
        const cellText = cell.textContent?.toLowerCase() || '';
        if (searchTerm && cellText.includes(lowerCaseSearchTerm)) {
            cell.classList.add('search-highlight');
        } else {
            cell.classList.remove('search-highlight');
        }
    });
}

/**
 * Interfejs dla callback'u UndoManager
 */
interface UndoManagerOptions<T> {
    maxStates?: number;
    onUpdate?: (manager: UndoManager<T>) => void;
}

/**
 * Manager cofania zmian
 */
export class UndoManager<T = unknown> {
    private maxStates: number;
    private onUpdate: (manager: UndoManager<T>) => void;
    private stack: T[];
    private currentIndex: number;

    constructor({ maxStates = 20, onUpdate = () => { } }: UndoManagerOptions<T> = {}) {
        this.maxStates = maxStates;
        this.onUpdate = onUpdate;
        this.stack = [];
        this.currentIndex = -1;
    }

    initialize(initialState: T): void {
        this.stack = [JSON.parse(JSON.stringify(initialState))];
        this.currentIndex = 0;
        this.onUpdate(this);
    }

    pushState(state: T): void {
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

    undo(): T | null {
        if (this.canUndo()) {
            this.currentIndex--;
            this.onUpdate(this);
            return JSON.parse(JSON.stringify(this.stack[this.currentIndex]));
        }
        return null;
    }

    canUndo(): boolean {
        return this.currentIndex > 0;
    }
}

/**
 * Oblicza datę Wielkanocy dla danego roku
 */
export function getEasterDate(year: number): Date {
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
}

/**
 * Sprawdza czy data jest świętem państwowym w Polsce
 */
export function isHoliday(date: Date): boolean {
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
        '11-24', // Wigilia (Grudzień 24)
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

    const zieloneSwiatki = new Date(easter);
    zieloneSwiatki.setUTCDate(easter.getUTCDate() + 49);

    const checkDate = (d: Date): boolean =>
        d.getUTCMonth() === month && d.getUTCDate() === day;

    if (checkDate(easter)) return true;
    if (checkDate(easterMonday)) return true;
    if (checkDate(bozeCialo)) return true;
    if (checkDate(zieloneSwiatki)) return true;

    return false;
}

/**
 * Liczy dni robocze między datami (bez weekendów i świąt)
 */
export function countWorkdays(startDate: string, endDate: string): number {
    let count = 0;
    const start = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');

    const current = new Date(start);

    while (current <= end) {
        const day = current.getUTCDay(); // 0 = Niedziela, 6 = Sobota
        if (day !== 0 && day !== 6 && !isHoliday(current)) {
            count++;
        }
        current.setUTCDate(current.getUTCDate() + 1);
    }
    return count;
}

// Backward compatibility - przypisanie do window
declare global {
    interface Window {
        AppConfig: AppConfigType;
        months: readonly string[];
        showToast: typeof showToast;
        hideLoadingOverlay: typeof hideLoadingOverlay;
        capitalizeFirstLetter: typeof capitalizeFirstLetter;
        searchAndHighlight: typeof searchAndHighlight;
        isHoliday: typeof isHoliday;
        getEasterDate: typeof getEasterDate;
        UndoManager: typeof UndoManager;
        countWorkdays: typeof countWorkdays;
    }
}

window.AppConfig = AppConfig;
window.months = months;
window.showToast = showToast;
window.hideLoadingOverlay = hideLoadingOverlay;
window.capitalizeFirstLetter = capitalizeFirstLetter;
window.searchAndHighlight = searchAndHighlight;
window.isHoliday = isHoliday;
window.getEasterDate = getEasterDate;
window.UndoManager = UndoManager;
window.countWorkdays = countWorkdays;
