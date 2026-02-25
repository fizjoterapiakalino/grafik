// scripts/stations.ts - PhysioResource Tracker Module
import { db as dbRaw, auth as authRaw, FieldValue } from './firebase-config.js';
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
            _ref?: unknown;
        };
    };
    runTransaction?<T>(
        updateFunction: (transaction: {
            get(
                docRef: {
                    _ref?: unknown;
                }
            ): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
            set(
                docRef: {
                    _ref?: unknown;
                },
                data: Record<string, unknown>,
                options?: { merge?: boolean }
            ): void;
        }) => Promise<T> | T
    ): Promise<T>;
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
    startTimeServer?: unknown;
    duration?: number;
    employeeId?: string;
    queue?: QueueEntry[];
}

interface StationsDocData extends Record<string, unknown> {
    _lastUpdated?: unknown;
    _revision?: number;
}

/**
 * Interfejs publicznego API Stations
 */
interface StationsAPI {
    init(): void;
    destroy(): void;
}

type RoomVisibilityMap = Record<string, boolean>;
type DesktopColumnsCount = 1 | 2 | 3;
type RoomLayoutSettings = Record<DesktopColumnsCount, string[][]>;
const DESKTOP_COLUMNS_OPTIONS: DesktopColumnsCount[] = [1, 2, 3];

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
    let roomVisibility: Map<string, boolean> = new Map();
    let desktopColumnsCount: DesktopColumnsCount = 3;
    let roomLayoutSettings: RoomLayoutSettings = { 1: [], 2: [], 3: [] };
    let isLayoutEditMode = false;
    let draggedRoomId: string | null = null;

    // User session state
    let currentUserUid: string | null = null;
    let currentEmployeeId: string | null = null;
    let isCurrentUserAdmin = false;

    // Pending queue action (for multi-room treatment selection)
    let pendingQueueStation: Station | null = null;
    let pendingQueueRoom: Room | null = null;
    let activeMobileRoomId: string | null = null;
    let lastQueueMove: { stationId: string; employeeId: string; direction: 'up' | 'down'; at: number } | null = null;

    interface StationNotificationState {
        startTime: number;
        warningSent: boolean;
        finishedSent: boolean;
    }
    const notificationStates = new Map<string, StationNotificationState>();
    const timerTransitionsInFlight = new Set<string>();
    const STATIONS_DOC_ID = 'state';
    let lastKnownRevision = 0;

    /**
     * Return current time.
     */
    const getNowMs = (): number => Date.now();

    const parseFirestoreMillis = (value: unknown): number | null => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (!value || typeof value !== 'object') return null;
        const maybeTimestamp = value as { toMillis?: () => number };
        if (typeof maybeTimestamp.toMillis !== 'function') return null;
        const millis = maybeTimestamp.toMillis();
        return Number.isFinite(millis) ? millis : null;
    };

    const updateServerOffset = (data: Record<string, unknown>): void => {
        const docData = data as StationsDocData;
        if (typeof docData._revision === 'number' && Number.isFinite(docData._revision)) {
            lastKnownRevision = Math.max(lastKnownRevision, Math.floor(docData._revision));
        }
    };

    const markQueueMove = (stationId: string, employeeId: string, direction: 'up' | 'down'): void => {
        const now = getNowMs();
        lastQueueMove = { stationId, employeeId, direction, at: now };
        window.setTimeout(() => {
            if (lastQueueMove && lastQueueMove.at === now) {
                lastQueueMove = null;
            }
        }, 900);
    };

    /**
     * Initialize module
     */
    const init = (): void => {
        console.log('Stations module initializing...');

        // Setup auth state listener
        unsubscribeAuth = auth.onAuthStateChanged((user: any) => {
            if (user) {
                currentUserUid = user.uid;
                const employee = EmployeeManager.getEmployeeByUid(user.uid);
                currentEmployeeId = employee ? employee.id : null;
                isCurrentUserAdmin = EmployeeManager.isUserAdmin(user.uid);
                console.log('Stations Auth Update:', { id: currentEmployeeId, isAdmin: isCurrentUserAdmin });
            } else {
                currentUserUid = null;
                currentEmployeeId = null;
                isCurrentUserAdmin = false;
            }

            loadRoomVisibilitySettings();
            loadDesktopColumnsSettings();
            loadRoomLayoutSettings();
            normalizeActiveMobileRoom();
            renderDesktopView();
            renderMobileView();
            renderSectionsOptionsList();
            updateAllStationCards();
        });

        // Deep clone configuration
        rooms = JSON.parse(JSON.stringify(ROOMS_CONFIG));
        activeMobileRoomId = rooms[0]?.id ?? null;
        loadRoomVisibilitySettings();
        loadDesktopColumnsSettings();
        loadRoomLayoutSettings();
        normalizeActiveMobileRoom();

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
        renderSectionsOptionsList();

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
        roomVisibility.clear();
        currentUserUid = null;
        desktopColumnsCount = 3;
        roomLayoutSettings = { 1: [], 2: [], 3: [] };
        isLayoutEditMode = false;
        draggedRoomId = null;
        pendingQueueStation = null;
        pendingQueueRoom = null;
        activeMobileRoomId = null;
        closeSectionsOptionsModal();
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
     * Request notification permission on user interaction
     */
    const requestNotificationPermissionOnInteraction = (): void => {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().catch(console.warn);
        }
    };

    /**
     * Send Push/Local Notification
     */
    const sendNotification = async (title: string, body: string, vibrate: number[]): Promise<void> => {
        if (!soundEnabled) return;

        if (navigator.vibrate) {
            navigator.vibrate(vibrate);
        }

        if (!('Notification' in window)) return;

        if (Notification.permission === 'granted') {
            try {
                const swRegistration = await navigator.serviceWorker?.getRegistration();
                if (swRegistration && swRegistration.showNotification) {
                    await swRegistration.showNotification(title, {
                        body,
                        vibrate,
                        icon: 'logo.png',
                        tag: `station-timer-${title}`,
                        renotify: true
                    } as any);
                } else {
                    new Notification(title, { body, vibrate, icon: 'logo.png' } as any);
                }
            } catch (e) {
                console.error('Notification error:', e);
            }
        }
    };

    /**
     * Subscribe to Firebase real-time updates
     */
    const subscribeToUpdates = (): void => {
        const docRef = db.collection('stations').doc(STATIONS_DOC_ID);

        unsubscribe = docRef.onSnapshot(
            (snapshot: any) => {
                if (snapshot.exists) {
                    const data = (snapshot.data() || {}) as StationsDocData;
                    updateServerOffset(data);
                    const previousStates = new Map(stationStates);

                    stationStates.clear();

                    for (const [stationId, state] of Object.entries(data)) {
                        if (stationId.startsWith('_')) continue;
                        stationStates.set(stationId, normalizeStationState(state));
                    }

                    // Check for newly finished stations
                    checkForNewlyFinished(previousStates);

                    // Sync local state
                    syncLocalState();

                    // Update UI
                    updateAllStationCards();
                } else {
                    stationStates.clear();
                    syncLocalState();
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
        const user = auth.currentUser;
        const currentUid = user?.uid;
        const isAdmin = currentUid ? EmployeeManager.isUserAdmin(currentUid) : false;
        const currentEmp = currentUid ? EmployeeManager.getEmployeeByUid(currentUid) : null;
        const effectiveEmpId = currentEmp?.id || null;

        if (options?.forcePicker) {
            if (isAdmin) {
                return showEmployeePickerModal(options.pickerTitle);
            }
            return effectiveEmpId;
        }

        // Dla zwykłych zabiegów zawsze używaj aktualnie zalogowanego pracownika.
        // Jeśli konto admina nie ma przypisanego employeeId, dopiero wtedy fallback do pickera.
        if (effectiveEmpId) {
            return effectiveEmpId;
        }

        return isAdmin ? showEmployeePickerModal(options?.pickerTitle) : null;
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
    const normalizeQueueEntries = (queue: unknown): QueueEntry[] => {
        if (!Array.isArray(queue)) return [];

        return queue
            .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
            .map((entry) => {
                const treatmentIdRaw = typeof entry.treatmentId === 'string' ? entry.treatmentId : '';
                const normalizedTreatmentId = normalizeTreatmentId(treatmentIdRaw) || treatmentIdRaw;
                const durationRaw = typeof entry.duration === 'number' ? entry.duration : 0;
                const normalizedDuration = isTherapyMassageTreatment(normalizedTreatmentId) ? 20 : durationRaw;

                return {
                    employeeId: typeof entry.employeeId === 'string' ? entry.employeeId : '',
                    treatmentId: normalizedTreatmentId,
                    duration: normalizedDuration,
                    addedAt: typeof entry.addedAt === 'number' ? entry.addedAt : getNowMs(),
                };
            })
            .filter(entry => !!entry.employeeId && !!entry.treatmentId && entry.duration > 0);
    };

    const normalizeStationState = (raw: unknown): StationState => {
        if (!raw || typeof raw !== 'object') {
            return { status: 'FREE', queue: [] };
        }

        const source = raw as Record<string, unknown>;
        const queue = normalizeQueueEntries(source.queue);
        const statusRaw = source.status;
        const status: StationStatus =
            statusRaw === 'OCCUPIED' || statusRaw === 'FINISHED' ? statusRaw : 'FREE';

        const treatmentIdRaw = typeof source.treatmentId === 'string' ? source.treatmentId : undefined;
        const treatmentId = normalizeTreatmentId(treatmentIdRaw);
        const durationRaw = typeof source.duration === 'number' ? source.duration : undefined;
        const serverStartTime = parseFirestoreMillis(source.startTimeServer);
        const startTimeFallback =
            typeof source.startTime === 'number' ? source.startTime : parseFirestoreMillis(source.startTime);
        const resolvedStartTime = serverStartTime ?? startTimeFallback ?? undefined;

        if (status !== 'OCCUPIED' && status !== 'FINISHED') {
            return {
                status: 'FREE',
                queue
            };
        }

        return {
            status,
            treatmentId,
            startTime: resolvedStartTime,
            startTimeServer: source.startTimeServer,
            duration: treatmentId && isTherapyMassageTreatment(treatmentId) ? 20 : durationRaw,
            employeeId: typeof source.employeeId === 'string' ? source.employeeId : undefined,
            queue
        };
    };

    const serializeStationState = (state: StationState): Record<string, unknown> => {
        const queue = normalizeQueueEntries(state.queue);
        if (state.status === 'OCCUPIED' || state.status === 'FINISHED') {
            return {
                status: state.status,
                treatmentId: normalizeTreatmentId(state.treatmentId),
                startTime: state.startTime,
                ...(state.startTimeServer !== undefined ? { startTimeServer: state.startTimeServer } : {}),
                duration: state.treatmentId && isTherapyMassageTreatment(state.treatmentId) ? 20 : state.duration,
                employeeId: state.employeeId,
                queue,
            };
        }

        return {
            status: 'FREE',
            queue,
        };
    };

    const applyStationStateToModel = (stationId: string, state: StationState): void => {
        for (const room of rooms) {
            const station = room.stations.find(s => s.id === stationId);
            if (!station) continue;

            station.status = state.status;
            station.treatmentId = normalizeTreatmentId(state.treatmentId);
            station.startTime = state.startTime;
            station.duration = state.treatmentId && isTherapyMassageTreatment(state.treatmentId) ? 20 : state.duration;
            station.employeeId = state.employeeId;
            station.queue = normalizeQueueEntries(state.queue);
            return;
        }
    };

    const mutateStationState = async <T = void>(
        stationId: string,
        mutate: (current: StationState) => { next: StationState; result?: T } | null
    ): Promise<{ applied: boolean; next: StationState | null; result?: T }> => {
        const docRef = db.collection('stations').doc(STATIONS_DOC_ID);

        if (typeof db.runTransaction !== 'function') {
            const snapshot = await docRef.get();
            const rawData = (snapshot.data?.() || {}) as StationsDocData;
            const current = normalizeStationState(rawData[stationId]);
            const mutation = mutate(current);
            if (!mutation) {
                return { applied: false, next: current };
            }

            const nextRevision = (typeof rawData._revision === 'number' ? rawData._revision : lastKnownRevision) + 1;
            const payload: Record<string, unknown> = {
                _lastUpdated: FieldValue.serverTimestamp(),
                _revision: nextRevision,
                [stationId]: serializeStationState(mutation.next)
            };

            await docRef.set(payload, { merge: true });
            lastKnownRevision = nextRevision;
            updateServerOffset({ _lastUpdated: Date.now(), _revision: nextRevision });
            return { applied: true, next: mutation.next, result: mutation.result };
        }

        let applied = false;
        let nextState: StationState | null = null;
        let mutationResult: T | undefined;

        await db.runTransaction(async (tx) => {
            const snapshot = await tx.get(docRef);
            const rawData = (snapshot.data?.() || {}) as StationsDocData;
            const current = normalizeStationState(rawData[stationId]);
            const mutation = mutate(current);
            if (!mutation) {
                nextState = current;
                return;
            }

            const nextRevision = (typeof rawData._revision === 'number' ? rawData._revision : lastKnownRevision) + 1;
            const payload: Record<string, unknown> = {
                _lastUpdated: FieldValue.serverTimestamp(),
                _revision: nextRevision,
                [stationId]: serializeStationState(mutation.next)
            };

            tx.set(docRef, payload, { merge: true });
            applied = true;
            nextState = mutation.next;
            mutationResult = mutation.result;
            lastKnownRevision = nextRevision;
        });

        return { applied, next: nextState, result: mutationResult };
    };

    const syncLocalState = (): void => {
        for (const room of rooms) {
            for (const station of room.stations) {
                const state = stationStates.get(station.id);
                if (state) {
                    const normalized = normalizeStationState(state);
                    station.status = normalized.status;
                    station.treatmentId = normalized.treatmentId;
                    station.startTime = normalized.startTime;
                    station.duration = normalized.duration;
                    station.employeeId = normalized.employeeId;
                    station.queue = normalized.queue || [];
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
     * Start treatment on a station (for simple rooms)
     */
    const startSimpleTreatment = async (room: Room, station: Station): Promise<void> => {
        requestNotificationPermissionOnInteraction();
        const empId = await getActiveEmployeeId();
        if (!empId) {
            window.showToast?.('Nie wybrano pracownika', 2000);
            return;
        }
        const startedAt = getNowMs();
        const mutation = await mutateStationState(station.id, (current) => {
            if (current.status !== 'FREE') return null;
            return {
                next: {
                    status: 'OCCUPIED',
                    treatmentId: station.id,
                    startTime: startedAt,
                    startTimeServer: FieldValue.serverTimestamp(),
                    duration: room.defaultDuration,
                    employeeId: empId,
                    queue: current.queue || [],
                }
            };
        });

        if (!mutation.applied || !mutation.next) {
            window.showToast?.('Stanowisko jest już zajęte', 2000);
            return;
        }

        applyStationStateToModel(station.id, mutation.next);
        window.showToast?.(`${station.name} - ${room.defaultDuration} min`, 2000);
        updateAllStationCards();
    };

    /**
     * Start treatment on a station (for multi-treatment rooms)
     */
    const startMultiTreatment = async (_room: Room, station: Station, treatment: Treatment): Promise<void> => {
        requestNotificationPermissionOnInteraction();
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

        const startedAt = getNowMs();
        const mutation = await mutateStationState(station.id, (current) => {
            if (current.status !== 'FREE') return null;
            return {
                next: {
                    status: 'OCCUPIED',
                    treatmentId: normalizeTreatmentId(treatment.id),
                    startTime: startedAt,
                    startTimeServer: FieldValue.serverTimestamp(),
                    duration: treatment.duration,
                    employeeId: empId,
                    queue: current.queue || [],
                }
            };
        });

        if (!mutation.applied || !mutation.next) {
            window.showToast?.('Stanowisko jest już zajęte', 2000);
            return;
        }

        applyStationStateToModel(station.id, mutation.next);
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
        const now = getNowMs();
        const mutation = await mutateStationState<{ startedNext: boolean; nextEmployeeId?: string }>(station.id, (current) => {
            if (current.status !== 'OCCUPIED' && current.status !== 'FINISHED') return null;
            if (!isCurrentUserAdmin && current.employeeId && current.employeeId !== currentEmployeeId) return null;

            const queue = normalizeQueueEntries(current.queue);
            const nextInQueue = queue[0];
            const isNextTherapy = nextInQueue && isTherapyMassageTreatment(nextInQueue.treatmentId);

            if (nextInQueue && !isNextTherapy) {
                const [, ...remainingQueue] = queue;
                return {
                    next: {
                        status: 'OCCUPIED',
                        treatmentId: normalizeTreatmentId(nextInQueue.treatmentId),
                        startTime: now,
                        startTimeServer: FieldValue.serverTimestamp(),
                        duration: isTherapyMassageTreatment(nextInQueue.treatmentId) ? 20 : nextInQueue.duration,
                        employeeId: nextInQueue.employeeId,
                        queue: remainingQueue,
                    },
                    result: {
                        startedNext: true,
                        nextEmployeeId: nextInQueue.employeeId,
                    }
                };
            }

            return {
                next: {
                    status: 'FREE',
                    queue,
                },
                result: {
                    startedNext: false
                }
            };
        });

        if (!mutation.next) return;
        applyStationStateToModel(station.id, mutation.next);

        if (mutation.result?.startedNext && mutation.result.nextEmployeeId) {
            const empName = EmployeeManager.getNameById(mutation.result.nextEmployeeId);
            window.showToast?.(`Następny: ${empName}`, 3000);
            playNotificationSound();
        } else {
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

        const mutation = await mutateStationState(station.id, (current) => {
            const queue = normalizeQueueEntries(current.queue);
            if (queue.length >= 5) return null;
            if (queue.some(q => q.employeeId === empId)) return null;

            return {
                next: {
                    ...current,
                    queue: [
                        ...queue,
                        {
                            employeeId: empId,
                            treatmentId: normalizedTreatmentId,
                            duration: normalizedDuration,
                            addedAt: getNowMs()
                        }
                    ]
                }
            };
        });

        if (!mutation.applied || !mutation.next) {
            const queue = normalizeQueueEntries(station.queue);
            if (queue.length >= 5) {
                window.showToast?.('Kolejka jest pełna (max 5)', 2500);
            } else {
                window.showToast?.('Jesteś już w kolejce', 2000);
            }
            return;
        }

        applyStationStateToModel(station.id, mutation.next);
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

        const mutation = await mutateStationState(station.id, (current) => {
            const queue = normalizeQueueEntries(current.queue);
            const exists = queue.some(q => q.employeeId === employeeId);
            if (!exists) return null;
            return {
                next: {
                    ...current,
                    queue: queue.filter(q => q.employeeId !== employeeId)
                }
            };
        });

        if (!mutation.applied || !mutation.next) return;

        applyStationStateToModel(station.id, mutation.next);
        window.showToast?.('Usunięto z kolejki', 1500);
        updateAllStationCards();
    };

    /**
     * Process next person in queue
     */
    const processQueue = async (station: Station, isManual = false): Promise<void> => {
        if (!station.queue || station.queue.length === 0) return;

        // Robust permission check - use fresh data if possible
        const user = auth.currentUser;
        const currentUid = user?.uid;
        const currentEmp = currentUid ? EmployeeManager.getEmployeeByUid(currentUid) : null;
        const isAdmin = currentUid ? EmployeeManager.isUserAdmin(currentUid) : false;
        const effectiveEmpId = currentEmp?.id || null;

        console.log('--- Queue Process Check ---');
        console.log('Action Type:', isManual ? 'MANUAL (User Clicked)' : 'AUTO (System/Release)');
        console.log('Current User:', { uid: currentUid, empId: effectiveEmpId, isAdmin });
        const mutation = await mutateStationState<{ startedEmployeeId: string }>(station.id, (current) => {
            const queue = normalizeQueueEntries(current.queue);
            const next = queue[0];
            if (!next) return null;

            console.log('Queued Item:', { nextEmpId: next.employeeId, treatmentId: next.treatmentId });

            if (isManual) {
                if (!currentUid || !effectiveEmpId) {
                    console.warn('BLOCK: User not identified as employee');
                    return null;
                }

                if (!isAdmin && next.employeeId !== effectiveEmpId) {
                    console.warn('BLOCK: User is not admin and does not own this queue entry');
                    return null;
                }

                console.log('Permission granted for manual start');
            }

            const [, ...remainingQueue] = queue;
            return {
                next: {
                    status: 'OCCUPIED',
                    employeeId: next.employeeId,
                    treatmentId: normalizeTreatmentId(next.treatmentId),
                    startTime: getNowMs(),
                    startTimeServer: FieldValue.serverTimestamp(),
                    duration: isTherapyMassageTreatment(next.treatmentId) ? 20 : next.duration,
                    queue: remainingQueue,
                },
                result: {
                    startedEmployeeId: next.employeeId
                }
            };
        });

        if (!mutation.applied || !mutation.next || !mutation.result?.startedEmployeeId) {
            if (isManual) {
                window.showToast?.('Możesz rozpocząć tylko własny zabieg', 3000);
            }
            return;
        }

        applyStationStateToModel(station.id, mutation.next);
        const empName = EmployeeManager.getNameById(mutation.result.startedEmployeeId);
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
        const remaining = Math.max(0, endTime - getNowMs());

        return Math.ceil(remaining / 1000);
    };

    /**
     * Get approximate waiting time (seconds) before queue entry can start
     */
    const getQueueWaitSeconds = (station: Station, queueIndex: number): number => {
        let waitSeconds = 0;

        if (station.status === 'OCCUPIED') {
            waitSeconds += getRemainingTime(station);
        }

        for (let i = 0; i < queueIndex; i += 1) {
            const entry = station.queue?.[i];
            if (!entry) continue;
            waitSeconds += Math.ceil(entry.duration * 60);
        }

        return Math.max(0, waitSeconds);
    };

    /**
     * Format queue ETA as clock time (HH:MM)
     */
    const formatQueueEta = (waitSeconds: number): string => {
        const startAt = new Date(getNowMs() + Math.max(0, waitSeconds) * 1000);
        const hours = startAt.getHours().toString().padStart(2, '0');
        const minutes = startAt.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
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
                    const threshold = isTherapyMassageTreatment(station.treatmentId) ? 300 : 60;

                    let notifState = notificationStates.get(station.id);
                    if (!notifState || notifState.startTime !== station.startTime) {
                        notifState = { startTime: station.startTime!, warningSent: false, finishedSent: false };
                        notificationStates.set(station.id, notifState);
                    }

                    if (remaining > 0 && remaining <= threshold && !notifState.warningSent) {
                        notifState.warningSent = true;
                        sendNotification(`Ostrzeżenie: ${station.name}`, `Zbliża się koniec. Pozostało: ${formatTime(remaining)}`, [200, 100, 200]);
                    }

                    if (remaining <= 0) {
                        if (!notifState.finishedSent) {
                            notifState.finishedSent = true;
                            sendNotification(`Koniec: ${station.name}`, `Czas zabiegu upłynął (00:00)`, [1000]);
                        }
                        if (!station.startTime || !station.duration) {
                            // Invalid local timer data; wait for next snapshot instead of persisting potentially stale state.
                            continue;
                        }

                        if (!timerTransitionsInFlight.has(station.id)) {
                            timerTransitionsInFlight.add(station.id);
                            const expectedStartTime = station.startTime;

                            void mutateStationState(station.id, (current) => {
                                if (current.status !== 'OCCUPIED') return null;
                                if (!current.startTime || !current.duration) return null;
                                if (current.startTime !== expectedStartTime) return null;

                                const nextInQueue = normalizeQueueEntries(current.queue)[0];
                                const isNextTherapy = nextInQueue && isTherapyMassageTreatment(nextInQueue.treatmentId);

                                if (isNextTherapy) {
                                    return {
                                        next: {
                                            status: 'FREE',
                                            queue: normalizeQueueEntries(current.queue),
                                        }
                                    };
                                }

                                return {
                                    next: {
                                        ...current,
                                        status: 'FINISHED',
                                        queue: normalizeQueueEntries(current.queue),
                                    }
                                };
                            })
                                .then((result) => {
                                    if (result.applied && result.next) {
                                        applyStationStateToModel(station.id, result.next);
                                        playNotificationSound();
                                        updateAllStationCards();
                                    }
                                })
                                .catch((error) => {
                                    console.error('Timer transition failed:', error);
                                })
                                .finally(() => {
                                    timerTransitionsInFlight.delete(station.id);
                                });
                        }

                        hasFinishedTransition = true;
                    }

                    updateTimerDisplay(station.id, remaining, station.treatmentId);
                }

                updateQueueEtaDisplay(station);
            }
        }

        if (hasFinishedTransition) {
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
     * Refresh queue ETA labels for a station
     */
    const updateQueueEtaDisplay = (station: Station): void => {
        if (!station.queue || station.queue.length === 0) return;

        const stationCards = document.querySelectorAll(`[data-station-id="${station.id}"]`);
        stationCards.forEach(card => {
            const etaElements = card.querySelectorAll<HTMLElement>('.queue-eta[data-queue-index]');
            etaElements.forEach(etaEl => {
                const index = Number(etaEl.dataset.queueIndex);
                if (Number.isNaN(index)) return;
                const waitSeconds = getQueueWaitSeconds(station, index);
                etaEl.textContent = formatQueueEta(waitSeconds);
            });
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
     * Build localStorage key for room visibility (per user)
     */
    const getRoomVisibilityStorageKey = (): string => {
        const userKey = currentUserUid || currentEmployeeId || 'anonymous';
        return `stationsRoomVisibility:${userKey}`;
    };

    /**
     * Build localStorage key for desktop columns count (per user)
     */
    const getDesktopColumnsStorageKey = (): string => {
        const userKey = currentUserUid || currentEmployeeId || 'anonymous';
        return `stationsDesktopColumns:${userKey}`;
    };

    /**
     * Build localStorage key for room layout settings (per user)
     */
    const getRoomLayoutStorageKey = (): string => {
        const userKey = currentUserUid || currentEmployeeId || 'anonymous';
        return `stationsRoomLayout:${userKey}`;
    };

    /**
     * Load room visibility from localStorage for current user
     */
    const loadRoomVisibilitySettings = (): void => {
        const defaults: RoomVisibilityMap = {};
        for (const room of rooms) {
            defaults[room.id] = true;
        }

        if (rooms.length === 0) {
            roomVisibility = new Map();
            return;
        }

        const raw = localStorage.getItem(getRoomVisibilityStorageKey());
        if (!raw) {
            roomVisibility = new Map(Object.entries(defaults));
            return;
        }

        try {
            const parsed = JSON.parse(raw) as RoomVisibilityMap;
            const merged: RoomVisibilityMap = {};
            for (const room of rooms) {
                merged[room.id] = parsed[room.id] !== false;
            }
            roomVisibility = new Map(Object.entries(merged));
        } catch {
            roomVisibility = new Map(Object.entries(defaults));
        }
    };

    /**
     * Save room visibility to localStorage for current user
     */
    const saveRoomVisibilitySettings = (): void => {
        const payload = Object.fromEntries(roomVisibility.entries());
        localStorage.setItem(getRoomVisibilityStorageKey(), JSON.stringify(payload));
    };

    /**
     * Load desktop columns count from localStorage for current user
     */
    const loadDesktopColumnsSettings = (): void => {
        const raw = localStorage.getItem(getDesktopColumnsStorageKey());
        const value = Number(raw);
        if (value === 1 || value === 2 || value === 3) {
            desktopColumnsCount = value;
            return;
        }
        desktopColumnsCount = 3;
    };

    /**
     * Save desktop columns count to localStorage for current user
     */
    const saveDesktopColumnsSettings = (): void => {
        localStorage.setItem(getDesktopColumnsStorageKey(), String(desktopColumnsCount));
    };

    /**
     * Create default room layout for a specific columns count
     */
    const createDefaultColumnsLayout = (columnsCount: DesktopColumnsCount): string[][] => {
        const columns: string[][] = Array.from({ length: columnsCount }, () => []);
        rooms.forEach((room, index) => {
            columns[index % columnsCount]?.push(room.id);
        });
        return columns;
    };

    /**
     * Normalize room layout: valid room IDs, no duplicates, all rooms present
     */
    const normalizeColumnsLayout = (columnsCount: DesktopColumnsCount, rawLayout?: unknown): string[][] => {
        const normalized = Array.from({ length: columnsCount }, () => [] as string[]);
        const validRoomIds = new Set(rooms.map(room => room.id));
        const seen = new Set<string>();

        if (Array.isArray(rawLayout)) {
            for (let colIndex = 0; colIndex < columnsCount; colIndex += 1) {
                const column = rawLayout[colIndex];
                if (!Array.isArray(column)) continue;

                for (const roomId of column) {
                    if (typeof roomId !== 'string') continue;
                    if (!validRoomIds.has(roomId)) continue;
                    if (seen.has(roomId)) continue;
                    normalized[colIndex]?.push(roomId);
                    seen.add(roomId);
                }
            }
        }

        const pickTargetColumn = (): number => {
            let target = 0;
            let smallest = Number.POSITIVE_INFINITY;
            for (let i = 0; i < normalized.length; i += 1) {
                const size = normalized[i]?.length ?? 0;
                if (size < smallest) {
                    smallest = size;
                    target = i;
                }
            }
            return target;
        };

        for (const room of rooms) {
            if (seen.has(room.id)) continue;
            const target = pickTargetColumn();
            normalized[target]?.push(room.id);
            seen.add(room.id);
        }

        return normalized;
    };

    /**
     * Get room layout for selected columns count
     */
    const getColumnsLayout = (columnsCount: DesktopColumnsCount): string[][] => {
        const normalized = normalizeColumnsLayout(columnsCount, roomLayoutSettings[columnsCount]);
        roomLayoutSettings[columnsCount] = normalized;
        return normalized;
    };

    /**
     * Load room layout settings from localStorage for current user
     */
    const loadRoomLayoutSettings = (): void => {
        const parsedByColumns: Partial<Record<DesktopColumnsCount, unknown>> = {};
        const raw = localStorage.getItem(getRoomLayoutStorageKey());

        if (raw) {
            try {
                const parsed = JSON.parse(raw) as Record<string, unknown>;
                parsedByColumns[1] = parsed?.['1'];
                parsedByColumns[2] = parsed?.['2'];
                parsedByColumns[3] = parsed?.['3'];
            } catch {
                // Ignore and fallback to defaults
            }
        }

        roomLayoutSettings = {
            1: normalizeColumnsLayout(1, parsedByColumns[1] ?? createDefaultColumnsLayout(1)),
            2: normalizeColumnsLayout(2, parsedByColumns[2] ?? createDefaultColumnsLayout(2)),
            3: normalizeColumnsLayout(3, parsedByColumns[3] ?? createDefaultColumnsLayout(3)),
        };
    };

    /**
     * Save room layout settings to localStorage for current user
     */
    const saveRoomLayoutSettings = (): void => {
        const payload = {
            1: roomLayoutSettings[1],
            2: roomLayoutSettings[2],
            3: roomLayoutSettings[3],
        };
        localStorage.setItem(getRoomLayoutStorageKey(), JSON.stringify(payload));
    };

    /**
     * Check whether room should be visible
     */
    const isRoomVisible = (roomId: string): boolean => {
        return roomVisibility.get(roomId) !== false;
    };

    /**
     * Keep active mobile section valid after room visibility changes
     */
    const normalizeActiveMobileRoom = (): void => {
        const visibleRooms = rooms.filter(room => isRoomVisible(room.id));
        if (!visibleRooms.length) {
            activeMobileRoomId = null;
            return;
        }

        if (!activeMobileRoomId || !isRoomVisible(activeMobileRoomId)) {
            activeMobileRoomId = visibleRooms[0]?.id ?? null;
        }
    };


    /**
     * Update operational attention bar (what needs action now).
     */
    const updateAttentionBar = (): void => {
        const bar = document.getElementById('stationsAttentionBar');
        if (!bar) return;

        const visibleRooms = rooms.filter(room => isRoomVisible(room.id));
        const scopeRooms = visibleRooms.length > 0 ? visibleRooms : rooms;
        const allStations = scopeRooms.flatMap(room => room.stations);

        const occupiedNow = allStations.filter(station => station.status === 'OCCUPIED').length;
        const queuedPeople = allStations.reduce((sum, station) => sum + (station.queue?.length || 0), 0);
        const toRelease = allStations.filter(station => station.status === 'FINISHED').length;
        const awaitingStart = allStations.filter(station => isAwaitingTherapyStartStation(station)).length;
        const fullQueues = allStations.filter(station => (station.queue?.length || 0) >= 5).length;

        const items: string[] = [];
        if (occupiedNow > 0) {
            items.push(`<div class="attention-item"><i class="fas fa-hourglass-half"></i> ${occupiedNow} zabiegi w toku</div>`);
        }
        if (queuedPeople > 0) {
            items.push(`<div class="attention-item"><i class="fas fa-user-friends"></i> ${queuedPeople} osoby w kolejce</div>`);
        }
        if (toRelease > 0) {
            items.push(`<div class="attention-item"><i class="fas fa-flag"></i> ${toRelease} stanowiska do zwolnienia</div>`);
        }
        if (awaitingStart > 0) {
            items.push(`<div class="attention-item"><i class="fas fa-play-circle"></i> ${awaitingStart} stanowiska czekają na rozpoczęcie</div>`);
        }
        if (fullQueues > 0) {
            items.push(`<div class="attention-item"><i class="fas fa-users"></i> ${fullQueues} stanowiska mają pełną kolejkę</div>`);
        }

        if (items.length === 0) {
            bar.classList.remove('active');
            bar.innerHTML = '';
            return;
        }

        bar.innerHTML = `
            <div class="attention-title">Co wymaga uwagi teraz</div>
            <div class="attention-items">${items.join('')}</div>
        `;
        bar.classList.add('active');
    };

    /**
     * Apply predefined UI preset in settings modal.
     */
    const applySettingsPreset = (preset: 'compact' | 'standard' | 'focus'): void => {
        const visibleMap: RoomVisibilityMap = {};
        rooms.forEach((room) => { visibleMap[room.id] = true; });

        if (preset === 'compact') {
            desktopColumnsCount = 3;
            roomLayoutSettings[3] = createDefaultColumnsLayout(3);
        }

        if (preset === 'standard') {
            desktopColumnsCount = 2;
            roomLayoutSettings[2] = createDefaultColumnsLayout(2);
        }

        if (preset === 'focus') {
            desktopColumnsCount = 1;
            roomLayoutSettings[1] = createDefaultColumnsLayout(1);
        }

        roomVisibility = new Map(Object.entries(visibleMap));
        saveRoomVisibilitySettings();
        saveDesktopColumnsSettings();
        saveRoomLayoutSettings();

        normalizeActiveMobileRoom();
        renderDesktopView();
        renderMobileView();
        renderSectionsOptionsList();
        updateAllStationCards();
    };

    /**
     * Restore default settings state.
     */
    const resetSettingsToDefaults = (): void => {
        roomVisibility = new Map(rooms.map((room) => [room.id, true]));
        desktopColumnsCount = 3;
        roomLayoutSettings = {
            1: createDefaultColumnsLayout(1),
            2: createDefaultColumnsLayout(2),
            3: createDefaultColumnsLayout(3),
        };

        saveRoomVisibilitySettings();
        saveDesktopColumnsSettings();
        saveRoomLayoutSettings();
        normalizeActiveMobileRoom();
        renderDesktopView();
        renderMobileView();
        renderSectionsOptionsList();
        updateAllStationCards();
    };

    /**
     * Station waits for manual start when it's free but first queue item is Terapia/Masaż.
     */
    const isAwaitingTherapyStartStation = (station: Station): boolean => {
        const nextInQueue = station.queue?.[0];
        return station.status === 'FREE' && Boolean(nextInQueue && isTherapyMassageTreatment(nextInQueue.treatmentId));
    };

    /**
     * Render options list inside modal
     */
    const renderSectionsOptionsList = (): void => {
        const optionsList = document.getElementById('sectionsOptionsList');
        if (!optionsList) return;

        const columnOptionsHtml = DESKTOP_COLUMNS_OPTIONS.map((count) => `
            <label class="section-columns-option-item">
                <input
                    class="section-columns-radio"
                    type="radio"
                    name="stationsDesktopColumns"
                    data-columns-count="${count}"
                    ${desktopColumnsCount === count ? 'checked' : ''}
                />
                <span>${count} kolumna${count === 1 ? '' : count === 2 ? 'y' : ''}</span>
            </label>
        `).join('');

        const roomById = new Map(rooms.map(room => [room.id, room] as const));
        const editColumns = getColumnsLayout(desktopColumnsCount);
        const editColumnsHtml = editColumns.map((roomIds, columnIndex) => {
            const cardsHtml = roomIds.map((roomId) => {
                const room = roomById.get(roomId);
                if (!room) return '';
                const hiddenBadge = isRoomVisible(roomId) ? '' : '<span class="layout-edit-room-badge">Ukryta</span>';
                return `
                    <div class="layout-edit-room" draggable="true" data-layout-room-id="${room.id}" data-layout-column="${columnIndex}">
                        <i class="fas ${room.icon}"></i>
                        <span>${room.name}</span>
                        ${hiddenBadge}
                    </div>
                `;
            }).join('');

            const emptyHtml = cardsHtml ? '' : '<div class="layout-edit-column-empty">Przeciągnij sekcję tutaj</div>';
            return `
                <div class="layout-edit-column" data-layout-column="${columnIndex}">
                    <div class="layout-edit-column-title">Kolumna ${columnIndex + 1}</div>
                    <div class="layout-edit-column-body" data-layout-column="${columnIndex}">
                        ${cardsHtml}
                        ${emptyHtml}
                    </div>
                </div>
            `;
        }).join('');

        if (isLayoutEditMode) {
            optionsList.innerHTML = `
                <div class="section-columns-options-group">
                    <div class="section-options-group-title">Tryb edycji układu (${desktopColumnsCount} kol.)</div>
                    <div class="layout-edit-help">Przeciągnij sekcję i upuść do wybranej kolumny.</div>
                    <div class="layout-edit-columns layout-edit-columns-${desktopColumnsCount}">
                        ${editColumnsHtml}
                    </div>
                    <button class="section-layout-edit-btn done" type="button" data-layout-action="close-edit">
                        Zakończ edycję
                    </button>
                </div>
            `;
            return;
        }

        optionsList.innerHTML = `
            <div class="section-columns-options-group">
                <div class="section-options-group-title">Układ desktop</div>
                <div class="section-columns-options-row">
                    ${columnOptionsHtml}
                </div>
                <div class="section-presets-row">
                    <button class="section-preset-btn" type="button" data-layout-preset="compact">Kompakt</button>
                    <button class="section-preset-btn" type="button" data-layout-preset="standard">Standard</button>
                    <button class="section-preset-btn" type="button" data-layout-preset="focus">Skupienie</button>
                </div>
                <button class="section-layout-edit-btn" type="button" data-layout-action="open-edit">
                    Zmień układ sekcji
                </button>
                <button class="section-layout-reset-btn" type="button" data-layout-action="reset">
                    Przywróć domyślne
                </button>
            </div>
            <div class="section-options-group-title">Widoczność sekcji</div>
            ${rooms.map(room => `
            <label class="section-option-item">
                <span class="section-option-label">${room.name}</span>
                <input
                    class="section-option-checkbox"
                    type="checkbox"
                    data-section-room-id="${room.id}"
                    ${isRoomVisible(room.id) ? 'checked' : ''}
                />
            </label>
            `).join('')}
        `;
    };

    /**
     * Open section options modal
     */
    const openSectionsOptionsModal = (): void => {
        const modal = document.getElementById('stationsSectionsModal');
        if (!modal) return;
        isLayoutEditMode = false;
        draggedRoomId = null;
        renderSectionsOptionsList();
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
    };

    /**
     * Close section options modal
     */
    const closeSectionsOptionsModal = (): void => {
        const modal = document.getElementById('stationsSectionsModal');
        if (!modal) return;
        isLayoutEditMode = false;
        draggedRoomId = null;
        renderSectionsOptionsList();
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
    };

    /**
     * Move room between columns in editable layout
     */
    const moveRoomInLayout = (
        columnsCount: DesktopColumnsCount,
        roomId: string,
        targetColumnIndex: number,
        beforeRoomId?: string
    ): void => {
        const current = getColumnsLayout(columnsCount).map(column => [...column]);
        if (!current[targetColumnIndex]) return;

        for (const column of current) {
            const idx = column.indexOf(roomId);
            if (idx >= 0) {
                column.splice(idx, 1);
            }
        }

        const targetColumn = current[targetColumnIndex];
        if (!targetColumn) return;

        if (beforeRoomId && beforeRoomId !== roomId) {
            const beforeIdx = targetColumn.indexOf(beforeRoomId);
            if (beforeIdx >= 0) {
                targetColumn.splice(beforeIdx, 0, roomId);
            } else {
                targetColumn.push(roomId);
            }
        } else {
            targetColumn.push(roomId);
        }

        roomLayoutSettings[columnsCount] = normalizeColumnsLayout(columnsCount, current);
        saveRoomLayoutSettings();
        renderDesktopView();
        updateAllStationCards();
        renderSectionsOptionsList();
    };

    /**
     * Render desktop grid view
     */
    const renderDesktopView = (): void => {
        const container = document.getElementById('stationsDesktopView');
        if (!container) return;

        const roomById = new Map(rooms.map(room => [room.id, room] as const));
        const visibleRoomIds = new Set(rooms.filter(room => isRoomVisible(room.id)).map(room => room.id));
        const layoutColumns = getColumnsLayout(desktopColumnsCount);
        const desktopColumns: Room[][] = layoutColumns.map(column => column
            .filter(roomId => visibleRoomIds.has(roomId))
            .map(roomId => roomById.get(roomId))
            .filter((room): room is Room => Boolean(room))
        );
        const hasVisibleRooms = desktopColumns.some(column => column.length > 0);

        if (!hasVisibleRooms) {
            container.style.gridTemplateColumns = '';
            container.innerHTML = '<div class="stations-empty-state">Brak widocznych sekcji. Włącz je w opcjach.</div>';
            return;
        }

        container.style.gridTemplateColumns = `repeat(${desktopColumnsCount}, minmax(0, calc((100% - 12px) / 3)))`;

        container.innerHTML = desktopColumns
            .map((columnRooms) => `
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

        const visibleRooms = rooms.filter(room => isRoomVisible(room.id));
        if (visibleRooms.length === 0) {
            container.innerHTML = '<div class="stations-empty-state">Brak widocznych sekcji. Włącz je w opcjach.</div>';
            return;
        }

        const activeId = activeMobileRoomId;

        const tilesHtml = visibleRooms.map(room => {
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

        // Special case: station is FREE but next in queue is Therapy/Massage
        // Show 'awaiting start' card to prevent bypassing the queue
        const nextInQueue = station.queue?.[0];
        const isAwaitingTherapyStart = isAwaitingTherapyStartStation(station);

        if (isAwaitingTherapyStart) {
            return renderAwaitingStartCard(room, station, nextInQueue!, queueHtml);
        }

        if (room.type === 'simple') {
            return renderSimpleStationCard(room, station, statusClass, remaining, employeeName, queueHtml);
        } else {
            return renderMultiStationCard(room, station, statusClass, remaining, treatment, employeeName, queueHtml);
        }
    };

    /**
     * Render a station card in 'awaiting start' mode (FREE but Therapy/Massage queued)
     */
    const renderAwaitingStartCard = (room: Room, station: Station, nextEntry: QueueEntry, queueHtml: string): string => {
        const nextName = EmployeeManager.getNameById(nextEntry.employeeId);
        const addQueueAction = room.type === 'simple' ? 'add-to-queue' : 'show-queue-treatments';
        return `
            <div class="station-card ${room.type === 'simple' ? 'station-simple' : 'station-multi'} awaiting-start" data-station-id="${station.id}">
                <div class="station-awaiting-content">
                    <span class="station-name">${station.name}</span>
                    <span class="station-reserved-badge">Zarezerwowane, odliczanie nieaktywne</span>
                    <div class="queue-next-action">
                        <div class="queue-next-info">
                            <i class="fas fa-user-clock"></i> Czeka: ${nextName}
                        </div>
                        <div class="awaiting-actions-row">
                            <button class="btn-start-queue" data-action="start-queue" data-station="${station.id}" data-room="${room.id}">
                                <i class="fas fa-play"></i> Rozpocznij
                            </button>
                            <button class="btn-awaiting-queue" data-action="${addQueueAction}" data-station="${station.id}" data-room="${room.id}">
                                <i class="fas fa-plus"></i> Zakolejkuj się
                            </button>
                        </div>
                    </div>
                </div>
                ${queueHtml}
            </div>
        `;
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
            const queueEta = formatQueueEta(getQueueWaitSeconds(station, index));
            const isOwn = q.employeeId === currentEmployeeId;
            const canRemove = isCurrentUserAdmin || isOwn;
            const isRecentlyMoved = Boolean(
                lastQueueMove &&
                lastQueueMove.stationId === station.id &&
                lastQueueMove.employeeId === q.employeeId &&
                (getNowMs() - lastQueueMove.at) <= 1000
            );
            const moveAnimClass = isRecentlyMoved
                ? (lastQueueMove!.direction === 'up' ? ' queue-item-moved-up' : ' queue-item-moved-down')
                : '';

            const canMoveUp = canRemove && index > 0;
            const canMoveDown = canRemove && index < (station.queue?.length || 0) - 1;

            return `
                <div class="queue-item ${isOwn ? 'own' : ''}${moveAnimClass}">
                    <span class="queue-index">${index + 1}.</span>
                    <span class="queue-emp">${empName}</span>
                    <span class="queue-treat">${treatmentName}</span>
                    <div class="queue-item-actions">
                        ${canMoveUp ? `
                            <button class="btn-move-queue" data-action="move-queue-up" 
                                    data-station="${station.id}" data-room="${room.id}" data-employee="${q.employeeId}" title="Przesuń w górę">
                                <i class="fas fa-arrow-up"></i>
                            </button>
                        ` : ''}
                        ${canMoveDown ? `
                            <button class="btn-move-queue" data-action="move-queue-down" 
                                    data-station="${station.id}" data-room="${room.id}" data-employee="${q.employeeId}" title="Przesuń w dół">
                                <i class="fas fa-arrow-down"></i>
                            </button>
                        ` : ''}
                        ${canRemove ? `
                            <button class="btn-remove-queue" data-action="remove-from-queue" 
                                    data-station="${station.id}" data-room="${room.id}" data-employee="${q.employeeId}">
                                <i class="fas fa-times"></i>
                            </button>
                        ` : ''}
                    </div>
                    <span class="queue-eta" data-queue-index="${index}">${queueEta}</span>
                </div>
            `;
        }).join('');

        const addButtonHtml = (station.status !== 'FREE' && station.queue.length < 5) ? (
            room.type === 'simple'
                ? `<button class="btn-add-queue queue-tail" data-action="add-to-queue" data-station="${station.id}" data-room="${room.id}"><i class="fas fa-plus"></i> Zakolejkuj się</button>`
                : `<button class="btn-add-queue queue-tail" data-action="show-queue-treatments" data-station="${station.id}" data-room="${room.id}"><i class="fas fa-plus"></i> Zakolejkuj się</button>`
        ) : '';

        const nextEntry = station.queue[0];
        let nextPreviewHtml = '';
        if (station.status === 'FINISHED' && nextEntry) {
            nextPreviewHtml = `
                <div class="queue-next">
                    <i class="fas fa-forward"></i> Następny: ${EmployeeManager.getNameById(nextEntry.employeeId)}
                </div>
            `;
        }

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
                const isTherapyMassage = isTherapyMassageTreatment(t.id);

                if (isTherapyMassage) {
                    return `
                        <div class="treatment-tile-group">
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
                            <button class="therapy-queue-btn"
                                    data-action="reserve-therapy-slot"
                                    data-station="${station.id}"
                                    data-room="${room.id}"
                                    data-treatment="${t.id}"
                                    title="Zakolejkuj się (rezerwacja stanowiska)">
                                <i class="fas fa-user-plus"></i>
                            </button>
                        </div>
                    `;
                }

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

        updateAttentionBar();
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
     * Force refresh station data from Firebase on demand.
     */
    const refreshStationsData = async (): Promise<void> => {
        const refreshBtn = document.getElementById('refreshStationsBtn');
        refreshBtn?.classList.add('is-refreshing');
        window.showToast?.('Odświeżanie...', 900);

        try {
            const snapshot = await db.collection('stations').doc(STATIONS_DOC_ID).get();
            stationStates.clear();

            if (snapshot.exists) {
                const data = (snapshot.data() || {}) as StationsDocData;
                updateServerOffset(data);

                for (const [stationId, state] of Object.entries(data)) {
                    if (stationId.startsWith('_')) continue;
                    stationStates.set(stationId, normalizeStationState(state));
                }
            }

            syncLocalState();
            normalizeActiveMobileRoom();
            renderDesktopView();
            renderMobileView();
            renderSectionsOptionsList();
            updateAllStationCards();
            window.showToast?.('Odświeżono', 1200);
        } catch (error) {
            console.error('Manual refresh failed:', error);
            window.showToast?.('Błąd odświeżania', 2200);
        } finally {
            refreshBtn?.classList.remove('is-refreshing');
        }
    };

    /**
     * Setup event listeners
     */
    const setupEventListeners = (): void => {
        document.addEventListener('click', handleClick);

        // Sound toggle
        const soundBtn = document.getElementById('toggleSoundBtn');
        soundBtn?.addEventListener('click', toggleSound);

        const refreshBtn = document.getElementById('refreshStationsBtn');
        refreshBtn?.addEventListener('click', () => {
            void refreshStationsData();
        });

        const openOptionsBtn = document.getElementById('openSectionsOptionsBtn');
        openOptionsBtn?.addEventListener('click', openSectionsOptionsModal);

        const closeOptionsBtn = document.getElementById('closeSectionsOptionsBtn');
        closeOptionsBtn?.addEventListener('click', closeSectionsOptionsModal);

        const sectionsModal = document.getElementById('stationsSectionsModal');
        sectionsModal?.addEventListener('click', (e) => {
            if (e.target === sectionsModal) {
                closeSectionsOptionsModal();
            }
        });

        const sectionsOptionsList = document.getElementById('sectionsOptionsList');
        sectionsOptionsList?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const presetBtn = target.closest('[data-layout-preset]') as HTMLElement | null;
            if (presetBtn) {
                const preset = presetBtn.dataset.layoutPreset;
                if (preset === 'compact' || preset === 'standard' || preset === 'focus') {
                    applySettingsPreset(preset);
                }
                return;
            }

            const layoutActionEl = target.closest('[data-layout-action]') as HTMLElement | null;
            if (!layoutActionEl) return;

            const action = layoutActionEl.dataset.layoutAction;
            if (action === 'open-edit') {
                isLayoutEditMode = true;
                renderSectionsOptionsList();
                return;
            }

            if (action === 'close-edit') {
                isLayoutEditMode = false;
                draggedRoomId = null;
                renderSectionsOptionsList();
                return;
            }

            if (action === 'reset') {
                resetSettingsToDefaults();
            }
        });

        sectionsOptionsList?.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement | null;
            if (!target) return;

            if (target.type === 'checkbox') {
                const roomId = target.dataset.sectionRoomId;
                if (!roomId) return;
                roomVisibility.set(roomId, target.checked);
                saveRoomVisibilitySettings();
            }

            if (target.type === 'radio') {
                const columnsCount = Number(target.dataset.columnsCount);
                if (columnsCount === 1 || columnsCount === 2 || columnsCount === 3) {
                    desktopColumnsCount = columnsCount;
                    saveDesktopColumnsSettings();
                } else {
                    return;
                }
            }

            normalizeActiveMobileRoom();
            renderDesktopView();
            renderMobileView();
            renderSectionsOptionsList();
            updateAllStationCards();
        });

        sectionsOptionsList?.addEventListener('dragstart', (e) => {
            const target = e.target as HTMLElement;
            const roomCard = target.closest('[data-layout-room-id]') as HTMLElement | null;
            if (!roomCard) return;
            draggedRoomId = roomCard.dataset.layoutRoomId || null;
            roomCard.classList.add('dragging');
            if (e.dataTransfer && draggedRoomId) {
                e.dataTransfer.setData('text/plain', draggedRoomId);
                e.dataTransfer.effectAllowed = 'move';
            }
        });

        sectionsOptionsList?.addEventListener('dragend', () => {
            draggedRoomId = null;
            sectionsOptionsList.querySelectorAll('.layout-edit-room.dragging').forEach((el) => {
                el.classList.remove('dragging');
            });
        });

        sectionsOptionsList?.addEventListener('dragover', (e) => {
            if (!isLayoutEditMode) return;
            const target = e.target as HTMLElement;
            const dropZone = target.closest('[data-layout-column], [data-layout-room-id]') as HTMLElement | null;
            if (!dropZone) return;
            e.preventDefault();
        });

        sectionsOptionsList?.addEventListener('drop', (e) => {
            if (!isLayoutEditMode) return;
            const target = e.target as HTMLElement;
            const dropTarget = target.closest('[data-layout-column], [data-layout-room-id]') as HTMLElement | null;
            if (!dropTarget) return;

            const roomIdFromTransfer = e.dataTransfer?.getData('text/plain') || '';
            const roomId = draggedRoomId || roomIdFromTransfer;
            if (!roomId) return;

            const columnEl = dropTarget.closest('[data-layout-column]') as HTMLElement | null;
            const columnIndex = Number(columnEl?.dataset.layoutColumn);
            if (Number.isNaN(columnIndex)) return;

            const beforeRoomEl = dropTarget.closest('[data-layout-room-id]') as HTMLElement | null;
            const beforeRoomId = beforeRoomEl?.dataset.layoutRoomId;

            e.preventDefault();
            moveRoomInLayout(
                desktopColumnsCount,
                roomId,
                columnIndex,
                beforeRoomId && beforeRoomId !== roomId ? beforeRoomId : undefined
            );
        });
    };

    /**
     * Handle click events
     */
    const handleClick = (e: MouseEvent): void => {
        const target = e.target as HTMLElement;

        const roomChip = target.closest('[data-mobile-room-chip]') as HTMLElement;
        if (roomChip) {
            setActiveMobileRoom(roomChip.dataset.mobileRoomChip || '');
            return;
        }

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
            case 'reserve-therapy-slot':
                if (station.status === 'FREE' && treatmentId) {
                    const treatment = room.treatments.find(t => t.id === treatmentId);
                    if (treatment && isTherapyMassageTreatment(treatment.id)) {
                        addToQueue(station, treatment.id, treatment.duration);
                    }
                }
                break;
            case 'cancel':
            case 'release':
                releaseStation(station);
                break;
            case 'add-to-queue':
                // Simple rooms: add directly with default treatment
                if (station.status !== 'FREE' || isAwaitingTherapyStartStation(station)) {
                    addToQueue(station, station.id, room.defaultDuration);
                }
                break;
            case 'show-queue-treatments':
                // Multi rooms: show treatment tiles for queue selection
                if (station.status !== 'FREE' || isAwaitingTherapyStartStation(station)) {
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
            case 'start-queue':
                processQueue(station, true);
                break;
            case 'move-queue-up':
                if (employeeId && station.queue) {
                    if (!isCurrentUserAdmin && employeeId !== currentEmployeeId) {
                        window.showToast?.('Możesz przesuwać tylko własną pozycję', 2200);
                        return;
                    }
                    void mutateStationState(station.id, (current) => {
                        const queue = normalizeQueueEntries(current.queue);
                        const index = queue.findIndex(q => q.employeeId === employeeId);
                        if (index <= 0) return null;
                        const reordered = [...queue];
                        const temp = reordered[index];
                        reordered[index] = reordered[index - 1];
                        reordered[index - 1] = temp;
                        return {
                            next: {
                                ...current,
                                queue: reordered
                            }
                        };
                    }).then((result) => {
                        if (!result.applied || !result.next) return;
                        applyStationStateToModel(station.id, result.next);
                        markQueueMove(station.id, employeeId, 'up');
                        window.showToast?.('Kolejność zmieniona', 1000);
                        updateAllStationCards();
                    });
                }
                break;
            case 'move-queue-down':
                if (employeeId && station.queue) {
                    if (!isCurrentUserAdmin && employeeId !== currentEmployeeId) {
                        window.showToast?.('Możesz przesuwać tylko własną pozycję', 2200);
                        return;
                    }
                    void mutateStationState(station.id, (current) => {
                        const queue = normalizeQueueEntries(current.queue);
                        const index = queue.findIndex(q => q.employeeId === employeeId);
                        if (index < 0 || index >= queue.length - 1) return null;
                        const reordered = [...queue];
                        const temp = reordered[index];
                        reordered[index] = reordered[index + 1];
                        reordered[index + 1] = temp;
                        return {
                            next: {
                                ...current,
                                queue: reordered
                            }
                        };
                    }).then((result) => {
                        if (!result.applied || !result.next) return;
                        applyStationStateToModel(station.id, result.next);
                        markQueueMove(station.id, employeeId, 'down');
                        window.showToast?.('Kolejność zmieniona', 1000);
                        updateAllStationCards();
                    });
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
        if (!roomId || !isRoomVisible(roomId)) return;
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
        requestNotificationPermissionOnInteraction();
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
