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
// HARMONOGRAM - STAN KOMÓRKI (Schedule Cell State)
// ============================================

/**
 * Dane leczenia dla pojedynczej komórki lub części split
 */
export interface TreatmentData {
    /** Data rozpoczęcia leczenia */
    startDate?: string | null;
    /** Przedłużenie leczenia (dni) */
    extensionDays?: number | null;
    /** Data zakończenia leczenia */
    endDate?: string | null;
    /** Dodatkowe informacje */
    additionalInfo?: string | null;
}

/**
 * Wpis historii zmian w komórce harmonogramu
 */
export interface ScheduleHistoryEntry {
    /** Poprzednia wartość */
    oldValue: string;
    /** Timestamp zmiany */
    timestamp: string;
    /** UID użytkownika, który dokonał zmiany */
    userId: string | null;
}

/**
 * Stan pojedynczej komórki harmonogramu
 * Używany w: schedule.ts, schedule-events.ts, schedule-data.ts,
 * schedule-helpers.ts, schedule-modals.ts, utils.ts
 */
export interface CellState {
    /** Zawartość komórki (dla normalnej komórki) */
    content?: string | null;
    /** Zawartość górnej części (dla split cell) */
    content1?: string | null;
    /** Zawartość dolnej części (dla split cell) */
    content2?: string | null;
    /** Czy komórka jest podzielona */
    isSplit?: boolean | null;
    /** Czy komórka jest przerwą */
    isBreak?: boolean | null;
    /** Czy pacjent ma masaż */
    isMassage?: boolean | null;
    /** Czy pacjent ma PNF */
    isPnf?: boolean | null;
    /** Czy pacjent przychodzi co drugi dzień */
    isEveryOtherDay?: boolean | null;
    /** Flagi dla górnej części split */
    isMassage1?: boolean | null;
    isPnf1?: boolean | null;
    isEveryOtherDay1?: boolean | null;
    /** Flagi dla dolnej części split */
    isMassage2?: boolean | null;
    isPnf2?: boolean | null;
    isEveryOtherDay2?: boolean | null;
    /** Dane leczenia (dla normalnej komórki) */
    treatmentStartDate?: string | null;
    treatmentExtensionDays?: number | null;
    treatmentEndDate?: string | null;
    additionalInfo?: string | null;
    /** Dane leczenia dla części split */
    treatmentData1?: TreatmentData | null;
    treatmentData2?: TreatmentData | null;
    /** Historia zmian */
    history?: ScheduleHistoryEntry[];
    /** Pozwala na dynamiczny dostęp do właściwości */
    [key: string]: unknown;
}

/**
 * Mapa komórek harmonogramu
 * Klucz zewnętrzny: czas (np. "08:00")
 * Klucz wewnętrzny: indeks pracownika
 */
export type ScheduleCellsMap = Record<string, Record<string, CellState>>;

/**
 * Stan aplikacji harmonogramu
 */
export interface ScheduleAppState {
    scheduleCells: ScheduleCellsMap;
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
