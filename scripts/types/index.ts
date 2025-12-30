/**
 * Typy modeli danych dla aplikacji Grafik
 * Ten plik zawiera wszystkie interfejsy TypeScript opisujące strukturę danych
 */

// ============================================
// PRACOWNICY (Employees)
// ============================================

/**
 * Dane urlopowe pracownika dla konkretnego roku
 */
export interface EmployeeLeaveInfo {
    /** Przysługujący wymiar urlopu */
    entitlement: number;
    /** Urlop przeniesiony z poprzedniego roku */
    carriedOver: number;
}

/**
 * Pełna struktura pracownika z Firestore
 */
export interface Employee {
    /** Imię pracownika */
    firstName?: string;
    /** Nazwisko pracownika */
    lastName?: string;
    /** Wyświetlana nazwa (legacy) */
    displayName?: string;
    /** Nazwa (legacy) */
    name?: string;
    /** UID z Firebase Auth */
    uid?: string;
    /** Kolor pracownika w grafiku */
    color: string;
    /** Czy pracownik jest ukryty */
    isHidden?: boolean;
    /** Czy pracownik jest tylko w grafiku (nie dotyczy urlopów) */
    isScheduleOnly?: boolean;
    /** Rola pracownika */
    role?: 'admin' | 'user';
    /** Przysługujący wymiar urlopu */
    leaveEntitlement?: number;
    /** Urlop zaległy (legacy) */
    carriedOverLeave?: number;
    /** Urlop zaległy wg roku */
    carriedOverLeaveByYear?: Record<string, number>;
}

/**
 * Mapa pracowników (klucz = ID pracownika)
 */
export type EmployeesMap = Record<string, Employee>;

// ============================================
// GRAFIK (Schedule)
// ============================================

/**
 * Dane komórki grafiku
 */
export interface CellData {
    /** Nazwa pacjenta */
    name?: string;
    /** Data rozpoczęcia leczenia */
    treatmentStartDate?: string;
    /** Przedłużenie leczenia (dni) */
    treatmentExtensionDays?: number;
    /** Dodatkowe informacje */
    additionalInfo?: string;
    /** Czy komórka jest przerwą */
    isBreak?: boolean;
    /** Typ zabiegu */
    treatmentType?: 'massage' | 'pnf' | 'everyOtherDay' | null;
    /** Dane dla podzielonej komórki */
    splitData?: SplitCellData;
}

/**
 * Dane podzielonej komórki (2 części)
 */
export interface SplitCellData {
    top: CellData | null;
    bottom: CellData | null;
}

/**
 * Struktura danych tygodniowego grafiku
 * Klucz: "employeeId_dayIndex_timeSlotIndex"
 */
export type WeeklyScheduleData = Record<string, CellData>;

/**
 * Pełna struktura dokumentu grafiku z Firestore
 */
export interface ScheduleDocument {
    employees: EmployeesMap;
    weeklyData: Record<string, WeeklyScheduleData>;
    scheduleSettings?: ScheduleSettings;
}

/**
 * Ustawienia grafiku
 */
export interface ScheduleSettings {
    startHour: number;
    endHour: number;
    slotDuration: number;
    workDays: number[];
}

// ============================================
// URLOPY (Leaves)
// ============================================

/**
 * Typ urlopu
 */
export type LeaveType =
    | 'vacation'           // Wypoczynkowy
    | 'child_care_art_188' // Opieka nad zdrowym dzieckiem
    | 'sick_child_care'    // Opieka nad chorym dzieckiem
    | 'family_member_care' // Opieka nad chorym członkiem rodziny
    | 'schedule_pickup';   // Wybicie za święto

/**
 * Pojedynczy wpis urlopowy
 */
export interface LeaveEntry {
    /** Unikalny identyfikator urlopu */
    id: string;
    /** Typ urlopu (opcjonalny, domyślnie 'vacation') */
    type?: LeaveType | string;
    /** Data rozpoczęcia (YYYY-MM-DD) */
    startDate: string;
    /** Data zakończenia (YYYY-MM-DD) */
    endDate: string;
}

/**
 * Mapa urlopów (klucz = nazwa pracownika)
 */
export type LeavesMap = Record<string, LeaveEntry[]>;

// ============================================
// HISTORIA ZMIAN
// ============================================

/**
 * Wpis w historii zmian
 */
export interface HistoryEntry {
    /** Timestamp zmiany */
    timestamp: number;
    /** Kto dokonał zmiany */
    changedBy?: string;
    /** Poprzednia wartość */
    previousValue: CellData | null;
    /** Nowa wartość */
    newValue: CellData | null;
}

// ============================================
// UI / UX
// ============================================

/**
 * Pozycja elementu menu kontekstowego
 */
export interface ContextMenuPosition {
    x: number;
    y: number;
}

/**
 * Element menu kontekstowego
 */
export interface ContextMenuItem {
    id: string;
    action: (cell: HTMLElement) => void;
}

/**
 * Konfiguracja modalu
 */
export interface ModalConfig {
    title: string;
    content: string;
    onConfirm?: () => void;
    onCancel?: () => void;
}

// ============================================
// FIREBASE
// ============================================

/**
 * Rozszerzenie globalnego window dla backward compatibility
 * Podstawowe funkcje UI - pozostałe są definiowane w poszczególnych modułach
 */
declare global {
    interface Window {
        showToast: (message: string, duration?: number) => void;
    }
}

export { };
