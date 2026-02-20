const STORAGE_KEY = 'fizjoterapia_mobile_zen_mode';
const MOBILE_BREAKPOINT_QUERY = '(max-width: 768px)';

interface MobileZenState {
    enabled: boolean;
    active: boolean;
}

interface MobileZenAPI {
    init(): void;
    isEnabled(): boolean;
    isActive(): boolean;
    setEnabled(enabled: boolean, notify?: boolean): void;
}

export const MobileZen: MobileZenAPI = (() => {
    let enabled = false;
    let initialized = false;
    let lastScrollTop = 0;
    let scrollContainer: HTMLElement | Window | null = null;
    let scrollListenerAttached = false;
    const SCROLL_HIDE_THRESHOLD = 12;
    const SCROLL_SHOW_TOP = 20;
    const SCROLL_HIDE_MIN_Y = 72;

    const handleViewportChange = (): void => applyStateToDom();

    const isMobileViewport = (): boolean => window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;

    const getState = (): MobileZenState => ({
        enabled,
        active: enabled && isMobileViewport(),
    });

    const dispatchState = (): void => {
        window.dispatchEvent(new CustomEvent<MobileZenState>('mobile-zen-changed', { detail: getState() }));
    };

    const setHeaderHidden = (hidden: boolean): void => {
        document.body.classList.toggle('mobile-zen-header-hidden', hidden);
    };

    const resolveScrollTop = (): number => {
        if (scrollContainer && 'scrollTop' in scrollContainer) {
            return (scrollContainer as HTMLElement).scrollTop;
        }
        return window.scrollY || 0;
    };

    const handleScroll = (): void => {
        if (!isMobileViewport() || !enabled) {
            setHeaderHidden(false);
            return;
        }

        if (document.querySelector('.nav-panel.visible')) {
            setHeaderHidden(false);
            return;
        }

        const current = resolveScrollTop();
        const delta = current - lastScrollTop;

        if (current <= SCROLL_SHOW_TOP) {
            setHeaderHidden(false);
            lastScrollTop = current;
            return;
        }

        if (delta > SCROLL_HIDE_THRESHOLD && current > SCROLL_HIDE_MIN_Y) {
            setHeaderHidden(true);
        } else if (delta < -SCROLL_HIDE_THRESHOLD) {
            setHeaderHidden(false);
        }

        lastScrollTop = current;
    };

    const detachScrollListener = (): void => {
        if (!scrollContainer || !scrollListenerAttached) return;
        scrollContainer.removeEventListener('scroll', handleScroll as EventListener);
        scrollListenerAttached = false;
    };

    const attachScrollListener = (): void => {
        const container = document.getElementById('page-content');
        const nextTarget: HTMLElement | Window = container || window;

        if (scrollContainer === nextTarget && scrollListenerAttached) return;

        detachScrollListener();
        scrollContainer = nextTarget;
        scrollContainer.addEventListener('scroll', handleScroll as EventListener, { passive: true });
        scrollListenerAttached = true;
        lastScrollTop = resolveScrollTop();
    };

    const refreshScrollBinding = (): void => {
        attachScrollListener();
        if (!enabled || !isMobileViewport()) {
            setHeaderHidden(false);
            return;
        }
        handleScroll();
    };

    const applyStateToDom = (): void => {
        const { active } = getState();
        document.body.classList.toggle('mobile-zen-mode', active);
        document.body.dataset.mobileZen = enabled ? 'on' : 'off';
        if (!active) {
            setHeaderHidden(false);
        }
        refreshScrollBinding();
        dispatchState();
    };

    const saveToStorage = (): void => {
        localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    };

    const loadFromStorage = (): boolean => {
        try {
            return localStorage.getItem(STORAGE_KEY) === '1';
        } catch {
            return false;
        }
    };

    const setEnabled = (nextEnabled: boolean, notify: boolean = false): void => {
        enabled = nextEnabled;
        saveToStorage();
        applyStateToDom();

        if (!notify) return;
        if (enabled) {
            if (isMobileViewport()) {
                window.showToast?.('Tryb zen mobilny został włączony', 2500);
            } else {
                window.showToast?.('Tryb zen zapisany. Włączy się automatycznie na mobile.', 3200);
            }
            return;
        }
        window.showToast?.('Tryb zen mobilny został wyłączony', 2500);
    };

    const init = (): void => {
        if (initialized) return;
        initialized = true;
        enabled = loadFromStorage();
        window.setTimeout(refreshScrollBinding, 0);
        window.addEventListener('hashchange', refreshScrollBinding);
        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('orientationchange', handleViewportChange);
        applyStateToDom();
    };

    const isEnabled = (): boolean => enabled;
    const isActive = (): boolean => getState().active;

    return {
        init,
        isEnabled,
        isActive,
        setEnabled,
    };
})();

declare global {
    interface Window {
        MobileZen: MobileZenAPI;
    }
}

window.MobileZen = MobileZen;
