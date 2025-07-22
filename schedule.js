document.addEventListener('DOMContentLoaded', function () {
    const mainScheduleTable = document.getElementById('mainScheduleTable');
    const tableBody = mainScheduleTable.querySelector('tbody');

    // Usunięto zależność od logowania, ładujemy dane od razu.
    loadSchedule();

    function loadSchedule() {
        window.toggleLoadingOverlay(true); // Pokaż "Wczytywanie..."

        db.collection('schedules').orderBy('time').onSnapshot(snapshot => {
            tableBody.innerHTML = ''; // Wyczyść tabelę przed każdym odświeżeniem

            if (snapshot.empty) {
                tableBody.innerHTML = '<tr><td colspan="2">Brak wpisów w harmonogramie. Dodaj pierwszy w konsoli Firebase.</td></tr>';
            } else {
                snapshot.forEach(doc => {
                    const entry = doc.data();
                    const row = document.createElement('tr');
                    
                    const timeCell = document.createElement('td');
                    timeCell.textContent = entry.time;
                    row.appendChild(timeCell);

                    const patientCell = document.createElement('td');
                    patientCell.textContent = entry.patient;
                    
                    // Komórka jest ZAWSZE edytowalna
                    patientCell.contentEditable = true;
                    patientCell.dataset.docId = doc.id; // Zapisz ID dokumentu

                    patientCell.addEventListener('blur', (e) => {
                        const documentId = e.target.dataset.docId;
                        const newText = e.target.textContent;
                        // Zapisz zmiany w bazie
                        db.collection('schedules').doc(documentId).update({ patient: newText })
                            .catch(err => console.error("Błąd zapisu:", err));
                    });
                    
                    row.appendChild(patientCell);
                    tableBody.appendChild(row);
                });
            }
            window.toggleLoadingOverlay(false); // Ukryj "Wczytywanie..."
        }, error => {
            console.error("Błąd ładowania danych: ", error);
            tableBody.innerHTML = `<tr><td colspan="2">Błąd ładowania: ${error.message}. Sprawdź reguły bazy danych.</td></tr>`;
            window.toggleLoadingOverlay(false);
        });
    }
});
