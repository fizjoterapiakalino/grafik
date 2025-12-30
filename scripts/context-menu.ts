// scripts/context-menu.ts

/**
 * Konfiguracja elementu menu kontekstowego
 */
export interface ContextMenuItemConfig {
    id: string;
    class?: string;
    action?: (target: HTMLElement, event?: MouseEvent) => void;
    condition?: (target: HTMLElement) => boolean;
    onShow?: (target: HTMLElement, event: MouseEvent) => void;
}

/**
 * Instancja menu kontekstowego
 */
interface ContextMenuInstance {
    handleContextMenu: (event: MouseEvent) => void;
    handleClickOutside: (event: MouseEvent) => void;
    itemClickHandlers: Map<string, () => void>;
    itemConfig: ContextMenuItemConfig[];
}

/**
 * Rozszerzona definicja dla menu z dodatkowymi właściwościami
 */
interface ContextMenuElement extends HTMLElement {
    contextEvent?: MouseEvent;
}

const contextMenuInstances: Record<string, ContextMenuInstance> = {};

export const initializeContextMenu = (
    menuId: string,
    targetSelector: string,
    itemConfig: ContextMenuItemConfig[]
): void => {
    const contextMenu = document.getElementById(menuId) as ContextMenuElement | null;
    if (!contextMenu) {
        console.error(`Context menu with id "${menuId}" not found.`);
        return;
    }

    let currentTarget: HTMLElement | null = null;

    const handleContextMenu = (event: MouseEvent): void => {
        const target = (event.target as HTMLElement).closest(targetSelector) as HTMLElement | null;
        if (target) {
            event.preventDefault();
            contextMenu.contextEvent = event;
            currentTarget = target;

            // Call onShow for items that have it
            itemConfig.forEach((item) => {
                if (item.onShow) {
                    item.onShow(currentTarget!, event);
                }
            });

            itemConfig.forEach((item) => {
                const element = document.getElementById(item.id);
                if (element) {
                    const shouldShow = item.condition ? item.condition(currentTarget!) : true;
                    element.style.display = shouldShow ? 'flex' : 'none';
                }
            });

            // Temporarily show to measure
            contextMenu.style.visibility = 'hidden';
            contextMenu.style.display = 'block';
            contextMenu.classList.add('visible');

            const { clientX: mouseX, clientY: mouseY } = event;
            const { innerWidth: windowWidth, innerHeight: windowHeight } = window;
            const menuWidth = contextMenu.offsetWidth;
            const menuHeight = contextMenu.offsetHeight;

            let x = mouseX;
            let y = mouseY;

            if (x + menuWidth > windowWidth) {
                x = windowWidth - menuWidth - 10;
            }

            if (y + menuHeight > windowHeight) {
                y = windowHeight - menuHeight - 10;
            }

            if (x < 0) x = 10;
            if (y < 0) y = 10;

            contextMenu.style.left = `${x}px`;
            contextMenu.style.top = `${y}px`;
            contextMenu.style.visibility = 'visible';
        }
    };

    const handleClickOutside = (event: MouseEvent): void => {
        if (!contextMenu.contains(event.target as Node)) {
            contextMenu.classList.remove('visible');
            contextMenu.style.display = 'none';
        }
    };

    const itemClickHandlers = new Map<string, () => void>();
    itemConfig.forEach((item) => {
        const element = document.getElementById(item.id);
        if (element) {
            const handler = (): void => {
                if (currentTarget && item.action) {
                    item.action(currentTarget, contextMenu.contextEvent);
                }
                contextMenu.classList.remove('visible');
                contextMenu.style.display = 'none';
            };
            itemClickHandlers.set(item.id, handler);
            element.addEventListener('click', handler);
        }
    });

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('click', handleClickOutside);

    // Long Press Support for Mobile
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    const LONG_PRESS_DURATION = 500;

    const handleTouchStart = (event: TouchEvent): void => {
        const target = (event.target as HTMLElement).closest(targetSelector) as HTMLElement | null;
        if (target) {
            longPressTimer = setTimeout(() => {
                const contextMenuEvent = new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: event.touches[0].clientX,
                    clientY: event.touches[0].clientY,
                });
                target.dispatchEvent(contextMenuEvent);
            }, LONG_PRESS_DURATION);
        }
    };

    const handleTouchEnd = (): void => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
        }
    };

    const handleTouchMove = (): void => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
        }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchmove', handleTouchMove);

    contextMenuInstances[menuId] = {
        handleContextMenu,
        handleClickOutside,
        itemClickHandlers,
        itemConfig,
    };
};

export const destroyContextMenu = (menuId: string): void => {
    const instance = contextMenuInstances[menuId];
    if (instance) {
        document.removeEventListener('contextmenu', instance.handleContextMenu);
        document.removeEventListener('click', instance.handleClickOutside);
        instance.itemConfig.forEach((item) => {
            const element = document.getElementById(item.id);
            const handler = instance.itemClickHandlers.get(item.id);
            if (element && handler) {
                element.removeEventListener('click', handler);
            }
        });
        delete contextMenuInstances[menuId];
        console.log(`Context menu ${menuId} destroyed.`);
    }
};

// Backward compatibility
declare global {
    interface Window {
        initializeContextMenu: typeof initializeContextMenu;
        destroyContextMenu: typeof destroyContextMenu;
    }
}

window.initializeContextMenu = initializeContextMenu;
window.destroyContextMenu = destroyContextMenu;
