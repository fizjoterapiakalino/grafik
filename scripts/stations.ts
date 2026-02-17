// scripts/stations.ts - PhysioResource Tracker Module
import { db as dbRaw, auth as authRaw } from './firebase-config.js';
import { EmployeeManager } from './employee-manager.js';

// Type for Firebase db wrapper (compatible with existing codebase)
interface DbWrapper {
    collection(name: string): {
        doc(id: string): {
            get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
            set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void>;
            onSnapshot(
                callback: (snapshot: { exists: boolean; data(): Record<string, unknown> | undefined }) => void,
                errorCallback?: (error: Error) => void
            ): () => void;
        };
    };
}

const db = dbRaw as unknown as DbWrapper;
const auth = authRaw as any;

/**
 * Wpis w kolejce
 */
interface QueueEntry {
    employeeId: string;
    treatmentId: string;
    duration: number;
    addedAt: number;
}

/**
 * Status stanowiska
 */
type StationStatus = 'FREE' | 'OCCUPIED' | 'FINISHED';

/**
 * Typ zabiegu
 */
interface Treatment {
    id: string;
    name: string;
    shortName: string; // Skrócona nazwa do kafelka
    duration: number; // minutes
    limit?: number; // max concurrent uses in room
}

/**
 * Stanowisko
 */
interface Station {
    id: string;
    name: string;
    roomId: string;
    status: StationStatus;
    treatmentId?: string;
    startTime?: number; // timestamp
    duration?: number; // minutes
    excludeTreatments?: string[]; // treatment IDs to hide for this station
    employeeId?: string; // NEW: ID pracownika który zajął
    queue?: QueueEntry[]; // NEW: lista oczekujących
}

/**
 * Typ pokoju - simple = jedno kliknięcie start, multi = wybór zabiegu z kafelków
 */
type RoomType = 'simple' | 'multi';

/**
 * Pomieszczenie
 */
interface Room {
    id: string;
    name: string;
    icon: string;
    type: RoomType;
    stations: Station[];
    treatments: Treatment[];
    maxCapacity: number;
    defaultDuration: number; // dla pokojów simple
}

/**
 * Dane stanu z Firebase
 */
interface StationState {
    status: StationStatus;
    treatmentId?: string;
    startTime?: number;
    duration?: number;
    employeeId?: string;
    queue?: QueueEntry[];
}

/**
 * Interfejs publicznego API Stations
 */
interface StationsAPI {
    init(): void;
    destroy(): void;
}

const THERAPY_MASSAGE_TREATMENT_ID = 'therapy_massage_20';
const LEGACY_THERAPY_MASSAGE_IDS = new Set(['massage_treatment', 'therapy', 'gym_therapy', 'gym_massage']);
const GLOBAL_SINGLE_DEVICE_TREATMENTS = new Set(['sollux']);

/**
 * Moduł Stanowiska Zabiegowe
 */
export const Stations: StationsAPI = (() => {
    // Configuration - room definitions based on specification
    // Column 1: Simple rooms (Hydro, Magnet, Aquavibron, Sala21)
    // Column 2: Fizyko 18, Fizyko 22
    // Column 3: Sala Gimnastyczna
    const ROOMS_CONFIG: Room[] = [
        {
            id: 'hydro',
            name: 'Hydroterapia',
            icon: 'fa-water',
            type: 'simple',
            maxCapacity: 3,
            defaultDuration: 15,
            stations: [
                { id: 'hydro_1', name: 'Wanna duża', roomId: 'hydro', status: 'FREE' },
                { id: 'hydro_2', name: 'Wanna mała', roomId: 'hydro', status: 'FREE' },
                { id: 'hydro_3', name: 'Wirówka', roomId: 'hydro', status: 'FREE' },
            ],
            treatments: [],
        },
        {
            id: 'magnet',
            name: 'Pole magnetyczne',
            icon: 'fa-magnet',
            type: 'simple',
            maxCapacity: 2,
            defaultDuration: 15,
            stations: [
                { id: 'magnet_1', name: 'Aparat Mały', roomId: 'magnet', status: 'FREE' },
                { id: 'magnet_2', name: 'Aparat Duży', roomId: 'magnet', status: 'FREE' },
            ],
            treatments: [],
        },
        {
            id: 'aquavibron',
            name: 'Aquavibron',
            icon: 'fa-wave-square',
            type: 'multi',
            maxCapacity: 1,
            defaultDuration: 6,
            stations: [
                { id: 'aquavibron_1', name: 'Aquavibron', roomId: 'aquavibron', status: 'FREE' },
            ],
            treatments: [
                { id: 'aquavibron_simple', name: 'Aquavibron', shortName: 'Aqua.', duration: 6 },
                { id: THERAPY_MASSAGE_TREATMENT_ID, name: 'Terapia/Masaż', shortName: 'Ter./Mas.', duration: 20 },
            ],
        },

        {
            id: 'physio1',
            name: 'Fizyko 18',
            icon: 'fa-bolt',
            type: 'multi',
            maxCapacity: 3,
            defaultDuration: 15,
            stations: [
                { id: 'physio1_1', name: 'Leżanka 1', roomId: 'physio1', status: 'FREE' },
                { id: 'physio1_2', name: 'Leżanka 2', roomId: 'physio1', status: 'FREE' },
                { id: 'physio1_3', name: 'Krzesło', roomId: 'physio1', status: 'FREE' },
            ],
            treatments: [
                { id: 'prady', name: 'Prądy', shortName: 'Prądy', duration: 15, limit: 2 },
                { id: 'ultrasound', name: 'Ultradźwięki', shortName: 'UD', duration: 7.5, limit: 2 },
                { id: 'laser', name: 'Laser', shortName: 'Laser', duration: 7.5, limit: 1 },
                { id: 'sollux', name: 'Sollux', shortName: 'Sollux', duration: 15, limit: 1 },
            ],
        },
        {
            id: 'physio2',
            name: 'Fizyko 22',
            icon: 'fa-bolt',
            type: 'multi',
            maxCapacity: 3,
            defaultDuration: 15,
            stations: [
                { id: 'physio2_1', name: 'Leżanka 1', roomId: 'physio2', status: 'FREE' },
                { id: 'physio2_2', name: 'Leżanka 2', roomId: 'physio2', status: 'FREE' },
                { id: 'physio2_3', name: 'Krzesło', roomId: 'physio2', status: 'FREE' },
            ],
            treatments: [
                { id: 'prady', name: 'Prądy', shortName: 'Prądy', duration: 15, limit: 2 },
                { id: 'ultrasound', name: 'Ultradźwięki', shortName: 'UD', duration: 7.5, limit: 2 },
                { id: 'laser', name: 'Laser', shortName: 'Laser', duration: 7.5, limit: 1 },
                { id: 'sollux', name: 'Sollux', shortName: 'Sollux', duration: 15, limit: 1 },
            ],
        },
        {
            id: 'sala21',
            name: 'Sala 21',
            icon: 'fa-hands',
            type: 'multi',
            maxCapacity: 2,
            defaultDuration: 15,
            stations: [
                { id: 'sala21_1', name: 'Leżanka 1', roomId: 'sala21', status: 'FREE' },
                { id: 'sala21_2', name: 'Leżanka 2', roomId: 'sala21', status: 'FREE' },
            ],
            treatments: [
                { id: THERAPY_MASSAGE_TREATMENT_ID, name: 'Terapia/Masaż', shortName: 'Ter./Mas.', duration: 20 },
            ],
        },
        {
            id: 'gym',
            name: 'Sala Gimnastyczna',
            icon: 'fa-dumbbell',
            type: 'multi',
            maxCapacity: 5,
            defaultDuration: 20,
            stations: [
                { id: 'gym_1', name: 'Leżanka 1', roomId: 'gym', status: 'FREE', excludeTreatments: ['gym_odciazenie'] },
                { id: 'gym_2', name: 'Leżanka 2', roomId: 'gym', status: 'FREE', excludeTreatments: ['gym_odciazenie'] },
                { id: 'gym_3', name: 'Leżanka 3', roomId: 'gym', status: 'FREE', excludeTreatments: ['gym_odciazenie'] },
                { id: 'gym_4', name: 'Leżanka 4', roomId: 'gym', status: 'FREE' },
                { id: 'gym_5', name: 'Leżanka 5', roomId: 'gym', status: 'FREE' },
            ],
            treatments: [
                { id: THERAPY_MASSAGE_TREATMENT_ID, name: 'Terapia/Masaż', shortName: 'Ter./Mas.', duration: 20 },
                { id: 'gym_odciazenie', name: 'Odciążenie', shortName: 'Odciąż.', duration: 15, limit: 2 },
            ],
        },
    ];

    // State
    let rooms: Room[] = [];
    let stationStates: Map<string, StationState> = new Map();
    let unsubscribe: (() => void) | null = null;
    let unsubscribeAuth: (() => void) | null = null;
    let timerInterval: number | null = null;
    let soundEnabled = true;

    // User session state
    let currentEmployeeId: string | null = null;
    let isCurrentUserAdmin = false;

    // Pending queue action (for multi-room treatment selection)
    let pendingQueueStation: Station | null = null;
    let pendingQueueRoom: Room | null = null;
    let activeMobileRoomId: string | null = null;

    /**
     * Initialize module
     */
    const init = (): void => {
        console.log('Stations module initializing...');

        // Setup auth state listener
        unsubscribeAuth = auth.onAuthStateChanged((user: any) => {
            if (user) {
                const employee = EmployeeManager.getEmployeeByUid(user.uid);
                currentEmployeeId = employee ? employee.id : null;
                isCurrentUserAdmin = EmployeeManager.isUserAdmin(user.uid);
            } else {
                currentEmployeeId = null;
                isCurrentUserAdmin = false;
            }
        });

        // Deep clone configuration
        rooms = JSON.parse(JSON.stringify(ROOMS_CONFIG));
        activeMobileRoomId = rooms[0]?.id ?? null;

        // Initialize audio
        initAudio();

        // Load sound preference
        const savedSoundPref = localStorage.getItem('stationsSoundEnabled');
        soundEnabled = savedSoundPref !== 'false';

        // Render views
        renderDesktopView();
        renderMobileView();

        // Setup listeners
        setupEventListeners();

        // Subscribe to real-time updates
        subscribeToUpdates();

        // Start timer
        startTimerInterval();

        // Update sound button state
        updateSoundButton();

        console.log('Stations module initialized');
    };

    /**
     * Cleanup module
     */
    const destroy = (): void => {
        if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
        }

        if (unsubscribeAuth) {
            unsubscribeAuth();
            unsubscribeAuth = null;
        }

        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }

        // Remove event listener
        document.removeEventListener('click', handleClick);

        // Remove employee picker modal if exists
        document.getElementById('employeePickerModal')?.remove();

        stationStates.clear();
        rooms = [];
        pendingQueueStation = null;
        pendingQueueRoom = null;
        activeMobileRoomId = null;
    };

    /**
     * Initialize notification audio
     */
    const initAudio = (): void => {
        try {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            (window as any).stationsAudioContext = audioContext;
        } catch (e) {
            console.log('Audio not supported');
        }
    };

    /**
     * Play notification sound
     */
    const playNotificationSound = (): void => {
        if (!soundEnabled) return;

        try {
            const audioContext = (window as any).stationsAudioContext;
            if (audioContext) {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.frequency.value = 880;
                oscillator.type = 'sine';

                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.5);
            }
        } catch (e) {
            console.log('Could not play sound');
        }
    };

    /**
     * Subscribe to Firebase real-time updates
     */
    const subscribeToUpdates = (): void => {
        const docRef = db.collection('stations').doc('state');

        unsubscribe = docRef.onSnapshot(
            (snapshot: any) => {
                if (snapshot.exists) {
                    const data = snapshot.data();
                    const previousStates = new Map(stationStates);

                    stationStates.clear();

                    for (const [stationId, state] of Object.entries(data)) {
                        if (stationId !== '_lastUpdated') {
                            stationStates.set(stationId, state as StationState);
                        }
                    }

                    // Check for newly finished stations
                    checkForNewlyFinished(previousStates);

                    // Sync local state
                    syncLocalState();

                    // Update UI
                    updateAllStationCards();
                }
            },
            (error: any) => {
                console.error('Error subscribing to stations:', error);
            }
        );
    };

    /**
     * Check for newly finished stations and play sound
     */
    const checkForNewlyFinished = (previousStates: Map<string, StationState>): void => {
        for (const [stationId, state] of stationStates) {
            if (state.status === 'FINISHED') {
                const prevState = previousStates.get(stationId);
                if (!prevState || prevState.status !== 'FINISHED') {
                    playNotificationSound();
                    const nextInQueue = state.queue?.[0];
                    if (nextInQueue) {
                        const nextName = EmployeeManager.getNameById(nextInQueue.employeeId);
                        window.showToast?.(`Stanowisko gotowe. Następny: ${nextName}`, 3500);
                    }
                    break;
                }
            }
        }
    };

    /**
     * Get active employee ID for an action (auto for user, picker for admin)
     */
    const getActiveEmployeeId = async (
        options?: { forcePicker?: boolean; pickerTitle?: string }
    ): Promise<string | null> => {
        if (options?.forcePicker) {
            return showEmployeePickerModal(options.pickerTitle);
        }

        // Dla zwykłych zabiegów zawsze używaj aktualnie zalogowanego pracownika.
        // Jeśli konto admina nie ma przypisanego employeeId, dopiero wtedy fallback do pickera.
        if (currentEmployeeId) {
            return currentEmployeeId;
        }

        return isCurrentUserAdmin ? showEmployeePickerModal(options?.pickerTitle) : null;
    };

    /**
     * Show modal for admin to pick an employee
     */
    const showEmployeePickerModal = (title = 'Wybierz pracownika'): Promise<string | null> => {
        return new Promise((resolve) => {
            // Remove existing modal if any
            document.getElementById('employeePickerModal')?.remove();

            const employees = EmployeeManager.getAll();
            const employeeButtons = Object.entries(employees)
                .filter(([_, emp]) => !emp.isHidden)
                .map(([id, emp]) => {
                    const name = emp.displayName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
                    const isCurrent = id === currentEmployeeId;
                    return `
                        <button class="emp-picker-btn ${isCurrent ? 'current' : ''}" data-emp-id="${id}">
                            <span class="emp-picker-name">${name}</span>
                        </button>
                    `;
                }).join('');

            const modal = document.createElement('div');
            modal.id = 'employeePickerModal';
            modal.className = 'emp-picker-overlay';
            modal.innerHTML = `
                <div class="emp-picker-modal">
                    <div class="emp-picker-header">
                        <span>${title}</span>
                        <button class="emp-picker-close"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="emp-picker-list">
                        ${employeeButtons}
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            // Handle clicks
            const handleModalClick = (e: MouseEvent) => {
                const target = e.target as HTMLElement;
                const btn = target.closest('[data-emp-id]') as HTMLElement;
                if (btn) {
                    modal.remove();
                    resolve(btn.dataset.empId || null);
                    return;
                }
                if (target.closest('.emp-picker-close') || target === modal) {
                    modal.remove();
                    resolve(null);
                }
            };

            modal.addEventListener('click', handleModalClick);
        });
    };

    /**
     * Sync local state with Firebase data
     */
    const syncLocalState = (): void => {
        for (const room of rooms) {
            for (const station of room.stations) {
                const state = stationStates.get(station.id);
                if (state) {
                    station.status = state.status;
                    station.treatmentId = normalizeTreatmentId(state.treatmentId);
                    station.startTime = state.startTime;
                    station.duration = isTherapyMassageTreatment(state.treatmentId) ? 20 : state.duration;
                    station.employeeId = state.employeeId;
                    station.queue = [...(state.queue || [])]
                        .map(entry => ({
                            ...entry,
                            treatmentId: normalizeTreatmentId(entry.treatmentId) || entry.treatmentId,
                            duration: isTherapyMassageTreatment(entry.treatmentId) ? 20 : entry.duration,
                        }))
                        .sort((a, b) => a.addedAt - b.addedAt);
                } else {
                    station.status = 'FREE';
                    station.treatmentId = undefined;
                    station.startTime = undefined;
                    station.duration = undefined;
                    station.employeeId = undefined;
                    station.queue = [];
                }
            }
        }
    };

    /**
     * Save station state to Firebase
     */
    const saveStationState = async (station: Station): Promise<void> => {
        try {
            const docRef = db.collection('stations').doc('state');

            const stateData: any = {
                _lastUpdated: Date.now(),
            };

            if (station.status === 'OCCUPIED' || station.status === 'FINISHED') {
                stateData[station.id] = {
                    status: station.status,
                    treatmentId: station.treatmentId,
                    startTime: station.startTime,
                    duration: station.duration,
                    employeeId: station.employeeId,
                    queue: station.queue || [],
                };
            } else {
                stateData[station.id] = {
                    status: 'FREE',
                    queue: station.queue || [],
                };
            }

            await docRef.set(stateData, { merge: true });
        } catch (error) {
            console.error('Error saving station state:', error);
            window.showToast?.('Błąd zapisu', 3000);
        }
    };

    /**
     * Start treatment on a station (for simple rooms)
     */
    const startSimpleTreatment = async (room: Room, station: Station): Promise<void> => {
        const empId = await getActiveEmployeeId();
        if (!empId) {
            window.showToast?.('Nie wybrano pracownika', 2000);
            return;
        }

        station.status = 'OCCUPIED';
        station.treatmentId = station.id; // Use station ID as treatment ID for simple rooms
        station.startTime = Date.now();
        station.duration = room.defaultDuration;
        station.employeeId = empId;

        await saveStationState(station);

        window.showToast?.(`${station.name} - ${room.defaultDuration} min`, 2000);
        updateAllStationCards();
    };

    /**
     * Start treatment on a station (for multi-treatment rooms)
     */
    const startMultiTreatment = async (_room: Room, station: Station, treatment: Treatment): Promise<void> => {
        const isTherapyMassage = isTherapyMassageTreatment(treatment.id);
        const empId = await getActiveEmployeeId({
            forcePicker: isTherapyMassage,
            pickerTitle: isTherapyMassage ? 'Wybierz terapeutę' : undefined,
        });
        if (!empId) {
            window.showToast?.('Nie wybrano pracownika', 2000);
            return;
        }
        if (!isTreatmentAvailable(_room, treatment)) {
            window.showToast?.('Ten zabieg jest chwilowo niedostępny', 2200);
            return;
        }
        if (isTherapyMassage && hasActiveTherapyMassage(empId, station.id)) {
            window.showToast?.('Masz już aktywną Terapię/Masaż. Możesz tylko dodać się do kolejki.', 3000);
            return;
        }

        station.status = 'OCCUPIED';
        station.treatmentId = normalizeTreatmentId(treatment.id);
        station.startTime = Date.now();
        station.duration = treatment.duration;
        station.employeeId = empId;

        await saveStationState(station);

        window.showToast?.(`${treatment.name} - ${treatment.duration} min`, 2000);
        updateAllStationCards();
    };

    /**
     * Release a station
     */
    const releaseStation = async (station: Station): Promise<void> => {
        // Check if user is allowed to release (owner or admin)
        if (!isCurrentUserAdmin && station.employeeId && station.employeeId !== currentEmployeeId) {
            window.showToast?.('Nie masz uprawnień do zwolnienia tego stanowiska', 3000);
            return;
        }

        station.status = 'FREE';
        station.treatmentId = undefined;
        station.startTime = undefined;
        station.duration = undefined;
        station.employeeId = undefined;

        // Process queue if exists
        if (station.queue && station.queue.length > 0) {
            await processQueue(station);
            // processQueue already shows its own toast and plays sound
        } else {
            await saveStationState(station);
            window.showToast?.('Stanowisko zwolnione', 1500);
        }

        updateAllStationCards();
    };

    /**
     * Add employee to station queue
     */
    const addToQueue = async (station: Station, treatmentId: string, duration: number): Promise<void> => {
        const normalizedTreatmentId = normalizeTreatmentId(treatmentId) || treatmentId;
        const isTherapyMassage = isTherapyMassageTreatment(normalizedTreatmentId);
        const empId = await getActiveEmployeeId({
            forcePicker: isTherapyMassage,
            pickerTitle: isTherapyMassage ? 'Wybierz terapeutę' : undefined,
        });
        if (!empId) {
            window.showToast?.('Nie wybrano pracownika', 2000);
            return;
        }
        const normalizedDuration = isTherapyMassageTreatment(normalizedTreatmentId) ? 20 : duration;

        // Initialize queue if not exists
        if (!station.queue) {
            station.queue = [];
        }

        // Limit queue size
        if (station.queue.length >= 3) {
            window.showToast?.('Kolejka jest pełna (max 3)', 2500);
            return;
        }

        // Check if employee already in queue for this station
        if (station.queue.some(q => q.employeeId === empId)) {
            window.showToast?.('Jesteś już w kolejce', 2000);
            return;
        }

        station.queue.push({
            employeeId: empId,
            treatmentId: normalizedTreatmentId,
            duration: normalizedDuration,
            addedAt: Date.now()
        });
        station.queue.sort((a, b) => a.addedAt - b.addedAt);

        await saveStationState(station);
        window.showToast?.('Dodano do kolejki', 2000);
        updateAllStationCards();
    };

    /**
     * Remove employee from station queue
     */
    const removeFromQueue = async (station: Station, employeeId: string): Promise<void> => {
        if (!isCurrentUserAdmin && employeeId !== currentEmployeeId) {
            window.showToast?.('Brak uprawnień', 2000);
            return;
        }

        if (!station.queue) return;

        station.queue = station.queue.filter(q => q.employeeId !== employeeId);
        await saveStationState(station);
        window.showToast?.('Usunięto z kolejki', 1500);
        updateAllStationCards();
    };

    /**
     * Process next person in queue
     */
    const processQueue = async (station: Station): Promise<void> => {
        if (!station.queue || station.queue.length === 0) return;

        const next = station.queue.shift();
        if (!next) return;

        station.status = 'OCCUPIED';
        station.employeeId = next.employeeId;
        station.treatmentId = normalizeTreatmentId(next.treatmentId);
        station.startTime = Date.now();
        station.duration = isTherapyMassageTreatment(next.treatmentId) ? 20 : next.duration;

        await saveStationState(station);

        const empName = EmployeeManager.getNameById(next.employeeId);
        window.showToast?.(`Następny: ${empName}`, 3000);
        playNotificationSound();
    };

    /**
     * Build short therapist label for station card
     */
    const getEmployeeLabel = (employeeId?: string): string => {
        if (!employeeId) return '';

        const fullName = EmployeeManager.getNameById(employeeId).trim();
        if (!fullName) return '';

        const parts = fullName.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return `${parts[0][0]}.${parts[1][0]}.`.toUpperCase();
        }

        return parts[0].slice(0, 10);
    };

    /**
     * Build queue treatment label
     */
    const getQueueTreatmentLabel = (room: Room, station: Station, entry: QueueEntry): string => {
        const treatment = room.treatments.find(t => t.id === entry.treatmentId);
        if (treatment) {
            return `${treatment.shortName} ${entry.duration}'`;
        }

        if (room.type === 'simple') {
            return `${station.name} ${entry.duration}'`;
        }

        return `${entry.duration}'`;
    };

    /**
     * Normalize legacy treatment IDs to canonical IDs
     */
    const normalizeTreatmentId = (treatmentId?: string): string | undefined => {
        if (!treatmentId) return treatmentId;
        return LEGACY_THERAPY_MASSAGE_IDS.has(treatmentId) ? THERAPY_MASSAGE_TREATMENT_ID : treatmentId;
    };

    /**
     * Checks whether treatment belongs to the merged Terapia/Masaż group
     */
    const isTherapyMassageTreatment = (treatmentId?: string): boolean => {
        if (!treatmentId) return false;
        const normalized = normalizeTreatmentId(treatmentId);
        return normalized === THERAPY_MASSAGE_TREATMENT_ID;
    };

    /**
     * Checks if employee currently occupies any Terapia/Masaż station
     */
    const hasActiveTherapyMassage = (employeeId: string, excludedStationId?: string): boolean => {
        for (const room of rooms) {
            for (const station of room.stations) {
                if (excludedStationId && station.id === excludedStationId) continue;
                if (station.employeeId !== employeeId) continue;
                if (station.status !== 'OCCUPIED' && station.status !== 'FINISHED') continue;
                if (isTherapyMassageTreatment(station.treatmentId)) {
                    return true;
                }
            }
        }
        return false;
    };

    /**
     * Get remaining time in seconds
     */
    const getRemainingTime = (station: Station): number => {
        if (!station.startTime || !station.duration) return 0;

        const endTime = station.startTime + (station.duration * 60 * 1000);
        const remaining = Math.max(0, endTime - Date.now());

        return Math.ceil(remaining / 1000);
    };

    /**
     * Format time as MM:SS
     */
    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    /**
     * Start timer interval
     */
    const startTimerInterval = (): void => {
        timerInterval = window.setInterval(() => {
            updateTimers();
        }, 1000);
    };

    /**
     * Update all timers
     */
    const updateTimers = (): void => {
        let hasFinishedTransition = false;

        for (const room of rooms) {
            for (const station of room.stations) {
                if (station.status === 'OCCUPIED') {
                    const remaining = getRemainingTime(station);

                    if (remaining <= 0) {
                        station.status = 'FINISHED';
                        hasFinishedTransition = true;
                        saveStationState(station);
                    }

                    updateTimerDisplay(station.id, remaining, station.treatmentId);
                }
            }
        }

        if (hasFinishedTransition) {
            playNotificationSound();
            updateAllStationCards();
        }
    };

    /**
     * Update timer display for a specific station
     */
    const updateTimerDisplay = (stationId: string, seconds: number, treatmentId?: string): void => {
        const stationCards = document.querySelectorAll(`[data-station-id="${stationId}"]`);

        // Threshold: 5 minutes (300s) for Therapy/Massage, 1 minute (60s) for others
        const threshold = isTherapyMassageTreatment(treatmentId) ? 300 : 60;

        stationCards.forEach(card => {
            // Update timer text
            const timerEl = card.querySelector('.station-timer');
            if (timerEl) {
                timerEl.textContent = formatTime(seconds);
            }

            // Add/remove ending warning class
            if (seconds > 0 && seconds <= threshold) {
                card.classList.add('ending');
            } else {
                card.classList.remove('ending');
            }
        });
    };

    /**
     * Count treatment usage in a room
     */
    const countTreatmentUsage = (room: Room, treatmentId: string): number => {
        const normalizedTreatmentId = normalizeTreatmentId(treatmentId) || treatmentId;
        const relevantRooms = GLOBAL_SINGLE_DEVICE_TREATMENTS.has(normalizedTreatmentId) ? rooms : [room];

        return relevantRooms.flatMap(r => r.stations).filter(s =>
            (s.status === 'OCCUPIED' || s.status === 'FINISHED') &&
            normalizeTreatmentId(s.treatmentId) === normalizedTreatmentId
        ).length;
    };

    /**
     * Check if treatment is available in room
     */
    const isTreatmentAvailable = (room: Room, treatment: Treatment): boolean => {
        const normalizedId = normalizeTreatmentId(treatment.id) || treatment.id;
        if (GLOBAL_SINGLE_DEVICE_TREATMENTS.has(normalizedId)) {
            return countTreatmentUsage(room, normalizedId) < 1;
        }
        if (!treatment.limit) return true;
        return countTreatmentUsage(room, treatment.id) < treatment.limit;
    };

    /**
     * Count free stations in a room
     */
    const countFreeStations = (room: Room): number => {
        return room.stations.filter(s => s.status === 'FREE').length;
    };

    /**
     * Render desktop grid view
     */
    const renderDesktopView = (): void => {
        const container = document.getElementById('stationsDesktopView');
        if (!container) return;

        const desktopColumns: Room[][] = [
            rooms.slice(0, 3), // Hydro, Magnet, Aquavibron
            rooms.slice(3, 5), // Fizyko 18, Fizyko 22
            rooms.slice(5, 7), // Sala 21, Sala Gimnastyczna
        ];

        container.innerHTML = desktopColumns.map((columnRooms) => `
            <div class="stations-column">
                ${columnRooms.map(room => `
                    <div class="room-panel" data-room="${room.id}">
                        <div class="room-panel-header">
                            <div class="room-panel-title">
                                <i class="fas ${room.icon}"></i>
                                ${room.name}
                            </div>
                            <div class="room-stats">
                                <span class="room-stat" data-room-stats="${room.id}">
                                    ${countFreeStations(room)}/${room.stations.length}
                                </span>
                            </div>
                        </div>
                        <div class="room-panel-body">
                            ${room.stations.map(station => renderStationCard(room, station)).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        `).join('');
    };

    /**
     * Render mobile view with category tiles
     */
    const renderMobileView = (): void => {
        const container = document.getElementById('stationsMobileView');
        if (!container) return;

        const activeId = activeMobileRoomId;

        const tilesHtml = rooms.map(room => {
            const isActive = room.id === activeId;
            return `
                <div class="mobile-room-card ${isActive ? 'expanded' : ''}" data-mobile-room-card="${room.id}">
                    <button class="mobile-room-tile ${isActive ? 'active' : ''}" data-mobile-room-tab="${room.id}" data-room="${room.id}">
                        <span class="mobile-room-tile-title">
                            <i class="fas ${room.icon}"></i>
                            ${room.name}
                        </span>
                        <span class="mobile-room-tile-meta">
                            <span class="mobile-room-status" data-room-status="${room.id}">
                                ${renderStatusDots(room)}
                            </span>
                            <span class="mobile-room-count" data-room-mobile-stats="${room.id}">
                                ${countFreeStations(room)}/${room.stations.length}
                            </span>
                        </span>
                    </button>
                    <div class="mobile-room-panel ${isActive ? 'active' : ''}" data-mobile-room-panel="${room.id}">
                        <div class="room-accordion-content">
                            ${room.stations.map(station => renderStationCard(room, station)).join('')}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="mobile-room-tiles">${tilesHtml}</div>
        `;
    };

    /**
     * Render status dots for accordion header
     */
    const renderStatusDots = (room: Room): string => {
        return room.stations.map(station => {
            const statusClass = station.status.toLowerCase();
            return `<span class="status-dot ${statusClass}"></span>`;
        }).join('');
    };

    /**
     * Render a station card - different for simple vs multi rooms
     */
    const renderStationCard = (room: Room, station: Station): string => {
        const statusClass = station.status.toLowerCase();
        const remaining = station.status === 'OCCUPIED' ? getRemainingTime(station) : 0;
        const treatment = room.treatments.find(t => t.id === station.treatmentId);
        const employeeName = getEmployeeLabel(station.employeeId);
        const queueHtml = renderQueueSection(room, station);

        if (room.type === 'simple') {
            return renderSimpleStationCard(room, station, statusClass, remaining, employeeName, queueHtml);
        } else {
            return renderMultiStationCard(room, station, statusClass, remaining, treatment, employeeName, queueHtml);
        }
    };

    /**
     * Render queue section for station card
     */
    const renderQueueSection = (room: Room, station: Station): string => {
        const isPickerActive = pendingQueueStation?.id === station.id && pendingQueueRoom;

        // Treatment picker tiles (shown inline when user clicks "Zakolejkuj się" on multi room)
        const pickerHtml = isPickerActive ? `
            <div class="queue-treatment-picker">
                <div class="queue-picker-title">Wybierz zabieg:</div>
                <div class="queue-picker-tiles">
                    ${pendingQueueRoom!.treatments
                .filter(t => !station.excludeTreatments?.includes(t.id))
                .map(t => `
                            <button class="queue-picker-tile" data-action="queue-treatment"
                                    data-station="${station.id}" data-room="${room.id}" data-treatment="${t.id}">
                                <span>${t.shortName}</span>
                                <span class="queue-picker-time">${t.duration}'</span>
                            </button>
                        `).join('')}
                </div>
            </div>
        ` : '';

        if (!station.queue || station.queue.length === 0) {
            // Show "Add to queue" button if station is not free
            if (station.status !== 'FREE') {
                if (room.type === 'simple') {
                    return `
                        <div class="station-queue-container">
                            <button class="btn-add-queue" data-action="add-to-queue" data-station="${station.id}" data-room="${room.id}">
                                <i class="fas fa-plus"></i> Zakolejkuj się
                            </button>
                        </div>
                    `;
                } else {
                    return `
                        <div class="station-queue-container">
                            <button class="btn-add-queue" data-action="show-queue-treatments" data-station="${station.id}" data-room="${room.id}">
                                <i class="fas fa-plus"></i> Zakolejkuj się
                            </button>
                            ${pickerHtml}
                        </div>
                    `;
                }
            }
            return '';
        }

        const queueList = station.queue.map((q, index) => {
            const empName = EmployeeManager.getNameById(q.employeeId);
            const treatmentName = getQueueTreatmentLabel(room, station, q);
            const isOwn = q.employeeId === currentEmployeeId;
            const canRemove = isCurrentUserAdmin || isOwn;

            return `
                <div class="queue-item ${isOwn ? 'own' : ''}">
                    <span class="queue-index">${index + 1}.</span>
                    <span class="queue-emp">${empName}</span>
                    <span class="queue-treat">${treatmentName}</span>
                    ${canRemove ? `
                        <button class="btn-remove-queue" data-action="remove-from-queue" 
                                data-station="${station.id}" data-room="${room.id}" data-employee="${q.employeeId}">
                            <i class="fas fa-times"></i>
                        </button>
                    ` : ''}
                </div>
            `;
        }).join('');

        const addButtonHtml = station.queue.length < 3 ? (
            room.type === 'simple'
                ? `<button class="btn-add-queue mini" data-action="add-to-queue" data-station="${station.id}" data-room="${room.id}"><i class="fas fa-plus"></i></button>`
                : `<button class="btn-add-queue mini" data-action="show-queue-treatments" data-station="${station.id}" data-room="${room.id}"><i class="fas fa-plus"></i></button>`
        ) : '';

        const nextEntry = station.queue[0];
        const nextPreviewHtml = station.status === 'FINISHED' && nextEntry ? `
            <div class="queue-next">
                <i class="fas fa-forward"></i> Następny: ${EmployeeManager.getNameById(nextEntry.employeeId)}
            </div>
        ` : '';

        return `
            <div class="station-queue-container">
                <div class="queue-header">
                    <i class="fas fa-list-ol"></i> Kolejka (${station.queue.length})
                </div>
                ${nextPreviewHtml}
                <div class="queue-list">
                    ${queueList}
                </div>
                ${addButtonHtml}
                ${pickerHtml}
            </div>
        `;
    };

    /**
     * Render simple station card (single click to start)
     */
    const renderSimpleStationCard = (room: Room, station: Station, statusClass: string, remaining: number, employeeName: string, queueHtml: string): string => {
        if (station.status === 'FREE') {
            return `
                <div class="station-card station-simple ${statusClass}" data-station-id="${station.id}">
                    <div class="station-simple-content" data-action="start-simple" data-station="${station.id}" data-room="${room.id}">
                        <span class="station-name">${station.name}</span>
                        <span class="station-duration">${room.defaultDuration} min</span>
                    </div>
                </div>
            `;
        } else if (station.status === 'OCCUPIED') {
            return `
                <div class="station-card station-simple ${statusClass}" data-station-id="${station.id}">
                    <div class="station-timer-content">
                        <div class="station-info">
                            <span class="station-name">${station.name}</span>
                            <span class="station-emp-name">${employeeName}</span>
                        </div>
                        <span class="station-timer">${formatTime(remaining)}</span>
                        <button class="station-cancel-btn" data-action="cancel" data-station="${station.id}" data-room="${room.id}">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    ${queueHtml}
                </div>
            `;
        } else {
            return `
                <div class="station-card station-simple ${statusClass}" data-station-id="${station.id}">
                    <div class="station-finished-content" data-action="release" data-station="${station.id}" data-room="${room.id}">
                        <span class="station-name">${station.name}</span>
                        <span class="station-emp-name">${employeeName}</span>
                        <span class="station-timer">00:00</span>
                        <span class="station-release-hint">Kliknij aby zwolnić</span>
                    </div>
                    ${queueHtml}
                </div>
            `;
        }
    };

    /**
     * Render multi-treatment station card (treatment tiles visible)
     */
    const renderMultiStationCard = (room: Room, station: Station, statusClass: string, remaining: number, treatment: Treatment | undefined, employeeName: string, queueHtml: string): string => {
        if (station.status === 'FREE') {
            // Filter treatments based on station's excludeTreatments
            const availableTreatments = room.treatments.filter(t =>
                !station.excludeTreatments?.includes(t.id)
            );

            // Show station name + treatment tiles
            const treatmentTiles = availableTreatments.map(t => {
                const blockedByOwnTherapyMassage = Boolean(
                    currentEmployeeId &&
                    !isCurrentUserAdmin &&
                    isTherapyMassageTreatment(t.id) &&
                    hasActiveTherapyMassage(currentEmployeeId, station.id)
                );
                const available = isTreatmentAvailable(room, t) && !blockedByOwnTherapyMassage;
                const disabledClass = available ? '' : 'disabled';
                const usageInfo = t.limit ? `${countTreatmentUsage(room, t.id)}/${t.limit}` : '';
                const disabledTitle = blockedByOwnTherapyMassage
                    ? 'Masz już aktywną Terapię/Masaż. Dodaj się do kolejki.'
                    : '';

                return `
                    <button class="treatment-tile ${disabledClass}" 
                            data-action="start-treatment" 
                            data-station="${station.id}" 
                            data-room="${room.id}"
                            data-treatment="${t.id}"
                            title="${disabledTitle}"
                            ${available ? '' : 'disabled'}>
                        <span class="treatment-tile-name">${t.shortName}</span>
                        <span class="treatment-tile-time">${t.duration}'</span>
                        ${usageInfo ? `<span class="treatment-tile-limit">${usageInfo}</span>` : ''}
                    </button>
                `;
            }).join('');

            return `
                <div class="station-card station-multi ${statusClass}" data-station-id="${station.id}">
                    <div class="station-header">
                        <span class="station-name">${station.name}</span>
                    </div>
                    <div class="treatment-tiles">
                        ${treatmentTiles}
                    </div>
                </div>
            `;
        } else if (station.status === 'OCCUPIED') {
            return `
                <div class="station-card station-multi ${statusClass}" data-station-id="${station.id}">
                    <div class="station-occupied-content">
                        <div class="station-info">
                            <span class="station-name">${station.name}</span>
                            <span class="station-emp-name">${employeeName}</span>
                            <span class="station-treatment-name">${treatment?.shortName || ''}</span>
                        </div>
                        <span class="station-timer">${formatTime(remaining)}</span>
                        <button class="station-cancel-btn" data-action="cancel" data-station="${station.id}" data-room="${room.id}">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    ${queueHtml}
                </div>
            `;
        } else {
            // FINISHED
            return `
                <div class="station-card station-multi ${statusClass}" data-station-id="${station.id}">
                    <div class="station-finished-content" data-action="release" data-station="${station.id}" data-room="${room.id}">
                        <div class="station-info">
                            <span class="station-name">${station.name}</span>
                            <span class="station-emp-name">${employeeName}</span>
                            <span class="station-treatment-name">${treatment?.shortName || ''}</span>
                        </div>
                        <span class="station-timer">00:00</span>
                        <span class="station-release-hint">Kliknij aby zwolnić</span>
                    </div>
                    ${queueHtml}
                </div>
            `;
        }
    };

    /**
     * Update all station cards
     */
    const updateAllStationCards = (): void => {
        for (const room of rooms) {
            for (const station of room.stations) {
                updateStationCard(room, station);
            }

            // Update room stats
            const statsEl = document.querySelector(`[data-room-stats="${room.id}"]`);
            if (statsEl) {
                statsEl.textContent = `${countFreeStations(room)}/${room.stations.length}`;
            }
            const mobileStatsEl = document.querySelector(`[data-room-mobile-stats="${room.id}"]`);
            if (mobileStatsEl) {
                mobileStatsEl.textContent = `${countFreeStations(room)}/${room.stations.length}`;
            }

            // Update status dots
            const statusDotsEl = document.querySelector(`[data-room-status="${room.id}"]`);
            if (statusDotsEl) {
                statusDotsEl.innerHTML = renderStatusDots(room);
            }
        }
    };

    /**
     * Update a single station card
     */
    const updateStationCard = (room: Room, station: Station): void => {
        const cards = document.querySelectorAll(`[data-station-id="${station.id}"]`);
        const newCardHtml = renderStationCard(room, station);

        cards.forEach(card => {
            const temp = document.createElement('div');
            temp.innerHTML = newCardHtml;
            const newCard = temp.firstElementChild as HTMLElement;

            if (newCard) {
                card.replaceWith(newCard);
            }
        });
    };

    /**
     * Setup event listeners
     */
    const setupEventListeners = (): void => {
        document.addEventListener('click', handleClick);

        // Sound toggle
        const soundBtn = document.getElementById('toggleSoundBtn');
        soundBtn?.addEventListener('click', toggleSound);
    };

    /**
     * Handle click events
     */
    const handleClick = (e: MouseEvent): void => {
        const target = e.target as HTMLElement;

        // Mobile room tile toggle
        const roomTile = target.closest('[data-mobile-room-tab]') as HTMLElement;
        if (roomTile && !target.closest('[data-action]')) {
            setActiveMobileRoom(roomTile.dataset.mobileRoomTab || '');
            return;
        }

        // Action buttons/elements
        const actionEl = target.closest('[data-action]') as HTMLElement;
        if (actionEl) {
            e.stopPropagation();
            const action = actionEl.dataset.action;
            const stationId = actionEl.dataset.station;
            const roomId = actionEl.dataset.room;
            const treatmentId = actionEl.dataset.treatment;
            const employeeId = actionEl.dataset.employee;

            if (action && stationId && roomId) {
                handleAction(action, roomId, stationId, treatmentId, employeeId);
            }
        }
    };

    /**
     * Handle action
     */
    const handleAction = (action: string, roomId: string, stationId: string, treatmentId?: string, employeeId?: string): void => {
        const room = rooms.find(r => r.id === roomId);
        const station = room?.stations.find(s => s.id === stationId);

        if (!room || !station) return;

        switch (action) {
            case 'start-simple':
                if (station.status === 'FREE') {
                    startSimpleTreatment(room, station);
                }
                break;
            case 'start-treatment':
                if (station.status === 'FREE' && treatmentId) {
                    const treatment = room.treatments.find(t => t.id === treatmentId);
                    if (treatment && isTreatmentAvailable(room, treatment)) {
                        startMultiTreatment(room, station, treatment);
                    }
                }
                break;
            case 'cancel':
            case 'release':
                releaseStation(station);
                break;
            case 'add-to-queue':
                // Simple rooms: add directly with default treatment
                if (station.status !== 'FREE') {
                    addToQueue(station, station.id, room.defaultDuration);
                }
                break;
            case 'show-queue-treatments':
                // Multi rooms: show treatment tiles for queue selection
                if (station.status !== 'FREE') {
                    showQueueTreatmentPicker(room, station);
                }
                break;
            case 'queue-treatment':
                // Treatment selected from queue picker
                if (treatmentId) {
                    const treatment = room.treatments.find(t => t.id === treatmentId);
                    if (treatment) {
                        addToQueue(station, treatment.id, treatment.duration);
                    }
                }
                // Close the picker
                pendingQueueStation = null;
                pendingQueueRoom = null;
                updateAllStationCards();
                break;
            case 'remove-from-queue':
                if (employeeId) {
                    removeFromQueue(station, employeeId);
                }
                break;
        }
    };

    /**
     * Show treatment picker tiles for queue selection (multi rooms)
     */
    const showQueueTreatmentPicker = (room: Room, station: Station): void => {
        // Toggle: if already showing picker for this station, hide it
        if (pendingQueueStation?.id === station.id) {
            pendingQueueStation = null;
            pendingQueueRoom = null;
        } else {
            pendingQueueStation = station;
            pendingQueueRoom = room;
        }
        updateAllStationCards();
    };

    /**
     * Set active mobile room tile/panel
     */
    const setActiveMobileRoom = (roomId: string): void => {
        if (!roomId) return;
        activeMobileRoomId = activeMobileRoomId === roomId ? null : roomId;

        document.querySelectorAll('.mobile-room-tile').forEach(tile => {
            const isActive = (tile as HTMLElement).dataset.mobileRoomTab === activeMobileRoomId;
            tile.classList.toggle('active', isActive);
        });

        document.querySelectorAll('.mobile-room-panel').forEach(panel => {
            const isActive = (panel as HTMLElement).dataset.mobileRoomPanel === activeMobileRoomId;
            panel.classList.toggle('active', isActive);
        });

        document.querySelectorAll('.mobile-room-card').forEach(card => {
            const isActive = (card as HTMLElement).dataset.mobileRoomCard === activeMobileRoomId;
            card.classList.toggle('expanded', isActive);
        });
    };

    /**
     * Toggle sound
     */
    const toggleSound = (): void => {
        soundEnabled = !soundEnabled;
        localStorage.setItem('stationsSoundEnabled', String(soundEnabled));
        updateSoundButton();
        window.showToast?.(soundEnabled ? 'Dźwięk włączony' : 'Dźwięk wyłączony', 1500);
    };

    /**
     * Update sound button state
     */
    const updateSoundButton = (): void => {
        const btn = document.getElementById('toggleSoundBtn');
        if (!btn) return;

        if (soundEnabled) {
            btn.classList.remove('muted');
            btn.innerHTML = '<i class="fas fa-volume-up"></i>';
        } else {
            btn.classList.add('muted');
            btn.innerHTML = '<i class="fas fa-volume-mute"></i>';
        }
    };

    return {
        init,
        destroy,
    };
})();

// Backward compatibility
declare global {
    interface Window {
        Stations: StationsAPI;
    }
}

window.Stations = Stations;
