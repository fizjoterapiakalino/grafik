// scripts/statistics.ts
import { debugLog } from './common.js';
import { db as dbRaw } from './firebase-config.js';
import { AppConfig } from './common.js';
import { EmployeeManager } from './employee-manager.js';
import {
    calculateScheduleMetrics,
    calculateWeeklyAverages,
    createWeeklyStatsSnapshot,
    createDailyWorkloadSnapshot,
    backfillWorkloadSnapshots,
    calculatePeriodWorkloadAverages,
    getActiveEmployeeIds,
    getIsoWeekInfo,
    type ScheduleMetrics,
    type WeeklyStatsSnapshot,
    type DailyWorkloadSnapshot,
    type PeriodWorkloadAverages,
    type EmployeePeriodWorkloadSummary,
} from './statistics-helpers.js';
import type { FirestoreDbWrapper } from './types/firebase';
import type { CellState, LeaveEntry, ScheduleAppState, TreatmentData } from './types/index.js';

const db = dbRaw as unknown as FirestoreDbWrapper;

// Chart.js declaration
declare const Chart: {
    new(ctx: CanvasRenderingContext2D, config: object): ChartInstance;
    register(...items: unknown[]): void;
};

interface ChartInstance {
    destroy(): void;
    resize(): void;
    update(): void;
}

interface TreatmentAlert {
    priority: number;
    priorityLabel: string;
    patientName: string;
    employeeName: string;
    time: string;
    reason: string;
    endDate: string;
}

interface PatientScheduleEntry {
    patientName: string;
    normalizedName: string;
    employeeName: string;
    time: string;
    startDate?: string | null;
    endDate?: string | null;
    extensionDays?: number | null;
}

/**
 * Interfejs publicznego API Statistics
 */
interface StatisticsAPI {
    init(): Promise<void>;
    destroy(): void;
}

/**
 * Typy urlopów z kolorami
 */
const LEAVE_TYPES: Record<string, { label: string; color: string }> = {
    vacation: { label: 'Wypoczynkowy', color: '#10b981' },
    child_care_art_188: { label: 'Opieka (zdrowe dziecko)', color: '#f59e0b' },
    sick_child_care: { label: 'Opieka (chore dziecko)', color: '#8b5cf6' },
    family_member_care: { label: 'Opieka (rodzina)', color: '#ef4444' },
    schedule_pickup: { label: 'Wybicie za święto', color: '#3b82f6' },
};

const WEEKLY_STATS_COLLECTION = 'statsWeekly';
const DAILY_STATS_COLLECTION = 'statsDaily';
const WORKLOAD_STORAGE_KEY = 'kalinowa.stats.dailyWorkload.v1';
const CHART_COLOR_PALETTE = [
    '#2563eb',
    '#16a34a',
    '#f59e0b',
    '#dc2626',
    '#7c3aed',
    '#0891b2',
    '#db2777',
    '#65a30d',
    '#ea580c',
    '#4f46e5',
    '#0d9488',
    '#9333ea',
];

/**
 * Moduł statystyk
 */
export const Statistics: StatisticsAPI = (() => {
    let currentYear = new Date().getUTCFullYear();
    let leavesData: Record<string, LeaveEntry[]> = {};
    let scheduleData: ScheduleAppState | null = null;
    let weeklyStatsData: WeeklyStatsSnapshot[] = [];
    let dailySnapshotsData: Record<string, DailyWorkloadSnapshot> = {};
    let currentWorkloadPeriod: 'weekly' | 'monthly' | 'yearly' = 'weekly';
    let currentWorkloadWeek = '';
    let currentWorkloadMonth = new Date().getUTCMonth() + 1;
    let currentWorkloadEmployeeId = 'all';
    let chartInstances: ChartInstance[] = [];
    let workloadEmployeeChartInstance: ChartInstance | null = null;
    let workloadTrendChartInstance: ChartInstance | null = null;

    // DOM Elements
    let yearSelect: HTMLSelectElement | null = null;

    const normalizeLeavesData = (rawData: unknown): Record<string, LeaveEntry[]> => {
        if (!rawData || typeof rawData !== 'object') return {};

        const normalized: Record<string, LeaveEntry[]> = {};
        Object.entries(rawData as Record<string, unknown>).forEach(([employeeName, value]) => {
            if (!Array.isArray(value)) return;

            const leaves = value.filter((leave): leave is LeaveEntry => {
                if (!leave || typeof leave !== 'object') return false;
                const candidate = leave as Partial<LeaveEntry>;
                return typeof candidate.startDate === 'string' && typeof candidate.endDate === 'string';
            });

            normalized[employeeName] = leaves;
        });

        return normalized;
    };

    /**
     * Inicjalizacja modułu
     */
    const init = async (): Promise<void> => {
        debugLog('Statistics: init');

        await EmployeeManager.load();

        yearSelect = document.getElementById('statsYearSelect') as HTMLSelectElement;
        const loadingOverlay = document.getElementById('loadingOverlay');

        populateYearSelect();
        setupEventListeners();

        await loadAllData();
        updateAllStats();

        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }
    };

    /**
     * Destroy modułu
     */
    const destroy = (): void => {
        debugLog('Statistics: destroy');
        // Destroy all charts
        chartInstances.forEach(chart => {
            try {
                chart.destroy();
            } catch (e) {
                console.warn('Error destroying chart:', e);
            }
        });
        chartInstances = [];
        workloadEmployeeChartInstance = null;
        workloadTrendChartInstance = null;
    };

    /**
     * Populowanie selectora roku
     */
    const populateYearSelect = (): void => {
        if (!yearSelect) return;

        const currentYearNum = new Date().getUTCFullYear();
        yearSelect.innerHTML = '';

        for (let year = currentYearNum - 2; year <= currentYearNum + 1; year++) {
            const option = document.createElement('option');
            option.value = year.toString();
            option.textContent = year.toString();
            if (year === currentYear) {
                option.selected = true;
            }
            yearSelect.appendChild(option);
        }
    };

    /**
     * Setup event listeners
     */
    const setupEventListeners = (): void => {
        // Year selector
        yearSelect?.addEventListener('change', async (e) => {
            currentYear = parseInt((e.target as HTMLSelectElement).value);
            await loadAllData();
            updateAllStats();
        });

        // Tab buttons
        const tabButtons = document.querySelectorAll('.statistics-header-controls .tab-btn');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLButtonElement;

                // Update active tab
                tabButtons.forEach(b => b.classList.remove('active'));
                target.classList.add('active');

                // Show corresponding view
                const viewMap: Record<string, string> = {
                    overviewViewBtn: 'overviewView',
                    leavesStatsBtn: 'leavesStatsView',
                    scheduleStatsBtn: 'scheduleStatsView',
                    workloadStatsBtn: 'workloadStatsView',
                    employeeStatsBtn: 'employeeStatsView',
                };
                const viewId = viewMap[target.id];
                if (!viewId) return;

                const views = document.querySelectorAll('.stats-view');
                views.forEach(v => v.classList.remove('active'));
                const targetView = document.getElementById(viewId);
                if (targetView) {
                    targetView.classList.add('active');
                    refreshChartsAfterTabChange();
                }
            });
        });

        // Workload period buttons
        const periodBtns = document.querySelectorAll<HTMLButtonElement>('.workload-period-tabs .subtab-btn');
        periodBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLButtonElement;
                const period = target.dataset.period as 'weekly' | 'monthly' | 'yearly';
                if (!period) return;

                periodBtns.forEach(b => b.classList.remove('active'));
                target.classList.add('active');
                currentWorkloadPeriod = period;

                const weekGroup = document.getElementById('workloadWeekSelectGroup');
                const monthGroup = document.getElementById('workloadMonthSelectGroup');

                if (weekGroup) weekGroup.style.display = period === 'weekly' ? 'flex' : 'none';
                if (monthGroup) monthGroup.style.display = period === 'monthly' ? 'flex' : 'none';

                updateWorkloadStats();
                refreshChartsAfterTabChange();
            });
        });

        // Workload week select
        document.getElementById('workloadWeekSelect')?.addEventListener('change', (e) => {
            currentWorkloadWeek = (e.target as HTMLSelectElement).value;
            updateWorkloadStats();
            refreshChartsAfterTabChange();
        });

        // Workload month select
        document.getElementById('workloadMonthSelect')?.addEventListener('change', (e) => {
            currentWorkloadMonth = parseInt((e.target as HTMLSelectElement).value, 10);
            updateWorkloadStats();
            refreshChartsAfterTabChange();
        });

        // Workload employee select
        document.getElementById('workloadEmployeeSelect')?.addEventListener('change', (e) => {
            currentWorkloadEmployeeId = (e.target as HTMLSelectElement).value;
            updateWorkloadStats();
            refreshChartsAfterTabChange();
        });

        // Workload snapshot manual refresh
        document.getElementById('refreshWorkloadSnapshotBtn')?.addEventListener('click', async () => {
            const btn = document.getElementById('refreshWorkloadSnapshotBtn');
            if (btn) btn.classList.add('rotating');
            await syncWorkloadSnapshots();
            updateWorkloadStats();
            refreshChartsAfterTabChange();
            if (btn) btn.classList.remove('rotating');
            window.showToast?.('Zaktualizowano snapshot obciążenia z bieżącego grafiku.', 3000);
        });
    };

    const refreshChartsAfterTabChange = (): void => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                chartInstances.forEach(chart => {
                    try {
                        chart.resize();
                        chart.update();
                    } catch (error) {
                        console.warn('Error refreshing chart after tab change:', error);
                    }
                });
            });
        });
    };

    /**
     * Ładuje wszystkie dane
     */
    const loadAllData = async (): Promise<void> => {
        try {
            // Load leaves
            const leavesDoc = await db.collection(AppConfig.firestore.collections.leaves).doc(AppConfig.firestore.docs.mainLeaves).get();
            if (leavesDoc.exists) {
                leavesData = normalizeLeavesData(leavesDoc.data());
            } else {
                leavesData = {};
            }

            // Load schedule
            const scheduleDoc = await db.collection(AppConfig.firestore.collections.schedules).doc(AppConfig.firestore.docs.mainSchedule).get();
            if (scheduleDoc.exists) {
                scheduleData = scheduleDoc.data() as ScheduleAppState;
            } else {
                scheduleData = null;
            }

            void refreshWeeklyStatsData();
            void refreshWorkloadStatsData();
        } catch (error) {
            console.error('Error loading data:', error);
        }
    };

    const refreshWeeklyStatsData = async (): Promise<void> => {
        try {
            if (currentYear === getIsoWeekInfo().year) {
                await persistCurrentWeeklyStats();
            }

            await loadWeeklyStats();
            updateWeeklyAverageStats();

            if (typeof Chart !== 'undefined') {
                renderCharts();
                refreshChartsAfterTabChange();
            }
        } catch (error) {
            console.warn('Unable to refresh weekly statistics in background:', error);
        }
    };

    const refreshWorkloadStatsData = async (): Promise<void> => {
        try {
            await loadDailyStats();
            await syncWorkloadSnapshots();
            updateWorkloadSelectors();
            updateWorkloadStats();

            if (typeof Chart !== 'undefined') {
                renderWorkloadByEmployeeChart();
                renderWorkloadTrendChart();
                refreshChartsAfterTabChange();
            }
        } catch (error) {
            console.warn('Unable to refresh workload statistics in background:', error);
        }
    };

    /**
     * Stores a lightweight weekly aggregate without patient names.
     */
    const persistCurrentWeeklyStats = async (): Promise<void> => {
        if (!scheduleData?.scheduleCells) return;

        try {
            const employees = EmployeeManager.getAll();
            const snapshot = createWeeklyStatsSnapshot(scheduleData.scheduleCells, employees, leavesData);
            await db.collection<WeeklyStatsSnapshot>(WEEKLY_STATS_COLLECTION)
                .doc(snapshot.weekKey)
                .set(snapshot, { merge: true });
        } catch (error) {
            console.warn('Unable to persist weekly statistics snapshot:', error);
        }
    };

    /**
     * Loads saved weekly aggregates for the selected year.
     */
    const loadWeeklyStats = async (): Promise<void> => {
        try {
            const snapshot = await db.collection<WeeklyStatsSnapshot>(WEEKLY_STATS_COLLECTION).get();
            weeklyStatsData = snapshot.docs
                .map(doc => doc.data())
                .filter((stats): stats is WeeklyStatsSnapshot => !!stats && stats.year === currentYear);
        } catch (error) {
            console.warn('Unable to load weekly statistics snapshots:', error);
            weeklyStatsData = [];
        }
    };

    const loadDailyStats = async (): Promise<void> => {
        try {
            const cached = localStorage.getItem(WORKLOAD_STORAGE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached) as Record<string, DailyWorkloadSnapshot>;
                if (parsed && typeof parsed === 'object') {
                    dailySnapshotsData = { ...dailySnapshotsData, ...parsed };
                }
            }
        } catch {}

        try {
            const snapshot = await db.collection<DailyWorkloadSnapshot>(DAILY_STATS_COLLECTION).get();
            snapshot.docs.forEach(doc => {
                const data = doc.data();
                if (data && data.date) {
                    dailySnapshotsData[data.date] = data;
                }
            });
        } catch (error) {
            console.warn('Unable to load from statsDaily collection:', error);
        }

        try {
            weeklyStatsData.forEach((w: any) => {
                if (w.dailySnapshots && typeof w.dailySnapshots === 'object') {
                    Object.entries(w.dailySnapshots).forEach(([date, snap]) => {
                        if (snap && !dailySnapshotsData[date]) {
                            dailySnapshotsData[date] = snap as DailyWorkloadSnapshot;
                        }
                    });
                }
            });
        } catch {}
    };

    const syncWorkloadSnapshots = async (): Promise<void> => {
        if (!scheduleData?.scheduleCells) return;

        const employees = EmployeeManager.getAll();
        const now = new Date();
        const todayIso = now.toISOString().split('T')[0];

        dailySnapshotsData = backfillWorkloadSnapshots(
            scheduleData.scheduleCells,
            employees,
            leavesData,
            currentYear,
            dailySnapshotsData,
            now
        );

        const todaySnap = createDailyWorkloadSnapshot(scheduleData.scheduleCells, employees, leavesData, now);
        dailySnapshotsData[todayIso] = todaySnap;

        try {
            localStorage.setItem(WORKLOAD_STORAGE_KEY, JSON.stringify(dailySnapshotsData));
        } catch {}

        const badge = document.getElementById('workloadSnapshotDate');
        if (badge) {
            badge.textContent = `Snapshot: ${todayIso} (${todaySnap.totalPatients} pacj.)`;
        }

        try {
            await db.collection<DailyWorkloadSnapshot>(DAILY_STATS_COLLECTION)
                .doc(todayIso)
                .set(todaySnap, { merge: true });
        } catch (err) {
            console.warn('Unable to persist daily snapshot to Firestore statsDaily:', err);
        }

        try {
            const weekInfo = getIsoWeekInfo(now);
            await db.collection(WEEKLY_STATS_COLLECTION)
                .doc(weekInfo.weekKey)
                .set({
                    [`dailySnapshots.${todayIso}`]: todaySnap,
                } as any, { merge: true });
        } catch {}
    };

    const updateWorkloadSelectors = (): void => {
        populateWorkloadWeekSelect();
        populateWorkloadMonthSelect();
        populateWorkloadEmployeeSelect();
    };

    const populateWorkloadWeekSelect = (): void => {
        const select = document.getElementById('workloadWeekSelect') as HTMLSelectElement | null;
        if (!select) return;

        const currentWeekInfo = getIsoWeekInfo(new Date());
        if (!currentWorkloadWeek) {
            currentWorkloadWeek = currentYear === currentWeekInfo.year
                ? currentWeekInfo.weekKey
                : `${currentYear}-W01`;
        }

        select.innerHTML = '';
        const jan4 = new Date(Date.UTC(currentYear, 0, 4));
        const day = jan4.getUTCDay() || 7;
        const week1Start = new Date(jan4);
        week1Start.setUTCDate(jan4.getUTCDate() - day + 1);

        const weekOptions: Array<{ key: string; text: string }> = [];

        for (let w = 1; w <= 53; w++) {
            const start = new Date(week1Start);
            start.setUTCDate(week1Start.getUTCDate() + (w - 1) * 7);
            const end = new Date(start);
            end.setUTCDate(start.getUTCDate() + 4);

            if (start.getUTCFullYear() > currentYear && w > 50) break;

            const weekKey = `${currentYear}-W${String(w).padStart(2, '0')}`;
            const isCur = weekKey === currentWeekInfo.weekKey && currentYear === currentWeekInfo.year;
            const startFormatted = `${String(start.getUTCDate()).padStart(2, '0')}.${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
            const endFormatted = `${String(end.getUTCDate()).padStart(2, '0')}.${String(end.getUTCMonth() + 1).padStart(2, '0')}`;

            weekOptions.push({
                key: weekKey,
                text: `Tydzień ${w} (${startFormatted} - ${endFormatted})${isCur ? ' - Bieżący' : ''}`,
            });
        }

        weekOptions.reverse().forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.key;
            option.textContent = opt.text;
            if (opt.key === currentWorkloadWeek) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    };

    const populateWorkloadMonthSelect = (): void => {
        const select = document.getElementById('workloadMonthSelect') as HTMLSelectElement | null;
        if (!select) return;

        const currentMonthNum = new Date().getUTCMonth() + 1;
        const monthNames = [
            'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
            'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
        ];

        select.innerHTML = '';
        monthNames.forEach((name, index) => {
            const monthNum = index + 1;
            const option = document.createElement('option');
            option.value = String(monthNum);
            const isCur = monthNum === currentMonthNum && currentYear === new Date().getUTCFullYear();
            option.textContent = `${name}${isCur ? ' (Bieżący)' : ''}`;
            if (monthNum === currentWorkloadMonth) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    };

    const populateWorkloadEmployeeSelect = (): void => {
        const select = document.getElementById('workloadEmployeeSelect') as HTMLSelectElement | null;
        if (!select) return;

        const employees = EmployeeManager.getAll();
        const activeIds = getActiveEmployeeIds(employees);

        select.innerHTML = '<option value="all">Wszyscy pracownicy</option>';
        activeIds.forEach(id => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = EmployeeManager.getNameById(id);
            if (id === currentWorkloadEmployeeId) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    };

    /**
     * Aktualizuje wszystkie statystyki
     */
    const updateAllStats = (): void => {
        const updates = [
            updateOverviewStats,
            updateLeavesStats,
            updateScheduleStats,
            updateWorkloadStats,
            updateEmployeeStats,
            renderCharts,
        ];

        updates.forEach(update => {
            try {
                update();
            } catch (error) {
                console.error('Error updating statistics section:', error);
            }
        });
    };

    /**
     * Oblicza liczbę dni roboczych w przedziale dat
     */
    const calculateWorkdays = (startDate: string, endDate: string): number => {
        const start = new Date(startDate);
        const end = new Date(endDate);
        let count = 0;

        const current = new Date(start);
        while (current <= end) {
            const day = current.getDay();
            if (day !== 0 && day !== 6) { // Not weekend
                count++;
            }
            current.setDate(current.getDate() + 1);
        }

        return count;
    };

    const getCurrentScheduleMetrics = (): ScheduleMetrics => {
        const employees = EmployeeManager.getAll();
        return calculateScheduleMetrics(scheduleData?.scheduleCells, getActiveEmployeeIds(employees));
    };

    const getDateDiffInDays = (dateIso: string): number => {
        const target = new Date(`${dateIso}T12:00:00Z`);
        const now = new Date();
        const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12));
        return Math.round((target.getTime() - today.getTime()) / 86400000);
    };

    const normalizePatientName = (patientName: string): string => patientName.trim().toLocaleLowerCase('pl-PL');

    const createEntry = (
        patientName: string | null | undefined,
        employeeName: string,
        time: string,
        treatmentData?: TreatmentData | null,
        fallbackStartDate?: string | null,
        fallbackEndDate?: string | null,
        fallbackExtensionDays?: number | null
    ): PatientScheduleEntry | null => {
        if (!patientName || !patientName.trim()) return null;

        return {
            patientName: patientName.trim(),
            normalizedName: normalizePatientName(patientName),
            employeeName,
            time,
            startDate: treatmentData?.startDate ?? fallbackStartDate,
            endDate: treatmentData?.endDate ?? fallbackEndDate,
            extensionDays: treatmentData?.extensionDays ?? fallbackExtensionDays,
        };
    };

    const getCurrentPatientEntries = (): PatientScheduleEntry[] => {
        if (!scheduleData?.scheduleCells) return [];

        const employees = EmployeeManager.getAll();
        const activeEmployeeIds = getActiveEmployeeIds(employees);
        const entries: PatientScheduleEntry[] = [];

        for (const [time, row] of Object.entries(scheduleData.scheduleCells)) {
            activeEmployeeIds.forEach(employeeId => {
                const cell = row?.[employeeId] as CellState | undefined;
                if (!cell || cell.isBreak) return;

                const employeeName = EmployeeManager.getNameById(employeeId);

                if (cell.isSplit) {
                    if (!cell.isHydrotherapy1) {
                        const entry = createEntry(cell.content1, employeeName, time, cell.treatmentData1);
                        if (entry) entries.push(entry);
                    }
                    if (!cell.isHydrotherapy2) {
                        const entry = createEntry(cell.content2, employeeName, time, cell.treatmentData2);
                        if (entry) entries.push(entry);
                    }
                    return;
                }

                if (cell.isHydrotherapy) return;
                const entry = createEntry(
                    cell.content,
                    employeeName,
                    time,
                    null,
                    cell.treatmentStartDate,
                    cell.treatmentEndDate,
                    cell.treatmentExtensionDays
                );
                if (entry) entries.push(entry);
            });
        }

        return entries;
    };

    const getTreatmentAlerts = (): TreatmentAlert[] => {
        const entries = getCurrentPatientEntries();
        const nameCounts = new Map<string, number>();
        entries.forEach(entry => {
            nameCounts.set(entry.normalizedName, (nameCounts.get(entry.normalizedName) || 0) + 1);
        });

        const alerts: TreatmentAlert[] = [];

        entries.forEach(entry => {
            if (!entry.startDate || !entry.endDate) {
                alerts.push({
                    priority: 2,
                    priorityLabel: 'Wysoki',
                    patientName: entry.patientName,
                    employeeName: entry.employeeName,
                    time: entry.time,
                    reason: 'Brak daty startu lub końca turnusu',
                    endDate: entry.endDate || '-',
                });
            } else {
                const diffDays = getDateDiffInDays(entry.endDate);
                if (diffDays < 0) {
                    alerts.push({
                        priority: 1,
                        priorityLabel: 'Pilny',
                        patientName: entry.patientName,
                        employeeName: entry.employeeName,
                        time: entry.time,
                        reason: `Turnus po terminie o ${Math.abs(diffDays)} dni`,
                        endDate: entry.endDate,
                    });
                } else if (diffDays === 0) {
                    alerts.push({
                        priority: 2,
                        priorityLabel: 'Wysoki',
                        patientName: entry.patientName,
                        employeeName: entry.employeeName,
                        time: entry.time,
                        reason: 'Turnus kończy się dzisiaj',
                        endDate: entry.endDate,
                    });
                } else if (diffDays <= 3) {
                    alerts.push({
                        priority: 3,
                        priorityLabel: 'Uwaga',
                        patientName: entry.patientName,
                        employeeName: entry.employeeName,
                        time: entry.time,
                        reason: `Turnus kończy się za ${diffDays} dni`,
                        endDate: entry.endDate,
                    });
                }
            }

            if ((nameCounts.get(entry.normalizedName) || 0) > 1) {
                alerts.push({
                    priority: 4,
                    priorityLabel: 'Duplikat',
                    patientName: entry.patientName,
                    employeeName: entry.employeeName,
                    time: entry.time,
                    reason: 'Pacjent występuje w grafiku więcej niż raz',
                    endDate: entry.endDate || '-',
                });
            }
        });

        return alerts
            .sort((a, b) => a.priority - b.priority || a.time.localeCompare(b.time))
            .slice(0, 20);
    };

    /**
     * Oblicza statystyki urlopów wg typu
     */
    const calculateLeaveStatsByType = (): Record<string, number> => {
        const stats: Record<string, number> = {};
        Object.keys(LEAVE_TYPES).forEach(type => stats[type] = 0);

        for (const employeeName of Object.keys(leavesData)) {
            const leaves = leavesData[employeeName] || [];
            for (const leave of leaves) {
                // Only count leaves that overlap with current year
                const startYear = new Date(leave.startDate).getFullYear();
                const endYear = new Date(leave.endDate).getFullYear();

                if (startYear <= currentYear && endYear >= currentYear) {
                    const leaveType = leave.type || 'vacation';
                    const days = calculateWorkdays(leave.startDate, leave.endDate);
                    if (stats[leaveType] !== undefined) {
                        stats[leaveType] += days;
                    } else {
                        stats['vacation'] += days;
                    }
                }
            }
        }

        return stats;
    };

    /**
     * Oblicza miesięczne statystyki urlopów
     */
    const calculateMonthlyLeaves = (): number[] => {
        const monthlyData = Array(12).fill(0);

        for (const employeeName of Object.keys(leavesData)) {
            const leaves = leavesData[employeeName] || [];
            for (const leave of leaves) {
                const startDate = new Date(leave.startDate);
                const endDate = new Date(leave.endDate);

                // Iterate through each day
                const current = new Date(startDate);
                while (current <= endDate) {
                    if (current.getFullYear() === currentYear) {
                        const day = current.getDay();
                        if (day !== 0 && day !== 6) { // workday
                            monthlyData[current.getMonth()]++;
                        }
                    }
                    current.setDate(current.getDate() + 1);
                }
            }
        }

        return monthlyData;
    };

    /**
     * Sprawdza ile osób jest na urlopie dzisiaj
     */
    const countOnLeaveToday = (): number => {
        const today = new Date().toISOString().split('T')[0];
        let count = 0;

        for (const employeeName of Object.keys(leavesData)) {
            const leaves = leavesData[employeeName] || [];
            for (const leave of leaves) {
                if (leave.startDate <= today && leave.endDate >= today) {
                    count++;
                    break; // Count each employee only once
                }
            }
        }

        return count;
    };

    /**
     * Aktualizuje statystyki przeglądu
     */
    const updateOverviewStats = (): void => {
        const employees = EmployeeManager.getAll();
        const activeEmployees = Object.values(employees).filter(e => !e.isHidden);

        // Total employees
        const totalEmployeesEl = document.getElementById('totalEmployeesValue');
        if (totalEmployeesEl) {
            totalEmployeesEl.textContent = String(activeEmployees.length);
        }

        // Total patients today
        const totalPatientsEl = document.getElementById('totalPatientsValue');
        if (totalPatientsEl) {
            totalPatientsEl.textContent = String(getCurrentScheduleMetrics().totalSlots);
        }

        // On leave today
        const onLeaveEl = document.getElementById('onLeaveValue');
        if (onLeaveEl) {
            onLeaveEl.textContent = String(countOnLeaveToday());
        }

        // Total leave days this year
        const leaveStats = calculateLeaveStatsByType();
        const totalLeaveDays = Object.values(leaveStats).reduce((a, b) => a + b, 0);
        const totalLeaveDaysEl = document.getElementById('totalLeaveDaysValue');
        if (totalLeaveDaysEl) {
            totalLeaveDaysEl.textContent = String(totalLeaveDays);
        }
    };

    /**
     * Aktualizuje statystyki urlopów
     */
    const updateLeavesStats = (): void => {
        const leaveStats = calculateLeaveStatsByType();

        // Update cards
        const vacationEl = document.getElementById('vacationDaysValue');
        if (vacationEl) vacationEl.textContent = String(leaveStats['vacation'] || 0);

        const childCareEl = document.getElementById('childCareDaysValue');
        if (childCareEl) childCareEl.textContent = String(leaveStats['child_care_art_188'] || 0);

        const sickChildEl = document.getElementById('sickChildCareDaysValue');
        if (sickChildEl) sickChildEl.textContent = String(leaveStats['sick_child_care'] || 0);

        const familyCareEl = document.getElementById('familyCareDaysValue');
        if (familyCareEl) familyCareEl.textContent = String(leaveStats['family_member_care'] || 0);

        // Update detailed table
        updateLeavesDetailsTable();
    };

    /**
     * Aktualizuje tabelę szczegółów urlopów
     */
    const updateLeavesDetailsTable = (): void => {
        const tbody = document.getElementById('leavesDetailsBody');
        if (!tbody) return;

        const employees = EmployeeManager.getAll();
        tbody.innerHTML = '';

        for (const [employeeId, employee] of Object.entries(employees)) {
            if (employee.isHidden || employee.isScheduleOnly) continue;

            const employeeName = EmployeeManager.getNameById(employeeId);
            const leaves = leavesData[employeeName] || [];

            // Calculate days by type
            const daysByType: Record<string, number> = {};
            Object.keys(LEAVE_TYPES).forEach(type => daysByType[type] = 0);

            for (const leave of leaves) {
                const startYear = new Date(leave.startDate).getFullYear();
                const endYear = new Date(leave.endDate).getFullYear();

                if (startYear <= currentYear && endYear >= currentYear) {
                    const leaveType = leave.type || 'vacation';
                    const days = calculateWorkdays(leave.startDate, leave.endDate);
                    if (daysByType[leaveType] !== undefined) {
                        daysByType[leaveType] += days;
                    } else {
                        daysByType['vacation'] += days;
                    }
                }
            }

            const total = Object.values(daysByType).reduce((a, b) => a + b, 0);

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <div class="employee-name-cell">
                        <span class="employee-color-dot" style="background-color: ${employee.color}"></span>
                        ${employeeName}
                    </div>
                </td>
                <td>${daysByType['vacation']}</td>
                <td>${daysByType['child_care_art_188']}</td>
                <td>${daysByType['sick_child_care']}</td>
                <td>${daysByType['family_member_care']}</td>
                <td>${daysByType['schedule_pickup']}</td>
                <td><strong>${total}</strong></td>
            `;
            tbody.appendChild(row);
        }
    };

    /**
     * Aktualizuje statystyki grafiku
     */
    const updateScheduleStats = (): void => {
        const weeklyValueIds = [
            'weeklyAverageSlotsValue',
            'weeklyAveragePerEmployeeValue',
            'weeklyAvailabilityValue',
            'weeklyTrendValue',
        ];
        const treatmentValueIds = [
            'overdueTreatmentsValue',
            'endingTodayValue',
            'endingSoonValue',
            'extendedTreatmentsValue',
            'missingTreatmentDatesValue',
            'duplicatePatientsValue',
            'handoverMorningValue',
            'handoverAfternoonValue',
            'dataQualityScoreValue',
        ];

        if (!scheduleData?.scheduleCells) {
            const defaultValue = '-';
            ['uniquePatientsValue', 'totalSlotsValue', 'breaksValue', 'treatmentTypesValue', ...weeklyValueIds, ...treatmentValueIds].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = defaultValue;
            });
            updateTreatmentAlertsTable([]);
            return;
        }

        const metrics = getCurrentScheduleMetrics();

        const uniquePatientsEl = document.getElementById('uniquePatientsValue');
        if (uniquePatientsEl) uniquePatientsEl.textContent = String(metrics.uniquePatients);

        const totalSlotsEl = document.getElementById('totalSlotsValue');
        if (totalSlotsEl) totalSlotsEl.textContent = String(metrics.totalSlots);

        const breaksEl = document.getElementById('breaksValue');
        if (breaksEl) breaksEl.textContent = String(metrics.breaks);

        const treatmentTypesEl = document.getElementById('treatmentTypesValue');
        if (treatmentTypesEl) treatmentTypesEl.textContent = String(metrics.massageOrPnf);

        const operationalValues: Record<string, number> = {
            overdueTreatmentsValue: metrics.overdue,
            endingTodayValue: metrics.endingToday,
            endingSoonValue: metrics.endingSoon,
            extendedTreatmentsValue: metrics.extendedTreatments,
            missingTreatmentDatesValue: metrics.missingTreatmentDates,
            duplicatePatientsValue: metrics.duplicatePatientEntries,
            handoverMorningValue: metrics.handoverMorning,
            handoverAfternoonValue: metrics.handoverAfternoon,
            dataQualityScoreValue: metrics.dataQualityScore,
        };
        Object.entries(operationalValues).forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = id === 'dataQualityScoreValue' ? `${value}%` : String(value);
        });

        updateTreatmentAlertsTable(getTreatmentAlerts());

        updateWeeklyAverageStats();
    };

    const updateTreatmentAlertsTable = (alerts: TreatmentAlert[]): void => {
        const tbody = document.getElementById('treatmentAlertsBody');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (alerts.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = '<td colspan="6" class="no-data-cell">Brak pilnych alertów turnusów.</td>';
            tbody.appendChild(row);
            return;
        }

        alerts.forEach(alert => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><span class="status-badge ${alert.priority <= 2 ? 'on-leave' : alert.priority === 3 ? 'hidden' : 'active'}">${alert.priorityLabel}</span></td>
                <td>${alert.patientName}</td>
                <td>${alert.employeeName}</td>
                <td>${alert.time}</td>
                <td>${alert.reason}</td>
                <td>${alert.endDate}</td>
            `;
            tbody.appendChild(row);
        });
    };

    const updateWeeklyAverageStats = (): void => {
        const weeklyAverages = calculateWeeklyAverages(weeklyStatsData);

        const weeklyAverageSlotsEl = document.getElementById('weeklyAverageSlotsValue');
        if (weeklyAverageSlotsEl) weeklyAverageSlotsEl.textContent = String(weeklyAverages.averageTotalSlots);

        const weeklyAveragePerEmployeeEl = document.getElementById('weeklyAveragePerEmployeeValue');
        if (weeklyAveragePerEmployeeEl) weeklyAveragePerEmployeeEl.textContent = String(weeklyAverages.averagePatientsPerAvailableEmployee);

        const weeklyAvailabilityEl = document.getElementById('weeklyAvailabilityValue');
        if (weeklyAvailabilityEl) weeklyAvailabilityEl.textContent = String(weeklyAverages.averageAvailableEmployees);

        const weeklyTrendEl = document.getElementById('weeklyTrendValue');
        if (weeklyTrendEl) {
            weeklyTrendEl.textContent = weeklyAverages.trendPercent === null
                ? '-'
                : `${weeklyAverages.trendPercent > 0 ? '+' : ''}${weeklyAverages.trendPercent}%`;
        }

        const rangeEl = document.getElementById('weeklyStatsRange');
        if (rangeEl) {
            rangeEl.textContent = weeklyAverages.weeks.length > 0
                ? `Na podstawie ${weeklyAverages.weeks.length} zapisanych tygodni. Aktualny tydzień zapisuje się automatycznie po wejściu w statystyki.`
                : 'Brak zapisanych agregatów tygodniowych dla wybranego roku.';
        }

        updateWeeklyAvailabilityTable(weeklyAverages.weeks);
    };

    const updateWeeklyAvailabilityTable = (weeks: WeeklyStatsSnapshot[]): void => {
        const tbody = document.getElementById('weeklyAvailabilityBody');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (weeks.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = '<td colspan="7" class="no-data-cell">Brak danych tygodniowych.</td>';
            tbody.appendChild(row);
            return;
        }

        weeks.forEach(week => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${week.weekKey}</td>
                <td>${week.scheduleMetrics.totalSlots}</td>
                <td>${week.scheduleMetrics.uniquePatients}</td>
                <td>${week.averageAvailableEmployees}</td>
                <td>${week.leaveDays}</td>
                <td><strong>${week.averagePatientsPerAvailableEmployee}</strong></td>
                <td>${week.scheduleMetrics.occupancyPercent}%</td>
            `;
            tbody.appendChild(row);
        });
    };

    const getShiftBadgeHtml = (shiftGroup?: 'first' | 'second' | string | null): string => {
        if (shiftGroup === 'first') {
            return '<span class="shift-badge first"><i class="fas fa-sun"></i> I Zmiana</span>';
        } else if (shiftGroup === 'second') {
            return '<span class="shift-badge second"><i class="fas fa-moon"></i> II Zmiana</span>';
        }
        return '<span class="shift-badge none">-</span>';
    };

    /**
     * Renderuje tabelę ze szczegółowym obciążeniem pracowników w danym okresie
     */
    const renderWorkloadTable = (
        averages: PeriodWorkloadAverages,
        displayedEmployees: EmployeePeriodWorkloadSummary[]
    ): void => {
        const thead = document.getElementById('workloadDetailsHead');
        const tbody = document.getElementById('workloadDetailsBody');
        if (!thead || !tbody) return;

        thead.innerHTML = `
            <tr>
                <th>Pracownik</th>
                <th>Zmiana</th>
                <th>Dni obecności</th>
                <th>Dni urlopu</th>
                <th>Wpisy pacjentów</th>
                <th>Śr. / dzień obecności</th>
                <th>Śr. / tydzień</th>
                <th>Obłożenie slotów</th>
            </tr>
        `;

        tbody.innerHTML = '';

        if (displayedEmployees.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = '<td colspan="8" class="no-data-cell">Brak danych obciążenia dla wybranego okresu i filtrów.</td>';
            tbody.appendChild(emptyRow);
            return;
        }

        displayedEmployees.forEach(emp => {
            const row = document.createElement('tr');

            const leaveBadge = emp.daysOnLeave > 0
                ? `<span class="status-badge on-leave"><i class="fas fa-plane"></i> ${emp.daysOnLeave} dni</span>`
                : '<span class="text-muted">-</span>';

            const occupancyClass = emp.occupancyPercent >= 80 ? 'good' : (emp.occupancyPercent >= 50 ? 'medium' : 'low');

            row.innerHTML = `
                <td>
                    <div class="employee-name-cell">
                        <span class="employee-color-dot" style="background-color: ${emp.color}"></span>
                        <strong>${emp.employeeName}</strong>
                    </div>
                </td>
                <td>${getShiftBadgeHtml(emp.shiftGroup)}</td>
                <td><strong>${emp.daysPresent}</strong> / ${emp.workdaysInPeriod}</td>
                <td>${leaveBadge}</td>
                <td>${emp.totalPatients}</td>
                <td><strong class="workload-highlight">${emp.averagePatientsPerPresentDay}</strong></td>
                <td>${emp.averagePatientsPerWeek}</td>
                <td>
                    <div class="leave-progress">
                        <span class="progress-text">${emp.occupancyPercent}%</span>
                        <div class="progress-bar">
                            <div class="progress-fill ${occupancyClass}" style="width: ${Math.min(100, emp.occupancyPercent)}%"></div>
                        </div>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });

        // Wiersz podsumowania zespołu, jeśli wyświetlono więcej niż jednego pracownika
        if (displayedEmployees.length > 1) {
            const summaryRow = document.createElement('tr');
            summaryRow.className = 'workload-summary-row';
            const totalLeaves = displayedEmployees.reduce((acc, e) => acc + e.daysOnLeave, 0);
            summaryRow.innerHTML = `
                <td><strong>Średnia / Łącznie zespołu</strong></td>
                <td>-</td>
                <td>-</td>
                <td>${totalLeaves > 0 ? `<strong>${totalLeaves} dni</strong>` : '-'}</td>
                <td><strong>${averages.totalPatientCount}</strong></td>
                <td><strong class="workload-highlight">${averages.averageDailyPerPresentEmployee}</strong></td>
                <td><strong>${averages.averageWeeklyPerEmployee}</strong></td>
                <td><strong>${averages.averageOccupancyPercent}%</strong></td>
            `;
            tbody.appendChild(summaryRow);
        }
    };

    /**
     * Aktualizuje widok średniego obciążenia pracownika (KPI, tabela, wykresy)
     */
    const updateWorkloadStats = (): void => {
        const employees = EmployeeManager.getAll();
        const snapshotsList = Object.values(dailySnapshotsData);

        const averages = calculatePeriodWorkloadAverages(
            snapshotsList,
            currentWorkloadPeriod,
            {
                weekKey: currentWorkloadWeek,
                month: currentWorkloadMonth,
                year: currentYear,
                employees,
            }
        );

        const displayedEmployees = currentWorkloadEmployeeId === 'all'
            ? averages.employees
            : averages.employees.filter(e => e.employeeId === currentWorkloadEmployeeId);

        const selectedEmployee = currentWorkloadEmployeeId !== 'all'
            ? averages.employees.find(e => e.employeeId === currentWorkloadEmployeeId) || null
            : null;

        // Karty wskaźników KPI
        const avgDailyEl = document.getElementById('workloadAvgDailyValue');
        if (avgDailyEl) {
            avgDailyEl.textContent = selectedEmployee
                ? String(selectedEmployee.averagePatientsPerPresentDay)
                : String(averages.averageDailyPerPresentEmployee);
        }

        const avgWeeklyEl = document.getElementById('workloadAvgWeeklyValue');
        if (avgWeeklyEl) {
            avgWeeklyEl.textContent = selectedEmployee
                ? String(selectedEmployee.averagePatientsPerWeek)
                : String(averages.averageWeeklyPerEmployee);
        }

        const occupancyEl = document.getElementById('workloadOccupancyValue');
        if (occupancyEl) {
            occupancyEl.textContent = selectedEmployee
                ? `${selectedEmployee.occupancyPercent}%`
                : `${averages.averageOccupancyPercent}%`;
        }

        const totalPatientsEl = document.getElementById('workloadTotalPatientsValue');
        if (totalPatientsEl) {
            totalPatientsEl.textContent = selectedEmployee
                ? String(selectedEmployee.totalPatients)
                : String(averages.totalPatientCount);
        }

        // Podtytuł okresu
        const subtitleEl = document.getElementById('workloadPeriodSubtitle');
        if (subtitleEl) {
            const empLabel = selectedEmployee ? ` | Pracownik: ${selectedEmployee.employeeName}` : ' | Wszyscy pracownicy';
            subtitleEl.textContent = `Okres: ${averages.periodLabel} (${averages.workdaysCount} dni roboczych w okresie)${empLabel}`;
        }

        // Tabela szczegółowa
        renderWorkloadTable(averages, displayedEmployees);

        // Wykresy (jeśli Chart.js dostępny)
        if (typeof Chart !== 'undefined') {
            renderWorkloadByEmployeeChart();
            renderWorkloadTrendChart();
        }
    };

    /**
     * Renderuje wykres średniego obciążenia wg pracownika
     */
    const renderWorkloadByEmployeeChart = (): void => {
        const ctx = document.getElementById('workloadByEmployeeChart') as HTMLCanvasElement | null;
        if (!ctx) return;

        if (workloadEmployeeChartInstance) {
            try {
                workloadEmployeeChartInstance.destroy();
            } catch {}
            chartInstances = chartInstances.filter(c => c !== workloadEmployeeChartInstance);
            workloadEmployeeChartInstance = null;
        }

        const employees = EmployeeManager.getAll();
        const snapshotsList = Object.values(dailySnapshotsData);
        const averages = calculatePeriodWorkloadAverages(
            snapshotsList,
            currentWorkloadPeriod,
            {
                weekKey: currentWorkloadWeek,
                month: currentWorkloadMonth,
                year: currentYear,
                employees,
            }
        );

        const displayedEmployees = currentWorkloadEmployeeId === 'all'
            ? averages.employees
            : averages.employees.filter(e => e.employeeId === currentWorkloadEmployeeId);

        let labels: string[] = [];
        let data: number[] = [];
        let backgroundColors: string[] = [];
        let borderColors: string[] = [];

        if (currentWorkloadEmployeeId === 'all') {
            labels = displayedEmployees.map(e => e.employeeName);
            data = displayedEmployees.map(e => e.averagePatientsPerPresentDay);
            backgroundColors = displayedEmployees.map(e => `${e.color}CC`);
            borderColors = displayedEmployees.map(e => e.color);
        } else {
            const selected = displayedEmployees[0];
            if (selected) {
                labels = [selected.employeeName, 'Średnia zespołu'];
                data = [selected.averagePatientsPerPresentDay, averages.averageDailyPerPresentEmployee];
                backgroundColors = [`${selected.color}CC`, 'rgba(99, 102, 241, 0.7)'];
                borderColors = [selected.color, '#6366f1'];
            }
        }

        const chart = new Chart(ctx.getContext('2d')!, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Śr. pacjentów / dzień obecności',
                    data,
                    backgroundColor: backgroundColors,
                    borderColor: borderColors,
                    borderWidth: 1,
                    borderRadius: 6,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: currentWorkloadEmployeeId === 'all' ? 'y' : 'x',
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: '#f1f5f9' }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { display: false }
                    }
                }
            }
        });

        workloadEmployeeChartInstance = chart;
        chartInstances.push(chart);
    };

    /**
     * Renderuje wykres trendu obciążenia w czasie (tydzień/miesiąc/rok)
     */
    const renderWorkloadTrendChart = (): void => {
        const ctx = document.getElementById('workloadTrendChart') as HTMLCanvasElement | null;
        if (!ctx) return;

        if (workloadTrendChartInstance) {
            try {
                workloadTrendChartInstance.destroy();
            } catch {}
            chartInstances = chartInstances.filter(c => c !== workloadTrendChartInstance);
            workloadTrendChartInstance = null;
        }

        const titleEl = document.getElementById('workloadTrendChartTitle');
        const employees = EmployeeManager.getAll();
        const snapshotsList = Object.values(dailySnapshotsData);
        const averages = calculatePeriodWorkloadAverages(
            snapshotsList,
            currentWorkloadPeriod,
            {
                weekKey: currentWorkloadWeek,
                month: currentWorkloadMonth,
                year: currentYear,
                employees,
            }
        );

        let labels: string[] = [];
        let datasetValues: number[] = [];
        let chartLabel = 'Pacjenci';

        if (currentWorkloadPeriod === 'weekly') {
            if (titleEl) {
                titleEl.innerHTML = `<i class="fas fa-chart-line"></i> Dzienny rozkład w tygodniu (${averages.periodKey})`;
            }
            const weekSnapshots = snapshotsList
                .filter(s => s.isWorkday && s.weekKey === averages.periodKey)
                .sort((a, b) => a.date.localeCompare(b.date));

            const dayNames = ['Ndz', 'Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob'];
            labels = weekSnapshots.map(s => {
                const parts = s.date.split('-');
                const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
                return `${dayNames[d.getUTCDay()]} (${parts[2]}.${parts[1]})`;
            });

            if (currentWorkloadEmployeeId === 'all') {
                datasetValues = weekSnapshots.map(s => s.totalPatients);
                chartLabel = 'Wszyscy pacjenci w klinice';
            } else {
                const emp = employees[currentWorkloadEmployeeId];
                const empName = emp ? (emp.name || currentWorkloadEmployeeId) : currentWorkloadEmployeeId;
                chartLabel = `Pacjenci (${empName})`;
                datasetValues = weekSnapshots.map(s => s.employees[currentWorkloadEmployeeId]?.patientSlots || 0);
            }
        } else if (currentWorkloadPeriod === 'monthly') {
            if (titleEl) {
                titleEl.innerHTML = `<i class="fas fa-chart-line"></i> Dni robocze w miesiącu (${averages.periodLabel})`;
            }
            const monthSnapshots = snapshotsList
                .filter(s => s.isWorkday && s.year === currentYear && s.month === currentWorkloadMonth)
                .sort((a, b) => a.date.localeCompare(b.date));

            labels = monthSnapshots.map(s => s.date.split('-')[2]);

            if (currentWorkloadEmployeeId === 'all') {
                datasetValues = monthSnapshots.map(s => s.totalPatients);
                chartLabel = 'Pacjenci w klinice';
            } else {
                const emp = employees[currentWorkloadEmployeeId];
                const empName = emp ? (emp.name || currentWorkloadEmployeeId) : currentWorkloadEmployeeId;
                chartLabel = `Pacjenci (${empName})`;
                datasetValues = monthSnapshots.map(s => s.employees[currentWorkloadEmployeeId]?.patientSlots || 0);
            }
        } else {
            // Yearly
            if (titleEl) {
                titleEl.innerHTML = `<i class="fas fa-chart-line"></i> Średnie dzienne obciążenie w miesiącach (${currentYear})`;
            }
            const monthNames = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];
            labels = monthNames;

            datasetValues = monthNames.map((_, idx) => {
                const m = idx + 1;
                const mSnapshots = snapshotsList.filter(s => s.isWorkday && s.year === currentYear && s.month === m);
                if (mSnapshots.length === 0) return 0;

                if (currentWorkloadEmployeeId === 'all') {
                    let totalPatients = 0;
                    let totalPresent = 0;
                    mSnapshots.forEach(s => {
                        Object.values(s.employees).forEach(emp => {
                            if (!emp.isOnLeave) {
                                totalPresent++;
                                totalPatients += emp.patientSlots;
                            }
                        });
                    });
                    return totalPresent > 0 ? Math.round((totalPatients / totalPresent) * 10) / 10 : 0;
                } else {
                    let totalPatients = 0;
                    let totalPresent = 0;
                    mSnapshots.forEach(s => {
                        const emp = s.employees[currentWorkloadEmployeeId];
                        if (emp && !emp.isOnLeave) {
                            totalPresent++;
                            totalPatients += emp.patientSlots;
                        }
                    });
                    return totalPresent > 0 ? Math.round((totalPatients / totalPresent) * 10) / 10 : 0;
                }
            });

            chartLabel = currentWorkloadEmployeeId === 'all'
                ? 'Śr. pacjentów / dzień obecności pracownika'
                : 'Śr. pacjentów / dzień obecności';
        }

        const chart = new Chart(ctx.getContext('2d')!, {
            type: currentWorkloadPeriod === 'yearly' ? 'line' : 'bar',
            data: {
                labels,
                datasets: [{
                    label: chartLabel,
                    data: datasetValues,
                    backgroundColor: currentWorkloadPeriod === 'yearly'
                        ? 'rgba(16, 185, 129, 0.15)'
                        : 'rgba(59, 130, 246, 0.65)',
                    borderColor: currentWorkloadPeriod === 'yearly' ? '#10b981' : '#3b82f6',
                    borderWidth: 2,
                    borderRadius: currentWorkloadPeriod === 'yearly' ? 0 : 6,
                    tension: currentWorkloadPeriod === 'yearly' ? 0.3 : 0,
                    fill: currentWorkloadPeriod === 'yearly',
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { font: { size: 11 }, usePointStyle: true }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: '#f1f5f9' }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });

        workloadTrendChartInstance = chart;
        chartInstances.push(chart);
    };

    /**
     * Aktualizuje statystyki pracowników
     */
    const updateEmployeeStats = (): void => {
        const employees = EmployeeManager.getAll();
        const allEmployees = Object.values(employees);

        const active = allEmployees.filter(e => !e.isHidden && !e.isScheduleOnly);
        const hidden = allEmployees.filter(e => e.isHidden);
        const firstShift = allEmployees.filter(e => e.shiftGroup === 'first');
        const secondShift = allEmployees.filter(e => e.shiftGroup === 'second');

        const activeEl = document.getElementById('activeEmployeesValue');
        if (activeEl) activeEl.textContent = String(active.length);

        const hiddenEl = document.getElementById('hiddenEmployeesValue');
        if (hiddenEl) hiddenEl.textContent = String(hidden.length);

        const firstShiftEl = document.getElementById('firstShiftValue');
        if (firstShiftEl) firstShiftEl.textContent = String(firstShift.length);

        const secondShiftEl = document.getElementById('secondShiftValue');
        if (secondShiftEl) secondShiftEl.textContent = String(secondShift.length);

        // Update employees table
        updateEmployeesTable();
    };

    /**
     * Aktualizuje tabelę pracowników
     */
    const updateEmployeesTable = (): void => {
        const tbody = document.getElementById('employeesTableBody');
        if (!tbody) return;

        const employees = EmployeeManager.getAll();
        const today = new Date().toISOString().split('T')[0];
        tbody.innerHTML = '';

        for (const [employeeId, employee] of Object.entries(employees)) {
            if (employee.isScheduleOnly) continue;

            const employeeName = EmployeeManager.getNameById(employeeId);

            // Check if on leave
            const leaves = leavesData[employeeName] || [];
            const isOnLeave = leaves.some(l => l.startDate <= today && l.endDate >= today);

            // Calculate used leave days
            let usedDays = 0;
            for (const leave of leaves) {
                if (leave.type === 'vacation' || !leave.type) {
                    const startYear = new Date(leave.startDate).getFullYear();
                    const endYear = new Date(leave.endDate).getFullYear();
                    if (startYear <= currentYear && endYear >= currentYear) {
                        usedDays += calculateWorkdays(leave.startDate, leave.endDate);
                    }
                }
            }

            const entitlement = employee.leaveEntitlement || 26;
            const carriedOver = employee.carriedOverLeaveByYear?.[String(currentYear)] || employee.carriedOverLeave || 0;
            const totalEntitlement = entitlement + carriedOver;
            const remaining = totalEntitlement - usedDays;
            const remainingPercent = Math.max(0, Math.min(100, (remaining / totalEntitlement) * 100));

            const shiftBadge = getShiftBadgeHtml(employee.shiftGroup);

            let statusBadge = '';
            if (isOnLeave) {
                statusBadge = '<span class="status-badge on-leave"><i class="fas fa-plane"></i> Na urlopie</span>';
            } else if (employee.isHidden) {
                statusBadge = '<span class="status-badge hidden"><i class="fas fa-eye-slash"></i> Ukryty</span>';
            } else {
                statusBadge = '<span class="status-badge active"><i class="fas fa-check"></i> Aktywny</span>';
            }

            let progressClass = 'good';
            if (remainingPercent < 30) progressClass = 'low';
            else if (remainingPercent < 60) progressClass = 'medium';

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <div class="employee-name-cell">
                        <span class="employee-color-dot" style="background-color: ${employee.color}"></span>
                        ${employeeName}
                    </div>
                </td>
                <td>${shiftBadge}</td>
                <td>${statusBadge}</td>
                <td>${totalEntitlement}</td>
                <td>${usedDays}</td>
                <td>
                    <div class="leave-progress">
                        <span class="progress-text">${remaining} dni</span>
                        <div class="progress-bar">
                            <div class="progress-fill ${progressClass}" style="width: ${remainingPercent}%"></div>
                        </div>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        }
    };

    /**
     * Renderuje wykresy
     */
    const renderCharts = (): void => {
        // Destroy existing charts
        chartInstances.forEach(chart => {
            try {
                chart.destroy();
            } catch (e) {
                console.warn('Error destroying chart:', e);
            }
        });
        chartInstances = [];

        // Check if Chart.js is available
        if (typeof Chart === 'undefined') {
            console.warn('Chart.js not loaded');
            return;
        }

        renderLeaveTypesChart();
        renderMonthlyLeavesChart();
        renderEmployeeWorkloadChart();
        renderPatientsByEmployeeChart();
        renderPatientsByTimeChart();
        renderWeeklyTrendChart();
        renderWorkloadByEmployeeChart();
        renderWorkloadTrendChart();
    };

    /**
     * Wykres typów urlopów (pie)
     */
    const renderLeaveTypesChart = (): void => {
        const ctx = document.getElementById('leaveTypesChart') as HTMLCanvasElement | null;
        if (!ctx) return;

        const leaveStats = calculateLeaveStatsByType();
        const labels = Object.keys(leaveStats).map(type => LEAVE_TYPES[type]?.label || type);
        const data = Object.values(leaveStats);
        const colors = Object.keys(leaveStats).map(type => LEAVE_TYPES[type]?.color || '#94a3b8');

        const chart = new Chart(ctx.getContext('2d')!, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors,
                    borderWidth: 2,
                    borderColor: '#ffffff',
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            padding: 15,
                            usePointStyle: true,
                            font: { size: 11 }
                        }
                    }
                }
            }
        });
        chartInstances.push(chart);
    };

    /**
     * Wykres miesięcznych urlopów (bar)
     */
    const renderMonthlyLeavesChart = (): void => {
        const ctx = document.getElementById('monthlyLeavesChart') as HTMLCanvasElement | null;
        if (!ctx) return;

        const monthlyData = calculateMonthlyLeaves();
        const months = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze', 'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];

        const chart = new Chart(ctx.getContext('2d')!, {
            type: 'bar',
            data: {
                labels: months,
                datasets: [{
                    label: 'Dni urlopowe',
                    data: monthlyData,
                    backgroundColor: 'rgba(16, 185, 129, 0.7)',
                    borderColor: '#10b981',
                    borderWidth: 1,
                    borderRadius: 6,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: '#f1f5f9' }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });
        chartInstances.push(chart);
    };

    /**
     * Wykres obciążenia pracowników (bar horizontal)
     */
    const renderEmployeeWorkloadChart = (): void => {
        const ctx = document.getElementById('employeeWorkloadChart') as HTMLCanvasElement | null;
        if (!ctx || !scheduleData?.scheduleCells) return;

        const employees = EmployeeManager.getAll();
        const employeeIds = getActiveEmployeeIds(employees);
        const metrics = calculateScheduleMetrics(scheduleData.scheduleCells, employeeIds);
        const labels = employeeIds.map(id => EmployeeManager.getNameById(id));
        const data = employeeIds.map(id => metrics.byEmployee[id] || 0);
        const colors = employeeIds.map(id => employees[id].color || '#94a3b8');

        const chart = new Chart(ctx.getContext('2d')!, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Pacjenci',
                    data,
                    backgroundColor: colors.map(c => c + 'BB'),
                    borderColor: colors,
                    borderWidth: 1,
                    borderRadius: 6,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: '#f1f5f9' }
                    },
                    y: {
                        grid: { display: false }
                    }
                }
            }
        });
        chartInstances.push(chart);
    };

    /**
     * Wykres pacjentów wg pracownika (pie)
     */
    const renderPatientsByEmployeeChart = (): void => {
        const ctx = document.getElementById('patientsByEmployeeChart') as HTMLCanvasElement | null;
        if (!ctx || !scheduleData?.scheduleCells) return;

        const employees = EmployeeManager.getAll();
        const employeeIds = getActiveEmployeeIds(employees);
        const metrics = calculateScheduleMetrics(scheduleData.scheduleCells, employeeIds);
        const labels: string[] = [];
        const data: number[] = [];

        employeeIds.forEach(id => {
            const count = metrics.byEmployee[id] || 0;
            if (count > 0) {
                labels.push(EmployeeManager.getNameById(id));
                data.push(count);
            }
        });
        const colors = labels.map((_, index) => CHART_COLOR_PALETTE[index % CHART_COLOR_PALETTE.length]);

        const chart = new Chart(ctx.getContext('2d')!, {
            type: 'pie',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors,
                    borderColor: colors,
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            padding: 10,
                            usePointStyle: true,
                            font: { size: 11 }
                        }
                    }
                }
            }
        });
        chartInstances.push(chart);
    };

    /**
     * Wykres pacjentów wg godziny (bar)
     */
    const renderPatientsByTimeChart = (): void => {
        const ctx = document.getElementById('patientsByTimeChart') as HTMLCanvasElement | null;
        if (!ctx || !scheduleData?.scheduleCells) return;

        const employees = EmployeeManager.getAll();
        const metrics = calculateScheduleMetrics(scheduleData.scheduleCells, getActiveEmployeeIds(employees));
        const patientsByTime = metrics.byHour;

        const sortedTimes = Object.keys(patientsByTime).sort((a, b) => {
            const [aHour, aMinute] = a.split(':').map(Number);
            const [bHour, bMinute] = b.split(':').map(Number);
            return (aHour * 60 + aMinute) - (bHour * 60 + bMinute);
        });
        const labels = sortedTimes;
        const data = sortedTimes.map(t => patientsByTime[t]);

        const chart = new Chart(ctx.getContext('2d')!, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Pacjenci',
                    data,
                    backgroundColor: 'rgba(99, 102, 241, 0.7)',
                    borderColor: '#6366f1',
                    borderWidth: 1,
                    borderRadius: 6,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: '#f1f5f9' }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });
        chartInstances.push(chart);
    };

    /**
     * Weekly trend combines patient entries, leave days, and team availability.
     */
    const renderWeeklyTrendChart = (): void => {
        const ctx = document.getElementById('weeklyTrendChart') as HTMLCanvasElement | null;
        if (!ctx) return;

        const weeklyAverages = calculateWeeklyAverages(weeklyStatsData);
        const weeks = weeklyAverages.weeks;

        const chart = new Chart(ctx.getContext('2d')!, {
            type: 'bar',
            data: {
                labels: weeks.map(week => week.weekKey),
                datasets: [
                    {
                        type: 'bar',
                        label: 'Wpisy',
                        data: weeks.map(week => week.scheduleMetrics.totalSlots),
                        backgroundColor: 'rgba(59, 130, 246, 0.65)',
                        borderColor: '#3b82f6',
                        borderWidth: 1,
                        borderRadius: 6,
                    },
                    {
                        type: 'line',
                        label: 'Dni urlopowe',
                        data: weeks.map(week => week.leaveDays),
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.12)',
                        tension: 0.25,
                        yAxisID: 'y1',
                    },
                    {
                        type: 'line',
                        label: 'Dost\u0119pni pracownicy \u015br.',
                        data: weeks.map(week => week.averageAvailableEmployees),
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.12)',
                        tension: 0.25,
                        yAxisID: 'y1',
                    },
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            font: { size: 11 }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: '#f1f5f9' }
                    },
                    y1: {
                        beginAtZero: true,
                        position: 'right',
                        grid: { drawOnChartArea: false }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });
        chartInstances.push(chart);
    };

    return {
        init,
        destroy,
    };
})();

// Backward compatibility
declare global {
    interface Window {
        Statistics: StatisticsAPI;
    }
}

window.Statistics = Statistics;
