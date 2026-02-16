// scripts/schedule-logic.ts
import { AppConfig, capitalizeFirstLetter, isHoliday } from './common.js';

/**
 * Dane leczenia dla części komórki
 */
interface TreatmentData {
    startDate?: string;
    extensionDays?: number;
    endDate?: string;
    gender?: string;
}

/**
 * Dane komórki harmonogramu
 */
interface CellData {
    content?: string;
    content1?: string;
    content2?: string;
    isSplit?: boolean;
    isBreak?: boolean;
    isMassage?: boolean;
    isPnf?: boolean;
    isEveryOtherDay?: boolean;
    isHydrotherapy?: boolean;
    isMassage1?: boolean;
    isMassage2?: boolean;
    isPnf1?: boolean;
    isPnf2?: boolean;
    isEveryOtherDay1?: boolean;
    isHydrotherapy1?: boolean;
    isEveryOtherDay2?: boolean;
    isHydrotherapy2?: boolean;
    treatmentStartDate?: string;
    treatmentExtensionDays?: number;
    treatmentEndDate?: string;
    treatmentData1?: TreatmentData;
    treatmentData2?: TreatmentData;
}

/**
 * Dane części podzielonej komórki
 */
interface PartData {
    text: string;
    classes: string[];
    isMassage: boolean;
    isPnf: boolean;
    isEveryOtherDay: boolean;
    isHydrotherapy: boolean;
    treatmentEndDate?: string | null;
    daysRemaining?: number | null;
}

/**
 * Wynik wyświetlania komórki
 */
interface CellDisplayData {
    text: string;
    classes: string[];
    styles: Record<string, string>;
    isSplit: boolean;
    parts: PartData[];
    isBreak: boolean;
    treatmentEndDate?: string | null;
    daysRemaining?: number | null;
}

/**
 * Mapa komórek harmonogramu
 */
type ScheduleCells = Record<string, Record<string, CellData>>;

/**
 * Interfejs publicznego API ScheduleLogic
 */
interface ScheduleLogicAPI {
    getCellDisplayData(cellData: CellData | null | undefined): CellDisplayData;
    calculatePatientCount(scheduleCells: ScheduleCells | null | undefined): number;
    calculateEndDate(startDate: string | undefined, extensionDays?: number): string;
}

/**
 * Moduł logiki harmonogramu
 */
export const ScheduleLogic: ScheduleLogicAPI = (() => {
    const getCellDisplayData = (cellData: CellData | null | undefined): CellDisplayData => {
        const result: CellDisplayData = {
            text: '',
            classes: [],
            styles: {},
            isSplit: false,
            parts: [],
            isBreak: false,
        };

        if (!cellData) return result;

        // Handle Break
        if (cellData.isBreak) {
            result.text = AppConfig.schedule.breakText;
            result.classes.push('break-cell');
            result.isBreak = true;
            return result;
        }

        // Handle Split Cell
        if (cellData.isSplit) {
            result.isSplit = true;
            result.styles.backgroundColor = AppConfig.schedule.contentCellColor;
            result.classes.push('split-cell');

            const createPartData = (
                content: string | undefined,
                isMassage: boolean | undefined,
                isPnf: boolean | undefined,
                isEveryOtherDay: boolean | undefined,
                isHydrotherapy: boolean | undefined
            ): PartData => {
                const part: PartData = {
                    text: capitalizeFirstLetter(content || ''),
                    classes: [],
                    isMassage: !!isMassage,
                    isPnf: !!isPnf,
                    isEveryOtherDay: !!isEveryOtherDay,
                    isHydrotherapy: !!isHydrotherapy,
                };

                if (isMassage) part.classes.push('massage-text');
                if (isPnf) part.classes.push('pnf-text');
                if (isEveryOtherDay) part.classes.push('every-other-day-text');
                if (isHydrotherapy) {
                    part.classes.push('hydrotherapy-text');
                    part.classes.push('hydrotherapy-cell-bg'); // Helper class for partial split bg if needed
                }

                return part;
            };

            result.parts.push(
                createPartData(
                    cellData.content1,
                    cellData.isMassage1,
                    cellData.isPnf1,
                    cellData.isEveryOtherDay1,
                    cellData.isHydrotherapy1
                )
            );

            result.parts.push(
                createPartData(
                    cellData.content2,
                    cellData.isMassage2,
                    cellData.isPnf2,
                    cellData.isEveryOtherDay2,
                    cellData.isHydrotherapy2
                )
            );

            // Treatment End Markers for Split
            const todayStr = new Date().toISOString().split('T')[0];
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // Part 1
            let endDate1: string | null = cellData.treatmentData1?.endDate
                ? cellData.treatmentData1.endDate.toString().trim()
                : null;
            if (!endDate1 && cellData.treatmentData1?.startDate && cellData.content1) {
                endDate1 = calculateEndDate(cellData.treatmentData1.startDate, cellData.treatmentData1.extensionDays || 0);
            }
            if (endDate1) {
                result.parts[0].treatmentEndDate = endDate1;
                const endDateObj = new Date(endDate1 + 'T00:00:00');
                const diffTime = endDateObj.getTime() - today.getTime();
                result.parts[0].daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (endDate1 <= todayStr) {
                    result.parts[0].classes.push('treatment-end-marker');
                }
            }

            // Part 2
            let endDate2: string | null = cellData.treatmentData2?.endDate
                ? cellData.treatmentData2.endDate.toString().trim()
                : null;
            if (!endDate2 && cellData.treatmentData2?.startDate && cellData.content2) {
                endDate2 = calculateEndDate(cellData.treatmentData2.startDate, cellData.treatmentData2.extensionDays || 0);
            }
            if (endDate2) {
                result.parts[1].treatmentEndDate = endDate2;
                const endDateObj = new Date(endDate2 + 'T00:00:00');
                const diffTime = endDateObj.getTime() - today.getTime();
                result.parts[1].daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (endDate2 <= todayStr) {
                    result.parts[1].classes.push('treatment-end-marker');
                }
            }

            return result;
        }

        // Handle Normal Cell
        result.text = capitalizeFirstLetter(cellData.content || '');

        if (cellData.isMassage) result.classes.push('massage-text');
        if (cellData.isPnf) result.classes.push('pnf-text');
        if (cellData.isEveryOtherDay) result.classes.push('every-other-day-text');

        if (cellData.isHydrotherapy) {
            result.text = 'Hydro.'; // Enforce text for full cell
            result.classes.push('hydrotherapy-cell');
            result.styles.backgroundColor = 'var(--bg-hydrotherapy)'; // Direct style application
        } else {
            // Apply default or content color only if NOT hydrotherapy
            if (result.text.trim() !== '') {
                result.styles.backgroundColor = AppConfig.schedule.contentCellColor;
            } else {
                result.styles.backgroundColor = AppConfig.schedule.defaultCellColor;
            }
        }

        // Treatment End Marker for Normal
        const todayStr = new Date().toISOString().split('T')[0];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let endDateStr: string | null = cellData.treatmentEndDate
            ? cellData.treatmentEndDate.toString().trim()
            : null;

        if (!endDateStr && cellData.treatmentStartDate && cellData.content) {
            endDateStr = calculateEndDate(cellData.treatmentStartDate, cellData.treatmentExtensionDays || 0);
        }

        if (endDateStr) {
            result.treatmentEndDate = endDateStr;
            const endDateObj = new Date(endDateStr + 'T00:00:00');
            const diffTime = endDateObj.getTime() - today.getTime();
            result.daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (endDateStr <= todayStr) {
                result.classes.push('treatment-end-marker');
            }
        }

        return result;
    };

    const calculatePatientCount = (scheduleCells: ScheduleCells | null | undefined): number => {
        let count = 0;
        if (!scheduleCells) return 0;

        Object.values(scheduleCells).forEach((employeeCells) => {
            if (!employeeCells) return;
            Object.values(employeeCells).forEach((cell) => {
                if (cell.isBreak || cell.isHydrotherapy) return;

                if (cell.isSplit) {
                    if (cell.content1 && cell.content1.trim()) count++;
                    if (cell.content2 && cell.content2.trim()) count++;
                } else {
                    if (cell.content && cell.content.trim()) count++;
                }
            });
        });
        return count;
    };

    const calculateEndDate = (startDate: string | undefined, extensionDays?: number): string => {
        if (!startDate) return '';
        const endDate = new Date(startDate + 'T12:00:00Z');

        endDate.setUTCDate(endDate.getUTCDate() - 1);
        const totalDays = 15 + parseInt(String(extensionDays || 0), 10);
        let daysAdded = 0;
        while (daysAdded < totalDays) {
            endDate.setUTCDate(endDate.getUTCDate() + 1);
            const dayOfWeek = endDate.getUTCDay();
            // Pomijamy weekendy (sobota=6, niedziela=0) oraz polskie święta
            if (dayOfWeek !== 0 && dayOfWeek !== 6 && !isHoliday(endDate)) {
                daysAdded++;
            }
        }
        return endDate.toISOString().split('T')[0];
    };

    return {
        getCellDisplayData,
        calculatePatientCount,
        calculateEndDate,
    };
})();
