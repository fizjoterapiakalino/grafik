# Statistics Module Redesign („Obciążenie i Sumienność” — Wariant A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 5-tab Statistics page with a single tamper-resistant „Obciążenie i Sumienność” view (Wariant A) supporting 1-week, 2-week (shift rotation), monthly, and yearly workload metrics plus live column-hygiene indicators, while closing undated/expired cell loopholes in the Schedule editor.

**Architecture:** Extract pure 14-day rotation period generation into `scripts/rotation-periods.ts` (shared by `changes-rotation.ts` and `statistics-helpers.ts`), harden treatment-date initialization across paste/move/split-modal flows in `schedule-*.ts`, rebuild `statistics-helpers.ts` + `workload-snapshot.ts` around active 30-minute slots (max 1 per cell, cutting off entries at `date > endDate` and excluding undated cells), and rewrite `pages/statistics.html`, `styles/statistics.css`, and `scripts/statistics.ts` as a single-screen Chart.js + table dashboard.

**Tech Stack:** TypeScript (strict ESM), HTML5, CSS3 custom properties, Chart.js (global `Chart`), Firebase Firestore compat wrapper (`statsDaily`, `schedules/mainSchedule`, `leaves/mainLeaves`), Jest + `tsc -p tsconfig.tests.json`, Vite.

**Spec:** `docs/superpowers/specs/2026-10-30-statistics-redesign-design.md`

## Global Constraints

- **No patient registry (RODO):** Never deduplicate or track patients across cells or days; stop writing normalized patient names (`legacy:<name>`) into new `statsDaily` snapshots.
- **Active employees scope:** All employees in `EmployeeManager.getAll()` with `!employee.isHidden` participate in workload & hygiene statistics (including `isScheduleOnly: true` therapists who work in `mainSchedule`).
- **1 cell (30 min) = max 1 active slot:** A schedule cell contributes `1` to `patientSlots` on workday `D` iff `!isBreak && !isHydrotherapy` and at least one non-hydrotherapy entry/part in that cell has non-empty text, a valid `startDate`, `startDate <= D <= effectiveEndDate`, and satisfies `isEveryOtherDay` parity.
- **Bell cutoff (`D > effectiveEndDate`):** Day 15 (`D === effectiveEndDate`) is the final treatment day and counts as active (`+1`); from `D > effectiveEndDate` the entry contributes `0` to workload and counts as an overdue bell (`🔔`) in live hygiene metrics. Visual `.treatment-end-marker` in `scripts/schedule-logic.ts` (`endDate <= todayStr`) remains unchanged.
- **No immortal undated cells:** Missing `startDate` evaluates to inactive (`0` workload) and increments `undatedEntries` in live hygiene metrics.
- **Immutable history:** Past `statsDaily/{date < today}` documents are never modified; opening Schedule or Statistics on a clinical workday auto-creates `statsDaily/{today}` if missing (`ensureTodayWorkloadSnapshot`).
- **Execution environment:** Run `npm` commands from `/data/data/com.termux/files/home/GrafikKalinowa` (bind-mounted to `/mnt/sdcard/Download/GrafikKalinowa`). All code must pass `npm run type-check`, `npm run lint`, `npm test`, and `npm run build` with zero warnings.

## Review Focus

1. **Cross-year `weekly` / `biweekly` periods and January previous-period delta:** A 2-week rotation period or ISO week spanning Dec–Jan (e.g. `2025-12-29` to `2026-01-09`) must include snapshots from both calendar years rather than dropping December days via `s.year === year`.
2. **Ongoing or future period workday coverage (`expectedWorkdaysCount`):** On Wednesday of an ongoing 10-workday rotation period, expected workdays must cap at `referenceDate` (`3 / 3 dni roboczych`, not `3 / 10`), and future unstarted periods must return `0 / 0` without division-by-zero (`NaN`).
3. **Mixed split cell (`isSplit: true`) with one overdue half and one active half:** Must count as `1` active workload slot for today while still reporting `1` overdue bell (`🔔`) at that time slot in `calculateColumnHygieneMetrics`.
4. **`Ctrl+V` pasting a split cell where one half is ongoing (`endDate >= today`) and one half is expired (`endDate < today`) or undated:** Must preserve the ongoing half's dates and reset only the expired/undated half to `today`.
5. **Column `lastUpdated` with UTC evening history timestamps, future-scheduled `startDate`, or malformed date strings:** Must convert valid timestamps to local `YYYY-MM-DD`, clamp `daysAgo` at `>= 0` (`Dziś` for `<= 0`), and ignore malformed strings without throwing `RangeError`.

---

### Task 1: Shared 2-Week Rotation Helper & Schedule Treatment-Date Integrity

**Files:**
- Create: `scripts/rotation-periods.ts`
- Modify: `scripts/changes-rotation.ts:32-76`
- Modify: `scripts/schedule-helpers.ts:132-200,442-450`
- Modify: `scripts/schedule-drag-drop.ts:212-267`
- Modify: `scripts/schedule-events.ts:400-426`
- Modify: `scripts/schedule-modals.ts:127-205`
- Modify: `tsconfig.tests.json`
- Test: `tests/changes-rotation.test.js`
- Test: `tests/schedule-helpers.test.js`

**Interfaces:**
- Produces in `scripts/rotation-periods.ts`:
  - `export interface RotationPeriod { start: string; end: string; }`
  - `export const isWeekend = (date: Date): boolean`
  - `export const generateTwoWeekPeriods = (year: number): RotationPeriod[]`
  - `export const findRotationPeriodForDate = (dateIso: string): RotationPeriod` (returns the continuous 14-day period Mon..Fri-of-week-2 containing `dateIso`, including weekend days Sat/Sun mapped to their enclosing 14-day block `startMs .. startMs + 13 * ONE_DAY_MS`)
- Produces in `scripts/schedule-helpers.ts`:
  - `export const ensureActiveTreatmentDates = (state: CellState, options?: { resetIfExpired?: boolean; todayIso?: string }): void`
- Consumed by `scripts/changes-rotation.ts`: re-exports `RotationPeriod`, `isWeekend`, `generateTwoWeekPeriods` so existing callers and `tests/changes-rotation.test.js` remain 100% compatible.

- [ ] **Step 1: Add failing tests for `findRotationPeriodForDate`, `ensureActiveTreatmentDates` (including mixed split paste & move), and split-cell `openPatientInfoModal`**

Add tests in `tests/changes-rotation.test.js` (importing `findRotationPeriodForDate` from `../scripts/rotation-periods.js`) asserting `findRotationPeriodForDate('2026-10-24')` (Saturday between week 1 and week 2 of a 14-day block) returns the enclosing `RotationPeriod` (`start <= '2026-10-24'` and within 13 days of `start`).

Add tests in `tests/schedule-helpers.test.js`:
1. `ensureActiveTreatmentDates` with `{ resetIfExpired: false, todayIso: '2026-10-30' }` fills missing `treatmentStartDate`/`treatmentEndDate` on normal & split cells while keeping existing dates (even expired ones during simple move if `resetIfExpired` is false, and filling missing `endDate` from `startDate`).
2. `ensureActiveTreatmentDates` with `{ resetIfExpired: true, todayIso: '2026-10-30' }` on a split cell where `treatmentData1` has `startDate: '2026-09-01', endDate: '2026-09-19'` (expired) and `treatmentData2` has `startDate: '2026-10-26', endDate: '2026-11-16'` (active) resets `treatmentData1.startDate` to `'2026-10-30'` (`extensionDays: 0`) while keeping `treatmentData2.startDate === '2026-10-26'`.
3. `createTargetUpdateFn` on a legacy undated source cell (`{ content: 'Kowalski' }`) populates `treatmentStartDate` and `treatmentEndDate` on target.
4. `ScheduleModals.openPatientInfoModal` (create minimal DOM elements `#patientInfoModal`, `#patientName`, `#treatmentStartDate`, `#treatmentExtensionDays`, `#treatmentEndDate`, `#savePatientInfoModal`, `#closePatientInfoModal`, `#additionalInfo` and a `.split-cell-wrapper` with two child `<div>`s) opened on the 2nd child `<div>` reads `cellState.treatmentData2.startDate`, and clicking `#savePatientInfoModal` updates `state.treatmentData2` without writing root `state.treatmentStartDate` (and defaults blank `startDateInput.value` to today).

- [ ] **Step 2: Run Jest to verify new tests fail**

Run: `cd /data/data/com.termux/files/home/GrafikKalinowa && npm test -- tests/changes-rotation.test.js tests/schedule-helpers.test.js`
Expected: FAIL (`Cannot find module '../scripts/rotation-periods.js'` / `ensureActiveTreatmentDates is not a function`).

- [ ] **Step 3: Implement `scripts/rotation-periods.ts`, update `changes-rotation.ts`, and harden treatment dates in `schedule-helpers.ts`, `schedule-drag-drop.ts`, `schedule-events.ts`, `schedule-modals.ts`, and `tsconfig.tests.json`**

1. Create `scripts/rotation-periods.ts` moving `EPOCH_MONDAY`, `ONE_DAY_MS`, `ONE_PERIOD_MS`, `RotationPeriod`, `isWeekend`, and `generateTwoWeekPeriods` from `scripts/changes-rotation.ts`, plus `findRotationPeriodForDate(dateIso: string): RotationPeriod` using `k = Math.floor((Date.UTC(y, m - 1, d) - EPOCH_MONDAY) / ONE_PERIOD_MS)`. Re-export `RotationPeriod`, `isWeekend`, and `generateTwoWeekPeriods` from `scripts/changes-rotation.ts`.
2. Implement `ensureActiveTreatmentDates(state, options)` in `scripts/schedule-helpers.ts`; invoke `{ resetIfExpired: false }` at the end of `createTargetUpdateFn`'s returned mutator.
3. In `scripts/schedule-drag-drop.ts`, call `ensureActiveTreatmentDates(targetState, { resetIfExpired: false })` at the end of `applyTargetAutoSplit`, `applyTargetPartUpdate`, and `applyTargetNormalUpdate`.
4. In `scripts/schedule-events.ts` (`Ctrl+V` handler), after `Object.assign(state, source); state.history = existingHistory;`, call `ensureCellPatientIds(state)` and `ensureActiveTreatmentDates(state, { resetIfExpired: true })`.
5. In `scripts/schedule-modals.ts` (`openPatientInfoModal`), detect `const targetPart = cellState.isSplit ? (getTargetPart(element) ?? 1) : null;`. Read from `cellState[`treatmentData${targetPart}`]` when `targetPart` is `1 | 2` (or root fields otherwise); on save, use `const effectiveStart = startDateInput.value.trim() || getTodayDate();`, compute `endDate = ScheduleLogic.calculateEndDate(effectiveStart, extDays)`, and write to `state[`treatmentData${targetPart}`]` when `targetPart` is set, else root fields.
6. Add `"scripts/rotation-periods.ts"` and `"scripts/schedule-modals.ts"` to `tsconfig.tests.json`.

- [ ] **Step 4: Run tests, type-check, and lint**

Run: `cd /data/data/com.termux/files/home/GrafikKalinowa && npm test -- tests/changes-rotation.test.js tests/schedule-helpers.test.js && npm run type-check && npm run lint`
Expected: PASS with 0 errors and 0 warnings.

- [ ] **Step 5: Commit Task 1**

```bash
git -C /mnt/sdcard/Download/GrafikKalinowa add scripts/rotation-periods.ts scripts/changes-rotation.ts scripts/schedule-helpers.ts scripts/schedule-drag-drop.ts scripts/schedule-events.ts scripts/schedule-modals.ts tsconfig.tests.json tests/changes-rotation.test.js tests/schedule-helpers.test.js
git -C /mnt/sdcard/Download/GrafikKalinowa commit -m "fix(schedule): extract rotation periods and enforce treatment dates on paste, move, and split modal"
```

---

### Task 2: Tamper-Resistant Statistics Engine, Column Hygiene & Auto-Snapshot

**Files:**
- Modify: `scripts/statistics-helpers.ts`
- Modify: `scripts/workload-snapshot.ts`
- Modify: `scripts/schedule-data.ts:285-305`
- Test: `tests/statistics-helpers.test.js`
- Create: `tests/workload-snapshot.test.js`

**Interfaces:**
- Consumes from Task 1: `generateTwoWeekPeriods`, `findRotationPeriodForDate`, `RotationPeriod` from `./rotation-periods.js`; `ScheduleLogic.calculateEndDate` from `./schedule-logic.js`.
- Produces in `scripts/statistics-helpers.ts`:
  - `export type WorkloadPeriodType = 'weekly' | 'biweekly' | 'monthly' | 'yearly';`
  - `export interface IsoWeekOption { weekKey: string; weekNumber: number; weekStart: string; weekEnd: string; label: string; }`
  - `export const getIsoWeeksForYear = (year: number): IsoWeekOption[]`
  - `export const isClinicalWorkday = (dateIso: string): boolean`
  - `export const countClinicalWorkdaysInRange = (startIso: string, endIso: string): number`
  - `export interface DailyEmployeeWorkload { employeeId: string; employeeName: string; patientSlots: number; availableSlots: number; occupancyPercent: number; isOnLeave: boolean; leaveType?: string | null; uniquePatients?: number; patientIds?: string[]; }`
  - `export interface DailyWorkloadSnapshot { version?: number; date: string; year: number; month: number; dayOfWeek: number; weekKey: string; isWorkday: boolean; updatedAt: string; employees: Record<string, DailyEmployeeWorkload>; totalPatients: number; activeEmployeesCount: number; }`
  - `export interface EmployeePeriodWorkloadSummary { employeeId: string; employeeName: string; color: string; workdaysInPeriod: number; daysPresent: number; daysOnLeave: number; totalActiveSlots: number; averageSlotsPerPresentDay: number; dailyBreakdown: Record<string, DailyEmployeeWorkload>; }`
  - `export interface PeriodWorkloadAverages { periodType: WorkloadPeriodType; periodKey: string; periodLabel: string; rangeStart: string; rangeEnd: string; recordedWorkdaysCount: number; expectedWorkdaysCount: number; totalPersonDaysPresent: number; totalActiveSlots: number; employeesWithPresenceCount: number; averageDailyPerPresentEmployee: number; averagePeriodSumPerPresentEmployee: number; previousPeriodDeltaDaily: number | null; employees: EmployeePeriodWorkloadSummary[]; }`
  - `export interface EmployeeColumnHygiene { employeeId: string; overdueBellsCount: number; overdueTimes: string[]; activeExtensionsCount: number; activeExtensionDaysSum: number; undatedCount: number; lastUpdatedIso: string | null; lastUpdatedDaysAgo: number | null; }`
  - `export interface ColumnHygieneReport { totalOverdueBells: number; undatedEntries: Array<{ employeeId: string; employeeName: string; time: string }>; byEmployee: Record<string, EmployeeColumnHygiene>; }`
  - `export const createDailyWorkloadSnapshot = (scheduleCells: ScheduleCellsMap | null | undefined, employees: EmployeesMap, leavesData: LeavesMap, targetDate?: Date): DailyWorkloadSnapshot`
  - `export const calculatePeriodWorkloadAverages = (snapshots: DailyWorkloadSnapshot[], periodType: WorkloadPeriodType, options: { weekKey?: string; periodStart?: string; periodEnd?: string; month?: number; year: number; employees: EmployeesMap; referenceDate?: Date }): PeriodWorkloadAverages`
  - `export const calculateColumnHygieneMetrics = (scheduleCells: ScheduleCellsMap | null | undefined, employees: EmployeesMap, referenceDate?: Date): ColumnHygieneReport`
- Produces in `scripts/workload-snapshot.ts`:
  - `export const persistTodayWorkloadSnapshot = async (scheduleCells: ScheduleCellsMap, referenceDate?: Date): Promise<DailyWorkloadSnapshot | null>`
  - `export const ensureTodayWorkloadSnapshot = async (scheduleCells: ScheduleCellsMap, referenceDate?: Date): Promise<DailyWorkloadSnapshot | null>` (reads `statsDaily/{todayIso}` first on clinical workdays; if `doc.exists` returns `doc.data()` without writing; otherwise delegates to `persistTodayWorkloadSnapshot`).

*Note on `scripts/statistics.ts` compile safety during Task 2:* Because `scripts/statistics.ts` is rewritten in Task 3 and currently imports old symbols from `statistics-helpers.ts`, Task 2 must focus verification on `npx tsc -p tsconfig.tests.json --noEmit` + Jest tests (`scripts/statistics.ts` is not in `tsconfig.tests.json`), OR Task 3 runs immediately after Task 2 before full `npm run type-check`. Keep `scripts/statistics.ts` untouched in Task 2 so file ownership is 100% clean.

- [ ] **Step 1: Rewrite `tests/statistics-helpers.test.js` and create `tests/workload-snapshot.test.js` with failing tests covering all spec rules and Review Focus edge cases**

Cover in `tests/statistics-helpers.test.js`:
1. `getActiveEmployeeIds` includes `isScheduleOnly: true` employees and excludes `isHidden: true`.
2. `createDailyWorkloadSnapshot`:
   - Counts day 15 (`dateIso === treatmentEndDate`) as `1` active slot, and day 16 (`dateIso > treatmentEndDate`) as `0` slots.
   - Derives `effectiveEndDate` via `ScheduleLogic.calculateEndDate` when `treatmentStartDate` exists and `treatmentEndDate` is missing.
   - Excludes undated cells (`!treatmentStartDate`) -> `0` slots.
   - Counts split cell `A / B` with two simultaneously active halves as **`1`** slot (not `2`), and `1` slot when one half is expired and one half is active.
   - Does NOT write `patientIds` containing patient names (`patientIds` undefined or empty).
   - Respects Polish holidays (`isWorkday === false`, `0` slots), leaves (`isOnLeave === true`, `0` slots), and `isEveryOtherDay`.
3. `calculatePeriodWorkloadAverages`:
   - Supports `'weekly'`, `'biweekly'` (including cross-year Dec 2025 – Jan 2026 snapshots!), `'monthly'`, and `'yearly'`.
   - Caps `expectedWorkdaysCount` at `referenceDate` for an ongoing period (`3 / 3` on Wednesday) and returns `0` for future periods without `NaN`.
   - Divides `averagePeriodSumPerPresentEmployee` by `employeesWithPresenceCount` (excluding an employee on 2-week leave with `daysPresent === 0`).
   - Computes `previousPeriodDeltaDaily` against the immediately preceding period (including Jan vs Dec of `year - 1`).
4. `calculateColumnHygieneMetrics`:
   - Mixed split cell (one overdue half `endDate < today`, one active half with `extensionDays: 3`) reports `overdueBellsCount: 1`, `overdueTimes: ['8:30']`, `activeExtensionsCount: 1`, `activeExtensionDaysSum: 3`.
   - Reports `undatedEntries` when a filled non-break/non-hydro cell lacks `startDate`.
   - Computes `lastUpdatedIso` and `lastUpdatedDaysAgo` from `max(startDate, localDate(history[0].timestamp))`, handling late-UTC evening timestamps, clamping future `startDate` to `daysAgo = 0`, and ignoring invalid timestamp strings without throwing.

Cover in `tests/workload-snapshot.test.js`:
- `ensureTodayWorkloadSnapshot` skips `.set()` when `statsDaily/{today}` already exists, writes `.set()` when `statsDaily/{today}` does not exist on a workday, and does not write on a weekend/holiday.

- [ ] **Step 2: Run Jest to verify new tests fail**

Run: `cd /data/data/com.termux/files/home/GrafikKalinowa && npm test -- tests/statistics-helpers.test.js tests/workload-snapshot.test.js`
Expected: FAIL (`calculateColumnHygieneMetrics is not a function` / `ensureTodayWorkloadSnapshot is not a function`).

- [ ] **Step 3: Implement `scripts/statistics-helpers.ts`, `scripts/workload-snapshot.ts`, and initial-load `ensureTodayWorkloadSnapshot` hook in `scripts/schedule-data.ts`**

1. Refactor `scripts/statistics-helpers.ts` to remove dead `statsWeekly` / duplicate-patient / shift-handover functions and implement all interfaces above cleanly. Sort `employees` in `calculatePeriodWorkloadAverages` cleanly (preserving `getActiveEmployeeIds` order).
2. Add `ensureTodayWorkloadSnapshot` in `scripts/workload-snapshot.ts`.
3. In `scripts/schedule-data.ts`, when the initial Firestore `onSnapshot` receives `mainSchedule` cells (non-empty `appState.scheduleCells` on first load), trigger `void ensureTodayWorkloadSnapshot(appState.scheduleCells).catch(...)` once per session (`let initialSnapshotEnsured = false;`, reset in `destroy()`).

- [ ] **Step 4: Run Jest tests on `statistics-helpers`, `workload-snapshot`, and `schedule-data`**

Run: `cd /data/data/com.termux/files/home/GrafikKalinowa && npm test -- tests/statistics-helpers.test.js tests/workload-snapshot.test.js tests/schedule-data.test.js`
Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git -C /mnt/sdcard/Download/GrafikKalinowa add scripts/statistics-helpers.ts scripts/workload-snapshot.ts scripts/schedule-data.ts tests/statistics-helpers.test.js tests/workload-snapshot.test.js
git -C /mnt/sdcard/Download/GrafikKalinowa commit -m "feat(statistics): implement tamper-resistant slot metrics, biweekly periods, and column hygiene"
```

---

### Task 3: Single-Screen „Wariant A: Obciążenie i Sumienność” UI & Controller

**Files:**
- Modify: `pages/statistics.html`
- Modify: `styles/statistics.css`
- Modify: `scripts/statistics.ts`
- Modify: `tsconfig.tests.json`
- Create: `tests/statistics-ui.test.js`

**Interfaces:**
- Consumes from Task 1 & Task 2:
  - `generateTwoWeekPeriods`, `findRotationPeriodForDate` from `./rotation-periods.js`
  - `calculatePeriodWorkloadAverages`, `calculateColumnHygieneMetrics`, `createDailyWorkloadSnapshot`, `getIsoWeekInfo`, `getIsoWeeksForYear`, `normalizeLeavesData`, `WorkloadPeriodType`, `DailyWorkloadSnapshot`, `PeriodWorkloadAverages`, `ColumnHygieneReport` from `./statistics-helpers.js`
  - `persistTodayWorkloadSnapshot`, `ensureTodayWorkloadSnapshot` from `./workload-snapshot.js`
- Produces in `scripts/statistics.ts`:
  - `export const Statistics: { init(): Promise<void>; destroy(): void }` (unchanged public contract consumed by `scripts/router.ts`).
- Exact DOM IDs in `pages/statistics.html`:
  - Period buttons (`[data-period="weekly" | "biweekly" | "monthly" | "yearly"]`): `#periodWeeklyBtn`, `#periodBiweeklyBtn` (default `.active`), `#periodMonthlyBtn`, `#periodYearlyBtn`
  - Selectors: `#statsYearSelect`, `#statsPeriodSelectGroup`, `#statsPeriodSelectLabel`, `#statsPeriodSelect`
  - Snapshot status: `#workloadSnapshotDate`, `#refreshWorkloadSnapshotBtn`
  - Undated warning banner: `#undatedWarningBanner` (hidden when `undatedEntries.length === 0`), `#undatedWarningText`
  - 4 KPI cards:
    - `#kpiAvgDailyValue`, `#kpiAvgDailySub`
    - `#kpiAvgPeriodSumValue`, `#kpiAvgPeriodSumSub`
    - `#kpiOverdueBellsValue`, `#kpiOverdueBellsSub`
    - `#kpiWorkdayCoverageValue`, `#kpiWorkdayCoverageSub`
  - Chart: `<canvas id="workloadComparisonChart"></canvas>`
  - Table: `#workloadHygieneTable`, `<th id="periodSumHeader">Suma (2 tyg.)</th>`, `<tbody id="workloadHygieneBody"></tbody>`

- [ ] **Step 1: Write failing JSDOM UI integration tests in `tests/statistics-ui.test.js`**

Add `"scripts/statistics.ts"` to `tsconfig.tests.json` and create `tests/statistics-ui.test.js` (mocking `firebase-config.js`, `employee-manager.js`, and `global.Chart`):
1. Loads `pages/statistics.html` into `document.body`, seeds 2 employees (`Anna K.`, `Marek W.`), `mainSchedule` (with active turnuses, 2 overdue bells on `Marek W.` at `08:00` and `13:00`, 1 active `+3 dni` extension on `Anna K.`, and 1 undated cell), and `statsDaily` snapshots across a 2-week period.
2. Verifies `await Statistics.init()`:
   - Default active period button is `#periodBiweeklyBtn` (`2 Tygodnie (Zmiana)`).
   - KPI cards display expected active daily average, team period sum per present employee, `2` overdue bells (`#kpiOverdueBellsValue`), and workday coverage `X / Y`.
   - `#undatedWarningBanner` is visible when an undated cell exists, and hidden when all cells have dates.
   - `#workloadHygieneBody` renders 2 rows sorted by `EmployeeManager.compareEmployees` with exact columns: employee name, workdays + leave note, daily avg, period sum, bell badge with `title` containing `08:00, 13:00`, `+3 dni (1 wpis)`, and `Ost. aktualizacja kolumny` (`Dziś` / `X dni temu`).
   - Switching to `#periodWeeklyBtn`, `#periodMonthlyBtn`, and `#periodYearlyBtn` updates `#periodSumHeader` (`Suma (1 tydz.)`, `Suma (miesiąc)`, `Suma (rok)`), hides `#statsPeriodSelectGroup` in `yearly` mode, and re-renders Chart.js horizontal bars (`indexAxis: 'y'`) with 2 datasets (*Śr. aktywnych slotów / dzień pracy* and *Zaległe dzwoneczki 🔔 dziś (odcięte)*).
   - Verifies absence of deleted views (`#leavesStatsView`, `#employeeStatsView`, `#overviewView`, `#scheduleStatsView` all `null`).

- [ ] **Step 2: Run Jest to verify `tests/statistics-ui.test.js` fails**

Run: `cd /data/data/com.termux/files/home/GrafikKalinowa && npm test -- tests/statistics-ui.test.js`
Expected: FAIL (old `pages/statistics.html` lacks `#periodBiweeklyBtn` / `#workloadHygieneBody`, and `scripts/statistics.ts` fails compile against updated `statistics-helpers.ts`).

- [ ] **Step 3: Implement `pages/statistics.html`, `styles/statistics.css`, and `scripts/statistics.ts`**

1. Rewrite `pages/statistics.html` into the single-screen Wariant A layout with the exact IDs listed above and no tabs.
2. Rewrite `scripts/statistics.ts`:
   - Query `statsDaily` for `year in [currentYear - 1, currentYear, currentYear + 1]` (or fallback client filter + `localStorage` cache `kalinowa.stats.dailyWorkload.v2`) so cross-year weeks/biweekly periods and January vs December trend comparisons work seamlessly.
   - On `init()`, load employees, `leaves/mainLeaves`, `schedules/mainSchedule`, and `statsDaily`; call `ensureTodayWorkloadSnapshot` when viewing current year on a workday if today's snapshot is missing from `dailySnapshotsData`.
   - Render toolbar controls, undated banner, 4 KPI cards, horizontal Chart.js bar chart (dynamic wrapper height `Math.max(240, employees.length * 44 + 70)` px), and the 7-column hygiene & workload table with `escapeHTML` on all dynamic strings.
   - Clean up event listeners and destroy Chart instance in `destroy()`.
3. Update `styles/statistics.css` removing unused 5-tab/leaves/employee-roster rules and styling the single-screen toolbar, KPI grid, undated warning banner, horizontal chart card, hygiene badges (`.bell-badge--clean`, `.bell-badge--low`, `.bell-badge--warn`), and responsive table.

- [ ] **Step 4: Run full test suite, type-check, lint, and production build**

Run: `cd /data/data/com.termux/files/home/GrafikKalinowa && npm run type-check && npm run lint && npm test && npm run build`
Expected: PASS (all test suites passing, 0 TypeScript errors, 0 ESLint errors/warnings, clean Vite + Workbox production build).

- [ ] **Step 5: Commit Task 3**

```bash
git -C /mnt/sdcard/Download/GrafikKalinowa add pages/statistics.html styles/statistics.css scripts/statistics.ts tsconfig.tests.json tests/statistics-ui.test.js
git -C /mnt/sdcard/Download/GrafikKalinowa commit -m "feat(statistics): replace 5-tab page with single-screen Wariant A workload and hygiene dashboard"
```
