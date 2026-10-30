import { AppConfig, isHoliday } from './common.js';
import { findRotationPeriodForDate } from './rotation-periods.js';
import { ScheduleLogic } from './schedule-logic.js';
import type { Employee, LeaveEntry, ScheduleCellsMap } from './types/index.js';

export type WorkloadPeriodType = 'weekly' | 'biweekly' | 'monthly' | 'yearly';

export interface IsoWeekOption {
    weekKey: string;
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
    label: string;
}

export interface DailyEmployeeWorkload {
    employeeId: string;
    employeeName: string;
    patientSlots: number;
    availableSlots: number;
    occupancyPercent: number;
    isOnLeave: boolean;
    leaveType?: string | null;
    uniquePatients?: number;
    patientIds?: string[];
}

export interface DailyWorkloadSnapshot {
    version?: number;
    date: string;
    year: number;
    month: number;
    dayOfWeek: number;
    weekKey: string;
    isWorkday: boolean;
    updatedAt: string;
    employees: Record<string, DailyEmployeeWorkload>;
    totalPatients: number;
    activeEmployeesCount: number;
}

export interface EmployeePeriodWorkloadSummary {
    employeeId: string;
    employeeName: string;
    color: string;
    workdaysInPeriod: number;
    daysPresent: number;
    daysOnLeave: number;
    totalActiveSlots: number;
    averageSlotsPerPresentDay: number;
    dailyBreakdown: Record<string, DailyEmployeeWorkload>;
}

export interface PeriodWorkloadAverages {
    periodType: WorkloadPeriodType;
    periodKey: string;
    periodLabel: string;
    rangeStart: string;
    rangeEnd: string;
    recordedWorkdaysCount: number;
    expectedWorkdaysCount: number;
    totalPersonDaysPresent: number;
    totalActiveSlots: number;
    employeesWithPresenceCount: number;
    averageDailyPerPresentEmployee: number;
    averagePeriodSumPerPresentEmployee: number;
    previousPeriodDeltaDaily: number | null;
    employees: EmployeePeriodWorkloadSummary[];
}

export interface EmployeeColumnHygiene {
    employeeId: string;
    overdueBellsCount: number;
    overdueTimes: string[];
    activeExtensionsCount: number;
    activeExtensionDaysSum: number;
    undatedCount: number;
    lastUpdatedIso: string | null;
    lastUpdatedDaysAgo: number | null;
}

export interface ColumnHygieneReport {
    totalOverdueBells: number;
    undatedEntries: Array<{ employeeId: string; employeeName: string; time: string }>;
    byEmployee: Record<string, EmployeeColumnHygiene>;
}

type EmployeesMap = Record<string, Employee>;
type LeavesMap = Record<string, LeaveEntry[]>;

const isFilled = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

const roundToOne = (value: number): number => Math.round(value * 10) / 10;

/** Format daty kliniki w lokalnej strefie przeglądarki, nie w UTC. */
const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const createUtcDate = (isoDate: string): Date => new Date(`${isoDate}T12:00:00Z`);

const formatDayMonth = (iso: string): string => {
    const parts = iso.split('-');
    return `${parts[2]}.${parts[1]}`;
};

const getNumber = (value: unknown): number => {
    const parsed = Number.parseInt(String(value ?? 0), 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

const overlapsDate = (leave: LeaveEntry, dateIso: string): boolean =>
    leave.startDate <= dateIso && leave.endDate >= dateIso;

export const normalizeLeavesData = (rawData: unknown): LeavesMap => {
    if (!rawData || typeof rawData !== 'object') return {};

    return Object.fromEntries(
        Object.entries(rawData as Record<string, unknown>)
            .filter(([, value]) => Array.isArray(value))
            .map(([employeeName, value]) => [
                employeeName,
                (value as unknown[]).filter((leave): leave is LeaveEntry => {
                    if (!leave || typeof leave !== 'object') return false;
                    const candidate = leave as Partial<LeaveEntry>;
                    return typeof candidate.startDate === 'string' && typeof candidate.endDate === 'string';
                }),
            ])
    );
};

export const getEmployeeDisplayName = (employeeId: string, employee: Employee): string =>
    employee.displayName || employee.name || `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || `Pracownik ${Number.parseInt(employeeId, 10) + 1}`;

export const getActiveEmployeeIds = (employees: EmployeesMap): string[] =>
    Object.keys(employees).filter(id => !employees[id]?.isHidden);

export const generateScheduleTimeSlots = (): string[] => {
    const slots: string[] = [];
    for (let hour = AppConfig.schedule.startHour; hour <= AppConfig.schedule.endHour; hour++) {
        for (let minute = 0; minute < 60; minute += 30) {
            if (hour === AppConfig.schedule.endHour && minute === 30) continue;
            slots.push(`${hour}:${minute.toString().padStart(2, '0')}`);
        }
    }
    return slots;
};

export const isClinicalWorkday = (dateIso: string): boolean => {
    const date = createUtcDate(dateIso);
    const day = date.getUTCDay();
    return day >= 1 && day <= 5 && !isHoliday(date);
};

export const countClinicalWorkdaysInRange = (startIso: string, endIso: string): number => {
    if (startIso > endIso) return 0;
    const cursor = createUtcDate(startIso);
    const end = createUtcDate(endIso);
    let count = 0;
    while (cursor <= end) {
        const iso = cursor.toISOString().split('T')[0];
        if (isClinicalWorkday(iso)) {
            count++;
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return count;
};

export const getIsoWeekInfo = (dateInput: Date = new Date()): { year: number; weekNumber: number; weekKey: string; weekStart: string; weekEnd: string } => {
    const date = new Date(Date.UTC(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate(), 12));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);

    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1, 12));
    const weekNumber = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    const year = date.getUTCFullYear();

    const weekStart = new Date(date);
    weekStart.setUTCDate(date.getUTCDate() - 3);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

    const paddedWeek = weekNumber.toString().padStart(2, '0');
    return {
        year,
        weekNumber,
        weekKey: `${year}-W${paddedWeek}`,
        weekStart: formatDate(weekStart),
        weekEnd: formatDate(weekEnd),
    };
};

export const getIsoWeeksForYear = (year: number): IsoWeekOption[] => {
    const weeks: IsoWeekOption[] = [];
    const jan4 = new Date(Date.UTC(year, 0, 4, 12));
    const day = jan4.getUTCDay() || 7;
    const cursor = new Date(Date.UTC(year, 0, 4 - day + 1, 12));

    while (true) {
        const info = getIsoWeekInfo(cursor);
        if (info.year !== year) break;
        const startParts = info.weekStart.split('-');
        const endParts = info.weekEnd.split('-');
        const label = `Tydzień ${info.weekNumber} (${startParts[2]}.${startParts[1]} – ${endParts[2]}.${endParts[1]})`;
        weeks.push({
            weekKey: info.weekKey,
            weekNumber: info.weekNumber,
            weekStart: info.weekStart,
            weekEnd: info.weekEnd,
            label,
        });
        cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return weeks;
};

const isEveryOtherWorkday = (startDate: string | null | undefined, dateIso: string): boolean => {
    if (!startDate) return true;
    if (dateIso < startDate) return false;

    let occurrence = 0;
    const cursor = createUtcDate(startDate);
    const target = createUtcDate(dateIso);
    for (; cursor <= target; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const cursorIso = cursor.toISOString().split('T')[0];
        if (isClinicalWorkday(cursorIso)) occurrence++;
    }
    return occurrence > 0 && occurrence % 2 === 1;
};

export const createDailyWorkloadSnapshot = (
    scheduleCells: ScheduleCellsMap | null | undefined,
    employees: EmployeesMap,
    leavesData: LeavesMap,
    targetDate: Date = new Date()
): DailyWorkloadSnapshot => {
    const dateIso = formatDate(targetDate);
    const dayOfWeek = targetDate.getDay() || 7;
    const isWorkday = isClinicalWorkday(dateIso);
    const weekInfo = getIsoWeekInfo(targetDate);
    const month = targetDate.getMonth() + 1;
    const year = targetDate.getFullYear();
    const activeEmployeeIds = getActiveEmployeeIds(employees);
    const timeSlots = generateScheduleTimeSlots();

    const employeesWorkload: Record<string, DailyEmployeeWorkload> = {};
    let totalPatientsInDay = 0;

    const isEntryActiveOnDate = (
        content: string | null | undefined,
        startDate?: string | null,
        rawEndDate?: string | null,
        extensionDays?: number | null,
        everyOtherDay?: boolean | null,
        isHydroPart?: boolean | null
    ): boolean => {
        if (isHydroPart) return false;
        if (!isFilled(content)) return false;
        if (!startDate || !startDate.trim()) return false;

        const effectiveStart = startDate.trim();
        const extDays = getNumber(extensionDays);
        const effectiveEnd = rawEndDate?.trim() || ScheduleLogic.calculateEndDate(effectiveStart, extDays);

        if (dateIso < effectiveStart || dateIso > effectiveEnd) return false;
        if (everyOtherDay) {
            return isEveryOtherWorkday(effectiveStart, dateIso);
        }
        return true;
    };

    activeEmployeeIds.forEach(employeeId => {
        const employee = employees[employeeId];
        const displayName = getEmployeeDisplayName(employeeId, employee);
        const employeeLeaves = leavesData[displayName] || [];
        const activeLeave = employeeLeaves.find(leave => overlapsDate(leave, dateIso));
        const isOnLeave = Boolean(activeLeave);

        let patientSlots = 0;
        let availableSlots = 0;

        if (scheduleCells && isWorkday) {
            timeSlots.forEach(time => {
                const cell = scheduleCells[time]?.[employeeId];
                if (!cell) {
                    availableSlots++;
                    return;
                }

                if (cell.isBreak) return;
                if (cell.isHydrotherapy) return;

                availableSlots++;

                if (isOnLeave) return;

                if (cell.isSplit) {
                    const part1Active = isEntryActiveOnDate(
                        cell.content1,
                        cell.treatmentData1?.startDate,
                        cell.treatmentData1?.endDate,
                        cell.treatmentData1?.extensionDays,
                        cell.isEveryOtherDay1,
                        cell.isHydrotherapy1
                    );
                    const part2Active = isEntryActiveOnDate(
                        cell.content2,
                        cell.treatmentData2?.startDate,
                        cell.treatmentData2?.endDate,
                        cell.treatmentData2?.extensionDays,
                        cell.isEveryOtherDay2,
                        cell.isHydrotherapy2
                    );
                    if (part1Active || part2Active) {
                        patientSlots++;
                    }
                } else if (isEntryActiveOnDate(
                    cell.content,
                    cell.treatmentStartDate,
                    cell.treatmentEndDate,
                    cell.treatmentExtensionDays,
                    cell.isEveryOtherDay,
                    false
                )) {
                    patientSlots++;
                }
            });
        } else if (!isWorkday && scheduleCells) {
            timeSlots.forEach(time => {
                const cell = scheduleCells[time]?.[employeeId];
                if (!cell || (!cell.isBreak && !cell.isHydrotherapy)) {
                    availableSlots++;
                }
            });
        }

        const occupancyPercent = availableSlots > 0 ? Math.round((patientSlots / availableSlots) * 100) : 0;
        if (!isOnLeave && isWorkday) {
            totalPatientsInDay += patientSlots;
        }

        employeesWorkload[employeeId] = {
            employeeId,
            employeeName: displayName,
            patientSlots,
            availableSlots,
            occupancyPercent,
            isOnLeave,
            leaveType: activeLeave ? activeLeave.type : null,
            uniquePatients: patientSlots,
            patientIds: [],
        };
    });

    return {
        version: 2,
        date: dateIso,
        year,
        month,
        dayOfWeek,
        weekKey: weekInfo.weekKey,
        isWorkday,
        updatedAt: new Date().toISOString(),
        employees: employeesWorkload,
        totalPatients: totalPatientsInDay,
        activeEmployeesCount: activeEmployeeIds.length,
    };
};

export const calculatePeriodWorkloadAverages = (
    snapshots: DailyWorkloadSnapshot[],
    periodType: WorkloadPeriodType,
    options: {
        weekKey?: string;
        periodStart?: string;
        periodEnd?: string;
        month?: number;
        year: number;
        employees: EmployeesMap;
        referenceDate?: Date;
    }
): PeriodWorkloadAverages => {
    const { weekKey, periodStart, periodEnd, month, year, employees } = options;
    const refDate = options.referenceDate ?? new Date();
    const refIso = formatDate(refDate);
    const activeEmployeeIds = getActiveEmployeeIds(employees);

    let rangeStart = '';
    let rangeEnd = '';
    let periodKey = '';
    let periodLabel = '';

    if (periodType === 'weekly') {
        const targetWeek = weekKey || getIsoWeekInfo(refDate).weekKey;
        periodKey = targetWeek;
        const [yStr, wStr] = targetWeek.split('-W');
        const wNum = Number.parseInt(wStr || '1', 10);
        const yNum = Number.parseInt(yStr || String(year), 10);
        const jan4 = new Date(Date.UTC(yNum, 0, 4, 12));
        const day = jan4.getUTCDay() || 7;
        const cursor = new Date(Date.UTC(yNum, 0, 4 - day + 1 + (wNum - 1) * 7, 12));
        rangeStart = formatDate(cursor);
        cursor.setUTCDate(cursor.getUTCDate() + 6);
        rangeEnd = formatDate(cursor);
        periodLabel = `Tydzień ${wNum} (${formatDayMonth(rangeStart)} – ${formatDayMonth(rangeEnd)})`;
    } else if (periodType === 'biweekly') {
        if (periodStart && periodEnd) {
            rangeStart = periodStart;
            rangeEnd = periodEnd;
        } else {
            const rotation = findRotationPeriodForDate(refIso);
            rangeStart = rotation.start;
            rangeEnd = rotation.end;
        }
        periodKey = `${rangeStart}_${rangeEnd}`;
        periodLabel = `Zmiana: ${formatDayMonth(rangeStart)} – ${formatDayMonth(rangeEnd)}`;
    } else if (periodType === 'monthly') {
        const targetMonth = month ?? (refDate.getMonth() + 1);
        periodKey = `${year}-${String(targetMonth).padStart(2, '0')}`;
        rangeStart = `${year}-${String(targetMonth).padStart(2, '0')}-01`;
        const lastDay = new Date(Date.UTC(year, targetMonth, 0)).getUTCDate();
        rangeEnd = `${year}-${String(targetMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        const monthNames = [
            'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
            'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
        ];
        periodLabel = `${monthNames[targetMonth - 1]} ${year}`;
    } else {
        periodKey = String(year);
        periodLabel = `Rok ${year}`;
        rangeStart = `${year}-01-01`;
        rangeEnd = `${year}-12-31`;
    }

    const filteredSnapshots = snapshots
        .filter(s => s.date >= rangeStart && s.date <= rangeEnd && isClinicalWorkday(s.date))
        .sort((a, b) => a.date.localeCompare(b.date));

    const recordedDates = new Set(filteredSnapshots.map(s => s.date));
    const recordedWorkdaysCount = recordedDates.size;

    let expectedWorkdaysCount = 0;
    if (refIso < rangeStart) {
        expectedWorkdaysCount = 0;
    } else if (refIso >= rangeEnd) {
        expectedWorkdaysCount = countClinicalWorkdaysInRange(rangeStart, rangeEnd);
    } else {
        expectedWorkdaysCount = countClinicalWorkdaysInRange(rangeStart, refIso);
    }

    let totalActiveSlotsAll = 0;
    let totalPersonDaysPresent = 0;
    let employeesWithPresenceCount = 0;
    const employeeSummaries: EmployeePeriodWorkloadSummary[] = [];

    activeEmployeeIds.forEach(employeeId => {
        const employee = employees[employeeId];
        const employeeName = getEmployeeDisplayName(employeeId, employee);
        let daysPresent = 0;
        let daysOnLeave = 0;
        let totalActiveSlots = 0;
        const dailyBreakdown: Record<string, DailyEmployeeWorkload> = {};

        filteredSnapshots.forEach(snap => {
            const empData = snap.employees[employeeId];
            if (empData) {
                dailyBreakdown[snap.date] = empData;
                if (empData.isOnLeave) {
                    daysOnLeave++;
                } else {
                    daysPresent++;
                    totalActiveSlots += (empData.patientSlots || 0);
                }
            }
        });

        totalActiveSlotsAll += totalActiveSlots;
        totalPersonDaysPresent += daysPresent;
        if (daysPresent > 0) {
            employeesWithPresenceCount++;
        }

        const averageSlotsPerPresentDay = daysPresent > 0 ? roundToOne(totalActiveSlots / daysPresent) : 0;

        employeeSummaries.push({
            employeeId,
            employeeName,
            color: employee?.color || '#94a3b8',
            workdaysInPeriod: recordedWorkdaysCount,
            daysPresent,
            daysOnLeave,
            totalActiveSlots,
            averageSlotsPerPresentDay,
            dailyBreakdown,
        });
    });

    const averageDailyPerPresentEmployee = totalPersonDaysPresent > 0
        ? roundToOne(totalActiveSlotsAll / totalPersonDaysPresent)
        : 0;

    const averagePeriodSumPerPresentEmployee = employeesWithPresenceCount > 0
        ? roundToOne(totalActiveSlotsAll / employeesWithPresenceCount)
        : 0;

    let previousPeriodDeltaDaily: number | null = null;
    let prevStart = '';
    let prevEnd = '';

    if (periodType === 'weekly') {
        const cursor = createUtcDate(rangeStart);
        cursor.setUTCDate(cursor.getUTCDate() - 7);
        const prevWeek = getIsoWeekInfo(cursor);
        const [pyStr, pwStr] = prevWeek.weekKey.split('-W');
        const pwNum = Number.parseInt(pwStr, 10);
        const pyNum = Number.parseInt(pyStr, 10);
        const pJan4 = new Date(Date.UTC(pyNum, 0, 4, 12));
        const pDay = pJan4.getUTCDay() || 7;
        const pCur = new Date(Date.UTC(pyNum, 0, 4 - pDay + 1 + (pwNum - 1) * 7, 12));
        prevStart = formatDate(pCur);
        pCur.setUTCDate(pCur.getUTCDate() + 6);
        prevEnd = formatDate(pCur);
    } else if (periodType === 'biweekly') {
        const cursor = createUtcDate(rangeStart);
        cursor.setUTCDate(cursor.getUTCDate() - 3);
        const prevRot = findRotationPeriodForDate(formatDate(cursor));
        prevStart = prevRot.start;
        prevEnd = prevRot.end;
    } else if (periodType === 'monthly') {
        const targetMonth = month ?? (refDate.getMonth() + 1);
        const pMonth = targetMonth === 1 ? 12 : targetMonth - 1;
        const pYear = targetMonth === 1 ? year - 1 : year;
        prevStart = `${pYear}-${String(pMonth).padStart(2, '0')}-01`;
        const pLastDay = new Date(Date.UTC(pYear, pMonth, 0)).getUTCDate();
        prevEnd = `${pYear}-${String(pMonth).padStart(2, '0')}-${String(pLastDay).padStart(2, '0')}`;
    } else {
        const pYear = year - 1;
        prevStart = `${pYear}-01-01`;
        prevEnd = `${pYear}-12-31`;
    }

    const prevSnapshots = snapshots.filter(s => s.date >= prevStart && s.date <= prevEnd && isClinicalWorkday(s.date));
    if (prevSnapshots.length > 0) {
        let prevTotalSlots = 0;
        let prevPersonDays = 0;
        prevSnapshots.forEach(snap => {
            activeEmployeeIds.forEach(id => {
                const empData = snap.employees[id];
                if (empData && !empData.isOnLeave) {
                    prevTotalSlots += (empData.patientSlots || 0);
                    prevPersonDays++;
                }
            });
        });
        if (prevPersonDays > 0) {
            const prevAvgDaily = roundToOne(prevTotalSlots / prevPersonDays);
            previousPeriodDeltaDaily = roundToOne(averageDailyPerPresentEmployee - prevAvgDaily);
        }
    }

    return {
        periodType,
        periodKey,
        periodLabel,
        rangeStart,
        rangeEnd,
        recordedWorkdaysCount,
        expectedWorkdaysCount,
        totalPersonDaysPresent,
        totalActiveSlots: totalActiveSlotsAll,
        employeesWithPresenceCount,
        averageDailyPerPresentEmployee,
        averagePeriodSumPerPresentEmployee,
        previousPeriodDeltaDaily,
        employees: employeeSummaries,
    };
};

export const calculateColumnHygieneMetrics = (
    scheduleCells: ScheduleCellsMap | null | undefined,
    employees: EmployeesMap,
    referenceDate: Date = new Date()
): ColumnHygieneReport => {
    const todayIso = formatDate(referenceDate);
    const activeEmployeeIds = getActiveEmployeeIds(employees);
    const timeSlots = generateScheduleTimeSlots();

    const byEmployee: Record<string, EmployeeColumnHygiene> = {};
    const undatedEntries: Array<{ employeeId: string; employeeName: string; time: string }> = [];
    let totalOverdueBells = 0;

    activeEmployeeIds.forEach(employeeId => {
        byEmployee[employeeId] = {
            employeeId,
            overdueBellsCount: 0,
            overdueTimes: [],
            activeExtensionsCount: 0,
            activeExtensionDaysSum: 0,
            undatedCount: 0,
            lastUpdatedIso: null,
            lastUpdatedDaysAgo: null,
        };
    });

    if (!scheduleCells) {
        return {
            totalOverdueBells: 0,
            undatedEntries: [],
            byEmployee,
        };
    }

    activeEmployeeIds.forEach(employeeId => {
        const employee = employees[employeeId];
        const displayName = getEmployeeDisplayName(employeeId, employee);
        const hygiene = byEmployee[employeeId];
        const candidateDates: string[] = [];

        const processPart = (
            time: string,
            content?: string | null,
            startDate?: string | null,
            rawEndDate?: string | null,
            extensionDays?: number | null,
            isHydro?: boolean | null
        ) => {
            if (isHydro) return;
            if (!isFilled(content)) return;

            if (!startDate || !startDate.trim()) {
                hygiene.undatedCount++;
                undatedEntries.push({ employeeId, employeeName: displayName, time });
                return;
            }

            const sDate = startDate.trim();
            candidateDates.push(sDate);

            const extDays = getNumber(extensionDays);
            const effectiveEnd = rawEndDate?.trim() || ScheduleLogic.calculateEndDate(sDate, extDays);

            if (effectiveEnd < todayIso) {
                hygiene.overdueBellsCount++;
                totalOverdueBells++;
                if (!hygiene.overdueTimes.includes(time)) {
                    hygiene.overdueTimes.push(time);
                }
            } else if (extDays > 0) {
                hygiene.activeExtensionsCount++;
                hygiene.activeExtensionDaysSum += extDays;
            }
        };

        timeSlots.forEach(time => {
            const cell = scheduleCells[time]?.[employeeId];
            if (!cell) return;

            if (Array.isArray(cell.history)) {
                cell.history.forEach(entry => {
                    if (entry && typeof entry.timestamp === 'string') {
                        const parsed = new Date(entry.timestamp);
                        if (!Number.isNaN(parsed.getTime())) {
                            candidateDates.push(formatDate(parsed));
                        }
                    }
                });
            }

            if (cell.isBreak) return;
            if (cell.isHydrotherapy) return;

            if (cell.isSplit) {
                processPart(
                    time,
                    cell.content1,
                    cell.treatmentData1?.startDate,
                    cell.treatmentData1?.endDate,
                    cell.treatmentData1?.extensionDays,
                    cell.isHydrotherapy1
                );
                processPart(
                    time,
                    cell.content2,
                    cell.treatmentData2?.startDate,
                    cell.treatmentData2?.endDate,
                    cell.treatmentData2?.extensionDays,
                    cell.isHydrotherapy2
                );
            } else {
                processPart(
                    time,
                    cell.content,
                    cell.treatmentStartDate,
                    cell.treatmentEndDate,
                    cell.treatmentExtensionDays,
                    false
                );
            }
        });

        if (candidateDates.length > 0) {
            candidateDates.sort((a, b) => a.localeCompare(b));
            const maxIso = candidateDates[candidateDates.length - 1];
            hygiene.lastUpdatedIso = maxIso;
            const targetUtc = createUtcDate(maxIso).getTime();
            const todayUtc = createUtcDate(todayIso).getTime();
            const diffDays = Math.round((todayUtc - targetUtc) / 86400000);
            hygiene.lastUpdatedDaysAgo = Math.max(0, diffDays);
        }
    });

    return {
        totalOverdueBells,
        undatedEntries,
        byEmployee,
    };
};
