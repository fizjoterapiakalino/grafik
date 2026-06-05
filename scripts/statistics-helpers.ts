import { AppConfig } from './common.js';
import type { Employee, LeaveEntry, ScheduleCellsMap } from './types/index.js';

export interface ScheduleMetrics {
    totalSlots: number;
    uniquePatients: number;
    breaks: number;
    massageOrPnf: number;
    everyOtherDay: number;
    hydrotherapy: number;
    endingToday: number;
    endingSoon: number;
    overdue: number;
    extendedTreatments: number;
    longExtensions: number;
    missingTreatmentDates: number;
    duplicatePatientEntries: number;
    handoverMorning: number;
    handoverAfternoon: number;
    dataQualityScore: number;
    byEmployee: Record<string, number>;
    byHour: Record<string, number>;
    possibleSlots: number;
    availableSlots: number;
    occupancyPercent: number;
}

export interface WeeklyStatsSnapshot {
    weekKey: string;
    year: number;
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
    updatedAt: string;
    scheduleMetrics: ScheduleMetrics;
    activeEmployeeCount: number;
    averageAvailableEmployees: number;
    leaveDays: number;
    averagePatientsPerAvailableEmployee: number;
}

export interface WeeklyAverages {
    weeks: WeeklyStatsSnapshot[];
    averageTotalSlots: number;
    averageUniquePatients: number;
    averageOccupancyPercent: number;
    averageAvailableEmployees: number;
    averagePatientsPerAvailableEmployee: number;
    totalLeaveDays: number;
    trendPercent: number | null;
}

type EmployeesMap = Record<string, Employee>;
type LeavesMap = Record<string, LeaveEntry[]>;

const isFilled = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

const roundToOne = (value: number): number => Math.round(value * 10) / 10;

const formatDate = (date: Date): string => date.toISOString().split('T')[0];

const createUtcDate = (isoDate: string): Date => new Date(`${isoDate}T12:00:00Z`);

const getMinutesFromTime = (time: string): number => {
    const [hourRaw, minuteRaw] = time.split(':');
    const hour = Number.parseInt(hourRaw || '0', 10);
    const minute = Number.parseInt(minuteRaw || '0', 10);
    return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
};

const getDateDiffInDays = (dateIso: string, referenceDate: Date): number => {
    const target = createUtcDate(dateIso);
    const reference = new Date(Date.UTC(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate(), 12));
    return Math.round((target.getTime() - reference.getTime()) / 86400000);
};

const getNumber = (value: unknown): number => {
    const parsed = Number.parseInt(String(value ?? 0), 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

export const getActiveEmployeeIds = (employees: EmployeesMap): string[] =>
    Object.keys(employees).filter(id => !employees[id].isHidden && !employees[id].isScheduleOnly);

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

export const getIsoWeekInfo = (dateInput: Date = new Date()): { year: number; weekNumber: number; weekKey: string; weekStart: string; weekEnd: string } => {
    const date = new Date(Date.UTC(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate()));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);

    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
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

export const getRecentIsoWeekKeys = (referenceDate: Date = new Date(), count = 4): string[] => {
    const keys: string[] = [];
    const cursor = new Date(Date.UTC(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate()));

    for (let i = 0; i < count; i++) {
        keys.push(getIsoWeekInfo(cursor).weekKey);
        cursor.setUTCDate(cursor.getUTCDate() - 7);
    }

    return keys.reverse();
};

export const calculateScheduleMetrics = (
    scheduleCells: ScheduleCellsMap | null | undefined,
    activeEmployeeIds: string[],
    referenceDate: Date = new Date()
): ScheduleMetrics => {
    const metrics: ScheduleMetrics = {
        totalSlots: 0,
        uniquePatients: 0,
        breaks: 0,
        massageOrPnf: 0,
        everyOtherDay: 0,
        hydrotherapy: 0,
        endingToday: 0,
        endingSoon: 0,
        overdue: 0,
        extendedTreatments: 0,
        longExtensions: 0,
        missingTreatmentDates: 0,
        duplicatePatientEntries: 0,
        handoverMorning: 0,
        handoverAfternoon: 0,
        dataQualityScore: 100,
        byEmployee: {},
        byHour: {},
        possibleSlots: generateScheduleTimeSlots().length * activeEmployeeIds.length,
        availableSlots: 0,
        occupancyPercent: 0,
    };

    const uniquePatients = new Set<string>();
    const patientEntryCounts = new Map<string, number>();

    activeEmployeeIds.forEach(id => {
        metrics.byEmployee[id] = 0;
    });

    if (!scheduleCells) {
        metrics.availableSlots = metrics.possibleSlots;
        return metrics;
    }

    const registerPatient = (
        employeeId: string,
        time: string,
        patientName: string,
        treatmentStartDate?: string | null,
        treatmentEndDate?: string | null,
        treatmentExtensionDays?: number | null
    ): void => {
        metrics.totalSlots++;
        metrics.byEmployee[employeeId] = (metrics.byEmployee[employeeId] || 0) + 1;
        metrics.byHour[time] = (metrics.byHour[time] || 0) + 1;
        const normalizedPatientName = patientName.trim().toLocaleLowerCase('pl-PL');
        uniquePatients.add(normalizedPatientName);
        patientEntryCounts.set(normalizedPatientName, (patientEntryCounts.get(normalizedPatientName) || 0) + 1);

        const minutes = getMinutesFromTime(time);
        if (minutes <= 10 * 60 + 30) metrics.handoverMorning++;
        if (minutes >= 14 * 60 + 30) metrics.handoverAfternoon++;

        const extensionDays = getNumber(treatmentExtensionDays);
        if (extensionDays > 0) metrics.extendedTreatments++;
        if (extensionDays >= 15) metrics.longExtensions++;

        if (!treatmentStartDate || !treatmentEndDate) {
            metrics.missingTreatmentDates++;
            return;
        }

        const diffDays = getDateDiffInDays(treatmentEndDate, referenceDate);
        if (diffDays < 0) {
            metrics.overdue++;
        } else if (diffDays === 0) {
            metrics.endingToday++;
        } else if (diffDays <= 3) {
            metrics.endingSoon++;
        }
    };

    for (const [time, row] of Object.entries(scheduleCells)) {
        for (const employeeId of activeEmployeeIds) {
            const cell = row?.[employeeId];
            if (!cell) continue;

            if (cell.isBreak) {
                metrics.breaks++;
                continue;
            }

            if (cell.isSplit) {
                if (cell.isHydrotherapy1) metrics.hydrotherapy++;
                if (cell.isHydrotherapy2) metrics.hydrotherapy++;

                if (isFilled(cell.content1) && !cell.isHydrotherapy1) {
                    registerPatient(
                        employeeId,
                        time,
                        cell.content1,
                        cell.treatmentData1?.startDate,
                        cell.treatmentData1?.endDate,
                        cell.treatmentData1?.extensionDays
                    );
                    if (cell.isMassage1 || cell.isPnf1) metrics.massageOrPnf++;
                    if (cell.isEveryOtherDay1) metrics.everyOtherDay++;
                }
                if (isFilled(cell.content2) && !cell.isHydrotherapy2) {
                    registerPatient(
                        employeeId,
                        time,
                        cell.content2,
                        cell.treatmentData2?.startDate,
                        cell.treatmentData2?.endDate,
                        cell.treatmentData2?.extensionDays
                    );
                    if (cell.isMassage2 || cell.isPnf2) metrics.massageOrPnf++;
                    if (cell.isEveryOtherDay2) metrics.everyOtherDay++;
                }
            } else {
                if (cell.isHydrotherapy) {
                    metrics.hydrotherapy++;
                    continue;
                }

                if (isFilled(cell.content)) {
                    registerPatient(
                        employeeId,
                        time,
                        cell.content,
                        cell.treatmentStartDate,
                        cell.treatmentEndDate,
                        cell.treatmentExtensionDays
                    );
                    if (cell.isMassage || cell.isPnf) metrics.massageOrPnf++;
                    if (cell.isEveryOtherDay) metrics.everyOtherDay++;
                }
            }
        }
    }

    metrics.uniquePatients = uniquePatients.size;
    metrics.duplicatePatientEntries = Array.from(patientEntryCounts.values())
        .reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    metrics.availableSlots = Math.max(0, metrics.possibleSlots - metrics.breaks - metrics.hydrotherapy);
    metrics.occupancyPercent = metrics.availableSlots > 0
        ? Math.round((metrics.totalSlots / metrics.availableSlots) * 100)
        : 0;
    const qualityPenalty = (metrics.missingTreatmentDates * 8)
        + (metrics.duplicatePatientEntries * 6)
        + (metrics.overdue * 4);
    metrics.dataQualityScore = Math.max(0, Math.min(100, 100 - qualityPenalty));

    return metrics;
};

const overlapsDate = (leave: LeaveEntry, dateIso: string): boolean => leave.startDate <= dateIso && leave.endDate >= dateIso;

const countWorkdaysInOverlap = (leave: LeaveEntry, rangeStartIso: string, rangeEndIso: string): number => {
    const start = createUtcDate(leave.startDate > rangeStartIso ? leave.startDate : rangeStartIso);
    const end = createUtcDate(leave.endDate < rangeEndIso ? leave.endDate : rangeEndIso);
    let count = 0;

    for (const current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
        const day = current.getUTCDay();
        if (day !== 0 && day !== 6) count++;
    }

    return count;
};

export const calculateLeaveDaysInWeek = (leavesData: LeavesMap, weekStart: string, weekEnd: string): number => {
    let total = 0;

    Object.values(leavesData).forEach(leaves => {
        leaves.forEach(leave => {
            if (leave.startDate <= weekEnd && leave.endDate >= weekStart) {
                total += countWorkdaysInOverlap(leave, weekStart, weekEnd);
            }
        });
    });

    return total;
};

export const calculateAverageAvailableEmployees = (
    employees: EmployeesMap,
    leavesData: LeavesMap,
    weekStart: string,
    weekEnd: string
): number => {
    const activeEntries = Object.entries(employees).filter(([, employee]) => !employee.isHidden && !employee.isScheduleOnly);
    if (activeEntries.length === 0) return 0;

    const start = createUtcDate(weekStart);
    const end = createUtcDate(weekEnd);
    let workdays = 0;
    let availableTotal = 0;

    for (const current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
        const day = current.getUTCDay();
        if (day === 0 || day === 6) continue;

        workdays++;
        const dateIso = formatDate(current);
        const availableToday = activeEntries.filter(([employeeId]) => {
            const displayName = getEmployeeDisplayName(employeeId, employees[employeeId]);
            const leaves = leavesData[displayName] || [];
            return !leaves.some(leave => overlapsDate(leave, dateIso));
        }).length;
        availableTotal += availableToday;
    }

    return workdays > 0 ? roundToOne(availableTotal / workdays) : activeEntries.length;
};

export const getEmployeeDisplayName = (employeeId: string, employee: Employee): string =>
    employee.displayName || employee.name || `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || `Pracownik ${Number.parseInt(employeeId, 10) + 1}`;

export const createWeeklyStatsSnapshot = (
    scheduleCells: ScheduleCellsMap | null | undefined,
    employees: EmployeesMap,
    leavesData: LeavesMap,
    referenceDate: Date = new Date()
): WeeklyStatsSnapshot => {
    const week = getIsoWeekInfo(referenceDate);
    const activeEmployeeIds = getActiveEmployeeIds(employees);
    const scheduleMetrics = calculateScheduleMetrics(scheduleCells, activeEmployeeIds);
    const averageAvailableEmployees = calculateAverageAvailableEmployees(employees, leavesData, week.weekStart, week.weekEnd);

    return {
        weekKey: week.weekKey,
        year: week.year,
        weekNumber: week.weekNumber,
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        updatedAt: new Date().toISOString(),
        scheduleMetrics,
        activeEmployeeCount: activeEmployeeIds.length,
        averageAvailableEmployees,
        leaveDays: calculateLeaveDaysInWeek(leavesData, week.weekStart, week.weekEnd),
        averagePatientsPerAvailableEmployee: averageAvailableEmployees > 0
            ? roundToOne(scheduleMetrics.totalSlots / averageAvailableEmployees)
            : 0,
    };
};

export const calculateWeeklyAverages = (
    snapshots: WeeklyStatsSnapshot[],
    referenceDate: Date = new Date(),
    weekCount = 4
): WeeklyAverages => {
    const recentKeys = new Set(getRecentIsoWeekKeys(referenceDate, weekCount));
    const weeks = snapshots
        .filter(snapshot => recentKeys.has(snapshot.weekKey))
        .sort((a, b) => a.weekKey.localeCompare(b.weekKey));

    const divisor = weeks.length || 1;
    const averageTotalSlots = roundToOne(weeks.reduce((sum, week) => sum + week.scheduleMetrics.totalSlots, 0) / divisor);
    const averageUniquePatients = roundToOne(weeks.reduce((sum, week) => sum + week.scheduleMetrics.uniquePatients, 0) / divisor);
    const averageOccupancyPercent = roundToOne(weeks.reduce((sum, week) => sum + week.scheduleMetrics.occupancyPercent, 0) / divisor);
    const averageAvailableEmployees = roundToOne(weeks.reduce((sum, week) => sum + week.averageAvailableEmployees, 0) / divisor);
    const averagePatientsPerAvailableEmployee = roundToOne(weeks.reduce((sum, week) => sum + week.averagePatientsPerAvailableEmployee, 0) / divisor);
    const totalLeaveDays = roundToOne(weeks.reduce((sum, week) => sum + week.leaveDays, 0));

    const previous = weeks.length > 1 ? weeks[weeks.length - 2].scheduleMetrics.totalSlots : null;
    const current = weeks.length > 0 ? weeks[weeks.length - 1].scheduleMetrics.totalSlots : null;
    const trendPercent = previous && current !== null
        ? roundToOne(((current - previous) / previous) * 100)
        : null;

    return {
        weeks,
        averageTotalSlots,
        averageUniquePatients,
        averageOccupancyPercent,
        averageAvailableEmployees,
        averagePatientsPerAvailableEmployee,
        totalLeaveDays,
        trendPercent,
    };
};
