// scripts/schedule-logic.js
import { AppConfig, capitalizeFirstLetter } from './common.js';

export const ScheduleLogic = (() => {
    const getCellDisplayData = (cellData) => {
        const result = {
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

            const createPartData = (content, isMassage, isPnf, isEveryOtherDay, gender) => {
                const part = {
                    text: capitalizeFirstLetter(content || ''),
                    classes: [],
                    isMassage: !!isMassage,
                    isPnf: !!isPnf,
                    isEveryOtherDay: !!isEveryOtherDay,
                };

                if (isMassage) part.classes.push('massage-text');
                if (isPnf) part.classes.push('pnf-text');
                if (isEveryOtherDay) part.classes.push('every-other-day-text');

                return part;
            };

            result.parts.push(
                createPartData(
                    cellData.content1,
                    cellData.isMassage1,
                    cellData.isPnf1,
                    cellData.isEveryOtherDay1,
                    cellData.treatmentData1?.gender,
                ),
            );

            result.parts.push(
                createPartData(
                    cellData.content2,
                    cellData.isMassage2,
                    cellData.isPnf2,
                    cellData.isEveryOtherDay2,
                    cellData.treatmentData2?.gender,
                ),
            );

            // Treatment End Markers for Split
            const todayStr = new Date().toISOString().split('T')[0];

            // Part 1
            let endDate1 = cellData.treatmentData1?.endDate ? cellData.treatmentData1.endDate.toString().trim() : null;
            if (!endDate1 && cellData.treatmentData1?.startDate && cellData.content1) {
                endDate1 = calculateEndDate(cellData.treatmentData1.startDate, cellData.treatmentData1.extensionDays || 0);
            }
            if (endDate1 && endDate1 <= todayStr) {
                result.parts[0].classes.push('treatment-end-marker');
            }

            // Part 2
            let endDate2 = cellData.treatmentData2?.endDate ? cellData.treatmentData2.endDate.toString().trim() : null;
            if (!endDate2 && cellData.treatmentData2?.startDate && cellData.content2) {
                endDate2 = calculateEndDate(cellData.treatmentData2.startDate, cellData.treatmentData2.extensionDays || 0);
            }
            if (endDate2 && endDate2 <= todayStr) {
                result.parts[1].classes.push('treatment-end-marker');
            }

            return result;
        }

        // Handle Normal Cell
        result.text = capitalizeFirstLetter(cellData.content || '');

        if (cellData.isMassage) result.classes.push('massage-text');
        if (cellData.isPnf) result.classes.push('pnf-text');
        if (cellData.isEveryOtherDay) result.classes.push('every-other-day-text');

        if (result.text.trim() !== '') {
            result.styles.backgroundColor = AppConfig.schedule.contentCellColor;
        } else {
            result.styles.backgroundColor = AppConfig.schedule.defaultCellColor;
        }

        // Treatment End Marker for Normal
        const todayStr = new Date().toISOString().split('T')[0];
        let endDateStr = cellData.treatmentEndDate ? cellData.treatmentEndDate.toString().trim() : null;

        // Fallback: If endDate is missing but startDate is present, calculate it on the fly for the marker
        if (!endDateStr && cellData.treatmentStartDate && cellData.content) {
            endDateStr = calculateEndDate(cellData.treatmentStartDate, cellData.treatmentExtensionDays || 0);
        }

        if (endDateStr && endDateStr <= todayStr) {
            result.classes.push('treatment-end-marker');
        }

        return result;
    };

    const calculatePatientCount = (scheduleCells) => {
        let count = 0;
        if (!scheduleCells) return 0;

        Object.values(scheduleCells).forEach((employeeCells) => {
            if (!employeeCells) return;
            Object.values(employeeCells).forEach((cell) => {
                if (cell.isBreak) return;

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

    const calculateEndDate = (startDate, extensionDays) => {
        if (!startDate) return '';
        let endDate = new Date(startDate);
        // Reset time to midnight to avoid issues with transitions or slightly different hours
        endDate.setHours(12, 0, 0, 0);

        endDate.setDate(endDate.getDate() - 1);
        let totalDays = 15 + parseInt(extensionDays || 0, 10);
        let daysAdded = 0;
        while (daysAdded < totalDays) {
            endDate.setDate(endDate.getDate() + 1);
            const dayOfWeek = endDate.getDay();
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
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
