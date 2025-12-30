// scripts/backup-service.ts
import { db as dbRaw } from './firebase-config.js';
import type { FirestoreDbWrapper } from './types/firebase';

const db = dbRaw as unknown as FirestoreDbWrapper;

/**
 * Dane kopii zapasowej
 */
interface BackupData {
    backupDate: Date;
    scheduleData: Record<string, unknown>;
    leavesData: Record<string, unknown>;
}

/**
 * Dokument kopii zapasowej z Firestore
 */
interface BackupDocument {
    backupDate?: { toDate(): Date };
    scheduleData?: Record<string, unknown>;
    leavesData?: Record<string, unknown>;
}

/**
 * Interfejs publicznego API BackupService
 */
interface BackupServiceAPI {
    performBackup(silent?: boolean): Promise<boolean>;
    getLastBackupDate(): Promise<Date | null>;
    restoreBackup(): Promise<BackupDocument>;
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

            const [scheduleDoc, leavesDoc] = await Promise.all([scheduleRef.get(), leavesRef.get()]);

            const backupData: BackupData = {
                backupDate: new Date(),
                scheduleData: scheduleDoc.exists ? (scheduleDoc.data() as Record<string, unknown>) || {} : {},
                leavesData: leavesDoc.exists ? (leavesDoc.data() as Record<string, unknown>) || {} : {},
            };

            await getBackupDocRef().set(backupData as unknown as BackupDocument);

            if (!silent) {
                window.showToast('Kopia zapasowa utworzona pomyślnie!', 3000);
            } else {
                console.log('Automatyczna kopia zapasowa została wykonana.');
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

    return {
        performBackup,
        getLastBackupDate,
        restoreBackup,
    };
})();
