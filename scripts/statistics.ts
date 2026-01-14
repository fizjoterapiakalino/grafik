// scripts/statistics.ts
import { debugLog } from './common.js';
import { db as dbRaw } from './firebase-config.js';
import { AppConfig } from './common.js';
import { EmployeeManager } from './employee-manager.js';
import type { FirestoreDbWrapper } from './types/firebase';
import type { LeaveEntry, ScheduleAppState } from './types/index.js';

const db = dbRaw as unknown as FirestoreDbWrapper;

// Chart.js declaration
declare const Chart: {
    new(ctx: CanvasRenderingContext2D, config: object): ChartInstance;
    register(...items: unknown[]): void;
};

interface ChartInstance {
    destroy(): void;
    update(): void;
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

/**
 * Moduł statystyk
 */
export const Statistics: StatisticsAPI = (() => {
    let currentYear = new Date().getUTCFullYear();
    let leavesData: Record<string, LeaveEntry[]> = {};
    let scheduleData: ScheduleAppState | null = null;
    let chartInstances: ChartInstance[] = [];

    // DOM Elements
    let yearSelect: HTMLSelectElement | null = null;

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
                const target = e.target as HTMLButtonElement;

                // Update active tab
                tabButtons.forEach(b => b.classList.remove('active'));
                target.classList.add('active');

                // Show corresponding view
                const viewId = target.id.replace('Btn', 'View');
                const views = document.querySelectorAll('.stats-view');
                views.forEach(v => v.classList.remove('active'));
                const targetView = document.getElementById(viewId);
                if (targetView) {
                    targetView.classList.add('active');
                }
            });
        });
    };

    /**
     * Ładuje wszystkie dane
     */
    const loadAllData = async (): Promise<void> => {
        try {
            // Load leaves
            const leavesDoc = await db.collection(AppConfig.firestore.collections.leaves).doc(String(currentYear)).get();
            if (leavesDoc.exists) {
                leavesData = leavesDoc.data() as Record<string, LeaveEntry[]>;
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
        } catch (error) {
            console.error('Error loading data:', error);
        }
    };

    /**
     * Aktualizuje wszystkie statystyki
     */
    const updateAllStats = (): void => {
        updateOverviewStats();
        updateLeavesStats();
        updateScheduleStats();
        updateEmployeeStats();
        renderCharts();
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
            totalPatientsEl.textContent = String(countPatientsToday());
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
     * Liczba pacjentów dzisiaj (z harmonogramu)
     */
    const countPatientsToday = (): number => {
        if (!scheduleData?.scheduleCells) return 0;

        let count = 0;
        for (const time of Object.keys(scheduleData.scheduleCells)) {
            for (const empIdx of Object.keys(scheduleData.scheduleCells[time])) {
                const cell = scheduleData.scheduleCells[time][empIdx];
                if (cell) {
                    if (cell.isSplit) {
                        if (cell.content1 && !cell.isBreak) count++;
                        if (cell.content2) count++;
                    } else if (cell.content && !cell.isBreak) {
                        count++;
                    }
                }
            }
        }
        return count;
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
        if (!scheduleData?.scheduleCells) {
            const defaultValue = '-';
            ['uniquePatientsValue', 'totalSlotsValue', 'breaksValue', 'treatmentTypesValue'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = defaultValue;
            });
            return;
        }

        const uniquePatients = new Set<string>();
        let totalSlots = 0;
        let breaks = 0;
        let treatmentTypes = 0;

        for (const time of Object.keys(scheduleData.scheduleCells)) {
            for (const empIdx of Object.keys(scheduleData.scheduleCells[time])) {
                const cell = scheduleData.scheduleCells[time][empIdx];
                if (cell) {
                    if (cell.isBreak) {
                        breaks++;
                    } else if (cell.isSplit) {
                        if (cell.content1) {
                            uniquePatients.add(cell.content1);
                            totalSlots++;
                            if (cell.isMassage1 || cell.isPnf1) treatmentTypes++;
                        }
                        if (cell.content2) {
                            uniquePatients.add(cell.content2);
                            totalSlots++;
                            if (cell.isMassage2 || cell.isPnf2) treatmentTypes++;
                        }
                    } else if (cell.content) {
                        uniquePatients.add(cell.content);
                        totalSlots++;
                        if (cell.isMassage || cell.isPnf) treatmentTypes++;
                    }
                }
            }
        }

        const uniquePatientsEl = document.getElementById('uniquePatientsValue');
        if (uniquePatientsEl) uniquePatientsEl.textContent = String(uniquePatients.size);

        const totalSlotsEl = document.getElementById('totalSlotsValue');
        if (totalSlotsEl) totalSlotsEl.textContent = String(totalSlots);

        const breaksEl = document.getElementById('breaksValue');
        if (breaksEl) breaksEl.textContent = String(breaks);

        const treatmentTypesEl = document.getElementById('treatmentTypesValue');
        if (treatmentTypesEl) treatmentTypesEl.textContent = String(treatmentTypes);
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

            let shiftBadge = '';
            if (employee.shiftGroup === 'first') {
                shiftBadge = '<span class="shift-badge first"><i class="fas fa-sun"></i> I Zmiana</span>';
            } else if (employee.shiftGroup === 'second') {
                shiftBadge = '<span class="shift-badge second"><i class="fas fa-moon"></i> II Zmiana</span>';
            } else {
                shiftBadge = '<span class="shift-badge none">-</span>';
            }

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
        const patientCounts: Record<string, number> = {};

        // Count patients per employee
        for (const time of Object.keys(scheduleData.scheduleCells)) {
            for (const empIdx of Object.keys(scheduleData.scheduleCells[time])) {
                const cell = scheduleData.scheduleCells[time][empIdx];
                if (cell && !cell.isBreak) {
                    patientCounts[empIdx] = patientCounts[empIdx] || 0;
                    if (cell.isSplit) {
                        if (cell.content1) patientCounts[empIdx]++;
                        if (cell.content2) patientCounts[empIdx]++;
                    } else if (cell.content) {
                        patientCounts[empIdx]++;
                    }
                }
            }
        }

        const employeeIds = Object.keys(employees).filter(id => !employees[id].isHidden && !employees[id].isScheduleOnly);
        const labels = employeeIds.map(id => EmployeeManager.getNameById(id));
        const data = employeeIds.map(id => {
            // Find matching index in patientCounts
            const idx = employeeIds.indexOf(id);
            return patientCounts[String(idx)] || 0;
        });
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
        const patientCounts: Record<string, number> = {};

        // Count patients per employee
        for (const time of Object.keys(scheduleData.scheduleCells)) {
            for (const empIdx of Object.keys(scheduleData.scheduleCells[time])) {
                const cell = scheduleData.scheduleCells[time][empIdx];
                if (cell && !cell.isBreak) {
                    patientCounts[empIdx] = patientCounts[empIdx] || 0;
                    if (cell.isSplit) {
                        if (cell.content1) patientCounts[empIdx]++;
                        if (cell.content2) patientCounts[empIdx]++;
                    } else if (cell.content) {
                        patientCounts[empIdx]++;
                    }
                }
            }
        }

        const employeeIds = Object.keys(employees).filter(id => !employees[id].isHidden && !employees[id].isScheduleOnly);
        const labels: string[] = [];
        const data: number[] = [];
        const colors: string[] = [];

        employeeIds.forEach((id, idx) => {
            const count = patientCounts[String(idx)] || 0;
            if (count > 0) {
                labels.push(EmployeeManager.getNameById(id));
                data.push(count);
                colors.push(employees[id].color || '#94a3b8');
            }
        });

        const chart = new Chart(ctx.getContext('2d')!, {
            type: 'pie',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors.map(c => c + 'DD'),
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

        const patientsByTime: Record<string, number> = {};

        // Count patients per time slot
        for (const time of Object.keys(scheduleData.scheduleCells)) {
            patientsByTime[time] = 0;
            for (const empIdx of Object.keys(scheduleData.scheduleCells[time])) {
                const cell = scheduleData.scheduleCells[time][empIdx];
                if (cell && !cell.isBreak) {
                    if (cell.isSplit) {
                        if (cell.content1) patientsByTime[time]++;
                        if (cell.content2) patientsByTime[time]++;
                    } else if (cell.content) {
                        patientsByTime[time]++;
                    }
                }
            }
        }

        const sortedTimes = Object.keys(patientsByTime).sort();
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
