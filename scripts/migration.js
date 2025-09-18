// scripts/migration.js
document.addEventListener('DOMContentLoaded', () => {
    const migrateBtn = document.getElementById('migrateBtn');
    const statusDiv = document.getElementById('status');

    // Sprawdzenie, czy obiekty firebase i db są dostępne
    if (typeof firebase === 'undefined' || typeof db === 'undefined') {
        statusDiv.textContent = "Błąd: Firebase nie jest poprawnie załadowany. Sprawdź konfigurację w firebase-config.js.";
        console.error("Firebase lub Firestore DB nie zostały zainicjowane.");
        return;
    }

    migrateBtn.addEventListener('click', async () => {
        statusDiv.textContent = "Rozpoczynam migrację...";
        const docRef = db.collection("schedules").doc("mainSchedule");

        try {
            await db.runTransaction(async (transaction) => {
                const doc = await transaction.get(docRef);

                if (!doc.exists) {
                    throw new Error("Dokument mainSchedule nie istnieje!");
                }

                const data = doc.data();

                if (!data.employeeHeaders) {
                    statusDiv.textContent = "Wygląda na to, że migracja została już przeprowadzona (brak pola 'employeeHeaders').";
                    console.log("Migracja nie jest wymagana.");
                    return;
                }

                if (data.employees) {
                    statusDiv.textContent = "Wykryto pole 'employees'. Przerwij migrację, aby uniknąć nadpisania danych.";
                    console.warn("Wykryto pole 'employees', przerwanie.");
                    return;
                }

                statusDiv.textContent = "Konwertowanie danych...";
                const oldHeaders = data.employeeHeaders;
                const newEmployees = {};

                for (const index in oldHeaders) {
                    const name = oldHeaders[index];
                    if (name) { // Upewnij się, że nazwa nie jest pusta
                        newEmployees[index] = {
                            name: name,
                            leaveEntitlement: 26, // Domyślna wartość
                            carriedOverLeave: 0     // Domyślna wartość
                        };
                    }
                }

                // Aktualizacja dokumentu: dodanie nowego pola i usunięcie starego
                transaction.update(docRef, {
                    employees: newEmployees,
                    employeeHeaders: firebase.firestore.FieldValue.delete()
                });
            });

            statusDiv.textContent = "Migracja zakończona pomyślnie! Struktura danych została zaktualizowana.";
            console.log("Migracja zakończona sukcesem.");

        } catch (error) {
            statusDiv.textContent = `Błąd podczas migracji: ${error.message}`;
            console.error("Błąd migracji:", error);
        }
    });
});
