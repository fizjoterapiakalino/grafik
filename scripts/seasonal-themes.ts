// scripts/seasonal-themes.ts
/**
 * Moduł zarządzający sezonowymi motywami aplikacji
 *
 * Aby dodać nowy motyw:
 * 1. Dodaj definicję w SEASONAL_THEMES
 * 2. Dodaj funkcję createXxxOverlay w OVERLAY_CREATORS
 * 3. Dodaj style CSS w styles/seasonal.css
 */

import { getEasterDate } from './common.js';

/**
 * Typ nazwy motywu
 */
export type ThemeName = 'christmas' | 'newyear' | 'easter';

/**
 * Interfejs motywu sezonowego
 */
interface SeasonalTheme {
    name: ThemeName;
    description: string;
    isActive: (date: Date) => boolean;
}

/**
 * Funkcja tworząca overlay
 */
type OverlayCreator = (overlay: HTMLElement) => void;

/**
 * Konfiguracja dostępnych motywów sezonowych
 */
const SEASONAL_THEMES: Record<ThemeName, SeasonalTheme> = {
    christmas: {
        name: 'christmas',
        description: 'Motyw świąteczny z płatkami śniegu',
        isActive: (date: Date): boolean => {
            const month = date.getMonth();
            const day = date.getDate();
            return month === 11 && day >= 1 && day <= 26;
        },
    },
    newyear: {
        name: 'newyear',
        description: 'Motyw noworoczny z bąbelkami szampana',
        isActive: (date: Date): boolean => {
            const month = date.getMonth();
            const day = date.getDate();
            return (month === 11 && day >= 27) || (month === 0 && day <= 15);
        },
    },
    easter: {
        name: 'easter',
        description: 'Motyw wielkanocny',
        isActive: (date: Date): boolean => {
            const year = date.getFullYear();
            const easter = getEasterDate(year);

            const easterStart = new Date(easter);
            easterStart.setDate(easter.getDate() - 7);

            const easterEnd = new Date(easter);
            easterEnd.setDate(easter.getDate() + 2);

            return date >= easterStart && date <= easterEnd;
        },
    },
};

/**
 * Funkcje tworzące overlay dla każdego motywu
 */
const OVERLAY_CREATORS: Record<ThemeName, OverlayCreator> = {
    christmas: (overlay: HTMLElement): void => {
        const snowflakeCount = 20;
        for (let i = 0; i < snowflakeCount; i++) {
            const flake = document.createElement('div');
            flake.className = 'snowflake';
            flake.textContent = '❄';
            flake.style.left = Math.random() * 100 + 'vw';
            flake.style.animationDuration = Math.random() * 5 + 5 + 's';
            flake.style.animationDelay = Math.random() * 5 + 's';
            flake.style.fontSize = Math.random() * 10 + 10 + 'px';
            flake.style.opacity = String(Math.random() * 0.5 + 0.2);
            overlay.appendChild(flake);
        }
    },

    newyear: (overlay: HTMLElement): void => {
        const confettiCount = 25;
        const confettiColors = ['#FFD700', '#C0C0C0', '#FF4444', '#9B59B6', '#00CED1', '#FF69B4'];
        const confettiShapes = ['●', '■', '▬', '★'];

        for (let i = 0; i < confettiCount; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'newyear-confetti';
            confetti.textContent = confettiShapes[Math.floor(Math.random() * confettiShapes.length)];
            confetti.style.left = Math.random() * 100 + 'vw';
            confetti.style.color = confettiColors[Math.floor(Math.random() * confettiColors.length)];
            confetti.style.fontSize = Math.random() * 8 + 8 + 'px';
            confetti.style.animationDuration = Math.random() * 6 + 8 + 's';
            confetti.style.animationDelay = Math.random() * 10 + 's';
            confetti.style.setProperty('--rotation', Math.random() * 720 - 360 + 'deg');
            overlay.appendChild(confetti);
        }

        const sparkleCount = 15;
        for (let i = 0; i < sparkleCount; i++) {
            const sparkle = document.createElement('div');
            sparkle.className = 'newyear-sparkle';
            sparkle.textContent = '✦';
            sparkle.style.left = Math.random() * 100 + 'vw';
            sparkle.style.top = Math.random() * 80 + 10 + 'vh';
            sparkle.style.color = Math.random() > 0.5 ? '#FFD700' : '#C0C0C0';
            sparkle.style.fontSize = Math.random() * 10 + 8 + 'px';
            sparkle.style.animationDelay = Math.random() * 5 + 's';
            overlay.appendChild(sparkle);
        }

        const fireworkColors = ['#FFD700', '#FF4444', '#00CED1', '#FF69B4', '#9B59B6', '#00FF00'];
        const fireworkCount = 4;

        const createExplosion = (x: number, y: number, color: string, container: HTMLElement): void => {
            const particleCount = 12;
            const distance = 80;

            for (let i = 0; i < particleCount; i++) {
                const particle = document.createElement('div');
                particle.className = 'newyear-explosion-particle';
                particle.style.left = x + 'vw';
                particle.style.top = y + 'vh';
                particle.style.backgroundColor = color;
                particle.style.boxShadow = `0 0 6px ${color}, 0 0 10px ${color}`;

                const angle = ((i / particleCount) * 360 * Math.PI) / 180;
                const translateX = Math.cos(angle) * distance;
                const translateY = Math.sin(angle) * distance;

                particle.style.setProperty('--translate-x', translateX + 'px');
                particle.style.setProperty('--translate-y', translateY + 'px');

                container.appendChild(particle);

                setTimeout(() => particle.remove(), 1500);
            }
        };

        const createFirework = (): void => {
            const firework = document.createElement('div');
            firework.className = 'newyear-firework';

            const startX = Math.random() * 80 + 10;
            firework.style.left = startX + 'vw';

            const endY = Math.random() * 40 + 10;
            firework.style.setProperty('--end-y', endY + 'vh');

            const color = fireworkColors[Math.floor(Math.random() * fireworkColors.length)];
            firework.style.setProperty('--firework-color', color);

            const delay = Math.random() * 8;
            firework.style.animationDelay = delay + 's';

            overlay.appendChild(firework);

            setTimeout(
                () => {
                    createExplosion(startX, endY, color, overlay);
                },
                (delay + 1.5) * 1000
            );
        };

        for (let i = 0; i < fireworkCount; i++) {
            createFirework();
        }

        setInterval(() => {
            createFirework();
        }, 3000);
    },

    easter: (overlay: HTMLElement): void => {
        const symbols = ['🥚', '🐣', '🐰', '🌷', '🦋', '🌸'];
        const itemCount = 25;

        for (let i = 0; i < itemCount; i++) {
            const item = document.createElement('div');
            item.className = 'easter-item';
            item.textContent = symbols[Math.floor(Math.random() * symbols.length)];

            item.style.left = Math.random() * 100 + 'vw';
            item.style.animationDuration = Math.random() * 8 + 6 + 's';
            item.style.animationDelay = Math.random() * 8 + 's';
            item.style.fontSize = Math.random() * 12 + 14 + 'px';
            item.style.opacity = String(Math.random() * 0.4 + 0.3);

            const swayDirection = Math.random() > 0.5 ? 1 : -1;
            item.style.setProperty('--sway-direction', String(swayDirection));

            overlay.appendChild(item);
        }
    },
};

/**
 * Określa aktywny motyw dla danej daty
 */
export function getActiveTheme(date: Date = new Date()): SeasonalTheme | null {
    const themeOrder: ThemeName[] = ['christmas', 'newyear', 'easter'];

    for (const themeName of themeOrder) {
        const theme = SEASONAL_THEMES[themeName];
        if (theme && theme.isActive(date)) {
            return theme;
        }
    }

    return null;
}

/**
 * Tworzy overlay sezonowy
 */
function createSeasonalOverlay(themeName: ThemeName): void {
    const existingOverlay = document.querySelector('.seasonal-overlay');
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement('div');
    overlay.className = 'seasonal-overlay';

    const creator = OVERLAY_CREATORS[themeName];
    if (creator) {
        creator(overlay);
    }

    document.body.appendChild(overlay);
}

/**
 * Aplikuje sezonowy motyw do strony
 */
export function applySeasonalTheme(): void {
    console.log('Checking seasonal theme...');

    const theme = getActiveTheme();

    if (theme) {
        console.log(`Applying theme: ${theme.name}`);
        document.body.classList.add(`theme-${theme.name}`);
        createSeasonalOverlay(theme.name);
    } else {
        console.log('No seasonal theme active.');
    }
}

/**
 * Usuwa aktywny motyw sezonowy
 */
export function removeSeasonalTheme(): void {
    (Object.keys(SEASONAL_THEMES) as ThemeName[]).forEach((themeName) => {
        document.body.classList.remove(`theme-${themeName}`);
    });

    const overlay = document.querySelector('.seasonal-overlay');
    if (overlay) overlay.remove();
}

/**
 * Informacja o motywie
 */
interface ThemeInfo {
    key: ThemeName;
    name: ThemeName;
    description: string;
    isCurrentlyActive: boolean;
}

/**
 * Zwraca listę dostępnych motywów
 */
export function getAvailableThemes(): ThemeInfo[] {
    return (Object.entries(SEASONAL_THEMES) as [ThemeName, SeasonalTheme][]).map(([key, theme]) => ({
        key,
        name: theme.name,
        description: theme.description,
        isCurrentlyActive: theme.isActive(new Date()),
    }));
}
