interface TestAppointment {
    patient: string;
    tags?: { label: string; className?: string }[];
    note?: string;
}

interface ScheduleMobileTestAPI {
    init(): void;
    destroy(): void;
}

const START_HOUR = 7;
const END_HOUR = 18;
const CURRENT_TIME = '12:30';

export const ScheduleMobileTest: ScheduleMobileTestAPI = (() => {
    let selectedTime = CURRENT_TIME;
    let activeFilter: 'now' | 'busy' | 'free' = 'now';
    let root: HTMLElement | null = null;
    let timeline: HTMLElement | null = null;
    let input: HTMLInputElement | null = null;
    let addButton: HTMLButtonElement | null = null;
    let clearButton: HTMLButtonElement | null = null;
    let pnfButton: HTMLButtonElement | null = null;

    const appointments: Record<string, TestAppointment> = {
        '7:30': {
            patient: 'Jan Kowalski',
            tags: [{ label: 'Masaż', className: 'massage' }, { label: 'Koniec 24.06' }],
            note: 'Wczesny wpis do sprawdzenia przewijania od początku dnia.',
        },
        '8:30': {
            patient: 'Barbara Zielińska',
            tags: [{ label: 'PNF', className: 'pnf' }],
        },
        '10:00': {
            patient: 'Tomasz Wójcik',
            tags: [{ label: 'Co 2 dni' }],
            note: 'Dłuższa informacja pomocnicza powinna zawijać się bez wypychania karty.',
        },
        '11:30': {
            patient: 'Katarzyna Maj',
            tags: [{ label: 'Masaż', className: 'massage' }],
        },
        '13:00': {
            patient: 'Maria Nowak',
            tags: [{ label: 'PNF', className: 'pnf' }, { label: 'Co 2 dni' }],
        },
        '13:30': {
            patient: 'Adam Wiśniewski / Ewa Maj',
            tags: [{ label: 'Hydroterapia', className: 'hydro' }, { label: 'Podzielona' }],
            note: 'Podzielone komórki mogą być pokazane jako jeden wpis z etykietą.',
        },
        '15:00': {
            patient: 'Piotr Kamiński',
            tags: [{ label: 'Koniec 27.06' }],
        },
        '17:30': {
            patient: 'Ewelina Lis',
            tags: [{ label: 'Hydroterapia', className: 'hydro' }],
            note: 'Wpis pod koniec dnia do testu długiego przewijania.',
        },
    };

    const makeTimeSlots = (): string[] => {
        const slots: string[] = [];
        for (let hour = START_HOUR; hour <= END_HOUR; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                if (hour === END_HOUR && minute === 30) continue;
                slots.push(`${hour}:${minute.toString().padStart(2, '0')}`);
            }
        }
        return slots;
    };

    const toMinutes = (time: string): number => {
        const [hour, minute] = time.split(':').map(Number);
        return hour * 60 + minute;
    };

    const createTag = (label: string, className?: string): HTMLSpanElement => {
        const tag = document.createElement('span');
        tag.className = `mobile-test-tag${className ? ` ${className}` : ''}`;
        tag.textContent = label;
        return tag;
    };

    const updateSummary = (): void => {
        const countEl = root?.querySelector<HTMLElement>('.mobile-test-count');
        if (!countEl) return;
        const count = Object.values(appointments).filter((appointment) => appointment.patient.trim()).length;
        countEl.textContent = `Terapie: ${count}`;
    };

    const shouldShowSlot = (appointment: TestAppointment | undefined): boolean => {
        if (activeFilter === 'busy') return Boolean(appointment?.patient);
        if (activeFilter === 'free') return !appointment?.patient;
        return true;
    };

    const selectSlot = (time: string): void => {
        selectedTime = time;
        if (input) {
            input.value = appointments[time]?.patient || '';
            input.placeholder = `Pacjent na ${time}`;
        }
        render();
    };

    const renderSlot = (time: string): HTMLElement | null => {
        const appointment = appointments[time];
        if (!shouldShowSlot(appointment)) return null;

        const slot = document.createElement('article');
        slot.className = 'mobile-test-slot';
        slot.dataset.time = time;

        if (!appointment?.patient) slot.classList.add('is-empty');
        if (time === CURRENT_TIME) slot.classList.add('is-current');
        if (time === selectedTime) slot.classList.add('is-selected');
        if (toMinutes(time) < toMinutes(CURRENT_TIME)) slot.classList.add('is-past');

        const hour = document.createElement('div');
        hour.className = 'mobile-test-hour';
        const hourText = document.createElement('span');
        hourText.textContent = time;
        hour.appendChild(hourText);
        if (time === CURRENT_TIME) {
            const now = document.createElement('span');
            now.className = 'mobile-test-now';
            now.textContent = 'Teraz';
            hour.appendChild(now);
        }

        const card = document.createElement('div');
        card.className = 'mobile-test-card';

        const patient = document.createElement('div');
        patient.className = 'mobile-test-patient';
        patient.textContent = appointment?.patient || 'Wolny termin';
        card.appendChild(patient);

        const meta = document.createElement('div');
        meta.className = 'mobile-test-meta';
        if (appointment?.tags?.length) {
            appointment.tags.forEach((tag) => meta.appendChild(createTag(tag.label, tag.className)));
        } else {
            meta.appendChild(createTag('30 min'));
        }
        card.appendChild(meta);

        const note = document.createElement('div');
        note.className = 'mobile-test-note';
        note.textContent = appointment?.note || (appointment?.patient ? 'Tapnij slot, aby testowo zmienić wpis.' : 'Tapnij slot i wpisz pacjenta w panelu na dole.');
        card.appendChild(note);

        slot.appendChild(hour);
        slot.appendChild(card);
        slot.addEventListener('click', () => selectSlot(time));

        return slot;
    };

    const render = (): void => {
        if (!timeline) return;
        timeline.innerHTML = '';

        makeTimeSlots().forEach((time) => {
            const slot = renderSlot(time);
            if (slot) timeline?.appendChild(slot);
        });

        updateSummary();
    };

    const setFilter = (filter: 'now' | 'busy' | 'free'): void => {
        activeFilter = filter;
        root?.querySelectorAll<HTMLButtonElement>('.mobile-test-filter').forEach((button) => {
            button.classList.toggle('is-active', button.dataset.filter === filter);
        });
        render();
    };

    const addPatient = (): void => {
        const value = input?.value.trim() || '';
        if (!selectedTime || !value) return;

        appointments[selectedTime] = {
            patient: value,
            tags: [{ label: 'Nowy' }],
            note: 'Wpis dodany lokalnie w prototypie testowym.',
        };
        render();
    };

    const clearPatient = (): void => {
        if (!selectedTime) return;
        delete appointments[selectedTime];
        if (input) input.value = '';
        render();
    };

    const togglePnf = (): void => {
        if (!selectedTime || !appointments[selectedTime]) return;
        const currentTags = appointments[selectedTime].tags || [];
        const hasPnf = currentTags.some((tag) => tag.label === 'PNF');
        appointments[selectedTime].tags = hasPnf
            ? currentTags.filter((tag) => tag.label !== 'PNF')
            : [...currentTags, { label: 'PNF', className: 'pnf' }];
        render();
    };

    const init = (): void => {
        root = document.querySelector('.mobile-schedule-test');
        timeline = document.querySelector('.mobile-test-timeline');
        input = document.getElementById('mobileTestPatientInput') as HTMLInputElement | null;
        addButton = document.getElementById('mobileTestAddPatient') as HTMLButtonElement | null;
        clearButton = document.getElementById('mobileTestClear') as HTMLButtonElement | null;
        pnfButton = document.getElementById('mobileTestPnf') as HTMLButtonElement | null;

        root?.querySelectorAll<HTMLButtonElement>('.mobile-test-filter').forEach((button) => {
            const label = button.textContent?.trim().toLowerCase();
            const filter = label === 'zajęte' ? 'busy' : label === 'wolne' ? 'free' : 'now';
            button.dataset.filter = filter;
            button.addEventListener('click', () => setFilter(filter));
        });

        addButton?.addEventListener('click', addPatient);
        clearButton?.addEventListener('click', clearPatient);
        pnfButton?.addEventListener('click', togglePnf);
        input?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                addPatient();
            }
        });

        selectSlot(selectedTime);
        setTimeout(() => {
            document.querySelector<HTMLElement>('.mobile-test-slot.is-current')?.scrollIntoView({
                block: 'center',
                behavior: 'smooth',
            });
        }, 100);
    };

    const destroy = (): void => {
        root = null;
        timeline = null;
        input = null;
        addButton = null;
        clearButton = null;
        pnfButton = null;
    };

    return {
        init,
        destroy,
    };
})();
