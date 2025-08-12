document.addEventListener('DOMContentLoaded', () => {
    window.initializeContextMenu = (menuId, targetSelector, itemConfig) => {
        const contextMenu = document.getElementById(menuId);
        if (!contextMenu) {
            console.error(`Context menu with id "${menuId}" not found.`);
            return;
        }

        let currentTarget = null;

        // Show context menu
        document.addEventListener('contextmenu', (event) => {
            const target = event.target.closest(targetSelector);
            if (target) {
                event.preventDefault();
                contextMenu.contextEvent = event; // Store the original event
                currentTarget = target;

                // Update item visibility based on conditions
                itemConfig.forEach(item => {
                    const element = document.getElementById(item.id);
                    if (element) {
                        const shouldShow = item.condition ? item.condition(currentTarget) : true;
                        element.style.display = shouldShow ? 'flex' : 'none';
                    }
                });

                const { clientX: mouseX, clientY: mouseY } = event;
                const { innerWidth: windowWidth, innerHeight: windowHeight } = window;
                const menuWidth = contextMenu.offsetWidth;
                const menuHeight = contextMenu.offsetHeight;

                let x = mouseX;
                let y = mouseY;

                if (mouseX + menuWidth > windowWidth) {
                    x = windowWidth - menuWidth - 5; // 5px buffer
                }

                if (mouseY + menuHeight > windowHeight) {
                    y = windowHeight - menuHeight - 5; // 5px buffer
                }

                contextMenu.style.left = `${x}px`;
                contextMenu.style.top = `${y}px`;
                contextMenu.classList.add('visible');
            }
        });

        // Hide context menu on click outside
        document.addEventListener('click', (event) => {
            if (!contextMenu.contains(event.target)) {
                contextMenu.classList.remove('visible');
            }
        });

        // Handle item clicks
        itemConfig.forEach(item => {
            const element = document.getElementById(item.id);
            if (element) {
                element.addEventListener('click', () => {
                    if (currentTarget && item.action) {
                        item.action(currentTarget, contextMenu.contextEvent);
                    }
                    contextMenu.classList.remove('visible');
                });
            }
        });
    };
});
