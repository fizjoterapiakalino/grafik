document.addEventListener('DOMContentLoaded', function () {
    const mainScheduleTable = document.getElementById('mainScheduleTable');
    const undoButton = document.getElementById('undoButton');
    const tableBody = mainScheduleTable.querySelector('tbody');

    firebase.auth().onAuthStateChanged(user => {
        if (user) {
            mainScheduleTable.classList.add('user-logged-in');
            loadSchedule();
        } else {
            mainScheduleTable.classList.remove('user-logged-in');
            loadSchedule();
        }
    });

    function loadSchedule() {
        db.collection('schedules').orderBy('time').onSnapshot(snapshot => {
            tableBody.innerHTML = '';
            snapshot.forEach(doc => {
                const schedule = doc.data();
                const row = document.createElement('tr');
                row.dataset.id = doc.id;

                const timeCell = document.createElement('td');
                timeCell.textContent = schedule.time;
                row.appendChild(timeCell);

                const patientCell = document.createElement('td');
                patientCell.textContent = schedule.patient;
                if (firebase.auth().currentUser) {
                    patientCell.contentEditable = true;
                    patientCell.addEventListener('blur', (e) => {
                        updatePatient(doc.id, e.target.textContent);
                    });
                }
                row.appendChild(patientCell);

                tableBody.appendChild(row);
            });
        });
    }

    function updatePatient(id, patient) {
        db.collection('schedules').doc(id).update({ patient: patient });
    }

    undoButton.addEventListener('click', () => {
        // Logika cofania
    });
});
