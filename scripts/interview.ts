interface InterviewRecord { id: string; barcode: string; createdAt: string; updatedAt: string; values: Record<string, string | boolean>; }
interface InterviewAPI { init(): void; destroy(): void; }

const STORAGE_KEY = 'kalinowa.patient-interviews.v1';
const ACTIVITY_OPTIONS = ['Bez problemu', 'Małe problemy', 'Średnie problemy', 'Duże problemy', 'Niemożliwe'];
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const CODE_39_PATTERNS: Record<string, string> = {
    '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
    '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', '*': 'nwnnwnwnn',
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
        const encoded = `*${barcode.replace(/[^0-9]/g, '')}*`;
        const units = encoded.split('').reduce((total, character) => total + [...CODE_39_PATTERNS[character]].reduce((sum, width) => sum + (width === 'w' ? 3 : 1), 0) + 1, 20);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${units} 100`);
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', `Kod kreskowy Code 39: ${barcode}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        let x = 10;
        encoded.split('').forEach((character) => {
            [...CODE_39_PATTERNS[character]].forEach((width, index) => {
                const barWidth = width === 'w' ? 3 : 1;
                if (index % 2 === 0) {
                    const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    bar.setAttribute('x', String(x)); bar.setAttribute('y', '4'); bar.setAttribute('width', String(barWidth)); bar.setAttribute('height', '92'); bar.setAttribute('fill', '#000');
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
        if (!newButton || !barcodeField || !barcodeInput) return;
        newButton.hidden = Boolean(record);
        barcodeField.hidden = !record;
        if (record) { barcodeInput.value = record.barcode; barcodeInput.readOnly = !isDevelopment; }
    };
    const showList = (): void => {
        saveCurrent(); document.getElementById('interviewListView')?.removeAttribute('hidden'); document.getElementById('interviewFormView')?.setAttribute('hidden', ''); updateHeaderBarcode(null); renderRecordList();
    };
    const showForm = (record: InterviewRecord): void => {
        currentId = record.id; fillForm(record); document.getElementById('interviewListView')?.setAttribute('hidden', ''); document.getElementById('interviewFormView')?.removeAttribute('hidden'); updateHeaderBarcode(record); setStatus('Zapis lokalny');
    };
    const createRecord = (barcode?: string): void => { saveCurrent(); const record = newRecord(); if (barcode) record.barcode = barcode; records.push(record); writeStorage(); showForm(record); };
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
    const stopScanner = (): void => {
        if (scanFrameId !== null) { cancelAnimationFrame(scanFrameId); scanFrameId = null; }
        cameraStream?.getTracks().forEach((track) => track.stop()); cameraStream = null;
        const video = document.getElementById('barcodeScannerVideo') as HTMLVideoElement | null;
        if (video) video.srcObject = null;
        document.getElementById('barcodeScannerModal')?.setAttribute('hidden', '');
    };
    const setScannerStatus = (text: string): void => { const status = document.getElementById('barcodeScannerStatus'); if (status) status.textContent = text; };
    const startScanner = async (): Promise<void> => {
        const modal = document.getElementById('barcodeScannerModal');
        const video = document.getElementById('barcodeScannerVideo') as HTMLVideoElement | null;
        const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
        if (!modal || !video) return;
        modal.removeAttribute('hidden');
        if (!Detector) { setScannerStatus('Ta przeglądarka nie obsługuje skanowania kodów. Użyj aktualnego Chrome lub Edge.'); return; }
        try {
            setScannerStatus('Skieruj aparat na kod kreskowy Code 39.');
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
            video.srcObject = cameraStream; await video.play();
            const detector = new Detector({ formats: ['code_39'] });
            const scan = async (): Promise<void> => {
                if (!cameraStream) return;
                try {
                    const codes = await detector.detect(video); const rawValue = codes[0]?.rawValue || ''; const barcode = rawValue.replace(/[^0-9]/g, '');
                    if (/^\d{12}$/.test(barcode)) { stopScanner(); createRecord(barcode); return; }
                    if (rawValue) setScannerStatus('Odczytano nieprawidłowy kod. Spróbuj ponownie.');
                } catch { /* The video frame may not be ready yet. */ }
                scanFrameId = requestAnimationFrame(() => { void scan(); });
            };
            void scan();
        } catch (error) { console.error('Camera scanner error:', error); setScannerStatus('Nie udało się uruchomić kamery. Sprawdź uprawnienia przeglądarki.'); }
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
    const init = (): void => {
        renderScales(); setupCollapsibleSections(); records = readStorage(); writeStorage(); renderRecordList(); listeners = new AbortController(); const options = { signal: listeners.signal };
        getForm()?.addEventListener('input', scheduleSave, options); getForm()?.addEventListener('change', scheduleSave, options);
        document.getElementById('newInterviewButton')?.addEventListener('click', () => createRecord(), options);
        document.getElementById('scanInterviewButton')?.addEventListener('click', () => { void startScanner(); }, options);
        document.getElementById('closeScannerButton')?.addEventListener('click', stopScanner, options);
        document.getElementById('barcodeScannerModal')?.addEventListener('click', (event) => {
            if (event.target === event.currentTarget) stopScanner();
        }, options);
        document.addEventListener('keydown', (event) => { if (event.key === 'Escape') stopScanner(); }, options);
        document.getElementById('activeBarcodeInput')?.addEventListener('change', (event) => {
            if (!isDevelopment) return;
            const record = getCurrentRecord(); const barcode = (event.target as HTMLInputElement).value.replace(/[^0-9]/g, '');
            if (record && /^\d{12}$/.test(barcode)) { record.barcode = barcode; writeStorage(); }
            else updateHeaderBarcode(record || null);
        }, options);
        document.getElementById('backToInterviewListButton')?.addEventListener('click', showList, options);
        document.getElementById('deleteInterviewButton')?.addEventListener('click', deleteRecord, options);
        document.getElementById('flagsToggle')?.addEventListener('click', toggleFlags, options);
        document.getElementById('interviewCards')?.addEventListener('click', (event) => {
            const card = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-record-id]'); const record = records.find((item) => item.id === card?.dataset.recordId); if (record) showForm(record);
        }, options);
    };
    const destroy = (): void => { if (saveTimer !== null) { globalThis.clearTimeout(saveTimer); saveTimer = null; } saveCurrent(); stopScanner(); listeners?.abort(); listeners = null; };
    return { init, destroy };
})();
