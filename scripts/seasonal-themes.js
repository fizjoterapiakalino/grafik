export function applySeasonalTheme() {
    console.log('Checking seasonal theme...');
    const now = new Date();
    const month = now.getMonth(); // 0-11
    const day = now.getDate(); // 1-31

    let theme = null;

    // December: 11
    // January: 0

    // Christmas: Dec 1 - Dec 26
    if (month === 11 && day >= 1 && day <= 26) {
        theme = 'christmas';
    }
    // New Year / Winter: Dec 27 - Jan 15
    else if ((month === 11 && day >= 27) || (month === 0 && day <= 15)) {
        theme = 'newyear';
    }

    if (theme) {
        console.log(`Applying theme: ${theme}`);
        document.body.classList.add(`theme-${theme}`);
        createSeasonalOverlay(theme);
    } else {
        console.log('No seasonal theme active.');
    }
}

function createSeasonalOverlay(theme) {
    const existingOverlay = document.querySelector('.seasonal-overlay');
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement('div');
    overlay.className = 'seasonal-overlay';

    if (theme === 'christmas') {
        // Create snowflakes
        const snowflakeCount = 20; // Keep it readable, not a blizzard
        for (let i = 0; i < snowflakeCount; i++) {
            const flake = document.createElement('div');
            flake.className = 'snowflake';
            flake.textContent = '❄';
            flake.style.left = Math.random() * 100 + 'vw';
            flake.style.animationDuration = (Math.random() * 5 + 5) + 's'; // 5-10s
            flake.style.animationDelay = Math.random() * 5 + 's';
            flake.style.fontSize = (Math.random() * 10 + 10) + 'px';
            flake.style.opacity = Math.random() * 0.5 + 0.2; // Semi-transparent
            overlay.appendChild(flake);
        }
    } else if (theme === 'newyear') {
        // Create champagne bubbles
        const bubbleCount = 40; // Increased count
        for (let i = 0; i < bubbleCount; i++) {
            const bubble = document.createElement('div');
            bubble.className = 'champagne-bubble';

            // Randomize position and size
            bubble.style.left = (Math.random() * 100) + 'vw';

            const size = Math.random() * 10 + 5; // 5px to 15px
            bubble.style.width = size + 'px';
            bubble.style.height = size + 'px';

            // Randomize variables for CSS
            const duration = (Math.random() * 5 + 5); // 5-10s
            bubble.style.animation = `rise-and-pop ${duration}s linear infinite`;
            bubble.style.animationDelay = (Math.random() * 10) + 's';

            // Set CSS custom properties for random behavior
            const sway = (Math.random() * 40 - 20) + 'px'; // -20px to 20px
            const popHeight = (Math.random() * 40 + 40) + '%'; // Pops between 40% and 80% screen height

            bubble.style.setProperty('--sway-amount', sway);
            bubble.style.setProperty('--pop-height', popHeight);

            overlay.appendChild(bubble);
        }
    }

    document.body.appendChild(overlay);
}
