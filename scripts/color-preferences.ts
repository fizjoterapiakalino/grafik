// scripts/color-preferences.ts
// Moduł personalizacji kolorów - zapisuje preferencje w localStorage

const DEFAULT_COLORS = {
    massage: '#f472b6',
    pnf: '#3b82f6',
    everyOtherDay: '#a855f7',
    break: '#64748b',
};

const STORAGE_KEY = 'fizjoterapia_color_preferences';

export interface TreatmentColors {
    massage: string;
    pnf: string;
    everyOtherDay: string;
    break: string;
}

export const ColorPreferences = (() => {
    let currentColors: TreatmentColors = { ...DEFAULT_COLORS };

    const loadFromStorage = (): TreatmentColors => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) return { ...DEFAULT_COLORS, ...JSON.parse(stored) };
        } catch (e) {
            console.warn('ColorPreferences: Błąd wczytywania z localStorage', e);
        }
        return { ...DEFAULT_COLORS };
    };

    const saveToStorage = (): void => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(currentColors));
        } catch (e) {
            console.warn('ColorPreferences: Błąd zapisu do localStorage', e);
        }
    };

    const applyColors = (): void => {
        const root = document.documentElement;
        root.style.setProperty('--bg-massage', currentColors.massage);
        root.style.setProperty('--bg-pnf', currentColors.pnf);
        root.style.setProperty('--bg-every-other-day', currentColors.everyOtherDay);
        root.style.setProperty('--bg-break', currentColors.break);
    };

    const init = (): void => {
        currentColors = loadFromStorage();
        applyColors();
    };

    const getColors = (): TreatmentColors => ({ ...currentColors });

    const setColor = (key: keyof TreatmentColors, value: string): void => {
        if (key in currentColors) {
            currentColors[key] = value;
            saveToStorage();
            applyColors();
        }
    };

    const resetToDefaults = (): void => {
        currentColors = { ...DEFAULT_COLORS };
        saveToStorage();
        applyColors();
    };

    return {
        init,
        getColors,
        setColor,
        resetToDefaults,
        applyColors,
    };
})();
