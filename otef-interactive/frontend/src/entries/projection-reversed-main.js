import { mountReversedProjection } from '../projection/projection-reversed-output.js';

const mounted = mountReversedProjection({ document, window, location: window.location });
if (!mounted) document.body.textContent = 'Choose a left or right projector output.';
else window.addEventListener('pagehide', mounted.dispose, { once: true });
