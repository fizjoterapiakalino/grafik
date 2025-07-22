document.addEventListener('DOMContentLoaded', function () {
    const mainScheduleTable = document.getElementById('mainScheduleTable');
    const tableBody = mainScheduleTable.querySelector('tbody');
    const loadingOverlay = document.getElementById('loadingOverlay');

    function toggleLoading(show) {
        if (loadingOverlay) loadingOverlay.style.display = show ? 'flex' : 'none';
    }

    // Nasłuchuj zmian w stanie uwierzytelnienia
    firebase.auth().onAuthStateChanged(user => {
        // Niezależnie od tego czy użytkownik jest zalogowany, próbujemy załadować harmonogram.
        // Uprawnienia do edycji będą sprawdzane w miejscu edycji.
        loadSchedule(!!user);
    });

    function loadSchedule(isUserLoggedIn) {
        toggleLoading(true);
        db.collection('schedules').orderBy('time').onSnapshot(snapshot => {
            tableBody.innerHTML = ''; // Wyczyść tabelę przed dodaniem nowych danych
            if (snapshot.empty) {
                tableBody.innerHTML = '<tr><td colspan="2">Brak danych w harmonogramie. Dodaj pierwszy wpis w konsoli Firebase.</td></tr>';
            } else {
                snapshot.forEach(doc => {
                    const entry = doc.data();
                    const row = document.createElement('tr');
                    
                    row.innerHTML = `
                        <td class="time-cell">${entry.time}</td>
                        <td class="patient-cell">${entry.patient}</td>
                    `;

                    if (isUserLoggedIn) {
                        const patientCell = row.querySelector('.patient-cell');
                        patientCell.contentEditable = true;
                        patientCell.addEventListener('blur', (e) => {
                            // Zapisz zmiany gdy komórka straci fokus
                            db.collection('schedules').doc(doc.id).update({ patient: e.target.textContent })
                                .catch(err => console.error("Błąd zapisu:", err));
                        });
                    }
                    tableBody.appendChild(row);
                });
            }
            toggleLoading(false);
        }, error => {
            console.error("Błąd ładowania danych: ", error);
            tableBody.innerHTML = `<tr><td colspan="2">Błąd ładowania: ${error.message}</td></tr>`;
            toggleLoading(false);
        });
    }
});
