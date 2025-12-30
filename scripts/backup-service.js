import { db } from './firebase-config.js';

export const BackupService = (() => {
    const getBackupDocRef = () => db.collection('backup').doc('latest');

    const performBackup = async (silent = false) => {
        try {
            const scheduleRef = db.collection('schedules').doc('mainSchedule');
            const leavesRef = db.collection('leaves').doc('mainLeaves');

            const [scheduleDoc, leavesDoc] = await Promise.all([scheduleRef.get(), leavesRef.get()]);

            const backupData = {
                backupDate: new Date(),
                scheduleData: scheduleDoc.exists ? scheduleDoc.data() : {},
                leavesData: leavesDoc.exists ? leavesDoc.data() : {},
            };

            await getBackupDocRef().set(backupData);

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

    const getLastBackupDate = async () => {
        try {
            const backupDoc = await getBackupDocRef().get();
            if (backupDoc.exists) {
                const backupData = backupDoc.data();
                if (backupData.backupDate) {
                    return backupData.backupDate.toDate();
                }
            }
            return null;
        } catch (error) {
            console.error('Błąd podczas pobierania daty kopii zapasowej:', error);
            return null;
        }
    };

    const restoreBackup = async () => {
        const backupDoc = await getBackupDocRef().get();
        if (!backupDoc.exists) {
            throw new Error('No backup found');
        }
        return backupDoc.data();
    }

    return {
        performBackup,
        getLastBackupDate,
        restoreBackup
    };
})();
