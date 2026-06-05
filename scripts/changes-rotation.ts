import { AppConfig, countWorkdays } from './common.js';
import { db as dbRaw } from './firebase-config.js';
import { EmployeeManager } from './employee-manager.js';
import { escapeHTML } from './utils.js';
import type { FirestoreDbWrapper } from './types/firebase';

const db = dbRaw as unknown as FirestoreDbWrapper;

type TeamId = 'first' | 'second';
type Horizon = 'half' | 'year';
type StationRole = 'hydro' | 'massage' | 'physio' | 'gym';

interface FixedAssignment {
    role: StationRole;
    alwaysMorning?: boolean;
}

interface LeaveEntry {
    startDate: string;
    endDate: string;
    type: string;
}

interface RotationStation {
    id: number;
    label: string;
    shortLabel: string;
    shift: 'morning' | 'afternoon';
    role: StationRole;
}

interface RotationPeriod {
    start: string;
    end: string;
}

interface RotationPlanRow {
    period: RotationPeriod;
    morningTeam: TeamId;
    afternoonTeam: TeamId;
    cells: Record<number, string[]>;
    substitutes?: Record<string, string>;
    overridden?: boolean;
    readOnly?: boolean;
    source?: 'draft' | 'published';
    sourceYear?: number;
}

interface RotationDraft {
    year: number;
    horizon: Horizon;
    firstMorningTeam: TeamId;
    fixedAssignments?: Record<string, FixedAssignment>;
    deletedPeriods?: Record<string, number>;
    rows: RotationPlanRow[];
}

interface ChangesCellState {
    assignedEmployees?: string[];
    substitutes?: Record<string, string>;
}

interface PublishedChangesState {
    changesCells: Record<string, Record<number, ChangesCellState>>;
}

interface ChangesRotationAPI {
    init(): Promise<void>;
    destroy(): void;
}

const STATIONS: RotationStation[] = [
    { id: 1, label: 'HYDRO 7:00-14:30', shortLabel: 'HYDRO rano', shift: 'morning', role: 'hydro' },
    { id: 2, label: 'MASAŻ 7:00-14:30', shortLabel: 'MASAŻ rano', shift: 'morning', role: 'massage' },
    { id: 3, label: 'FIZYKO 7:00-14:30', shortLabel: 'FIZYKO rano', shift: 'morning', role: 'physio' },
    { id: 4, label: 'SALA 7:00-14:30', shortLabel: 'SALA rano', shift: 'morning', role: 'gym' },
    { id: 5, label: 'MASAŻ 10:30-18:00', shortLabel: 'MASAŻ popoł.', shift: 'afternoon', role: 'massage' },
    { id: 6, label: 'FIZYKO 10:30-18:00', shortLabel: 'FIZYKO popoł.', shift: 'afternoon', role: 'physio' },
    { id: 7, label: 'SALA 10:30-18:00', shortLabel: 'SALA popoł.', shift: 'afternoon', role: 'gym' },
];

const STORAGE_KEY = 'changesRotationDraft';
const FIXED_ASSIGNMENTS_KEY = 'changesRotationFixedAssignments';
const MIN_LEAVE_WORKDAYS_FOR_SUBSTITUTE = 4;
const STATION_ROLE_LABELS: Record<StationRole, string> = {
    hydro: 'HYDRO',
    massage: 'MASAŻ',
    physio: 'FIZYKO',
    gym: 'SALA',
};

export const ChangesRotation: ChangesRotationAPI = (() => {
    let draft: RotationDraft | null = null;
    let publishedPreviewRows: RotationPlanRow[] = [];
    let leavesData: Record<string, LeaveEntry[]> = {};
    let editingRowIndex: number | null = null;

    const isWeekend = (date: Date): boolean => {
        const day = date.getUTCDay();
        return day === 0 || day === 6;
    };

    const formatDate = (date: Date): string => {
        const day = date.getUTCDate().toString().padStart(2, '0');
        const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
        return `${day}.${month}`;
    };

    const formatPeriod = (period: RotationPeriod): string => {
        return `${formatDate(new Date(period.start))} - ${formatDate(new Date(period.end))}`;
    };

    const getTodayUtc = (): Date => {
        const today = new Date();
        return new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    };

    const isPastPeriod = (period: RotationPeriod): boolean => {
        return new Date(`${period.end}T00:00:00Z`) < getTodayUtc();
    };

    const isRowReadOnly = (row: RotationPlanRow): boolean => Boolean(row.readOnly || isPastPeriod(row.period));

    const generateTwoWeekPeriods = (year: number): RotationPeriod[] => {
        const periods: RotationPeriod[] = [];
        let currentDate = new Date(Date.UTC(year, 0, 1));

        while (currentDate.getUTCDay() !== 1) {
            currentDate.setUTCDate(currentDate.getUTCDate() - 1);
        }

        while (currentDate.getUTCFullYear() <= year) {
            const startDate = new Date(currentDate);
            let endDate = new Date(startDate);
            let workDaysCount = 0;

            while (workDaysCount < 10) {
                if (!isWeekend(endDate)) {
                    workDaysCount++;
                }
                if (workDaysCount < 10) {
                    endDate.setUTCDate(endDate.getUTCDate() + 1);
                }
            }

            periods.push({
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0],
            });

            currentDate = new Date(endDate);
            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            while (isWeekend(currentDate)) {
                currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            }
        }

        return periods;
    };

    const getVisibleEmployeeIds = (): string[] => {
        const employees = EmployeeManager.getAll();
        return Object.keys(employees)
            .filter((id) => {
                const employee = employees[id];
                return !employee.isHidden && !employee.isScheduleOnly;
            })
            .sort((a, b) => EmployeeManager.compareEmployees(employees[a], employees[b]));
    };

    const getTeamIds = (team: TeamId): string[] => {
        const employees = EmployeeManager.getAll();
        return getVisibleEmployeeIds().filter((id) => employees[id]?.shiftGroup === team);
    };

    const normalizeFixedAssignments = (raw: unknown): Record<string, FixedAssignment> => {
        if (!raw || typeof raw !== 'object') return {};

        const normalized: Record<string, FixedAssignment> = {};
        Object.entries(raw as Record<string, unknown>).forEach(([employeeId, value]) => {
            if (typeof value === 'string' && value in STATION_ROLE_LABELS) {
                normalized[employeeId] = { role: value as StationRole };
                return;
            }

            if (!value || typeof value !== 'object') return;
            const item = value as Partial<FixedAssignment>;
            if (!item.role || !(item.role in STATION_ROLE_LABELS)) return;
            normalized[employeeId] = {
                role: item.role,
                alwaysMorning: Boolean(item.alwaysMorning),
            };
        });

        return normalized;
    };

    const loadFixedAssignments = (): Record<string, FixedAssignment> => {
        try {
            const stored = localStorage.getItem(FIXED_ASSIGNMENTS_KEY);
            return stored ? normalizeFixedAssignments(JSON.parse(stored)) : {};
        } catch {
            return {};
        }
    };

    const saveFixedAssignments = (assignments: Record<string, FixedAssignment>): void => {
        localStorage.setItem(FIXED_ASSIGNMENTS_KEY, JSON.stringify(assignments));
        if (draft) {
            draft.fixedAssignments = assignments;
            saveDraft();
        }
    };

    const seededScore = (value: string): number => {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    };

    const shuffleForPeriod = (ids: string[], periodIndex: number, shift: string): string[] => {
        return [...ids].sort((a, b) => {
            return seededScore(`${periodIndex}:${shift}:${a}`) - seededScore(`${periodIndex}:${shift}:${b}`);
        });
    };

    const assignTeamToStations = (
        teamIds: string[],
        stationIds: number[],
        periodIndex: number,
        fixedAssignments: Record<string, FixedAssignment>,
        shift: 'morning' | 'afternoon',
        reservedStationIds: Set<number> = new Set(),
    ): Record<number, string[]> => {
        const cells: Record<number, string[]> = {};
        stationIds.forEach((stationId) => {
            cells[stationId] = [];
        });

        const stations = stationIds
            .map((stationId) => STATIONS.find((station) => station.id === stationId))
            .filter((station): station is RotationStation => !!station);
        const gymStation = stations.find((station) => station.role === 'gym' && !reservedStationIds.has(station.id));
        const primaryStations = stations.filter((station) => station.role !== 'gym' && !reservedStationIds.has(station.id));
        const assigned = new Set<string>();

        teamIds.forEach((employeeId) => {
            const fixedAssignment = fixedAssignments[employeeId];
            if (!fixedAssignment || fixedAssignment.alwaysMorning) return;

            const targetStation = stations.find((station) => station.role === fixedAssignment.role);
            if (!targetStation) return;

            cells[targetStation.id].push(employeeId);
            assigned.add(employeeId);
        });

        const stationFillOrder = [...primaryStations, ...(gymStation ? [gymStation] : [])];
        const randomIds = shuffleForPeriod(
            teamIds.filter((employeeId) => !assigned.has(employeeId)),
            periodIndex,
            shift,
        );

        randomIds.forEach((employeeId) => {
            const stationWithNoPeople = stationFillOrder.find((station) => cells[station.id].length === 0);
            const stationId = stationWithNoPeople?.id || gymStation?.id || stationFillOrder[stationFillOrder.length - 1]?.id;
            if (!stationId) return;
            cells[stationId].push(employeeId);
        });

        return cells;
    };

    const getMorningStationForRole = (role: StationRole): RotationStation | null => {
        return STATIONS.find((station) => station.shift === 'morning' && station.role === role) || null;
    };

    const getAlwaysMorningEmployeeIds = (fixedAssignments: Record<string, FixedAssignment>): Set<string> => {
        return new Set(
            Object.entries(fixedAssignments)
                .filter(([, assignment]) => assignment.alwaysMorning)
                .map(([employeeId]) => employeeId),
        );
    };

    const getReservedMorningStationIds = (fixedAssignments: Record<string, FixedAssignment>): Set<number> => {
        return new Set(
            Object.values(fixedAssignments)
                .filter((assignment) => assignment.alwaysMorning)
                .map((assignment) => getMorningStationForRole(assignment.role)?.id)
                .filter((stationId): stationId is number => typeof stationId === 'number'),
        );
    };

    const applyAlwaysMorningAssignments = (
        cells: Record<number, string[]>,
        fixedAssignments: Record<string, FixedAssignment>,
    ): void => {
        Object.entries(fixedAssignments).forEach(([employeeId, assignment]) => {
            if (!assignment.alwaysMorning) return;
            const station = getMorningStationForRole(assignment.role);
            if (!station) return;

            Object.keys(cells).forEach((stationId) => {
                cells[Number(stationId)] = (cells[Number(stationId)] || []).filter((id) => id !== employeeId);
            });

            if (!cells[station.id]) cells[station.id] = [];
            cells[station.id].push(employeeId);
        });
    };

    const getOtherTeam = (team: TeamId): TeamId => team === 'first' ? 'second' : 'first';

    const inferMorningTeamFromCells = (periodCells: Record<number, ChangesCellState> | undefined): TeamId | null => {
        if (!periodCells) return null;

        const counts: Record<TeamId, number> = { first: 0, second: 0 };
        const employees = EmployeeManager.getAll();
        STATIONS
            .filter((station) => station.shift === 'morning')
            .forEach((station) => {
                (periodCells[station.id]?.assignedEmployees || []).forEach((employeeId) => {
                    const shiftGroup = employees[employeeId]?.shiftGroup;
                    if (shiftGroup === 'first' || shiftGroup === 'second') {
                        counts[shiftGroup]++;
                    }
                });
            });

        if (counts.first === 0 && counts.second === 0) return null;
        return counts.first >= counts.second ? 'first' : 'second';
    };

    const inferFirstMorningTeamFromPreviousYear = async (year: number): Promise<TeamId | null> => {
        try {
            const docRef = db.collection(AppConfig.firestore.collections.schedules).doc(`changesSchedule_${year - 1}`);
            const docSnap = await docRef.get();
            const state = docSnap.exists ? (docSnap.data() as PublishedChangesState | undefined) : undefined;
            const changesCells = state?.changesCells || {};
            const latestPeriodKey = Object.keys(changesCells)
                .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
            if (!latestPeriodKey) return null;

            const lastMorningTeam = inferMorningTeamFromCells(changesCells[latestPeriodKey]);
            return lastMorningTeam ? getOtherTeam(lastMorningTeam) : null;
        } catch (error) {
            console.error('Nie udało się ustalić zmiany z poprzedniego roku:', error);
            return null;
        }
    };

    const hasAnyAssignedEmployee = (periodCells: Record<number, ChangesCellState> | undefined): boolean => {
        if (!periodCells) return false;
        return Object.values(periodCells).some((cell) => (cell.assignedEmployees || []).length > 0);
    };

    const getPublishedChangesState = async (year: number): Promise<PublishedChangesState | null> => {
        const docRef = db.collection(AppConfig.firestore.collections.schedules).doc(`changesSchedule_${year}`);
        const docSnap = await docRef.get();
        return docSnap.exists ? (docSnap.data() as PublishedChangesState | undefined) || null : null;
    };

    const getPublishedPeriodForStart = (year: number, periodStart: string): RotationPeriod | null => {
        return [year, year - 1, year + 1]
            .flatMap((candidateYear) => generateTwoWeekPeriods(candidateYear))
            .find((period) => period.start === periodStart) || null;
    };

    const getPublishedEntriesForYear = async (
        year: number,
    ): Promise<Array<{ periodStart: string; periodCells: Record<number, ChangesCellState>; sourceYear: number }>> => {
        const currentState = await getPublishedChangesState(year);
        const previousState = await getPublishedChangesState(year - 1);
        const entries: Array<{ periodStart: string; periodCells: Record<number, ChangesCellState>; sourceYear: number }> = [];
        const usedPeriodStarts = new Set<string>();

        Object.entries(previousState?.changesCells || {}).forEach(([periodStart, periodCells]) => {
            const period = getPublishedPeriodForStart(year, periodStart);
            if (!period || !hasAnyAssignedEmployee(periodCells)) return;
            if (new Date(`${period.start}T00:00:00Z`).getUTCFullYear() >= year) return;
            if (new Date(`${period.end}T00:00:00Z`).getUTCFullYear() < year) return;
            entries.push({ periodStart, periodCells, sourceYear: year - 1 });
            usedPeriodStarts.add(periodStart);
        });

        Object.entries(currentState?.changesCells || {}).forEach(([periodStart, periodCells]) => {
            if (usedPeriodStarts.has(periodStart) || !hasAnyAssignedEmployee(periodCells)) return;
            entries.push({ periodStart, periodCells, sourceYear: year });
        });

        return entries;
    };

    const getLatestPublishedPeriodInfo = async (
        year: number,
    ): Promise<{ period: RotationPeriod; morningTeam: TeamId | null } | null> => {
        try {
            const entries = await getPublishedEntriesForYear(year);
            const latestEntry = entries
                .sort((a, b) => new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime())[0];
            if (!latestEntry) return null;

            const period = getPublishedPeriodForStart(year, latestEntry.periodStart);
            if (!period) return null;

            return {
                period,
                morningTeam: inferMorningTeamFromCells(latestEntry.periodCells),
            };
        } catch (error) {
            console.error('Nie udało się odczytać istniejącego harmonogramu zmian:', error);
            return null;
        }
    };

    const loadPublishedPreviewRows = async (year: number): Promise<RotationPlanRow[]> => {
        try {
            const entries = await getPublishedEntriesForYear(year);
            return entries
                .map(({ periodStart, periodCells, sourceYear }) => {
                    const period = getPublishedPeriodForStart(year, periodStart) || {
                        start: periodStart,
                        end: periodStart,
                    };
                    const cells: Record<number, string[]> = {};
                    const substitutes: Record<string, string> = {};
                    STATIONS.forEach((station) => {
                        const cell = periodCells[station.id] || {};
                        cells[station.id] = [...(cell.assignedEmployees || [])];
                        Object.assign(substitutes, cell.substitutes || {});
                    });
                    const morningTeam = inferMorningTeamFromCells(periodCells) || 'first';
                    return {
                        period,
                        morningTeam,
                        afternoonTeam: getOtherTeam(morningTeam),
                        cells,
                        substitutes: Object.keys(substitutes).length > 0 ? substitutes : undefined,
                        readOnly: isPastPeriod(period),
                        source: 'published' as const,
                        sourceYear,
                    };
                })
                .sort((a, b) => new Date(a.period.start).getTime() - new Date(b.period.start).getTime());
        } catch (error) {
            console.error('Nie udało się pobrać opublikowanego harmonogramu do podglądu:', error);
            return [];
        }
    };

    const getPeriodsForHorizon = (year: number, horizon: Horizon): RotationPeriod[] => {
        const periods = generateTwoWeekPeriods(year);
        if (horizon === 'year') return periods;

        const currentYear = new Date().getUTCFullYear();
        if (year !== currentYear) {
            const halfYearLimit = new Date(Date.UTC(year, 5, 30));
            return periods.filter((period) => new Date(period.start) <= halfYearLimit);
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const limit = new Date(today);
        limit.setMonth(limit.getMonth() + 6);

        return periods.filter((period) => {
            const periodEnd = new Date(period.end);
            return periodEnd >= today && periodEnd <= limit;
        });
    };

    const buildPlanRow = (
        period: RotationPeriod,
        index: number,
        firstMorningTeam: TeamId,
        fixedAssignments: Record<string, FixedAssignment>,
    ): RotationPlanRow => {
        const firstTeamIds = getTeamIds('first');
        const secondTeamIds = getTeamIds('second');
        const alwaysMorningIds = getAlwaysMorningEmployeeIds(fixedAssignments);
        const reservedMorningStationIds = getReservedMorningStationIds(fixedAssignments);
        const morningStationIds = STATIONS.filter((station) => station.shift === 'morning').map((station) => station.id);
        const afternoonStationIds = STATIONS.filter((station) => station.shift === 'afternoon').map((station) => station.id);
        const morningTeam = index % 2 === 0 ? firstMorningTeam : getOtherTeam(firstMorningTeam);
        const afternoonTeam = getOtherTeam(morningTeam);
        const morningIds = (morningTeam === 'first' ? firstTeamIds : secondTeamIds).filter((id) => !alwaysMorningIds.has(id));
        const afternoonIds = (afternoonTeam === 'first' ? firstTeamIds : secondTeamIds).filter((id) => !alwaysMorningIds.has(id));
        const cells = {
            ...assignTeamToStations(morningIds, morningStationIds, index, fixedAssignments, 'morning', reservedMorningStationIds),
            ...assignTeamToStations(afternoonIds, afternoonStationIds, index, fixedAssignments, 'afternoon'),
        };
        applyAlwaysMorningAssignments(cells, fixedAssignments);

        return {
            period,
            morningTeam,
            afternoonTeam,
            cells,
            source: 'draft' as const,
        };
    };

    const buildPlanRowForPeriod = (period: RotationPeriod): RotationPlanRow => {
        const sortedRows = [...(draft?.rows || [])].sort((a, b) => new Date(a.period.start).getTime() - new Date(b.period.start).getTime());
        const previousRow = [...sortedRows]
            .reverse()
            .find((row) => new Date(row.period.start) < new Date(period.start));
        const nextRow = sortedRows.find((row) => new Date(row.period.start) > new Date(period.start));
        const morningTeam = previousRow
            ? getOtherTeam(previousRow.morningTeam)
            : nextRow
                ? getOtherTeam(nextRow.morningTeam)
                : draft?.firstMorningTeam || getSelectedFirstMorningTeam();
        const row = buildPlanRow(period, 0, morningTeam, loadFixedAssignments());
        row.sourceYear = getSelectedYear();
        return row;
    };

    const buildDraft = async (year: number, horizon: Horizon, selectedFirstMorningTeam: TeamId): Promise<RotationDraft> => {
        let periods = getPeriodsForHorizon(year, horizon);
        const fixedAssignments = loadFixedAssignments();
        const latestPublishedPeriod = await getLatestPublishedPeriodInfo(year);
        let firstMorningTeam = selectedFirstMorningTeam;

        if (latestPublishedPeriod) {
            periods = periods.filter((period) => new Date(period.start) > new Date(latestPublishedPeriod.period.start));
            if (latestPublishedPeriod.morningTeam) {
                firstMorningTeam = getOtherTeam(latestPublishedPeriod.morningTeam);
            }
        } else {
            const previousYearFirstMorningTeam = await inferFirstMorningTeamFromPreviousYear(year);
            if (previousYearFirstMorningTeam) {
                firstMorningTeam = previousYearFirstMorningTeam;
            }
        }

        const rows = periods.map((period, index) => ({
            ...buildPlanRow(period, index, firstMorningTeam, fixedAssignments),
            sourceYear: year,
        }));

        return { year, horizon, firstMorningTeam, fixedAssignments, rows };
    };

    const getNextPeriod = (period: RotationPeriod): RotationPeriod => {
        const startDate = new Date(period.end);
        startDate.setUTCDate(startDate.getUTCDate() + 1);
        while (isWeekend(startDate)) {
            startDate.setUTCDate(startDate.getUTCDate() + 1);
        }

        const endDate = new Date(startDate);
        let workDaysCount = 0;
        while (workDaysCount < 10) {
            if (!isWeekend(endDate)) {
                workDaysCount++;
            }
            if (workDaysCount < 10) {
                endDate.setUTCDate(endDate.getUTCDate() + 1);
            }
        }

        return {
            start: startDate.toISOString().split('T')[0],
            end: endDate.toISOString().split('T')[0],
        };
    };

    const getSelectedYear = (): number => {
        return Number((document.getElementById('rotationYearSelect') as HTMLSelectElement | null)?.value || new Date().getUTCFullYear());
    };

    const getSelectedHorizon = (): Horizon => {
        return ((document.getElementById('rotationHorizonSelect') as HTMLSelectElement | null)?.value || 'half') as Horizon;
    };

    const getSelectedFirstMorningTeam = (): TeamId => {
        return ((document.getElementById('rotationFirstMorningSelect') as HTMLSelectElement | null)?.value || 'first') as TeamId;
    };

    const setSelectedFirstMorningTeam = (team: TeamId): void => {
        const select = document.getElementById('rotationFirstMorningSelect') as HTMLSelectElement | null;
        if (select) select.value = team;
    };

    const getLastPeriodForYear = (year: number): RotationPeriod | null => {
        return generateTwoWeekPeriods(year).slice(-1)[0] || null;
    };

    const getVisibleRows = (): RotationPlanRow[] => {
        return draft?.rows.length ? draft.rows : publishedPreviewRows;
    };

    const canAddNextPeriod = (): boolean => {
        const rows = getVisibleRows();
        if (rows.length === 0) return true;
        const selectedYear = getSelectedYear();
        const lastYearPeriod = getLastPeriodForYear(selectedYear);
        if (!lastYearPeriod) return false;
        const latestRow = [...rows].sort((a, b) => new Date(b.period.start).getTime() - new Date(a.period.start).getTime())[0];
        return new Date(latestRow.period.start).getTime() < new Date(lastYearPeriod.start).getTime();
    };

    const addNextPeriod = async (): Promise<void> => {
        if (!draft || draft.rows.length === 0) {
            const year = getSelectedYear();
            const latestPublishedPeriod = await getLatestPublishedPeriodInfo(year);
            const firstPeriod = latestPublishedPeriod
                ? getNextPeriod(latestPublishedPeriod.period)
                : generateTwoWeekPeriods(year)[0];
            if (!firstPeriod) return;
            if (new Date(firstPeriod.start).getUTCFullYear() > year) {
                window.showToast?.('Ten rok wygląda na zaplanowany do końca.', 2600);
                return;
            }

            const inferredFirstMorningTeam = latestPublishedPeriod?.morningTeam
                ? getOtherTeam(latestPublishedPeriod.morningTeam)
                : await inferFirstMorningTeamFromPreviousYear(year);
            const firstMorningTeam = inferredFirstMorningTeam || getSelectedFirstMorningTeam();
            const fixedAssignments = loadFixedAssignments();
            setSelectedFirstMorningTeam(firstMorningTeam);
            draft = {
                year,
                horizon: getSelectedHorizon(),
                firstMorningTeam,
                fixedAssignments,
                rows: [{
                    ...buildPlanRow(firstPeriod, 0, firstMorningTeam, fixedAssignments),
                    sourceYear: year,
                }],
            };
            saveDraft();
            syncControlsFromDraft();
            renderPlan();
            const sourceText = latestPublishedPeriod?.morningTeam
                ? ' po istniejącym harmonogramie.'
                : inferredFirstMorningTeam
                    ? ' Zmianę początkową ustalono z poprzedniego roku.'
                    : '';
            window.showToast?.(`Dodano pierwszy okres ${formatPeriod(firstPeriod)}.${sourceText}`, 3000);
            return;
        }

        const lastRow = draft.rows[draft.rows.length - 1];
        const period = getNextPeriod(lastRow.period);
        const rowIndex = draft.rows.length;
        const fixedAssignments = loadFixedAssignments();
        const nextRow = {
            ...buildPlanRow(period, rowIndex, draft.firstMorningTeam, fixedAssignments),
            sourceYear: draft.year,
        };

        draft.fixedAssignments = fixedAssignments;
        draft.rows.push(nextRow);
        saveDraft();
        renderPlan();
        window.showToast?.(`Dodano okres ${formatPeriod(period)}.`, 2200);
    };

    const getEmployeeLeaveEntry = (employeeId: string, period: RotationPeriod): LeaveEntry | null => {
        const employee = EmployeeManager.getAll()[employeeId];
        const employeeName = employee?.displayName || employee?.name;
        if (!employeeName) return null;

        const entries = leavesData[employeeName];
        if (!Array.isArray(entries)) return null;

        const start = new Date(period.start);
        const end = new Date(period.end);
        return entries.find((leave) => {
            if (leave.type !== 'vacation') return false;
            if (countWorkdays(leave.startDate, leave.endDate) < MIN_LEAVE_WORKDAYS_FOR_SUBSTITUTE) return false;
            const leaveStart = new Date(leave.startDate);
            const leaveEnd = new Date(leave.endDate);
            return !(leaveEnd < start || leaveStart > end);
        }) || null;
    };

    const getLeaveWarnings = (row: RotationPlanRow): string[] => {
        const warnings: string[] = [];
        STATIONS.forEach((station) => {
            if (station.role === 'gym') return;

            (row.cells[station.id] || []).forEach((employeeId) => {
                const leave = getEmployeeLeaveEntry(employeeId, row.period);
                if (leave) {
                    warnings.push(`${EmployeeManager.getFullNameById(employeeId)} ma urlop (${leave.startDate} - ${leave.endDate})`);
                }
            });
        });
        return warnings;
    };

    const saveDraft = (): void => {
        if (!draft) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
        localStorage.setItem(`${STORAGE_KEY}_${draft.year}`, JSON.stringify(draft));
    };

    const loadDraft = (year?: number): RotationDraft | null => {
        try {
            const selectedYear = year || getSelectedYear();
            const stored = localStorage.getItem(`${STORAGE_KEY}_${selectedYear}`) || localStorage.getItem(STORAGE_KEY);
            if (!stored) return null;
            const parsed = JSON.parse(stored) as RotationDraft;
            if (parsed.year !== selectedYear) return null;
            return parsed;
        } catch {
            return null;
        }
    };

    const renderYearOptions = (): void => {
        const select = document.getElementById('rotationYearSelect') as HTMLSelectElement | null;
        if (!select) return;

        const now = new Date().getUTCFullYear();
        select.innerHTML = '';
        for (let year = now - 1; year <= now + 3; year++) {
            const option = document.createElement('option');
            option.value = String(year);
            option.textContent = String(year);
            option.selected = year === now;
            select.appendChild(option);
        }
    };

    const renderFixedAssignmentControls = (): void => {
        const employeeSelect = document.getElementById('fixedEmployeeSelect') as HTMLSelectElement | null;
        const list = document.getElementById('fixedAssignmentsList');
        if (!employeeSelect || !list) return;

        const fixedAssignments = loadFixedAssignments();
        employeeSelect.innerHTML = '<option value="">-- Wybierz pracownika --</option>';
        getVisibleEmployeeIds().forEach((employeeId) => {
            const option = document.createElement('option');
            option.value = employeeId;
            option.textContent = EmployeeManager.getFullNameById(employeeId);
            employeeSelect.appendChild(option);
        });

        const entries = Object.entries(fixedAssignments)
            .filter(([employeeId]) => EmployeeManager.getAll()[employeeId])
            .sort(([a], [b]) => EmployeeManager.compareEmployees(EmployeeManager.getAll()[a], EmployeeManager.getAll()[b]));

        if (entries.length === 0) {
            list.innerHTML = '<span class="rotation-empty">Brak stałych przypisań. Generator rozdzieli osoby automatycznie.</span>';
            return;
        }

        list.innerHTML = entries.map(([employeeId, assignment]) => {
            const modeLabel = assignment.alwaysMorning ? 'zawsze rano' : 'według zespołu';
            return `
            <div class="rotation-fixed-item">
                <span><strong>${escapeHTML(EmployeeManager.getFullNameById(employeeId))}</strong> -> ${STATION_ROLE_LABELS[assignment.role]} <small>(${modeLabel})</small></span>
                <button type="button" class="rotation-fixed-remove" data-employee-id="${employeeId}" title="Usuń przypisanie">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        }).join('');
    };

    const renderSummary = (): void => {
        const container = document.getElementById('rotationSummary');
        if (!container) return;

        const firstCount = getTeamIds('first').length;
        const secondCount = getTeamIds('second').length;
        const visibleRows = draft?.rows.length ? draft.rows : publishedPreviewRows;
        const warningsCount = visibleRows.reduce((sum, row) => sum + getLeaveWarnings(row).length, 0);
        const rowsLabel = draft?.rows.some((row) => row.source === 'published')
            ? 'opublikowanych okresów'
            : draft?.rows.length
                ? 'okresów w szkicu'
                : 'okresów w podglądzie';

        container.innerHTML = `
            <div class="rotation-summary-card"><strong>${visibleRows.length}</strong><span>${rowsLabel}</span></div>
            <div class="rotation-summary-card"><strong>${firstCount}</strong><span>osób w zespole rannym</span></div>
            <div class="rotation-summary-card"><strong>${secondCount}</strong><span>osób w zespole popołudniowym</span></div>
            <div class="rotation-summary-card"><strong>${warningsCount}</strong><span>ostrzeżeń urlopowych</span></div>
        `;
    };

    const getAssignedEmployeeIds = (row: RotationPlanRow): Set<string> => {
        return new Set(Object.values(row.cells).flat());
    };

    const renderSubstituteSelect = (row: RotationPlanRow, employeeId: string, rowIndex: number): string => {
        const assignedIds = getAssignedEmployeeIds(row);
        const selectedSubstitute = row.substitutes?.[employeeId] || '';
        const options = getVisibleEmployeeIds()
            .filter((candidateId) => {
                if (candidateId === employeeId) return false;
                if (candidateId === selectedSubstitute) return true;
                return !getEmployeeLeaveEntry(candidateId, row.period);
            })
            .map((candidateId) => {
                const selected = candidateId === selectedSubstitute ? ' selected' : '';
                const assignedLabel = assignedIds.has(candidateId) ? ' (w obsadzie)' : '';
                return `<option value="${candidateId}"${selected}>${escapeHTML(EmployeeManager.getFullNameById(candidateId) + assignedLabel)}</option>`;
            })
            .join('');

        return `
            <select class="rotation-substitute-select" data-row-index="${rowIndex}" data-employee-id="${employeeId}" title="Wybierz zastępstwo">
                <option value="">Zastępstwo...</option>
                ${options}
            </select>
        `;
    };

    const renderEmployeeChips = (
        employeeIds: string[],
        row: RotationPlanRow,
        rowIndex: number,
        stationId: number,
        readOnly = false,
    ): string => {
        if (employeeIds.length === 0) {
            return '<span class="rotation-empty">Brak osoby</span>';
        }

        return employeeIds.map((employeeId) => {
            const leave = getEmployeeLeaveEntry(employeeId, row.period);
            const leaveIcon = leave ? ' <i class="fas fa-triangle-exclamation"></i>' : '';
            const className = leave ? 'rotation-employee-chip on-leave' : 'rotation-employee-chip';
            const substituteId = row.substitutes?.[employeeId];
            const substituteLabel = substituteId
                ? `<span class="rotation-substitute-label">/ ${escapeHTML(EmployeeManager.getLastNameById(substituteId) || EmployeeManager.getFullNameById(substituteId))}</span>`
                : '';
            const station = STATIONS.find((item) => item.id === stationId);
            const needsSubstitute = Boolean(leave && station?.role !== 'gym');
            const substituteSelect = !readOnly && needsSubstitute ? renderSubstituteSelect(row, employeeId, rowIndex) : '';
            const draggable = readOnly ? 'false' : 'true';
            const readOnlyClass = readOnly ? ' is-readonly' : '';

            return `
                <span class="${className}${readOnlyClass}" draggable="${draggable}" data-row-index="${rowIndex}" data-station-id="${stationId}" data-employee-id="${employeeId}">
                    <span class="rotation-chip-name">${escapeHTML(EmployeeManager.getLastNameById(employeeId) || EmployeeManager.getFullNameById(employeeId))}${leaveIcon}</span>
                    ${substituteLabel}
                    ${substituteSelect}
                </span>
            `;
        }).join('');
    };

    const renderAddPeriodButton = (): string => canAddNextPeriod() ? `
        <div class="rotation-add-period">
            <button class="rotation-add-period-btn" data-action="add-period" type="button" title="Dodaj kolejny okres 2 tygodni">
                <i class="fas fa-plus"></i>
            </button>
        </div>
    ` : `
        <div class="rotation-add-period is-complete">
            <span>To już koniec danego roku. Przejdź na kolejny rok, aby planować dalej.</span>
            <button class="rotation-add-period-btn" type="button" disabled title="Koniec roku">
                <i class="fas fa-check"></i>
            </button>
        </div>
    `;

    const getMissingPeriods = (rows: RotationPlanRow[]): RotationPeriod[] => {
        if (rows.length < 2) return [];
        const selectedYear = getSelectedYear();
        const rowStarts = new Set(rows.map((row) => row.period.start));
        const sortedRows = [...rows].sort((a, b) => new Date(a.period.start).getTime() - new Date(b.period.start).getTime());
        const firstStart = sortedRows[0].period.start;
        const lastStart = sortedRows[sortedRows.length - 1].period.start;

        return generateTwoWeekPeriods(selectedYear).filter((period) => {
            if (period.start < firstStart || period.start > lastStart) return false;
            return !rowStarts.has(period.start);
        });
    };

    const renderMissingPeriod = (period: RotationPeriod): string => {
        const readOnly = isPastPeriod(period);
        return `
            <article class="rotation-period rotation-period-missing${readOnly ? ' is-published-preview' : ''}">
                <div class="rotation-period-header">
                    <div class="rotation-period-date">${formatPeriod(period)}</div>
                    <div class="rotation-period-teams">
                        <span class="rotation-team-badge"><i class="fas fa-circle-exclamation"></i> brak okresu</span>
                        ${readOnly ? '<span class="rotation-team-badge"><i class="fas fa-lock"></i> historia</span>' : ''}
                    </div>
                    ${readOnly ? '' : `
                        <div class="rotation-period-actions">
                            <button class="rotation-period-btn" data-action="restore-period" data-period-start="${period.start}" type="button">
                                <i class="fas fa-plus"></i>
                                Utwórz okres
                            </button>
                        </div>
                    `}
                </div>
                <div class="rotation-missing-body">
                    ${readOnly
                        ? 'Ten okres jest w historii i nie można go odtworzyć z poziomu planowania.'
                        : 'Okres został usunięty albo brakuje go między zaplanowanymi turnusami. Możesz go odtworzyć i poprawić obsadę przed publikacją.'}
                </div>
            </article>
        `;
    };

    const renderPublishedEmployeeChips = (employeeIds: string[]): string => {
        if (employeeIds.length === 0) {
            return '<span class="rotation-empty">Brak osoby</span>';
        }

        return employeeIds.map((employeeId) => `
            <span class="rotation-employee-chip is-readonly" draggable="false">
                <span class="rotation-chip-name">${escapeHTML(EmployeeManager.getLastNameById(employeeId) || EmployeeManager.getFullNameById(employeeId))}</span>
            </span>
        `).join('');
    };

    const renderPublishedPreview = (): string => {
        const rowsHtml = publishedPreviewRows.map((row) => {
            const stationHtml = STATIONS.map((station) => `
                <div class="rotation-station is-readonly">
                    <div class="rotation-station-title">${station.label}</div>
                    ${renderPublishedEmployeeChips(row.cells[station.id] || [])}
                </div>
            `).join('');

            return `
                <article class="rotation-period is-published-preview">
                    <div class="rotation-period-header">
                        <div class="rotation-period-date">${formatPeriod(row.period)}</div>
                        <div class="rotation-period-teams">
                            <span class="rotation-team-badge morning"><i class="fas fa-sun"></i> Rano: ${row.morningTeam === 'first' ? 'zespół ranny' : 'zespół popołudniowy'}</span>
                            <span class="rotation-team-badge afternoon"><i class="fas fa-moon"></i> Popoł.: ${row.afternoonTeam === 'first' ? 'zespół ranny' : 'zespół popołudniowy'}</span>
                            <span class="rotation-team-badge"><i class="fas fa-eye"></i> podgląd</span>
                        </div>
                    </div>
                    <div class="rotation-period-grid">${stationHtml}</div>
                </article>
            `;
        }).join('');

        return `
            <div class="rotation-preview-note">
                <strong>Opublikowany harmonogram</strong>
                <span>Ten rok ma już zaplanowane okresy. To jest podgląd z harmonogramu; plus dopisze kolejny turnus po ostatnim wpisie.</span>
            </div>
            ${rowsHtml}
            ${renderAddPeriodButton()}
        `;
    };

    const renderPlan = (): void => {
        const list = document.getElementById('rotationPlanList');
        if (!list) return;

        if (!draft || draft.rows.length === 0) {
            if (publishedPreviewRows.length > 0) {
                list.innerHTML = renderPublishedPreview();
                renderSummary();
                return;
            }

            list.innerHTML = `
                <div class="rotation-empty-plan">
                    <strong>Brak szkicu</strong>
                    <span>Kliknij plus, aby dodać pierwszy dwutygodniowy okres. System użyje wybranej zmiany początkowej albo odczyta ją z ostatniego opublikowanego turnusu poprzedniego roku.</span>
                </div>
                ${renderAddPeriodButton()}
            `;
            renderSummary();
            return;
        }

        const hasPublishedRows = draft.rows.some((row) => row.source === 'published');
        const publishedNoteHtml = hasPublishedRows
            ? `
                <div class="rotation-preview-note">
                    <strong>Opublikowany harmonogram</strong>
                    <span>Szare turnusy są zakończone i tylko do odczytu. Turnusy bez szarego paska możesz poprawić, a potem ponownie opublikować.</span>
                </div>
            `
            : '';

        const missingPeriodsByStart = new Map(getMissingPeriods(draft.rows).map((period) => [period.start, period]));
        const rowsByStart = new Map(draft.rows.map((row, rowIndex) => [row.period.start, { row, rowIndex }]));
        const orderedPeriods = [...draft.rows.map((row) => row.period), ...missingPeriodsByStart.values()]
            .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

        const rowsHtml = orderedPeriods.map((period) => {
            const rowEntry = rowsByStart.get(period.start);
            if (!rowEntry) {
                return renderMissingPeriod(period);
            }

            const { row, rowIndex } = rowEntry;
            const warnings = getLeaveWarnings(row);
            const readOnly = isRowReadOnly(row);
            const stationHtml = STATIONS.map((station) => `
                <div class="rotation-station${readOnly ? ' is-readonly' : ''}" ${readOnly ? '' : `data-row-index="${rowIndex}" data-station-id="${station.id}"`}>
                    <div class="rotation-station-title">${station.label}</div>
                    ${renderEmployeeChips(row.cells[station.id] || [], row, rowIndex, station.id, readOnly)}
                </div>
            `).join('');

            const warningHtml = warnings.length > 0
                ? `<div class="rotation-leave-note"><i class="fas fa-triangle-exclamation"></i> ${warnings.map(escapeHTML).join('<br>')}</div>`
                : '';

            return `
                <article class="rotation-period${readOnly ? ' is-published-preview' : ''}${!readOnly && row.overridden ? ' is-overridden' : ''}">
                    <div class="rotation-period-header">
                        <div class="rotation-period-date">${formatPeriod(row.period)}</div>
                        <div class="rotation-period-teams">
                            <span class="rotation-team-badge morning"><i class="fas fa-sun"></i> Rano: ${row.morningTeam === 'first' ? 'zespół ranny' : 'zespół popołudniowy'}</span>
                            <span class="rotation-team-badge afternoon"><i class="fas fa-moon"></i> Popoł.: ${row.afternoonTeam === 'first' ? 'zespół ranny' : 'zespół popołudniowy'}</span>
                            ${readOnly ? '<span class="rotation-team-badge"><i class="fas fa-lock"></i> zakończony</span>' : ''}
                            ${!readOnly && row.source === 'published' ? '<span class="rotation-team-badge"><i class="fas fa-pen-to-square"></i> opublikowany</span>' : ''}
                            ${row.overridden ? '<span class="rotation-team-badge"><i class="fas fa-pen"></i> wyjątek</span>' : ''}
                        </div>
                        ${readOnly ? '' : `
                            <div class="rotation-period-actions">
                                <button class="rotation-period-btn" data-action="swap" data-row-index="${rowIndex}" type="button">
                                    <i class="fas fa-right-left"></i>
                                    Zamień zespoły
                                </button>
                                <button class="rotation-period-btn" data-action="edit" data-row-index="${rowIndex}" type="button">
                                    <i class="fas fa-user-pen"></i>
                                    Popraw osoby
                                </button>
                                <button class="rotation-period-btn is-danger" data-action="delete-period" data-row-index="${rowIndex}" type="button">
                                    <i class="fas fa-trash"></i>
                                    Usuń okres
                                </button>
                            </div>
                        `}
                    </div>
                    <div class="rotation-period-grid">${stationHtml}</div>
                    ${warningHtml}
                </article>
            `;
        }).join('');

        list.innerHTML = `${publishedNoteHtml}${rowsHtml}${renderAddPeriodButton()}`;

        renderSummary();
    };

    const openEditModal = (rowIndex: number): void => {
        if (!draft?.rows[rowIndex]) return;
        if (isRowReadOnly(draft.rows[rowIndex])) return;
        editingRowIndex = rowIndex;

        const row = draft.rows[rowIndex];
        const modal = document.getElementById('rotationEditModal');
        const label = document.getElementById('rotationEditPeriodLabel');
        const body = document.getElementById('rotationEditBody');
        if (!modal || !label || !body) return;

        const employeeIds = getVisibleEmployeeIds();
        label.textContent = formatPeriod(row.period);
        body.innerHTML = STATIONS.map((station) => {
            const selected = new Set(row.cells[station.id] || []);
            const peopleHtml = employeeIds.map((employeeId) => {
                const checked = selected.has(employeeId) ? ' checked' : '';
                const leave = getEmployeeLeaveEntry(employeeId, row.period);
                const leaveText = leave ? ' (urlop)' : '';
                return `
                    <label class="rotation-edit-person">
                        <input type="checkbox" data-station-id="${station.id}" value="${employeeId}"${checked}>
                        <span>${escapeHTML(EmployeeManager.getFullNameById(employeeId) + leaveText)}</span>
                    </label>
                `;
            }).join('');

            return `
                <section class="rotation-edit-station">
                    <h3>${station.shortLabel}</h3>
                    ${peopleHtml}
                </section>
            `;
        }).join('');

        modal.style.display = 'flex';
    };

    const swapTeamsForRow = (rowIndex: number): void => {
        if (!draft?.rows[rowIndex]) return;

        const row = draft.rows[rowIndex];
        if (isRowReadOnly(row)) return;
        const newMorningTeam = row.afternoonTeam;
        const newAfternoonTeam = row.morningTeam;
        const morningStationIds = STATIONS.filter((station) => station.shift === 'morning').map((station) => station.id);
        const afternoonStationIds = STATIONS.filter((station) => station.shift === 'afternoon').map((station) => station.id);
        const fixedAssignments = loadFixedAssignments();
        const alwaysMorningIds = getAlwaysMorningEmployeeIds(fixedAssignments);
        const reservedMorningStationIds = getReservedMorningStationIds(fixedAssignments);
        const morningIds = getTeamIds(newMorningTeam).filter((id) => !alwaysMorningIds.has(id));
        const afternoonIds = getTeamIds(newAfternoonTeam).filter((id) => !alwaysMorningIds.has(id));
        const cells = {
            ...assignTeamToStations(morningIds, morningStationIds, rowIndex, fixedAssignments, 'morning', reservedMorningStationIds),
            ...assignTeamToStations(afternoonIds, afternoonStationIds, rowIndex, fixedAssignments, 'afternoon'),
        };
        applyAlwaysMorningAssignments(cells, fixedAssignments);

        row.morningTeam = newMorningTeam;
        row.afternoonTeam = newAfternoonTeam;
        row.cells = cells;
        row.overridden = true;

        saveDraft();
        renderPlan();
        window.showToast?.('Zamieniono zespoły w wybranym okresie.', 2000);
    };

    const moveEmployeeToStation = (rowIndex: number, employeeId: string, targetStationId: number): void => {
        if (!draft?.rows[rowIndex]) return;

        const row = draft.rows[rowIndex];
        if (isRowReadOnly(row)) return;
        STATIONS.forEach((station) => {
            row.cells[station.id] = (row.cells[station.id] || []).filter((id) => id !== employeeId);
        });

        if (!row.cells[targetStationId]) row.cells[targetStationId] = [];
        row.cells[targetStationId].push(employeeId);
        row.overridden = true;

        saveDraft();
        renderPlan();
    };

    const setSubstitute = (rowIndex: number, employeeId: string, substituteId: string): void => {
        if (!draft?.rows[rowIndex]) return;

        const row = draft.rows[rowIndex];
        if (isRowReadOnly(row)) return;
        if (!row.substitutes) row.substitutes = {};

        if (substituteId) {
            row.substitutes[employeeId] = substituteId;
        } else {
            delete row.substitutes[employeeId];
        }

        row.overridden = true;
        saveDraft();
        renderPlan();
        window.showToast?.(substituteId ? 'Ustawiono zastępstwo.' : 'Usunięto zastępstwo.', 1800);
    };

    const deletePeriod = (rowIndex: number): void => {
        if (!draft?.rows[rowIndex]) return;
        const row = draft.rows[rowIndex];
        if (isRowReadOnly(row)) {
            window.showToast?.('Okres w historii jest nieusuwalny.', 2200);
            return;
        }
        if (!confirm(`Usunąć okres ${formatPeriod(row.period)} ze szkicu?`)) return;

        if (!draft.deletedPeriods) draft.deletedPeriods = {};
        draft.deletedPeriods[row.period.start] = row.sourceYear || draft.year;
        draft.rows.splice(rowIndex, 1);
        saveDraft();
        renderPlan();
        window.showToast?.('Usunięto okres. Opublikuj harmonogram, aby zapisać zmianę.', 2600);
    };

    const restorePeriod = (periodStart: string): void => {
        if (!draft) return;
        const period = generateTwoWeekPeriods(getSelectedYear()).find((item) => item.start === periodStart);
        if (!period || isPastPeriod(period)) return;
        if (draft.rows.some((row) => row.period.start === period.start)) return;

        const row = buildPlanRowForPeriod(period);
        row.overridden = true;
        draft.rows.push(row);
        draft.rows.sort((a, b) => new Date(a.period.start).getTime() - new Date(b.period.start).getTime());
        if (draft.deletedPeriods) {
            delete draft.deletedPeriods[period.start];
        }
        saveDraft();
        renderPlan();
        window.showToast?.('Utworzono brakujący okres. Możesz poprawić obsadę przed publikacją.', 2600);
    };

    const closeEditModal = (): void => {
        const modal = document.getElementById('rotationEditModal');
        if (modal) modal.style.display = 'none';
        editingRowIndex = null;
    };

    const saveEditModal = (): void => {
        if (editingRowIndex === null || !draft?.rows[editingRowIndex]) return;
        if (isRowReadOnly(draft.rows[editingRowIndex])) return;

        const body = document.getElementById('rotationEditBody');
        if (!body) return;

        const cells: Record<number, string[]> = {};
        const alreadyAssigned = new Set<string>();
        let duplicateCount = 0;
        STATIONS.forEach((station) => {
            const checked = Array.from(body.querySelectorAll<HTMLInputElement>(`input[data-station-id="${station.id}"]:checked`));
            cells[station.id] = [];
            checked.forEach((input) => {
                if (alreadyAssigned.has(input.value)) {
                    duplicateCount++;
                    return;
                }
                alreadyAssigned.add(input.value);
                cells[station.id].push(input.value);
            });
        });

        draft.rows[editingRowIndex].cells = cells;
        draft.rows[editingRowIndex].overridden = true;
        saveDraft();
        renderPlan();
        closeEditModal();
        const duplicateText = duplicateCount > 0 ? ` Pominięto ${duplicateCount} powtórzeń.` : '';
        window.showToast?.(`Zapisano wyjątek.${duplicateText}`, 2500);
    };

    const loadLeaves = async (): Promise<void> => {
        try {
            const docRef = db.collection(AppConfig.firestore.collections.leaves).doc(AppConfig.firestore.docs.mainLeaves);
            const docSnap = await docRef.get();
            leavesData = docSnap.exists ? (docSnap.data() as Record<string, LeaveEntry[]>) || {} : {};
        } catch (error) {
            console.error('Nie udało się pobrać urlopów dla planowania testowego:', error);
            leavesData = {};
        }
    };

    const publishDraftToChangesSchedule = async (): Promise<void> => {
        if (!draft || draft.rows.length === 0) {
            window.showToast?.('Brak szkicu do opublikowania.', 2000);
            return;
        }

        const shouldPublish = confirm('Opublikować szkic do istniejącego harmonogramu zmian? Okresy ze szkicu zostaną nadpisane.');
        if (!shouldPublish) return;

        try {
            window.setSaveStatus?.('saving');
            const publishedRowsCount = draft.rows.length;
            const targetYears = new Set<number>([
                ...draft.rows.map((row) => row.sourceYear || draft!.year),
                ...Object.values(draft.deletedPeriods || {}),
            ]);

            for (const targetYear of targetYears) {
                const docRef = db.collection(AppConfig.firestore.collections.schedules).doc(`changesSchedule_${targetYear}`);
                const docSnap = await docRef.get();
                const currentState = docSnap.exists ? (docSnap.data() as PublishedChangesState | undefined) : undefined;
                const changesCells: Record<string, Record<number, ChangesCellState>> = {
                    ...(currentState?.changesCells || {}),
                };

                Object.entries(draft.deletedPeriods || {}).forEach(([periodStart, sourceYear]) => {
                    if (sourceYear === targetYear) {
                        delete changesCells[periodStart];
                    }
                });

                draft.rows
                    .filter((row) => (row.sourceYear || draft!.year) === targetYear)
                    .forEach((row) => {
                        const periodCells: Record<number, ChangesCellState> = {};

                        STATIONS.forEach((station) => {
                            const assignedEmployees = [...(row.cells[station.id] || [])];
                            const substitutes = Object.fromEntries(
                                Object.entries(row.substitutes || {}).filter(([employeeId]) => assignedEmployees.includes(employeeId)),
                            );

                            periodCells[station.id] = Object.keys(substitutes).length > 0
                                ? { assignedEmployees, substitutes }
                                : { assignedEmployees };
                        });

                        changesCells[row.period.start] = periodCells;
                    });

                await docRef.set({ changesCells }, { merge: true });
            }

            const publishedYear = draft.year;
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(`${STORAGE_KEY}_${publishedYear}`);
            draft = null;
            publishedPreviewRows = await loadPublishedPreviewRows(publishedYear);
            hydratePublishedRowsAsDraft();
            renderPlan();
            window.setSaveStatus?.('saved');
            window.showToast?.(`Opublikowano ${publishedRowsCount} okresów do harmonogramu zmian.`, 3500);
        } catch (error) {
            console.error('Nie udało się opublikować szkicu harmonogramu:', error);
            window.setSaveStatus?.('error');
            window.showToast?.('Nie udało się opublikować harmonogramu.', 4000);
        }
    };

    const syncControlsFromDraft = (): void => {
        if (!draft) return;
        const yearSelect = document.getElementById('rotationYearSelect') as HTMLSelectElement | null;
        const horizonSelect = document.getElementById('rotationHorizonSelect') as HTMLSelectElement | null;
        const firstMorningSelect = document.getElementById('rotationFirstMorningSelect') as HTMLSelectElement | null;

        if (yearSelect) yearSelect.value = String(draft.year);
        if (horizonSelect) horizonSelect.value = draft.horizon;
        if (firstMorningSelect) firstMorningSelect.value = draft.firstMorningTeam;
    };

    const hydratePublishedRowsAsDraft = (): void => {
        if (draft?.rows.length || publishedPreviewRows.length === 0) return;

        draft = {
            year: getSelectedYear(),
            horizon: getSelectedHorizon(),
            firstMorningTeam: publishedPreviewRows[0]?.morningTeam || getSelectedFirstMorningTeam(),
            fixedAssignments: loadFixedAssignments(),
            rows: publishedPreviewRows.map((row) => ({
                ...row,
                cells: Object.fromEntries(
                    Object.entries(row.cells).map(([stationId, employeeIds]) => [stationId, [...employeeIds]]),
                ) as Record<number, string[]>,
                substitutes: row.substitutes ? { ...row.substitutes } : undefined,
            })),
        };
        syncControlsFromDraft();
    };

    const refreshPublishedPreview = async (): Promise<void> => {
        publishedPreviewRows = draft?.rows.length ? [] : await loadPublishedPreviewRows(getSelectedYear());
        hydratePublishedRowsAsDraft();
    };

    const handlePlanningScopeChange = (): void => {
        void (async (): Promise<void> => {
        draft = loadDraft(getSelectedYear());
        if (draft) {
            syncControlsFromDraft();
        }
        await refreshPublishedPreview();
        renderPlan();
        })();
    };

    const bindEvents = (): void => {
        document.getElementById('rotationYearSelect')?.addEventListener('change', handlePlanningScopeChange);
        document.getElementById('rotationHorizonSelect')?.addEventListener('change', () => {
            if (!draft || draft.year !== getSelectedYear()) return;
            draft.horizon = getSelectedHorizon();
            saveDraft();
            renderPlan();
        });
        document.getElementById('rotationFirstMorningSelect')?.addEventListener('change', () => {
            if (!draft || draft.rows.length === 0 || draft.year !== getSelectedYear()) return;
            window.showToast?.('Zmiana początku rotacji wpłynie na nowy szkic po wygenerowaniu planu.', 2600);
        });

        document.getElementById('generateRotationPlanBtn')?.addEventListener('click', () => {
            void (async (): Promise<void> => {
            const year = getSelectedYear();
            const horizon = getSelectedHorizon();
            const firstMorningTeam = getSelectedFirstMorningTeam();

            draft = await buildDraft(year, horizon, firstMorningTeam);
            saveDraft();
            syncControlsFromDraft();
            publishedPreviewRows = draft.rows.length > 0 ? [] : await loadPublishedPreviewRows(year);
            hydratePublishedRowsAsDraft();
            renderPlan();
            window.showToast?.(
                draft.rows.length > 0
                    ? 'Wygenerowano szkic rotacji dla niezaplanowanej części roku.'
                    : 'Brak okresów do wygenerowania. Rok może być już zaplanowany do końca.',
                3000,
            );
            })();
        });

        document.getElementById('addFixedAssignmentBtn')?.addEventListener('click', () => {
            const employeeSelect = document.getElementById('fixedEmployeeSelect') as HTMLSelectElement | null;
            const stationSelect = document.getElementById('fixedStationSelect') as HTMLSelectElement | null;
            const alwaysMorningCheckbox = document.getElementById('fixedAlwaysMorningCheckbox') as HTMLInputElement | null;
            const employeeId = employeeSelect?.value || '';
            const stationRole = (stationSelect?.value || 'gym') as StationRole;

            if (!employeeId) {
                window.showToast?.('Wybierz pracownika do stałego przypisania.', 2000);
                return;
            }

            const fixedAssignments = loadFixedAssignments();
            fixedAssignments[employeeId] = {
                role: stationRole,
                alwaysMorning: Boolean(alwaysMorningCheckbox?.checked),
            };
            saveFixedAssignments(fixedAssignments);
            renderFixedAssignmentControls();
            window.showToast?.('Dodano stałe przypisanie. Wygeneruj plan ponownie, aby je zastosować.', 3000);
        });

        document.getElementById('fixedAssignmentsList')?.addEventListener('click', (event) => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.rotation-fixed-remove');
            if (!button?.dataset.employeeId) return;

            const fixedAssignments = loadFixedAssignments();
            delete fixedAssignments[button.dataset.employeeId];
            saveFixedAssignments(fixedAssignments);
            renderFixedAssignmentControls();
        });

        document.getElementById('saveRotationDraftBtn')?.addEventListener('click', () => {
            saveDraft();
            window.showToast?.('Szkic zapisany w tej przeglądarce.', 2000);
        });

        document.getElementById('publishRotationDraftBtn')?.addEventListener('click', () => {
            void publishDraftToChangesSchedule();
        });

        document.getElementById('clearRotationDraftBtn')?.addEventListener('click', () => {
            if (!confirm('Wyczyścić szkic planowania?')) return;
            void (async (): Promise<void> => {
                const selectedYear = draft?.year || getSelectedYear();
                localStorage.removeItem(STORAGE_KEY);
                localStorage.removeItem(`${STORAGE_KEY}_${selectedYear}`);
                draft = null;
                await refreshPublishedPreview();
                renderPlan();
            })();
        });

        document.getElementById('rotationPlanList')?.addEventListener('click', (event) => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
            if (!button) return;
            if (button.dataset.action === 'add-period') {
                void addNextPeriod();
                return;
            }
            if (button.dataset.action === 'restore-period') {
                restorePeriod(button.dataset.periodStart || '');
                return;
            }
            const rowIndex = Number(button.dataset.rowIndex);
            if (button.dataset.action === 'swap') {
                swapTeamsForRow(rowIndex);
                return;
            }
            if (button.dataset.action === 'delete-period') {
                deletePeriod(rowIndex);
                return;
            }
            openEditModal(rowIndex);
        });

        document.getElementById('rotationPlanList')?.addEventListener('dragstart', (event) => {
            const chip = (event.target as HTMLElement).closest<HTMLElement>('.rotation-employee-chip');
            if (!chip || !event.dataTransfer) return;
            const rowIndex = Number(chip.dataset.rowIndex);
            if (!draft?.rows[rowIndex] || isRowReadOnly(draft.rows[rowIndex])) {
                event.preventDefault();
                return;
            }

            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', JSON.stringify({
                rowIndex,
                employeeId: chip.dataset.employeeId || '',
            }));
            chip.classList.add('is-dragging');
        });

        document.getElementById('rotationPlanList')?.addEventListener('dragend', (event) => {
            const chip = (event.target as HTMLElement).closest<HTMLElement>('.rotation-employee-chip');
            chip?.classList.remove('is-dragging');
            document.querySelectorAll('.rotation-station.is-drop-target').forEach((station) => station.classList.remove('is-drop-target'));
        });

        document.getElementById('rotationPlanList')?.addEventListener('dragover', (event) => {
            const station = (event.target as HTMLElement).closest<HTMLElement>('.rotation-station');
            if (!station) return;
            const rowIndex = Number(station.dataset.rowIndex);
            if (!draft?.rows[rowIndex] || isRowReadOnly(draft.rows[rowIndex])) return;
            event.preventDefault();
            station.classList.add('is-drop-target');
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        });

        document.getElementById('rotationPlanList')?.addEventListener('dragleave', (event) => {
            const station = (event.target as HTMLElement).closest<HTMLElement>('.rotation-station');
            station?.classList.remove('is-drop-target');
        });

        document.getElementById('rotationPlanList')?.addEventListener('drop', (event) => {
            const station = (event.target as HTMLElement).closest<HTMLElement>('.rotation-station');
            if (!station || !event.dataTransfer) return;
            const targetRowIndex = Number(station.dataset.rowIndex);
            const targetStationId = Number(station.dataset.stationId);
            if (!draft?.rows[targetRowIndex] || isRowReadOnly(draft.rows[targetRowIndex]) || !targetStationId) return;
            event.preventDefault();

            station.classList.remove('is-drop-target');
            let payload: { rowIndex?: number; employeeId?: string } = {};
            try {
                payload = JSON.parse(event.dataTransfer.getData('text/plain') || '{}') as { rowIndex?: number; employeeId?: string };
            } catch {
                return;
            }

            if (payload.rowIndex !== targetRowIndex || !payload.employeeId || !targetStationId) return;
            moveEmployeeToStation(targetRowIndex, payload.employeeId, targetStationId);
            window.showToast?.('Przeniesiono pracownika.', 1400);
        });

        document.getElementById('rotationPlanList')?.addEventListener('change', (event) => {
            const select = (event.target as HTMLElement).closest<HTMLSelectElement>('.rotation-substitute-select');
            if (!select) return;
            setSubstitute(Number(select.dataset.rowIndex), select.dataset.employeeId || '', select.value);
        });

        document.getElementById('saveRotationEditBtn')?.addEventListener('click', saveEditModal);
        document.getElementById('cancelRotationEditBtn')?.addEventListener('click', closeEditModal);
    };

    const init = async (): Promise<void> => {
        renderYearOptions();
        await loadLeaves();
        draft = loadDraft();
        syncControlsFromDraft();
        await refreshPublishedPreview();
        bindEvents();
        renderFixedAssignmentControls();
        renderPlan();
    };

    const destroy = (): void => {
        closeEditModal();
    };

    return { init, destroy };
})();

declare global {
    interface Window {
        ChangesRotation: ChangesRotationAPI;
    }
}

window.ChangesRotation = ChangesRotation;
