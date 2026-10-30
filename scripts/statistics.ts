// scripts/statistics.ts
import { db as dbRaw } from './firebase-config.js';
import { EmployeeManager } from './employee-manager.js';
import { escapeHTML, formatLocalIsoDate } from './utils.js';
import {
    generateTwoWeekPeriods,
    findRotationPeriodForDate,
} from './rotation-periods.js';
import {
    calculatePeriodWorkloadAverages,
    calculateColumnHygieneMetrics,
    getIsoWeekInfo,
    getIsoWeeksForYear,
    normalizeLeavesData,
    isClinicalWorkday,
    type WorkloadPeriodType,
    type DailyWorkloadSnapshot,
    type PeriodWorkloadAverages,
    type ColumnHygieneReport,
} from './statistics-helpers.js';
import {
    persistTodayWorkloadSnapshot,
    ensureTodayWorkloadSnapshot,
} from './workload-snapshot.js';
import type { FirestoreDbWrapper } from './types/firebase';
import type { Employee, ScheduleCellsMap } from './types/index.js';

const db = dbRaw as unknown as FirestoreDbWrapper;

declare const Chart: {
    new(ctx: CanvasRenderingContext2D, config: object): ChartInstance;
    register(...items: unknown[]): void;
};

interface ChartInstance {
    destroy(): void;
    resize(): void;
    update(): void;
}

interface StatisticsAPI {
    init(): Promise<void>;
    destroy(): void;
}

const WORKLOAD_STORAGE_KEY = 'kalinowa.stats.dailyWorkload.v2';

const formatDayMonth = (iso: string): string => {
    const parts = iso.split('-');
    if (parts.length >= 3) {
        return `${parts[2]}.${parts[1]}`;
    }
    return iso;
};

const formatExtensionText = (count: number, days: number): string => {
    if (count <= 0) return '0';
    if (count === 1) return `+${days} dni (1 wpis)`;
    const suffix = count >= 2 && count <= 4 ? 'wpisy' : 'wpisów';
    return `+${days} dni (${count} ${suffix})`;
};

const formatLastUpdatedText = (daysAgo: number | null): { text: string; className: string } => {
    if (daysAgo === null) {
        return { text: '—', className: 'update-badge' };
    }
    if (daysAgo === 0) {
        return { text: 'Dziś', className: 'update-badge update-badge--today' };
    }
    if (daysAgo === 1) {
        return { text: 'Wczoraj', className: 'update-badge' };
    }
    const className = daysAgo >= 3 ? 'update-badge update-badge--warn' : 'update-badge';
    return { text: `${daysAgo} dni temu`, className };
};

export const Statistics: StatisticsAPI = (() => {
    let currentPeriod: WorkloadPeriodType = 'biweekly';
    let selectedYear: number = new Date().getFullYear();
    let selectedPeriodKey: string = '';

    let dailySnapshotsData: DailyWorkloadSnapshot[] = [];
    let scheduleCells: ScheduleCellsMap = {};
    let employees: Record<string, Employee> = {};

    let workloadChart: ChartInstance | null = null;
    let abortController: AbortController | null = null;

    const loadDailySnapshots = async (): Promise<void> => {
        const yearsToFetch = [selectedYear - 1, selectedYear, selectedYear + 1];
        try {
            const statsDailyRef = db.collection<DailyWorkloadSnapshot>('statsDaily');
            const querySnap = await statsDailyRef.where('year', 'in', yearsToFetch).get();
            const fetched = querySnap.docs
                .map((doc) => doc.data() as DailyWorkloadSnapshot)
                .filter((snap): snap is DailyWorkloadSnapshot => Boolean(snap && snap.date));

            dailySnapshotsData = fetched;
            try {
                localStorage.setItem(WORKLOAD_STORAGE_KEY, JSON.stringify(dailySnapshotsData));
            } catch {
                // Ignore storage quota warnings
            }
        } catch (err) {
            console.warn('Błąd pobierania statsDaily z Firestore, fallback do cache:', err);
            try {
                const cached = localStorage.getItem(WORKLOAD_STORAGE_KEY);
                if (cached) {
                    dailySnapshotsData = JSON.parse(cached) as DailyWorkloadSnapshot[];
                }
            } catch {
                dailySnapshotsData = [];
            }
        }
    };

    const updateYearSelectOptions = (): void => {
        const yearSelect = document.getElementById('statsYearSelect') as HTMLSelectElement | null;
        if (!yearSelect) return;

        const currentYear = new Date().getFullYear();
        const yearSet = new Set<number>([currentYear - 1, currentYear, currentYear + 1, selectedYear]);
        dailySnapshotsData.forEach((s) => {
            if (s.year) yearSet.add(s.year);
        });

        const sortedYears = Array.from(yearSet).sort((a, b) => b - a);
        yearSelect.innerHTML = sortedYears
            .map((y) => `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${y}</option>`)
            .join('');
    };

    const updatePeriodSelectOptions = (): void => {
        const periodSelectGroup = document.getElementById('statsPeriodSelectGroup');
        const periodSelectLabel = document.getElementById('statsPeriodSelectLabel');
        const periodSelect = document.getElementById('statsPeriodSelect') as HTMLSelectElement | null;
        const periodSumHeader = document.getElementById('periodSumHeader');

        if (!periodSelectGroup || !periodSelect) return;

        if (periodSumHeader) {
            switch (currentPeriod) {
                case 'weekly':
                    periodSumHeader.textContent = 'Suma (1 tydz.)';
                    break;
                case 'biweekly':
                    periodSumHeader.textContent = 'Suma (2 tyg.)';
                    break;
                case 'monthly':
                    periodSumHeader.textContent = 'Suma (miesiąc)';
                    break;
                case 'yearly':
                    periodSumHeader.textContent = 'Suma (rok)';
                    break;
            }
        }

        if (currentPeriod === 'yearly') {
            periodSelectGroup.style.display = 'none';
            selectedPeriodKey = String(selectedYear);
            return;
        }

        periodSelectGroup.style.display = '';

        if (currentPeriod === 'weekly') {
            if (periodSelectLabel) periodSelectLabel.textContent = 'Tydzień:';
            const weeks = getIsoWeeksForYear(selectedYear);
            const todayInfo = getIsoWeekInfo(new Date());

            periodSelect.innerHTML = weeks
                .map((w) => `<option value="${w.weekKey}">${escapeHTML(w.label)}</option>`)
                .join('');

            if (selectedYear === todayInfo.year && weeks.some((w) => w.weekKey === todayInfo.weekKey)) {
                selectedPeriodKey = todayInfo.weekKey;
            } else if (weeks.length > 0) {
                selectedPeriodKey = weeks[0].weekKey;
            }
            periodSelect.value = selectedPeriodKey;
        } else if (currentPeriod === 'biweekly') {
            if (periodSelectLabel) periodSelectLabel.textContent = 'Okres:';
            const periods = generateTwoWeekPeriods(selectedYear);
            const todayIso = formatLocalIsoDate(new Date());
            const currentRotation = findRotationPeriodForDate(todayIso);
            const currentKey = `${currentRotation.start}_${currentRotation.end}`;

            periodSelect.innerHTML = periods
                .map((p) => {
                    const key = `${p.start}_${p.end}`;
                    const isCurrent = key === currentKey && selectedYear === new Date().getFullYear();
                    const label = `Zmiana: ${formatDayMonth(p.start)} – ${formatDayMonth(p.end)}${isCurrent ? ' (bieżąca)' : ''}`;
                    return `<option value="${key}">${escapeHTML(label)}</option>`;
                })
                .join('');

            if (periods.some((p) => `${p.start}_${p.end}` === currentKey)) {
                selectedPeriodKey = currentKey;
            } else if (periods.length > 0) {
                selectedPeriodKey = `${periods[0].start}_${periods[0].end}`;
            }
            periodSelect.value = selectedPeriodKey;
        } else if (currentPeriod === 'monthly') {
            if (periodSelectLabel) periodSelectLabel.textContent = 'Miesiąc:';
            const monthNames = [
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

            periodSelect.innerHTML = monthNames
                .map((name, idx) => `<option value="${idx + 1}">${escapeHTML(name)}</option>`)
                .join('');

            const currentMonth = new Date().getMonth() + 1;
            if (selectedYear === new Date().getFullYear()) {
                selectedPeriodKey = String(currentMonth);
            } else {
                selectedPeriodKey = '1';
            }
            periodSelect.value = selectedPeriodKey;
        }
    };

    const renderDashboard = (): void => {
        const today = new Date();

        let averages: PeriodWorkloadAverages;
        if (currentPeriod === 'weekly') {
            averages = calculatePeriodWorkloadAverages(dailySnapshotsData, 'weekly', {
                weekKey: selectedPeriodKey,
                year: selectedYear,
                employees,
                referenceDate: today,
            });
        } else if (currentPeriod === 'biweekly') {
            const [start, end] = selectedPeriodKey.split('_');
            averages = calculatePeriodWorkloadAverages(dailySnapshotsData, 'biweekly', {
                periodStart: start,
                periodEnd: end,
                year: selectedYear,
                employees,
                referenceDate: today,
            });
        } else if (currentPeriod === 'monthly') {
            averages = calculatePeriodWorkloadAverages(dailySnapshotsData, 'monthly', {
                month: Number.parseInt(selectedPeriodKey, 10),
                year: selectedYear,
                employees,
                referenceDate: today,
            });
        } else {
            averages = calculatePeriodWorkloadAverages(dailySnapshotsData, 'yearly', {
                year: selectedYear,
                employees,
                referenceDate: today,
            });
        }

        const hygieneReport: ColumnHygieneReport = calculateColumnHygieneMetrics(
            scheduleCells,
            employees,
            today
        );

        // 1. Undated warning banner
        const undatedBanner = document.getElementById('undatedWarningBanner');
        const undatedText = document.getElementById('undatedWarningText');
        if (undatedBanner) {
            if (hygieneReport.undatedEntries.length > 0) {
                undatedBanner.style.display = 'flex';
                undatedBanner.hidden = false;
                if (undatedText) {
                    undatedText.textContent = hygieneReport.undatedEntries
                        .map((e) => `${e.employeeName} (${e.time.padStart(5, '0')})`)
                        .join(', ');
                }
            } else {
                undatedBanner.style.display = 'none';
                undatedBanner.hidden = true;
            }
        }

        // 2. KPI Cards
        const kpiAvgDaily = document.getElementById('kpiAvgDailyValue');
        const kpiAvgDailySub = document.getElementById('kpiAvgDailySub');
        if (kpiAvgDaily) {
            kpiAvgDaily.textContent = String(averages.averageDailyPerPresentEmployee);
        }
        if (kpiAvgDailySub) {
            if (averages.previousPeriodDeltaDaily !== null) {
                const sign = averages.previousPeriodDeltaDaily >= 0 ? '▲ +' : '▼ ';
                kpiAvgDailySub.textContent = `${sign}${averages.previousPeriodDeltaDaily} vs poprz. okres`;
            } else {
                kpiAvgDailySub.textContent = 'Brak danych z poprz. okresu';
            }
        }

        const kpiAvgPeriodSum = document.getElementById('kpiAvgPeriodSumValue');
        const kpiAvgPeriodSumSub = document.getElementById('kpiAvgPeriodSumSub');
        if (kpiAvgPeriodSum) {
            kpiAvgPeriodSum.textContent = String(averages.averagePeriodSumPerPresentEmployee);
        }
        if (kpiAvgPeriodSumSub) {
            kpiAvgPeriodSumSub.textContent = `Łącznie zespół: ${averages.totalActiveSlots} slotów • ${averages.employeesWithPresenceCount} obecnych`;
        }

        const kpiOverdueBells = document.getElementById('kpiOverdueBellsValue');
        if (kpiOverdueBells) {
            kpiOverdueBells.textContent = String(hygieneReport.totalOverdueBells);
        }

        const kpiWorkdayCoverage = document.getElementById('kpiWorkdayCoverageValue');
        const kpiWorkdayCoverageSub = document.getElementById('kpiWorkdayCoverageSub');
        if (kpiWorkdayCoverage) {
            kpiWorkdayCoverage.textContent = `${averages.recordedWorkdaysCount} / ${averages.expectedWorkdaysCount}`;
        }
        if (kpiWorkdayCoverageSub) {
            kpiWorkdayCoverageSub.textContent = `${averages.recordedWorkdaysCount} z ${averages.expectedWorkdaysCount} dni roboczych ze snapshotem`;
        }

        // 3. Sort employees by EmployeeManager.compareEmployees
        const sortedSummaries = [...averages.employees].sort((a, b) => {
            const empA = employees[a.employeeId];
            const empB = employees[b.employeeId];
            if (empA && empB && typeof EmployeeManager.compareEmployees === 'function') {
                return EmployeeManager.compareEmployees(empA, empB);
            }
            return (a.employeeName || '').localeCompare(b.employeeName || '', 'pl');
        });

        // 4. Render Table
        const tbody = document.getElementById('workloadHygieneBody');
        if (tbody) {
            tbody.innerHTML = sortedSummaries
                .map((summary) => {
                    const emp = employees[summary.employeeId];
                    const empName = summary.employeeName || EmployeeManager.getNameById(summary.employeeId);
                    const empColor = emp?.color || summary.color || '#3b82f6';
                    const hygiene = hygieneReport.byEmployee[summary.employeeId];

                    const workdaysLabel = `${summary.daysPresent} ${summary.daysPresent === 1 ? 'dzień' : 'dni'}${
                        summary.daysOnLeave > 0 ? ` (${summary.daysOnLeave}d urlop)` : ''
                    }`;
                    const dailyAvgLabel =
                        summary.daysPresent > 0 ? String(summary.averageSlotsPerPresentDay) : '—';
                    const periodSumLabel = String(summary.totalActiveSlots);

                    const overdueCount = hygiene?.overdueBellsCount ?? 0;
                    const bellBadgeClass =
                        overdueCount === 0
                            ? 'bell-badge--clean'
                            : overdueCount === 1
                              ? 'bell-badge--low'
                              : 'bell-badge--warn';
                    const bellTitle =
                        hygiene?.overdueTimes && hygiene.overdueTimes.length > 0
                            ? `Do wyczyszczenia: ${hygiene.overdueTimes.map((t) => t.padStart(5, '0')).join(', ')}`
                            : 'Brak zaległych dzwoneczków';

                    const extCount = hygiene?.activeExtensionsCount ?? 0;
                    const extDays = hygiene?.activeExtensionDaysSum ?? 0;
                    const extText = formatExtensionText(extCount, extDays);

                    const updateInfo = formatLastUpdatedText(hygiene?.lastUpdatedDaysAgo ?? null);

                    return `<tr>` +
                        `<td><div class="employee-cell"><span class="employee-color-tag" style="background-color: ${escapeHTML(empColor)};"></span><span class="employee-name">${escapeHTML(empName)}</span></div></td>` +
                        `<td>${escapeHTML(workdaysLabel)}</td>` +
                        `<td>${summary.daysPresent > 0 ? `<strong class="workload-value-highlight">${escapeHTML(dailyAvgLabel)}</strong>` : '—'}</td>` +
                        `<td><strong>${escapeHTML(periodSumLabel)}</strong></td>` +
                        `<td><span class="bell-badge ${bellBadgeClass}" title="${escapeHTML(bellTitle)}">${overdueCount} 🔔</span></td>` +
                        `<td>${escapeHTML(extText)}</td>` +
                        `<td><span class="${escapeHTML(updateInfo.className)}">${escapeHTML(updateInfo.text)}</span></td>` +
                    `</tr>`;
                })
                .join('');
        }

        // 5. Render Horizontal Bar Chart (Chart.js)
        const canvas = document.getElementById('workloadComparisonChart') as HTMLCanvasElement | null;
        if (canvas && typeof Chart !== 'undefined') {
            const ctx = (canvas.getContext?.('2d') || canvas) as unknown as CanvasRenderingContext2D;
            if (ctx) {
                if (workloadChart) {
                    workloadChart.destroy();
                    workloadChart = null;
                }

                const wrapper = document.getElementById('chartWrapper');
                if (wrapper) {
                    wrapper.style.height = `${Math.max(240, sortedSummaries.length * 44 + 70)}px`;
                }

                const labels = sortedSummaries.map((s) => s.employeeName);
                const activeSlotsData = sortedSummaries.map((s) => s.averageSlotsPerPresentDay);
                const overdueBellsData = sortedSummaries.map(
                    (s) => hygieneReport.byEmployee[s.employeeId]?.overdueBellsCount ?? 0
                );

                workloadChart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [
                            {
                                label: 'Śr. aktywnych slotów / dzień pracy',
                                data: activeSlotsData,
                                backgroundColor: 'rgba(37, 99, 235, 0.85)',
                                borderColor: '#2563eb',
                                borderWidth: 1,
                                borderRadius: 4,
                            },
                            {
                                label: 'Zaległe dzwoneczki 🔔 dziś (odcięte)',
                                data: overdueBellsData,
                                backgroundColor: 'rgba(239, 68, 68, 0.7)',
                                borderColor: '#ef4444',
                                borderWidth: 1,
                                borderRadius: 4,
                            },
                        ],
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                position: 'top',
                                labels: {
                                    usePointStyle: true,
                                    boxWidth: 8,
                                },
                            },
                        },
                        scales: {
                            x: {
                                beginAtZero: true,
                                ticks: { stepSize: 1 },
                                grid: { color: '#f1f5f9' },
                            },
                            y: {
                                grid: { display: false },
                            },
                        },
                    },
                });
            }
        }
    };

    const attachEventListeners = (signal: AbortSignal): void => {
        const periodButtons: Array<{ id: string; period: WorkloadPeriodType }> = [
            { id: 'periodWeeklyBtn', period: 'weekly' },
            { id: 'periodBiweeklyBtn', period: 'biweekly' },
            { id: 'periodMonthlyBtn', period: 'monthly' },
            { id: 'periodYearlyBtn', period: 'yearly' },
        ];

        periodButtons.forEach(({ id, period }) => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener(
                    'click',
                    () => {
                        if (currentPeriod === period) return;
                        currentPeriod = period;
                        periodButtons.forEach((b) => {
                            const otherBtn = document.getElementById(b.id);
                            if (otherBtn) {
                                otherBtn.classList.toggle('active', b.period === period);
                            }
                        });
                        updatePeriodSelectOptions();
                        renderDashboard();
                    },
                    { signal }
                );
            }
        });

        const yearSelect = document.getElementById('statsYearSelect') as HTMLSelectElement | null;
        if (yearSelect) {
            yearSelect.addEventListener(
                'change',
                async () => {
                    selectedYear = Number.parseInt(yearSelect.value, 10);
                    await loadDailySnapshots();
                    updatePeriodSelectOptions();
                    renderDashboard();
                },
                { signal }
            );
        }

        const periodSelect = document.getElementById('statsPeriodSelect') as HTMLSelectElement | null;
        if (periodSelect) {
            periodSelect.addEventListener(
                'change',
                () => {
                    selectedPeriodKey = periodSelect.value;
                    renderDashboard();
                },
                { signal }
            );
        }

        const refreshBtn = document.getElementById('refreshWorkloadSnapshotBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener(
                'click',
                async () => {
                    try {
                        const now = new Date();
                        const snap = await persistTodayWorkloadSnapshot(scheduleCells, now);
                        if (snap) {
                            const existingIdx = dailySnapshotsData.findIndex((s) => s.date === snap.date);
                            if (existingIdx >= 0) {
                                dailySnapshotsData[existingIdx] = snap;
                            } else {
                                dailySnapshotsData.push(snap);
                            }
                            const dateEl = document.getElementById('workloadSnapshotDate');
                            if (dateEl) {
                                dateEl.textContent = 'Snapshot: Dzisiaj';
                            }
                            renderDashboard();
                        }
                    } catch (err) {
                        console.error('Błąd ręcznego odświeżania snapshotu:', err);
                    }
                },
                { signal }
            );
        }
    };

    const init = async (): Promise<void> => {
        destroy();
        abortController = new AbortController();

        currentPeriod = 'biweekly';
        selectedYear = new Date().getFullYear();

        await EmployeeManager.load();
        employees = EmployeeManager.getAll();

        try {
            const scheduleDoc = await db.collection('schedules').doc('mainSchedule').get();
            const schedData = scheduleDoc.data() as {
                scheduleCells?: ScheduleCellsMap;
                scheduleData?: ScheduleCellsMap;
                employees?: Record<string, Employee>;
            } | undefined;
            scheduleCells = schedData?.scheduleCells || schedData?.scheduleData || {};
            if (schedData?.employees && Object.keys(employees).length === 0) {
                employees = schedData.employees;
            }
        } catch (err) {
            console.warn('Nie udało się pobrać schedules/mainSchedule:', err);
            scheduleCells = {};
        }

        try {
            const leavesDoc = await db.collection('leaves').doc('mainLeaves').get();
            normalizeLeavesData(leavesDoc.data());
        } catch (err) {
            console.warn('Nie udało się pobrać leaves/mainLeaves:', err);
        }

        await loadDailySnapshots();

        // Ensure today snapshot on a clinical workday if missing
        const today = new Date();
        const todayIso = formatLocalIsoDate(today);
        if (selectedYear === today.getFullYear() && isClinicalWorkday(todayIso)) {
            const hasTodaySnapshot = dailySnapshotsData.some((s) => s.date === todayIso);
            if (!hasTodaySnapshot) {
                try {
                    const snap = await ensureTodayWorkloadSnapshot(scheduleCells, today);
                    if (snap) {
                        dailySnapshotsData.push(snap);
                    }
                } catch (err) {
                    console.warn('Nie udało się zapisać dzisiejszego snapshotu:', err);
                }
            }
        }

        updateYearSelectOptions();
        updatePeriodSelectOptions();
        attachEventListeners(abortController.signal);
        renderDashboard();
    };

    const destroy = (): void => {
        if (workloadChart) {
            workloadChart.destroy();
            workloadChart = null;
        }
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
    };

    return {
        init,
        destroy,
    };
})();
