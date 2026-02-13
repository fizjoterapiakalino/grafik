// scripts/schedule-ui.ts
import { AppConfig, capitalizeFirstLetter } from './common.js';
import { EmployeeManager } from './employee-manager.js';
import { auth as authRaw, db as dbRaw } from './firebase-config.js';
import { ScheduleLogic } from './schedule-logic.js';
import { toUTCDate } from './utils.js';
import type { FirebaseAuthWrapper, FirestoreDbWrapper } from './types/firebase';
import type { LeaveEntry } from './types/index.js';

const auth = authRaw as unknown as FirebaseAuthWrapper;
const db = dbRaw as unknown as FirestoreDbWrapper;

/**
 * Stan komórki
 */
interface CellData {
    content?: string;
    isSplit?: boolean;
    isBreak?: boolean;
    isMassage?: boolean;
    isPnf?: boolean;
    isEveryOtherDay?: boolean;
    isHydrotherapy?: boolean;
    [key: string]: unknown;
}

/**
 * Stan aplikacji
 */
interface AppState {
    scheduleCells: Record<string, Record<string, CellData>>;
}

/**
 * Interfejs publicznego API ScheduleUI
 */
interface ScheduleUIAPI {
    initialize(appState: AppState): void;
    render(): void;
    getElementText(element: HTMLElement | null): string;
    updatePatientCount(): void;
    destroy(): void;
}

/**
 * Moduł UI harmonogramu
 */
export const ScheduleUI: ScheduleUIAPI = (() => {
    let _appState: AppState | null = null;
    let _employeeTooltip: HTMLDivElement | null = null;
    let _currentTimeInterval: ReturnType<typeof setInterval> | null = null;
    let _leavesData: Record<string, LeaveEntry[]> = {};
    let _leavesLoaded = false;
    let _stationsUnsubscribe: (() => void) | null = null;
    let _stationOverlayInterval: ReturnType<typeof setInterval> | null = null;

    interface StationRealtimeState {
        status?: string;
        treatmentId?: string;
        startTime?: number;
        duration?: number;
        employeeId?: string;
    }

    interface EmployeeStationOverlayData {
        stationId: string;
        stationName: string;
        roomName: string;
        treatmentName: string;
        startTime: number;
        durationMinutes: number;
        endTime: number;
    }

    const THERAPY_MASSAGE_TREATMENT_ID = 'therapy_massage_20';
    const LEGACY_THERAPY_MASSAGE_IDS = new Set(['massage_treatment', 'therapy', 'gym_therapy', 'gym_massage']);

    const STATION_META: Record<string, { room: string; station: string }> = {
        hydro_1: { room: 'Hydroterapia', station: 'Wanna duza' },
        hydro_2: { room: 'Hydroterapia', station: 'Wanna mala' },
        hydro_3: { room: 'Hydroterapia', station: 'Wirowka' },
        magnet_1: { room: 'Pole magnetyczne', station: 'Aparat maly' },
        magnet_2: { room: 'Pole magnetyczne', station: 'Aparat duzy' },
        aquavibron_1: { room: 'Aquavibron', station: 'Aquavibron' },
        sala21_1: { room: 'Sala 21', station: 'Lezanka 1' },
        sala21_2: { room: 'Sala 21', station: 'Lezanka 2' },
        physio1_1: { room: 'Fizyko 18', station: 'Lezanka 1' },
        physio1_2: { room: 'Fizyko 18', station: 'Lezanka 2' },
        physio1_3: { room: 'Fizyko 18', station: 'Krzeslo' },
        physio2_1: { room: 'Fizyko 22', station: 'Lezanka 1' },
        physio2_2: { room: 'Fizyko 22', station: 'Lezanka 2' },
        physio2_3: { room: 'Fizyko 22', station: 'Krzeslo' },
        gym_1: { room: 'Sala Gimnastyczna', station: 'Lezanka 1' },
        gym_2: { room: 'Sala Gimnastyczna', station: 'Lezanka 2' },
        gym_3: { room: 'Sala Gimnastyczna', station: 'Lezanka 3' },
        gym_4: { room: 'Sala Gimnastyczna', station: 'Lezanka 4' },
        gym_5: { room: 'Sala Gimnastyczna', station: 'Lezanka 5' },
    };

    const TREATMENT_LABELS: Record<string, string> = {
        [THERAPY_MASSAGE_TREATMENT_ID]: 'Ter./Mas.',
        prady: 'Prady',
        prady_sala21: 'Prady',
        ultrasound: 'UD',
        laser: 'Laser',
        sollux: 'Sollux',
        gym_odciazenie: 'Odciazenie',
    };

    let _employeeStationOverlays: Record<string, EmployeeStationOverlayData> = {};

    const _createEmployeeTooltip = (): void => {
        const existing = document.getElementById('globalEmployeeTooltip') as HTMLDivElement | null;
        if (existing) {
            _employeeTooltip = existing;
            return;
        }

        _employeeTooltip = document.createElement('div');
        _employeeTooltip.id = 'globalEmployeeTooltip';
        _employeeTooltip.classList.add('employee-tooltip');
        document.body.appendChild(_employeeTooltip);
    };

    const _showEmployeeTooltip = (event: Event): void => {
        if (!_employeeTooltip) return;
        const th = event.currentTarget as HTMLTableCellElement;
        const fullName = th.dataset.fullName || '';
        const employeeNumber = th.dataset.employeeNumber || '';
        const workloadFilled = th.dataset.workloadFilled || '0';
        const workloadTotal = th.dataset.workloadTotal || '0';
        const workloadPercentage = th.dataset.workloadPercentage || '0';

        _employeeTooltip.innerHTML = '';

        // Imię i nazwisko (numer)
        const nameP = document.createElement('p');
        nameP.className = 'tooltip-name';
        nameP.textContent = employeeNumber ? `${fullName} (${employeeNumber})` : fullName;
        _employeeTooltip.appendChild(nameP);

        // Obciążenie pracownika
        const workloadP = document.createElement('p');
        workloadP.className = 'tooltip-workload';

        const workloadLabel = document.createElement('span');
        workloadLabel.textContent = 'Obciążenie: ';
        workloadP.appendChild(workloadLabel);

        const workloadValue = document.createElement('strong');
        workloadValue.textContent = `${workloadFilled}/${workloadTotal} (${workloadPercentage}%)`;

        // Koloruj procent w zależności od obciążenia
        const pct = parseInt(workloadPercentage);
        if (pct > 100) {
            workloadValue.style.color = '#8b5cf6'; // fioletowy - ponad normę
        } else if (pct >= 80) {
            workloadValue.style.color = '#ef4444'; // czerwony
        } else if (pct >= 50) {
            workloadValue.style.color = '#f59e0b'; // pomarańczowy
        } else {
            workloadValue.style.color = '#10b981'; // zielony
        }

        workloadP.appendChild(workloadValue);
        _employeeTooltip.appendChild(workloadP);

        const rect = th.getBoundingClientRect();
        _employeeTooltip.style.left = `${rect.left + rect.width / 2}px`;
        _employeeTooltip.style.top = `${rect.top - _employeeTooltip.offsetHeight - 10}px`;
        _employeeTooltip.style.transform = 'translateX(-50%)';
        _employeeTooltip.style.display = 'block';
    };

    const _hideEmployeeTooltip = (): void => {
        if (_employeeTooltip) {
            _employeeTooltip.style.display = 'none';
        }
    };

    const _normalizeTreatmentId = (treatmentId?: string): string | undefined => {
        if (!treatmentId) return treatmentId;
        return LEGACY_THERAPY_MASSAGE_IDS.has(treatmentId) ? THERAPY_MASSAGE_TREATMENT_ID : treatmentId;
    };

    const _formatCountdown = (seconds: number): string => {
        const safeSeconds = Math.max(0, Math.ceil(seconds));
        const minutes = Math.floor(safeSeconds / 60);
        const secs = safeSeconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const _resolveStationMeta = (stationId: string): { room: string; station: string } => {
        const known = STATION_META[stationId];
        if (known) return known;
        return {
            room: 'Stanowisko',
            station: stationId.replace(/_/g, ' '),
        };
    };

    const _resolveTreatmentName = (state: StationRealtimeState, stationId: string): string => {
        const normalized = _normalizeTreatmentId(state.treatmentId);
        if (normalized && TREATMENT_LABELS[normalized]) {
            return TREATMENT_LABELS[normalized];
        }
        if (!normalized || normalized === stationId) {
            return 'Standard';
        }
        return normalized.replace(/_/g, ' ');
    };

    const _refreshStationOverlayTimers = (): void => {
        document.querySelectorAll<HTMLElement>('.employee-station-overlay-timer[data-end-time]').forEach((timerEl) => {
            const endTimeRaw = timerEl.dataset.endTime;
            if (!endTimeRaw) return;
            const endTime = Number(endTimeRaw);
            if (Number.isNaN(endTime)) return;
            const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
            timerEl.textContent = _formatCountdown(remaining);
            timerEl.classList.toggle('is-finished', remaining <= 0);
            timerEl.classList.toggle('is-warning', remaining > 0 && remaining <= 120);
        });
    };

    const _clearOverlayColumnWidths = (): void => {
        document.querySelectorAll<HTMLTableCellElement>('th.employee-header[data-overlay-expanded="true"]').forEach((th) => {
            delete th.dataset.overlayExpanded;
            th.style.minWidth = '';
        });

        document.querySelectorAll<HTMLTableCellElement>('#mainScheduleTable tbody td[data-overlay-expanded="true"]').forEach((td) => {
            delete td.dataset.overlayExpanded;
            td.style.minWidth = '';
        });
    };

    const _clearOverlayColumnLocks = (): void => {
        document.querySelectorAll<HTMLTableCellElement>('th.employee-header.station-column-locked').forEach((th) => {
            th.classList.remove('station-column-locked');
        });

        document.querySelectorAll<HTMLTableCellElement>('#mainScheduleTable tbody td.station-column-locked').forEach((td) => {
            td.classList.remove('station-column-locked');
            td.removeAttribute('aria-disabled');

            if (td.dataset.overlayPrevTabindex !== undefined) {
                const prevTabIndex = td.dataset.overlayPrevTabindex;
                if (prevTabIndex === '') {
                    td.removeAttribute('tabindex');
                } else {
                    td.setAttribute('tabindex', prevTabIndex);
                }
                delete td.dataset.overlayPrevTabindex;
            }
        });
    };

    const _lockColumnForActiveStation = (employeeId: string): void => {
        const headerCell = document.querySelector<HTMLTableCellElement>(`#tableHeaderRow th.employee-header[data-employee-index="${employeeId}"]`);
        if (headerCell) {
            headerCell.classList.add('station-column-locked');
        }

        document.querySelectorAll<HTMLTableCellElement>(`#mainScheduleTable tbody td[data-employee-index="${employeeId}"]`).forEach((td) => {
            td.classList.add('station-column-locked');
            td.setAttribute('aria-disabled', 'true');
            if (td.dataset.overlayPrevTabindex === undefined) {
                td.dataset.overlayPrevTabindex = td.getAttribute('tabindex') ?? '';
            }
            td.setAttribute('tabindex', '-1');
        });
    };

    const _expandColumnToFitOverlay = (employeeId: string, headerCell: HTMLTableCellElement, overlayEl: HTMLElement): void => {
        const card = overlayEl.querySelector<HTMLElement>('.employee-station-overlay-card');
        if (!card) return;

        const currentWidth = Math.ceil(headerCell.getBoundingClientRect().width);
        const neededWidth = Math.ceil(card.scrollWidth + 12);
        if (neededWidth <= currentWidth) return;

        const widthPx = `${neededWidth}px`;
        headerCell.style.minWidth = widthPx;
        headerCell.dataset.overlayExpanded = 'true';

        document.querySelectorAll<HTMLTableCellElement>(`#mainScheduleTable tbody td[data-employee-index="${employeeId}"]`).forEach((td) => {
            td.style.minWidth = widthPx;
            td.dataset.overlayExpanded = 'true';
        });
    };

    const _renderEmployeeStationOverlays = (): void => {
        const headerRow = document.getElementById('tableHeaderRow') as HTMLTableRowElement | null;
        if (!headerRow) return;

        headerRow.querySelectorAll('.employee-station-overlay').forEach((el) => el.remove());
        _clearOverlayColumnWidths();
        _clearOverlayColumnLocks();

        if (window.innerWidth <= 768) return;

        Object.entries(_employeeStationOverlays).forEach(([employeeId, overlay]) => {
            const headerCell = headerRow.querySelector<HTMLTableCellElement>(`th.employee-header[data-employee-index="${employeeId}"]`);
            if (!headerCell) return;

            const overlayEl = document.createElement('div');
            overlayEl.className = 'employee-station-overlay';
            overlayEl.innerHTML = `
                <div class="employee-station-overlay-card">
                    <div class="employee-station-overlay-room">${overlay.roomName}</div>
                    <div class="employee-station-overlay-station">${overlay.stationName}</div>
                    <div class="employee-station-overlay-treatment">${overlay.treatmentName}</div>
                    <div class="employee-station-overlay-timer" data-end-time="${overlay.endTime}">${_formatCountdown(Math.ceil((overlay.endTime - Date.now()) / 1000))}</div>
                </div>
            `;

            headerCell.appendChild(overlayEl);
            _expandColumnToFitOverlay(employeeId, headerCell, overlayEl);
            _lockColumnForActiveStation(employeeId);
        });

        _refreshStationOverlayTimers();
    };

    const _updateEmployeeStationOverlays = (rawData: Record<string, unknown>): void => {
        const nextOverlays: Record<string, EmployeeStationOverlayData> = {};

        for (const [stationId, rawState] of Object.entries(rawData)) {
            if (stationId === '_lastUpdated') continue;
            if (!rawState || typeof rawState !== 'object') continue;

            const state = rawState as StationRealtimeState;
            if (state.status !== 'OCCUPIED' || !state.employeeId || !state.startTime || !state.duration) continue;

            const meta = _resolveStationMeta(stationId);
            const endTime = state.startTime + state.duration * 60 * 1000;
            const candidate: EmployeeStationOverlayData = {
                stationId,
                stationName: meta.station,
                roomName: meta.room,
                treatmentName: _resolveTreatmentName(state, stationId),
                startTime: state.startTime,
                durationMinutes: state.duration,
                endTime,
            };

            const existing = nextOverlays[state.employeeId];
            if (!existing || candidate.startTime > existing.startTime) {
                nextOverlays[state.employeeId] = candidate;
            }
        }

        _employeeStationOverlays = nextOverlays;
        _renderEmployeeStationOverlays();
    };

    const _subscribeToStationState = (): void => {
        _stationsUnsubscribe?.();
        _stationsUnsubscribe = null;

        const stationDocRef = db.collection('stations').doc('state');
        _stationsUnsubscribe = stationDocRef.onSnapshot(
            (snapshot) => {
                const data = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : {};
                _updateEmployeeStationOverlays(data || {});
            },
            (error) => {
                console.error('Blad subskrypcji stanowisk w schedule:', error);
            }
        );
    };

    /**
     * Pobiera dane o urlopach z Firebase
     */
    const _loadLeavesData = async (): Promise<void> => {
        if (_leavesLoaded) return;
        try {
            const docRef = db.collection(AppConfig.firestore.collections.leaves).doc(AppConfig.firestore.docs.mainLeaves);
            const docSnap = await docRef.get();
            _leavesData = docSnap.exists ? (docSnap.data() as Record<string, LeaveEntry[]>) || {} : {};
            _leavesLoaded = true;
        } catch (error) {
            console.error('Błąd podczas ładowania danych o urlopach:', error);
            _leavesData = {};
        }
    };

    /**
     * Sprawdza czy pracownik ma urlop w dzisiejszym dniu
     * @param employeeDisplayName - wyświetlana nazwa pracownika (klucz w danych urlopowych)
     * @returns true jeśli pracownik ma urlop dzisiaj
     */
    const _isEmployeeOnLeaveToday = (employeeDisplayName: string): boolean => {
        const leaves = _leavesData[employeeDisplayName] || [];
        if (leaves.length === 0) return false;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const leave of leaves) {
            if (!leave.startDate || !leave.endDate) continue;

            const start = toUTCDate(leave.startDate);
            const end = toUTCDate(leave.endDate);

            // Sprawdź czy dzisiaj jest w zakresie urlopu
            const startTime = start.getTime();
            const endTime = end.getTime();

            // Używamy UTC do porównania, więc dopasujmy dzisiejszą datę
            const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
            const todayUTCTime = todayUTC.getTime();

            if (todayUTCTime >= startTime && todayUTCTime <= endTime) {
                return true;
            }
        }
        return false;
    };

    /**
     * Dane z harmonogramu zmian (Changes)
     */
    interface ChangesCellState {
        assignedEmployees?: string[];
    }
    type ChangesData = Record<string, Record<number, ChangesCellState>>;
    let _changesData: ChangesData = {};
    let _changesLoaded = false;

    /**
     * Pobiera dane z harmonogramu zmian (Changes) z Firebase
     */
    const _loadChangesData = async (): Promise<void> => {
        if (_changesLoaded) return;
        try {
            const currentYear = new Date().getFullYear();
            const docRef = db.collection(AppConfig.firestore.collections.schedules).doc(`changesSchedule_${currentYear}`);
            const docSnap = await docRef.get();
            const data = docSnap.exists ? (docSnap.data() as { changesCells?: ChangesData }) : null;
            _changesData = data?.changesCells || {};
            _changesLoaded = true;
        } catch (error) {
            console.error('Błąd podczas ładowania danych z harmonogramu zmian:', error);
            _changesData = {};
        }
    };

    /**
     * Określa zmianę pracownika na podstawie przypisania do kolumn w Changes
     * Kolumny 1-4 = pierwsza zmiana (7:00-14:30)
     * Kolumny 5-7 = druga zmiana (10:30-17:00)
     * @param employeeId - ID pracownika
     * @returns 'first' | 'second' | null
     */
    const _getEmployeeShiftFromChanges = (employeeId: string): ShiftType => {
        // Znajdź bieżący okres (dwutygodniowy) na podstawie dzisiejszej daty
        const today = new Date();

        // Szukaj okresu, który zawiera dzisiejszą datę
        let currentPeriod: string | null = null;
        for (const periodKey of Object.keys(_changesData)) {
            // periodKey to data startu okresu (YYYY-MM-DD)
            const periodStart = new Date(periodKey);
            const periodEnd = new Date(periodStart);
            periodEnd.setDate(periodEnd.getDate() + 13); // 2 tygodnie

            if (today >= periodStart && today <= periodEnd) {
                currentPeriod = periodKey;
                break;
            }
        }

        if (!currentPeriod) return null;

        const periodData = _changesData[currentPeriod];
        if (!periodData) return null;

        // Sprawdź w których kolumnach jest przypisany pracownik
        // Kolumny 1-4 = pierwsza zmiana, Kolumny 5-7 = druga zmiana
        let inMorningShift = false;
        let inAfternoonShift = false;

        for (const colIdxStr of Object.keys(periodData)) {
            const colIdx = Number(colIdxStr);
            const cellState = periodData[colIdx];
            const assignedEmployees = cellState?.assignedEmployees || [];

            if (assignedEmployees.includes(employeeId)) {
                if (colIdx >= 1 && colIdx <= 4) {
                    inMorningShift = true;
                } else if (colIdx >= 5 && colIdx <= 7) {
                    inAfternoonShift = true;
                }
            }
        }

        // Jeśli pracownik jest w obu zmianach lub w żadnej - zwróć null (pełny zakres)
        if (inMorningShift && inAfternoonShift) return null;
        if (inMorningShift) return 'first';
        if (inAfternoonShift) return 'second';

        return null;
    };

    /**
     * Oblicza obciążenie pracownika (ile slotów jest zajętych)
     * @param employeeIndex - indeks pracownika
     * @param shiftType - grupa zmianowa ('first' = 7:00-14:30, 'second' = 10:30-17:00, null = pełny zakres)
     */
    interface WorkloadData {
        filled: number;
        total: number;
        percentage: number;
    }

    type ShiftType = 'first' | 'second' | null | undefined;

    const _calculateEmployeeWorkload = (employeeIndex: string, shiftType?: ShiftType): WorkloadData => {
        if (!_appState) return { filled: 0, total: 0, percentage: 0 };

        let filled = 0;
        let total = 0;

        // Określ zakres godzin na podstawie zmiany
        let rangeStartHour = AppConfig.schedule.startHour; // domyślnie 7
        let rangeStartMinute = 0;
        let rangeEndHour = AppConfig.schedule.endHour;     // domyślnie 17
        let rangeEndMinute = 0;

        if (shiftType === 'first') {
            // Poranna zmiana: 7:00-14:30
            rangeStartHour = 7;
            rangeStartMinute = 0;
            rangeEndHour = 14;
            rangeEndMinute = 30;
        } else if (shiftType === 'second') {
            // Popołudniowa zmiana: 10:30-17:00
            rangeStartHour = 10;
            rangeStartMinute = 30;
            rangeEndHour = 17;
            rangeEndMinute = 0;
        }

        // Iteruj po slotach w odpowiednim zakresie
        for (let hour = rangeStartHour; hour <= rangeEndHour; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                // Pomiń sloty przed rangeStartMinute na pierwszej godzinie
                if (hour === rangeStartHour && minute < rangeStartMinute) continue;
                // Pomiń sloty po rangeEndMinute na ostatniej godzinie
                if (hour === rangeEndHour && minute >= rangeEndMinute && rangeEndMinute !== 0) continue;
                if (hour === rangeEndHour && minute === 30 && rangeEndMinute === 0) continue;

                total++;
                const timeString = `${hour}:${minute.toString().padStart(2, '0')}`;
                const cellData = _appState.scheduleCells[timeString]?.[employeeIndex];

                if (cellData) {
                    if (cellData.isBreak) {
                        // Przerwa liczy się jako pełny slot
                        filled++;
                    } else if (cellData.isSplit) {
                        // Podzielona komórka - każda zajęta część = 1 (umożliwia przekroczenie 100%)
                        const part1Filled = cellData.content1 && String(cellData.content1).trim() !== '';
                        const part2Filled = cellData.content2 && String(cellData.content2).trim() !== '';
                        if (part1Filled) filled++;
                        if (part2Filled) filled++;
                    } else if (cellData.content && cellData.content.trim() !== '') {
                        // Normalna komórka z treścią
                        filled++;
                    }
                }
            }
        }

        const percentage = total > 0 ? Math.round((filled / total) * 100) : 0;
        return { filled, total, percentage };
    };

    const initialize = (appState: AppState): void => {
        _appState = appState;
        _createEmployeeTooltip();
        _subscribeToStationState();

        if (_stationOverlayInterval) {
            clearInterval(_stationOverlayInterval);
        }
        _stationOverlayInterval = setInterval(() => {
            _refreshStationOverlayTimers();
        }, 1000);

        // Załaduj dane o urlopach i harmonogramie zmian w tle
        Promise.all([_loadLeavesData(), _loadChangesData()]).then(() => {
            // Po załadowaniu danych, odśwież tabelę żeby wyświetlić badge'y i workload
            renderTable();
        });

        let lastWidth = window.innerWidth;

        window.addEventListener('resize', () => {
            if (window.innerWidth !== lastWidth) {
                lastWidth = window.innerWidth;
                renderTable();
            }
        });
    };

    const getElementText = (element: HTMLElement | null): string => {
        if (!element || element.classList.contains('break-cell') || element.classList.contains('empty-slot')) return '';
        const clone = element.cloneNode(true) as HTMLElement;
        const icons = clone.querySelectorAll('.cell-icon');
        icons.forEach((icon) => icon.remove());
        const spans = clone.querySelectorAll('span');
        let text = '';
        if (spans.length > 0) {
            spans.forEach((span) => {
                text += span.textContent + ' ';
            });
        } else {
            text = clone.textContent || '';
        }
        return text.trim();
    };

    const applyCellDataToDom = (cell: HTMLTableCellElement, cellObj: CellData): void => {
        cell.className = 'editable-cell';
        cell.innerHTML = '';

        delete cell.dataset.isMassage;
        delete cell.dataset.isPnf;
        delete cell.dataset.isEveryOtherDay;
        delete cell.dataset.isHydrotherapy;

        if (cell.tagName === 'TH') {
            cell.textContent = cellObj.content || '';
            return;
        }

        const displayData = ScheduleLogic.getCellDisplayData(cellObj);

        if (displayData.classes.length > 0) {
            cell.classList.add(...displayData.classes);
        }

        if (displayData.styles.backgroundColor) {
            cell.style.backgroundColor = displayData.styles.backgroundColor;
        }

        if (displayData.isBreak) {
            cell.textContent = displayData.text;
        } else if (displayData.isSplit) {
            const wrapper = document.createElement('div');
            wrapper.className = 'split-cell-wrapper';

            displayData.parts.forEach((part, index) => {
                const div = document.createElement('div');
                div.setAttribute('tabindex', '0');
                div.setAttribute('draggable', 'true');
                div.setAttribute('data-split-part', String(index + 1)); // 1 = górna, 2 = dolna

                const span = document.createElement('span');
                span.textContent = part.text;
                div.appendChild(span);

                if (part.classes.length > 0) {
                    div.classList.add(...part.classes);
                }

                if (part.isMassage) div.dataset.isMassage = 'true';
                if (part.isPnf) div.dataset.isPnf = 'true';
                if (part.isEveryOtherDay) div.dataset.isEveryOtherDay = 'true';
                if (part.isHydrotherapy) div.dataset.isHydrotherapy = 'true';

                // Dodaj tooltip z datą końca zabiegu
                if (part.treatmentEndDate) {
                    const formattedDate = formatDatePolish(part.treatmentEndDate);
                    let tooltipText = '';
                    if (part.daysRemaining !== null && part.daysRemaining !== undefined) {
                        if (part.daysRemaining <= 0) {
                            tooltipText = `⚠️ Zabieg zakończony: ${formattedDate}`;
                        } else if (part.daysRemaining === 1) {
                            tooltipText = `Koniec zabiegu: ${formattedDate} (pozostał 1 dzień)`;
                        } else {
                            tooltipText = `Koniec zabiegu: ${formattedDate} (pozostało ${part.daysRemaining} dni)`;
                        }
                    } else {
                        tooltipText = `Koniec zabiegu: ${formattedDate}`;
                    }
                    div.title = tooltipText;
                }

                wrapper.appendChild(div);
            });
            cell.appendChild(wrapper);
        } else {
            const span = document.createElement('span');
            span.textContent = displayData.text;
            cell.appendChild(span);

            if (cellObj.isMassage) cell.dataset.isMassage = 'true';
            if (cellObj.isPnf) cell.dataset.isPnf = 'true';
            if (cellObj.isEveryOtherDay) cell.dataset.isEveryOtherDay = 'true';
            if (cellObj.isHydrotherapy) cell.dataset.isHydrotherapy = 'true';

            // Dodaj tooltip z datą końca zabiegu
            if (displayData.treatmentEndDate) {
                const formattedDate = formatDatePolish(displayData.treatmentEndDate);
                let tooltipText = '';
                if (displayData.daysRemaining !== null && displayData.daysRemaining !== undefined) {
                    if (displayData.daysRemaining <= 0) {
                        tooltipText = `⚠️ Zabieg zakończony: ${formattedDate}`;
                    } else if (displayData.daysRemaining === 1) {
                        tooltipText = `Koniec zabiegu: ${formattedDate} (pozostał 1 dzień)`;
                    } else {
                        tooltipText = `Koniec zabiegu: ${formattedDate} (pozostało ${displayData.daysRemaining} dni)`;
                    }
                } else {
                    tooltipText = `Koniec zabiegu: ${formattedDate}`;
                }
                cell.title = tooltipText;
            }
        }
    };

    /**
     * Formatuje datę ISO na format polski (dd.mm.yyyy)
     */
    const formatDatePolish = (isoDate: string): string => {
        const [year, month, day] = isoDate.split('-');
        return `${day}.${month}.${year}`;
    };

    const refreshAllRowHeights = (): void => {
        document.querySelectorAll<HTMLTableRowElement>('#mainScheduleTable tbody tr').forEach((row) => {
            row.style.height = 'auto';
        });
    };

    const renderMobileView = (employeeIndices: string[]): void => {
        let mobileContainer = document.querySelector('.mobile-schedule-container') as HTMLDivElement | null;
        if (!mobileContainer) {
            mobileContainer = document.createElement('div');
            mobileContainer.className = 'mobile-schedule-container';
            const table = document.getElementById('mainScheduleTable');
            if (table && table.parentNode) {
                table.parentNode.insertBefore(mobileContainer, table);
            }
        }
        mobileContainer.innerHTML = '';
        mobileContainer.style.display = 'flex';

        const table = document.getElementById('mainScheduleTable') as HTMLTableElement | null;
        if (table) table.style.display = 'none';

        if (employeeIndices.length === 0) {
            mobileContainer.textContent = 'Brak danych pracownika do wyświetlenia.';
            return;
        }

        if (!_appState) return;

        // Get selected employee index from container's data attribute, or default to first
        let selectedEmployeeIndex = mobileContainer.dataset.selectedEmployee || employeeIndices[0];

        // Validate that selected employee is still in the list
        if (!employeeIndices.includes(selectedEmployeeIndex)) {
            selectedEmployeeIndex = employeeIndices[0];
        }

        // Add employee selector if multiple employees
        if (employeeIndices.length > 1) {
            const selectorWrapper = document.createElement('div');
            selectorWrapper.className = 'mobile-employee-selector';

            const label = document.createElement('label');
            label.textContent = 'Wybierz pracownika: ';
            label.htmlFor = 'mobileEmployeeSelect';
            selectorWrapper.appendChild(label);

            const select = document.createElement('select');
            select.id = 'mobileEmployeeSelect';
            select.className = 'employee-select';

            employeeIndices.forEach((empId) => {
                const option = document.createElement('option');
                option.value = empId;
                const empData = EmployeeManager.getById(empId);
                option.textContent = capitalizeFirstLetter(empData?.displayName || `Pracownik ${parseInt(empId) + 1}`);
                if (empId === selectedEmployeeIndex) {
                    option.selected = true;
                }
                select.appendChild(option);
            });

            select.addEventListener('change', (e) => {
                const newEmployeeId = (e.target as HTMLSelectElement).value;
                mobileContainer!.dataset.selectedEmployee = newEmployeeId;
                renderMobileView(employeeIndices);
            });

            selectorWrapper.appendChild(select);
            mobileContainer.appendChild(selectorWrapper);
        }

        const employeeData = EmployeeManager.getById(selectedEmployeeIndex);
        const header = document.createElement('h3');
        header.textContent = `Grafik: ${capitalizeFirstLetter(employeeData?.displayName || 'Pracownik')}`;
        header.style.textAlign = 'center';
        header.style.color = 'var(--color-primary-700)';
        mobileContainer.appendChild(header);

        for (let hour = AppConfig.schedule.startHour; hour <= AppConfig.schedule.endHour; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                if (hour === AppConfig.schedule.endHour && minute === 30) continue;

                const timeString = `${hour}:${minute.toString().padStart(2, '0')}`;
                const cellData = _appState.scheduleCells[timeString]?.[selectedEmployeeIndex] || {};
                const displayData = ScheduleLogic.getCellDisplayData(cellData);

                const card = document.createElement('div');
                card.className = 'appointment-card';
                card.setAttribute('data-time', timeString);

                const cardHeader = document.createElement('div');
                cardHeader.className = 'card-header';
                cardHeader.textContent = timeString;

                // Add click handler for accordion toggle
                cardHeader.addEventListener('click', (e) => {
                    e.stopPropagation();
                    card.classList.toggle('expanded');
                });

                card.appendChild(cardHeader);

                const cardBody = document.createElement('div');
                cardBody.className = 'card-body editable-cell';
                cardBody.setAttribute('data-time', timeString);
                cardBody.setAttribute('data-employee-index', selectedEmployeeIndex);
                cardBody.setAttribute('tabindex', '0');

                if (displayData.text) {
                    cardBody.textContent = displayData.text;
                    if (displayData.classes.length > 0) cardBody.classList.add(...displayData.classes);
                    if (displayData.styles.backgroundColor)
                        cardBody.style.backgroundColor = displayData.styles.backgroundColor;
                } else if (displayData.isSplit) {
                    const part1 = displayData.parts[0];
                    const part2 = displayData.parts[1];
                    cardBody.innerHTML = `<div>${part1.text}</div><div style="border-top:1px solid #ccc; margin-top:4px; padding-top:4px;">${part2.text}</div>`;
                } else {
                    cardBody.textContent = 'Wolny termin';
                    cardBody.classList.add('empty-slot');
                }

                card.appendChild(cardBody);
                mobileContainer.appendChild(card);
            }
        }

        // Auto-expand all cards from current time onwards
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes() < 30 ? 0 : 30;
        const currentTimeString = `${currentHour}:${currentMinute.toString().padStart(2, '0')}`;

        let foundCurrent = false;
        const allCards = mobileContainer.querySelectorAll('.appointment-card');
        allCards.forEach((card) => {
            const cardTime = card.getAttribute('data-time');
            if (cardTime === currentTimeString) {
                foundCurrent = true;
                card.classList.add('current-time');
            }
            // Expand all cards from current time onwards
            if (foundCurrent) {
                card.classList.add('expanded');
            }
        });

        // Scroll to current time card
        const currentCard = mobileContainer.querySelector('.current-time') as HTMLElement;
        if (currentCard) {
            setTimeout(() => {
                currentCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    };

    const renderTable = (): void => {
        const mainTable = document.getElementById('mainScheduleTable') as HTMLTableElement | null;
        if (!mainTable || !_appState) return;

        const isMobile = window.innerWidth <= 768;

        let employeeIndices: string[] = [];
        let isSingleUserView = false;

        const currentUser = auth.currentUser;
        if (currentUser) {
            if (EmployeeManager.isUserAdmin(currentUser.uid)) {
                const allEmployees = EmployeeManager.getAll();
                employeeIndices = Object.keys(allEmployees)
                    .filter((id) => !allEmployees[id].isHidden)
                    .sort((a, b) => parseInt(a) - parseInt(b));
                isSingleUserView = false;
            } else {
                const employee = EmployeeManager.getEmployeeByUid(currentUser.uid);
                if (employee) {
                    employeeIndices.push(employee.id);
                    isSingleUserView = true;
                }
            }
        } else {
            const allEmployees = EmployeeManager.getAll();
            employeeIndices = Object.keys(allEmployees)
                .filter((id) => !allEmployees[id].isHidden)
                .sort((a, b) => parseInt(a) - parseInt(b));
            isSingleUserView = false;
        }

        if (isMobile) {
            renderMobileView(employeeIndices);
            return;
        }

        const mobileContainer = document.querySelector('.mobile-schedule-container') as HTMLElement | null;
        if (mobileContainer) mobileContainer.style.display = 'none';
        mainTable.style.display = 'table';

        const tableHeaderRow = document.getElementById('tableHeaderRow') as HTMLTableRowElement | null;
        const tbody = mainTable.querySelector('tbody');

        if (!tableHeaderRow || !tbody) {
            console.error('Table header row or tbody not found, cannot render schedule.');
            return;
        }

        tableHeaderRow.innerHTML = '';
        const thTime = document.createElement('th');
        thTime.textContent = 'Godz.';
        tableHeaderRow.appendChild(thTime);

        tbody.innerHTML = '';

        mainTable.classList.toggle('single-user-view', isSingleUserView);

        for (const i of employeeIndices) {
            const th = document.createElement('th');
            const employeeData = EmployeeManager.getById(i);
            const displayName = employeeData?.displayName || employeeData?.name || `Pracownik ${parseInt(i) + 1}`;
            const fullName = EmployeeManager.getFullNameById(i);
            const employeeNumber = (employeeData as { employeeNumber?: string })?.employeeNumber || '';

            th.setAttribute('data-employee-index', i);
            th.setAttribute('tabindex', '0');
            th.classList.add('employee-header');

            const span = document.createElement('span');
            span.textContent = capitalizeFirstLetter(displayName);

            // Sprawdź czy pracownik ma urlop dzisiaj i dodaj odpowiednią klasę
            const isOnLeave = _isEmployeeOnLeaveToday(displayName);
            if (isOnLeave) {
                span.classList.add('on-leave');
                th.classList.add('employee-on-leave');
            }

            th.appendChild(span);

            // Oblicz obciążenie pracownika (zajęte sloty / wszystkie sloty)
            // Określ zmianę na podstawie przypisania w harmonogramie zmian (Changes)
            // Kolumny 1-4 = ranna zmiana (7:00-14:30), Kolumny 5-7 = popołudniowa (10:30-17:00)
            const shiftFromChanges = _getEmployeeShiftFromChanges(i);
            const workloadData = _calculateEmployeeWorkload(i, shiftFromChanges);
            const workloadBar = document.createElement('div');
            workloadBar.className = 'workload-bar';

            const workloadFill = document.createElement('div');
            workloadFill.className = 'workload-fill';
            // Ogranicz szerokość do 100%, ale pozwól na wyświetlanie wartości > 100%
            workloadFill.style.width = `${Math.min(workloadData.percentage, 100)}%`;

            // Ustaw kolor w zależności od obciążenia
            if (workloadData.percentage > 100) {
                workloadFill.classList.add('overload'); // ponad normę
            } else if (workloadData.percentage >= 80) {
                workloadFill.classList.add('high');
            } else if (workloadData.percentage >= 50) {
                workloadFill.classList.add('medium');
            } else {
                workloadFill.classList.add('low');
            }

            workloadBar.appendChild(workloadFill);
            th.appendChild(workloadBar);

            th.dataset.fullName = fullName;
            th.dataset.employeeNumber = employeeNumber;
            // Zapisz dane workload do dataset dla tooltipa
            th.dataset.workloadFilled = String(workloadData.filled);
            th.dataset.workloadTotal = String(workloadData.total);
            th.dataset.workloadPercentage = String(workloadData.percentage);
            tableHeaderRow.appendChild(th);

            th.addEventListener('mouseover', _showEmployeeTooltip);
            th.addEventListener('mouseout', _hideEmployeeTooltip);
        }

        _renderEmployeeStationOverlays();

        for (let hour = AppConfig.schedule.startHour; hour <= AppConfig.schedule.endHour; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                if (hour === AppConfig.schedule.endHour && minute === 30) continue;
                const tr = tbody.insertRow();
                const timeString = `${hour}:${minute.toString().padStart(2, '0')}`;
                tr.insertCell().textContent = timeString;

                for (const i of employeeIndices) {
                    const cell = tr.insertCell();
                    const cellData = _appState!.scheduleCells[timeString]?.[i] || {};
                    applyCellDataToDom(cell, cellData);
                    cell.setAttribute('data-time', timeString);
                    cell.setAttribute('data-employee-index', i);
                    cell.setAttribute('draggable', 'true');
                    cell.setAttribute('tabindex', '0');
                }
            }
        }
        refreshAllRowHeights();

        if (_currentTimeInterval) {
            clearInterval(_currentTimeInterval);
        }

        _currentTimeInterval = setInterval(() => {
            const now = new Date();
            const hours = now.getHours();
            const minutes = now.getMinutes();
            const roundedMinutes = minutes < 30 ? '00' : '30';
            const currentTimeString = `${hours}:${roundedMinutes}`;

            document.querySelectorAll('#mainScheduleTable tbody tr.current-time-row').forEach((row) => {
                row.classList.remove('current-time-row');
            });

            const allTimeCells = document.querySelectorAll('#mainScheduleTable tbody td:first-child');
            for (const cell of allTimeCells) {
                if ((cell as HTMLTableCellElement).textContent?.trim() === currentTimeString) {
                    cell.parentElement?.classList.add('current-time-row');
                    break;
                }
            }
        }, 60000);

        updatePatientCount();
    };

    const updatePatientCount = (): void => {
        const patientCountElement = document.getElementById('patientCount');
        if (!patientCountElement || !_appState) return;

        const therapyCount = ScheduleLogic.calculatePatientCount(_appState.scheduleCells);
        patientCountElement.textContent = `Terapie: ${therapyCount}`;
    };

    const destroy = (): void => {
        if (_currentTimeInterval) {
            clearInterval(_currentTimeInterval);
            _currentTimeInterval = null;
        }
        if (_stationOverlayInterval) {
            clearInterval(_stationOverlayInterval);
            _stationOverlayInterval = null;
        }
        if (_stationsUnsubscribe) {
            _stationsUnsubscribe();
            _stationsUnsubscribe = null;
        }
        _employeeStationOverlays = {};
    };

    return {
        initialize,
        render: renderTable,
        getElementText,
        updatePatientCount,
        destroy,
    };
})();

// Backward compatibility
declare global {
    interface Window {
        ScheduleUI: ScheduleUIAPI;
    }
}

window.ScheduleUI = ScheduleUI;
