import { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } from '@zxing/library';

interface InterviewRecord { id: string; barcode: string; createdAt: string; updatedAt: string; values: Record<string, string | boolean>; }
interface InterviewAPI { init(): void; destroy(): void; }

const STORAGE_KEY = 'kalinowa.patient-interviews.v1';
const ACTIVITY_OPTIONS = ['Bez problemu', 'Małe problemy', 'Średnie problemy', 'Duże problemy', 'Niemożliwe'];
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const CODE_39_PATTERNS: Record<string, string> = {
    '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
    '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
    'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn',
    'F': 'nnwnwwnnn', 'G': 'nnnnnnwwn', 'H': 'wnnnnnwwn', 'I': 'nnwnnnwwn', 'J': 'nnnnwnwwn',
    'K': 'wnnnnnnnw', 'L': 'nnwnnnnnw', 'M': 'wnwnnnnnn', 'N': 'nnnnwnnnw', 'O': 'wnnnwnnnn',
    'P': 'nnwnwnnnn', 'Q': 'nnnnnnwnw', 'R': 'wnnnnnwnn', 'S': 'nnwnnnwnn', 'T': 'nnnnwnwnn',
    'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn',
    'Z': 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
};

interface BarcodeDetectorLike { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>; }
interface BarcodeDetectorConstructor { new (options: { formats: string[] }): BarcodeDetectorLike; }

export const Interview: InterviewAPI = (() => {
    let records: InterviewRecord[] = [];
    let currentId: string | null = null;
    let saveTimer: number | null = null;
    let listeners: AbortController | null = null;
    let cameraStream: MediaStream | null = null;
    let scanFrameId: number | null = null;
    let codeReader: BrowserMultiFormatReader | null = null;
    let currentCameraDeviceId: string | null = null;
    let availableVideoDevices: MediaDeviceInfo[] = [];
    let torchActive = false;
    let isHandlingResult = false;

    const createBarcode = (): string => `${new Date().toISOString().slice(2, 10).replace(/-/g, '')}${Math.floor(100000 + Math.random() * 900000)}`;

    const newRecord = (): InterviewRecord => {
        const now = new Date().toISOString();
        return { id: crypto.randomUUID(), barcode: createBarcode(), createdAt: now, updatedAt: now, values: { examDate: now.slice(0, 10) } };
    };

    const getForm = (): HTMLFormElement | null => document.getElementById('patientInterviewForm') as HTMLFormElement | null;
    const getCurrentRecord = (): InterviewRecord | undefined => records.find((record) => record.id === currentId);
    const setStatus = (text: string): void => { const status = document.getElementById('interviewSaveStatus'); if (status) status.textContent = text; };

    const readStorage = (): InterviewRecord[] => {
        try {
            const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            if (!Array.isArray(parsed)) return [];
            return parsed.filter((item): item is InterviewRecord => Boolean(item && typeof item === 'object' && 'id' in item && 'values' in item)).map((item) => ({ ...item, barcode: typeof item.barcode === 'string' ? item.barcode : createBarcode() }));
        } catch { window.showToast?.('Nie udało się odczytać lokalnych kart.', 4000); return []; }
    };

    const writeStorage = (): boolean => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); return true; }
        catch { window.showToast?.('Brak miejsca na zapis lokalnej karty.', 4000); return false; }
    };

    const renderScales = (): void => document.querySelectorAll<HTMLElement>('[data-scale]').forEach((container) => {
        const field = container.dataset.scale;
        if (!field) return;
        const labels = field.startsWith('activity') ? ACTIVITY_OPTIONS : Array.from({ length: 11 }, (_, index) => String(index));
        container.innerHTML = labels.map((label) => `<label><input name="${field}" data-field type="radio" value="${label}"><span>${label}</span></label>`).join('');
    });

    const fillForm = (record: InterviewRecord): void => getForm()?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-field]').forEach((field) => {
        const value = record.values[field.name];
        if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')) field.checked = field.type === 'checkbox' ? value === true : value === field.value;
        else field.value = typeof value === 'string' ? value : '';
    });

    const collectForm = (): Record<string, string | boolean> => {
        const values: Record<string, string | boolean> = {};
        getForm()?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-field]').forEach((field) => {
            if (field instanceof HTMLInputElement && field.type === 'checkbox') values[field.name] = field.checked;
            else if (!(field instanceof HTMLInputElement && field.type === 'radio') || field.checked) values[field.name] = field.value;
        });
        return values;
    };

    const formatName = (record: InterviewRecord): string => typeof record.values.patientName === 'string' && record.values.patientName.trim() ? record.values.patientName.trim() : 'Nowa karta pacjenta';

    const createBarcodeSvg = (barcode: string): SVGSVGElement => {
        const cleaned = barcode.trim().toUpperCase().replace(/[^0-9A-Z\-. *]/g, '');
        const encoded = `*${cleaned.replace(/^\*+|\*+$/g, '')}*`;
        const units = encoded.split('').reduce((total, character) => {
            const pattern = CODE_39_PATTERNS[character];
            if (!pattern) return total + 10;
            return total + [...pattern].reduce((sum, width) => sum + (width === 'w' ? 3 : 1), 0) + 1;
        }, 20);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${units} 100`);
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', `Kod kreskowy Code 39: ${barcode}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        let x = 10;
        encoded.split('').forEach((character) => {
            const pattern = CODE_39_PATTERNS[character];
            if (!pattern) return;
            [...pattern].forEach((width, index) => {
                const barWidth = width === 'w' ? 3 : 1;
                if (index % 2 === 0) {
                    const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    bar.setAttribute('x', String(x));
                    bar.setAttribute('y', '4');
                    bar.setAttribute('width', String(barWidth));
                    bar.setAttribute('height', '92');
                    bar.setAttribute('fill', '#000');
                    svg.appendChild(bar);
                }
                x += barWidth;
            });
            x += 1;
        });
        return svg;
    };

    const renderRecordList = (): void => {
        const cards = document.getElementById('interviewCards'); const emptyState = document.getElementById('interviewEmptyState');
        if (!cards || !emptyState) return;
        cards.innerHTML = '';
        const ordered = records.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        emptyState.hidden = ordered.length > 0;
        ordered.forEach((record) => {
            const card = document.createElement('button'); card.type = 'button'; card.className = 'interview-card'; card.dataset.recordId = record.id;
            const name = document.createElement('strong'); name.textContent = formatName(record);
            const barcode = document.createElement('span'); barcode.className = 'interview-barcode'; barcode.appendChild(createBarcodeSvg(record.barcode));
            const digits = document.createElement('span'); digits.className = 'interview-barcode-digits'; digits.textContent = record.barcode;
            card.append(name, barcode, digits); cards.appendChild(card);
        });
    };

    const saveCurrent = (): void => {
        const record = getCurrentRecord(); if (!record) return;
        record.values = collectForm(); record.updatedAt = new Date().toISOString();
        if (writeStorage()) setStatus('Zapisano lokalnie');
    };

    const scheduleSave = (): void => { setStatus('Zapisywanie...'); if (saveTimer !== null) globalThis.clearTimeout(saveTimer); saveTimer = globalThis.setTimeout(saveCurrent, 350) as unknown as number; };

    const updateHeaderBarcode = (record: InterviewRecord | null): void => {
        const newButton = document.getElementById('newInterviewButton');
        const barcodeField = document.getElementById('activeBarcodeField');
        const barcodeInput = document.getElementById('activeBarcodeInput') as HTMLInputElement | null;
        const formBarcode = document.getElementById('formCardBarcodeInput') as HTMLInputElement | null;
        if (newButton) newButton.hidden = Boolean(record);
        if (barcodeField) barcodeField.hidden = !record;
        if (record) {
            if (barcodeInput) { barcodeInput.value = record.barcode; barcodeInput.readOnly = !isDevelopment; }
            if (formBarcode) { formBarcode.value = record.barcode; formBarcode.readOnly = !isDevelopment; }
        }
    };

    const showList = (): void => {
        saveCurrent();
        document.getElementById('interviewListView')?.removeAttribute('hidden');
        document.getElementById('interviewFormView')?.setAttribute('hidden', '');
        updateHeaderBarcode(null);
        renderRecordList();
    };

    const showForm = (record: InterviewRecord): void => {
        currentId = record.id;
        fillForm(record);
        const formBarcode = document.getElementById('formCardBarcodeInput') as HTMLInputElement | null;
        if (formBarcode) {
            formBarcode.value = record.barcode;
            formBarcode.readOnly = !isDevelopment;
        }
        document.getElementById('interviewListView')?.setAttribute('hidden', '');
        document.getElementById('interviewFormView')?.removeAttribute('hidden');
        updateHeaderBarcode(record);
        setStatus('Zapis lokalny');
    };

    const createRecord = (barcode?: string): void => {
        saveCurrent();
        const record = newRecord();
        if (barcode) record.barcode = barcode;
        records.push(record);
        writeStorage();
        showForm(record);
    };

    const deleteRecord = (): void => {
        const record = getCurrentRecord();
        if (!record || !window.confirm(`Usunąć lokalną kartę „${formatName(record)}”?`)) return;
        records = records.filter((item) => item.id !== record.id); currentId = null; writeStorage(); showList();
    };

    const toggleFlags = (): void => {
        const button = document.getElementById('flagsToggle'); const content = document.getElementById('flagsContent');
        if (!button || !content) return;
        const expanded = button.getAttribute('aria-expanded') === 'true'; button.setAttribute('aria-expanded', String(!expanded)); content.hidden = expanded;
    };

    const triggerScanSuccessFeedback = (): void => {
        try {
            const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            if (AudioCtx) {
                const ctx = new AudioCtx();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, ctx.currentTime);
                gain.gain.setValueAtTime(0.15, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.12);
            }
        } catch {}
        try {
            if (typeof navigator.vibrate === 'function') {
                navigator.vibrate(100);
            }
        } catch {}
        const frame = document.querySelector('.barcode-camera-frame');
        if (frame) {
            frame.classList.add('scan-success');
            setTimeout(() => frame.classList.remove('scan-success'), 400);
        }
    };

    const stopScanner = (): void => {
        isHandlingResult = false;
        if (scanFrameId !== null) { cancelAnimationFrame(scanFrameId); scanFrameId = null; }
        if (codeReader) {
            try { codeReader.reset(); } catch {}
        }
        if (cameraStream) {
            cameraStream.getTracks().forEach((track) => track.stop());
            cameraStream = null;
        }
        const video = document.getElementById('barcodeScannerVideo') as HTMLVideoElement | null;
        if (video) video.srcObject = null;

        torchActive = false;
        const torchBtn = document.getElementById('scannerTorchButton');
        if (torchBtn) {
            torchBtn.hidden = true;
            torchBtn.classList.remove('active');
        }
        document.getElementById('barcodeScannerModal')?.setAttribute('hidden', '');
    };

    const setScannerStatus = (text: string): void => { const status = document.getElementById('barcodeScannerStatus'); if (status) status.textContent = text; };

    const handleScannedBarcode = (rawBarcode: string): void => {
        const cleaned = rawBarcode.trim().replace(/^\*+|\*+$/g, '').trim();
        if (!cleaned) {
            setScannerStatus('Nie odczytano poprawnego kodu. Spróbuj ponownie.');
            return;
        }

        triggerScanSuccessFeedback();
        stopScanner();
        saveCurrent();

        // 1. Sprawdzenie czy istnieje karta o tym kodzie
        const existingRecord = records.find((record) => record.barcode.toLowerCase() === cleaned.toLowerCase());
        if (existingRecord) {
            showForm(existingRecord);
            window.showToast?.(`Otwarto kartę pacjenta: ${formatName(existingRecord)} (${cleaned})`, 4000);
            return;
        }

        // 2. Jeśli nie istnieje - otwórz nowy formularz z wpisanym kodem karty
        createRecord(cleaned);
        window.showToast?.(`Utworzono nową kartę z kodem: ${cleaned}`, 4000);
    };

    const toggleTorch = async (): Promise<void> => {
        if (!cameraStream) return;
        const track = cameraStream.getVideoTracks()[0];
        if (!track) return;
        try {
            torchActive = !torchActive;
            await track.applyConstraints({
                advanced: [{ torch: torchActive } as MediaTrackConstraintSet],
            });
            const torchBtn = document.getElementById('scannerTorchButton');
            if (torchBtn) torchBtn.classList.toggle('active', torchActive);
        } catch (err) {
            console.warn('Torch toggle failed:', err);
        }
    };

    const switchCamera = async (): Promise<void> => {
        if (availableVideoDevices.length <= 1) return;
        const currentIndex = availableVideoDevices.findIndex((d) => d.deviceId === currentCameraDeviceId);
        const nextIndex = (currentIndex + 1) % availableVideoDevices.length;
        currentCameraDeviceId = availableVideoDevices[nextIndex].deviceId;
        stopScanner();
        await startScanner();
    };

    const startScanner = async (): Promise<void> => {
        const modal = document.getElementById('barcodeScannerModal');
        const video = document.getElementById('barcodeScannerVideo') as HTMLVideoElement | null;
        if (!modal || !video) return;

        isHandlingResult = false;
        modal.removeAttribute('hidden');
        const manualInput = document.getElementById('scannerManualInput') as HTMLInputElement | null;
        if (manualInput) manualInput.value = '';

        setScannerStatus('Uruchamianie kamery...');

        try {
            const devices = await navigator.mediaDevices?.enumerateDevices?.();
            if (devices) {
                availableVideoDevices = devices.filter((d) => d.kind === 'videoinput');
                const switchBtn = document.getElementById('scannerSwitchCameraButton');
                if (switchBtn) switchBtn.hidden = availableVideoDevices.length <= 1;
            }
        } catch {
            availableVideoDevices = [];
        }

        try {
            const videoConstraints: MediaTrackConstraints = currentCameraDeviceId
                ? { deviceId: { exact: currentCameraDeviceId } }
                : { facingMode: { ideal: 'environment' } };

            const constraints: MediaStreamConstraints = {
                video: {
                    ...videoConstraints,
                    width: { ideal: 1280, min: 640 },
                    height: { ideal: 720, min: 480 },
                },
                audio: false,
            };

            cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = cameraStream;
            await video.play().catch(() => {});

            const track = cameraStream.getVideoTracks()[0];
            if (track) {
                if (!currentCameraDeviceId && track.getSettings) {
                    currentCameraDeviceId = track.getSettings().deviceId || null;
                }
                const capabilities = (track.getCapabilities ? track.getCapabilities() : {}) as {
                    focusMode?: string[];
                    torch?: boolean;
                };
                if (capabilities.focusMode?.includes('continuous')) {
                    await track.applyConstraints({
                        advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
                    }).catch(() => {});
                }
                const torchBtn = document.getElementById('scannerTorchButton');
                if (torchBtn) {
                    torchBtn.hidden = !capabilities.torch;
                    torchBtn.classList.remove('active');
                }
            }

            setScannerStatus('Skieruj aparat na kod kreskowy lub wpisz kod ręcznie.');

            if (!codeReader) {
                const hints = new Map<DecodeHintType, unknown>();
                hints.set(DecodeHintType.POSSIBLE_FORMATS, [
                    BarcodeFormat.CODE_39,
                    BarcodeFormat.CODE_128,
                    BarcodeFormat.EAN_13,
                    BarcodeFormat.EAN_8,
                    BarcodeFormat.UPC_A,
                    BarcodeFormat.QR_CODE,
                ]);
                hints.set(DecodeHintType.TRY_HARDER, true);
                codeReader = new BrowserMultiFormatReader(hints);
            }

            await codeReader.decodeFromStream(cameraStream, video, (result) => {
                if (result && !isHandlingResult) {
                    const text = result.getText();
                    if (text) {
                        isHandlingResult = true;
                        handleScannedBarcode(text);
                    }
                }
            });

            try {
                const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
                if (Detector && typeof (Detector as unknown as { getSupportedFormats?: () => Promise<string[]> }).getSupportedFormats === 'function') {
                    const supported: string[] = await (Detector as unknown as { getSupportedFormats: () => Promise<string[]> }).getSupportedFormats().catch(() => [] as string[]);
                    const validFormats = ['code_39', 'code_128', 'qr_code'].filter((f) => supported.includes(f));
                    if (validFormats.length > 0) {
                        const nativeDetector = new Detector({ formats: validFormats });
                        const nativeScan = async (): Promise<void> => {
                            if (!cameraStream || isHandlingResult) return;
                            try {
                                const codes = await nativeDetector.detect(video);
                                const raw = codes[0]?.rawValue;
                                if (raw && !isHandlingResult) {
                                    isHandlingResult = true;
                                    handleScannedBarcode(raw);
                                    return;
                                }
                            } catch {}
                            if (cameraStream && !isHandlingResult) {
                                scanFrameId = requestAnimationFrame(() => { void nativeScan(); });
                            }
                        };
                        scanFrameId = requestAnimationFrame(() => { void nativeScan(); });
                    }
                }
            } catch {}

        } catch (error) {
            console.error('Camera scanner error:', error);
            setScannerStatus('Nie udało się uzyskać obrazu z kamery. Wpisz kod ręcznie poniżej.');
        }
    };

    const setupCollapsibleSections = (): void => {
        document.querySelectorAll<HTMLElement>('.interview-section:not(.interview-flags-section)').forEach((section) => {
            const heading = section.querySelector<HTMLElement>(':scope > .section-heading');
            if (!heading || heading.dataset.collapsibleReady === 'true') return;
            const toggle = document.createElement('button');
            toggle.type = 'button'; toggle.className = 'section-toggle'; toggle.setAttribute('aria-expanded', 'false');
            toggle.innerHTML = `${heading.innerHTML}<i class="fas fa-chevron-down" aria-hidden="true"></i>`;
            const content = document.createElement('div'); content.className = 'section-content'; content.hidden = true;
            Array.from(section.children).forEach((child) => { if (child !== heading) content.appendChild(child); });
            heading.replaceWith(toggle); section.appendChild(content); heading.dataset.collapsibleReady = 'true';
            toggle.addEventListener('click', () => { const expanded = toggle.getAttribute('aria-expanded') === 'true'; toggle.setAttribute('aria-expanded', String(!expanded)); content.hidden = expanded; });
        });
    };

    const syncBarcodeChange = (newVal: string): void => {
        if (!isDevelopment) return;
        const record = getCurrentRecord();
        const barcode = newVal.trim().replace(/^\*+|\*+$/g, '');
        if (record && barcode) {
            record.barcode = barcode;
            writeStorage();
            updateHeaderBarcode(record);
            renderRecordList();
        } else {
            updateHeaderBarcode(record || null);
        }
    };

    const init = (): void => {
        renderScales(); setupCollapsibleSections(); records = readStorage(); writeStorage(); renderRecordList(); listeners = new AbortController(); const options = { signal: listeners.signal };
        getForm()?.addEventListener('input', scheduleSave, options); getForm()?.addEventListener('change', scheduleSave, options);
        document.getElementById('newInterviewButton')?.addEventListener('click', () => createRecord(), options);
        document.getElementById('scanInterviewButton')?.addEventListener('click', () => { void startScanner(); }, options);
        document.getElementById('closeScannerButton')?.addEventListener('click', stopScanner, options);
        document.getElementById('scannerTorchButton')?.addEventListener('click', () => { void toggleTorch(); }, options);
        document.getElementById('scannerSwitchCameraButton')?.addEventListener('click', () => { void switchCamera(); }, options);
        document.getElementById('scannerManualSubmitButton')?.addEventListener('click', () => {
            const input = document.getElementById('scannerManualInput') as HTMLInputElement | null;
            if (input && input.value.trim()) {
                handleScannedBarcode(input.value);
                input.value = '';
            }
        }, options);
        document.getElementById('scannerManualInput')?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                const input = event.target as HTMLInputElement;
                if (input.value.trim()) {
                    handleScannedBarcode(input.value);
                    input.value = '';
                }
            }
        }, options);
        document.getElementById('barcodeScannerModal')?.addEventListener('click', (event) => {
            if (event.target === event.currentTarget) stopScanner();
        }, options);
        document.addEventListener('keydown', (event) => { if (event.key === 'Escape') stopScanner(); }, options);
        document.getElementById('activeBarcodeInput')?.addEventListener('change', (event) => {
            syncBarcodeChange((event.target as HTMLInputElement).value);
        }, options);
        document.getElementById('formCardBarcodeInput')?.addEventListener('change', (event) => {
            syncBarcodeChange((event.target as HTMLInputElement).value);
        }, options);
        document.getElementById('backToInterviewListButton')?.addEventListener('click', showList, options);
        document.getElementById('deleteInterviewButton')?.addEventListener('click', deleteRecord, options);
        document.getElementById('flagsToggle')?.addEventListener('click', toggleFlags, options);
        document.getElementById('interviewCards')?.addEventListener('click', (event) => {
            const card = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-record-id]'); const record = records.find((item) => item.id === card?.dataset.recordId); if (record) showForm(record);
        }, options);
    };

    const destroy = (): void => {
        if (saveTimer !== null) { globalThis.clearTimeout(saveTimer); saveTimer = null; }
        saveCurrent();
        stopScanner();
        listeners?.abort();
        listeners = null;
    };

    return { init, destroy };
})();
