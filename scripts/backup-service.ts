// scripts/backup-service.ts
import { debugLog } from './common.js';
import { auth as authRaw, db as dbRaw } from './firebase-config.js';
import { EmployeeManager } from './employee-manager.js';
import type { FirebaseAuthWrapper, FirestoreDbWrapper } from './types/firebase';

const auth = authRaw as unknown as FirebaseAuthWrapper;
const db = dbRaw as unknown as FirestoreDbWrapper;

/**
 * Dane kopii zapasowej
 */
interface BackupData {
    backupDate: Date;
    scheduleData: Record<string, unknown>;
    leavesData: Record<string, unknown>;
    appointmentsData?: Record<string, unknown>;
    stationsData?: Record<string, unknown>;
    changesSchedules?: Record<string, Record<string, unknown>>;
}

/**
 * Dokument kopii zapasowej z Firestore
 */
interface BackupDocument {
    backupDate?: { toDate(): Date };
    scheduleData?: Record<string, unknown>;
    leavesData?: Record<string, unknown>;
    appointmentsData?: Record<string, unknown>;
    stationsData?: Record<string, unknown>;
    changesSchedules?: Record<string, Record<string, unknown>>;
}

/**
 * Interfejs publicznego API BackupService
 */
interface BackupServiceAPI {
    performBackup(silent?: boolean): Promise<boolean>;
    getLastBackupDate(): Promise<Date | null>;
    restoreBackup(): Promise<BackupDocument>;
    applyRestore(): Promise<void>;
    initAutoBackup(): void;
}

/**
 * Serwis kopii zapasowych
 */
export const BackupService: BackupServiceAPI = (() => {
    const getBackupDocRef = () => db.collection<BackupDocument>('backup').doc('latest');

    const performBackup = async (silent: boolean = false): Promise<boolean> => {
        try {
            const scheduleRef = db.collection('schedules').doc('mainSchedule');
            const leavesRef = db.collection('leaves').doc('mainLeaves');
            const appointmentsRef = db.collection('appointments').doc('current');
            const stationsRef = db.collection('stations').doc('state');

            const currentYear = new Date().getFullYear();
            const changeYears = [currentYear - 1, currentYear, currentYear + 1];
            const changeRefs = changeYears.map((year) => ({
                key: String(year),
                ref: db.collection('schedules').doc(`changesSchedule_${year}`),
            }));

            const [scheduleDoc, leavesDoc, appointmentsDoc, stationsDoc, ...changesDocs] = await Promise.all([
                scheduleRef.get(),
                leavesRef.get(),
                appointmentsRef.get(),
                stationsRef.get(),
                ...changeRefs.map((item) => item.ref.get()),
            ]);

            const changesSchedules: Record<string, Record<string, unknown>> = {};
            changeRefs.forEach((item, index) => {
                const docSnap = changesDocs[index];
                if (docSnap && docSnap.exists) {
                    changesSchedules[item.key] = (docSnap.data() as Record<string, unknown>) || {};
                }
            });

            const backupData: BackupData = {
                backupDate: new Date(),
                scheduleData: scheduleDoc.exists ? (scheduleDoc.data() as Record<string, unknown>) || {} : {},
                leavesData: leavesDoc.exists ? (leavesDoc.data() as Record<string, unknown>) || {} : {},
                appointmentsData: appointmentsDoc.exists ? (appointmentsDoc.data() as Record<string, unknown>) || {} : {},
                stationsData: stationsDoc.exists ? (stationsDoc.data() as Record<string, unknown>) || {} : {},
                changesSchedules,
            };

            await getBackupDocRef().set(backupData as unknown as BackupDocument);

            if (!silent) {
                window.showToast('Kopia zapasowa utworzona pomyślnie!', 3000);
            } else {
                debugLog('Automatyczna kopia zapasowa została wykonana.');
            }

            return true;
        } catch (error) {
            console.error('Błąd podczas tworzenia kopii zapasowej:', error);
            if (!silent) {
                window.showToast('Wystąpił błąd podczas tworzenia kopii zapasowej.', 5000);
            }
            return false;
        }
    };

    const getLastBackupDate = async (): Promise<Date | null> => {
        try {
            const backupDoc = await getBackupDocRef().get();
            if (backupDoc.exists) {
                const backupData = backupDoc.data();
                if (backupData?.backupDate) {
                    return backupData.backupDate.toDate();
                }
            }
            return null;
        } catch (error) {
            console.error('Błąd podczas pobierania daty kopii zapasowej:', error);
            return null;
        }
    };

    const restoreBackup = async (): Promise<BackupDocument> => {
        const backupDoc = await getBackupDocRef().get();
        if (!backupDoc.exists) {
            throw new Error('No backup found');
        }
        return backupDoc.data() as BackupDocument;
    };

    const applyRestore = async (): Promise<void> => {
        const backupData = await restoreBackup();
        const batch = db.batch();

        if (backupData.scheduleData) {
            const scheduleRef = db.collection('schedules').doc('mainSchedule');
            batch.set(scheduleRef, backupData.scheduleData);
        }

        if (backupData.leavesData) {
            const leavesRef = db.collection('leaves').doc('mainLeaves');
            batch.set(leavesRef, backupData.leavesData);
        }

        if (backupData.appointmentsData && Object.keys(backupData.appointmentsData).length > 0) {
            const appointmentsRef = db.collection('appointments').doc('current');
            batch.set(appointmentsRef, backupData.appointmentsData);
        }

        if (backupData.stationsData && Object.keys(backupData.stationsData).length > 0) {
            const stationsRef = db.collection('stations').doc('state');
            batch.set(stationsRef, backupData.stationsData);
        }

        if (backupData.changesSchedules) {
            for (const [docYear, data] of Object.entries(backupData.changesSchedules)) {
                if (data && typeof data === 'object') {
                    const changesRef = db.collection('schedules').doc(`changesSchedule_${docYear}`);
                    batch.set(changesRef, data);
                }
            }
        }

        await batch.commit();
    };

    const initAutoBackup = (): void => {
        const check = async (): Promise<void> => {
            const currentUser = auth.currentUser;
            if (!currentUser || !EmployeeManager.isUserAdmin(currentUser.uid)) {
                return;
            }

            const now = new Date();
            const day = now.getDay();
            if (day >= 1 && day <= 5 && now.getHours() === 17 && now.getMinutes() === 30) {
                const last = await getLastBackupDate();
                if (!last || last.getDate() !== now.getDate() || last.getMonth() !== now.getMonth() || last.getFullYear() !== now.getFullYear()) {
                    await performBackup(true);
                }
            }
        };
        setInterval(check, 60000);
        void check();
    };

    return {
        performBackup,
        getLastBackupDate,
        restoreBackup,
        applyRestore,
        initAutoBackup,
    };
})();
