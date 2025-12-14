/**
 * Nur Presentation Remote Controller
 * Mobile-friendly remote for controlling the presentation mode
 */

const API_BASE = window.location.origin;

// Configuration matching the frontend
const INDICATOR_CONFIG = {
    mobility: { id: 1, name: 'Mobility' },
    climate: { id: 2, name: 'Climate' }
};

const STATE_CONFIG = {
    mobility: ['Present'],
    climate: ['Dense Highrise', 'Existing', 'High Rises', 'Low Rise Dense', 'Mass Tree Planting', 'Open Public Space', 'Placemaking']
};

// Climate types (UTCI and Plan)
const CLIMATE_TYPES = ['utci', 'plan'];

class PresentationRemote {
    constructor() {
        // State
        this.isPlaying = false;
        this.currentIndex = 0;
        this.duration = 10;
        this.slides = [];
        this.connected = false;
        this.thumbnailUrl = null;

        // WebSocket
        this.ws = null;
        this.wsReconnectTimeout = null;

        // Dropdown state
        this.activeDropdown = null;

        // Performance optimization
        this.updateThrottleTimer = null;
        this.lastUpdateTime = 0;
        this.pendingUpdate = false;

        // Thumbnail throttling
        this.thumbnailThrottleTimer = null;
        this.lastThumbnailFetch = 0;
        this.pendingThumbnailFetch = false;

        // WebSocket health tracking
        this.wsConnected = false;
        this.lastWsUpdate = 0;

        // Image cache for fast thumbnail switching
        this.imageCache = new Map();
        this.inFlightRequests = new Set();

        // Climate scenario key mapping
        this.CLIMATE_SCENARIO_KEYS = {
            'Dense Highrise': 'dense_highrise',
            'Existing': 'existing',
            'High Rises': 'high_rises',
            'Low Rise Dense': 'lowrise',
            'Mass Tree Planting': 'mass_tree_planting',
            'Open Public Space': 'open_public_space',
            'Placemaking': 'placemaking'
        };

        // DOM elements
        this.elements = {
            playPauseBtn: document.getElementById('playPauseBtn'),
            prevBtn: document.getElementById('prevBtn'),
            nextBtn: document.getElementById('nextBtn'),
            durationMinus: document.getElementById('durationMinus'),
            durationPlus: document.getElementById('durationPlus'),
            durationValue: document.getElementById('durationValue'),
            slidesList: document.getElementById('slidesList'),
            addSlideBtn: document.getElementById('addSlideBtn'),
            currentIndex: document.querySelector('.current-index'),
            totalSlides: document.querySelector('.total-slides'),
            indicatorName: document.querySelector('.indicator-name'),
            stateName: document.querySelector('.state-name'),
            previewContainer: document.getElementById('previewContainer'),
            dropdownMenu: document.getElementById('dropdownMenu'),
            dropdownContent: document.getElementById('dropdownContent')
        };

        this.init();
    }
    
    async init() {
        this.showLoading();
        this.bindEvents();
        await this.fetchInitialState();
        this.connectWebSocket();
        this.startPolling(); // Fallback polling at reduced frequency
    }
    
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/presentation/`;
        
        console.log('🔌 Connecting to WebSocket:', wsUrl);
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('✓ WebSocket connected');
                this.wsConnected = true;
                this.updateConnectionStatus(true);
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    // Track last WebSocket update time
                    this.lastWsUpdate = Date.now();

                    if (message.type === 'presentation_update' && message.data) {
                        const data = message.data;
                        const wasIndex = this.currentIndex;

                        if (this.isPlaying) {
                            if (data.is_playing !== undefined) this.isPlaying = data.is_playing;
                            if (data.sequence_index !== undefined) this.currentIndex = data.sequence_index;
                            if (data.duration !== undefined) this.duration = data.duration;
                            if (data.sequence && Array.isArray(data.sequence)) this.slides = data.sequence;

                            this.throttledUpdateUI();

                            if (wasIndex !== this.currentIndex) {
                                this.throttledFetchThumbnail();
                            }
                        } else {
                            if (data.is_playing === true) {
                                this.isPlaying = true;
                                if (data.sequence_index !== undefined) this.currentIndex = data.sequence_index;
                                if (data.duration !== undefined) this.duration = data.duration;
                                if (data.sequence && Array.isArray(data.sequence)) this.slides = data.sequence;
                                this.throttledUpdateUI();
                                this.throttledFetchThumbnail();
                            }
                        }
                    }

                    if (message.type === 'indicator_update' && message.data) {
                        this.updateCurrentDisplay(message.data);
                        this.throttledFetchThumbnail();
                    }
                } catch (err) {
                    console.error('❌ WS error:', err);
                }
            };
            
            this.ws.onclose = () => {
                console.log('✗ WebSocket disconnected, reconnecting...');
                this.wsConnected = false;
                this.updateConnectionStatus(false);
                this.wsReconnectTimeout = setTimeout(() => this.connectWebSocket(), 3000);
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        } catch (err) {
            console.error('WebSocket connection failed:', err);
            this.wsReconnectTimeout = setTimeout(() => this.connectWebSocket(), 3000);
        }
    }
    
    bindEvents() {
        this.elements.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.elements.prevBtn.addEventListener('click', () => this.skipToPrev());
        this.elements.nextBtn.addEventListener('click', () => this.skipToNext());
        this.elements.durationMinus.addEventListener('click', () => this.adjustDuration(-1));
        this.elements.durationPlus.addEventListener('click', () => this.adjustDuration(1));
        this.elements.addSlideBtn.addEventListener('click', () => this.addSlide());
        
        // Close dropdown when clicking backdrop
        this.elements.dropdownMenu.addEventListener('click', (e) => {
            if (e.target === this.elements.dropdownMenu) {
                this.closeDropdown();
            }
        });
    }
    
    showLoading() {
        this.elements.slidesList.innerHTML = `
            <div class="loading-message">
                <div class="loading-spinner"></div>
                <p>Connecting to presentation...</p>
            </div>
        `;
    }
    
    async fetchInitialState() {
        try {
            const response = await this.apiGet('/api/actions/get_global_variables/');
            
            if (response) {
                this.connected = true;
                this.updateConnectionStatus(true);
                
                const presState = await this.apiGet('/api/actions/get_presentation_state/');
                if (presState) {
                    // If backend is actively playing, sync with it
                    // Otherwise, default to paused to avoid interfering with dashboard users
                    if (presState.is_playing) {
                        // Backend is playing - sync with it
                        this.isPlaying = true;
                        console.log('📡 Syncing with active presentation');
                    } else {
                        // Backend is paused - stay paused locally
                        this.isPlaying = false;
                    }
                    
                    this.currentIndex = presState.sequence_index || 0;
                    this.duration = presState.duration || 10;
                    this.slides = presState.sequence || this.getDefaultSlides();
                }
                
                this.updateUI();
                // Start preloading all slides for fast transitions
                await this.preloadSlides();
            }
        } catch (error) {
            console.error('Error fetching initial state:', error);
            this.updateConnectionStatus(false);
        }
    }
    
    getDefaultSlides() {
        return [
            { indicator: 'mobility', state: 'Present' }
        ];
    }
    
    startPolling() {
        // Emergency fallback only - WebSocket handles real-time updates
        setInterval(() => this.pollState(), 15000); // Poll every 15s (was 5s)
    }
    
    async pollState() {
        // Skip polling if WebSocket is connected and recently updated (within 20s)
        const now = Date.now();
        if (this.wsConnected && (now - this.lastWsUpdate < 20000)) {
            return; // WebSocket is handling updates
        }

        try {
            const presState = await this.apiGet('/api/actions/get_presentation_state/');
            
            if (presState) {
                this.connected = true;
                this.updateConnectionStatus(true);
                
                const wasIndex = this.currentIndex;
                const wasPlaying = this.isPlaying;
                
                // Only sync state from backend when we're playing (active control)
                // When paused, we maintain local state to avoid interfering with dashboard users
                if (this.isPlaying) {
                    if (presState.is_playing !== undefined) this.isPlaying = presState.is_playing;
                    this.currentIndex = presState.sequence_index || 0;
                    this.duration = presState.duration || 10;
                    
                    if (presState.sequence && presState.sequence.length > 0) {
                        this.slides = presState.sequence;
                    }
                    
                    // Update UI if something changed
                    if (wasPlaying !== this.isPlaying || wasIndex !== this.currentIndex) {
                        this.updateUI();
                        if (wasIndex !== this.currentIndex) {
                            await this.fetchThumbnail();
                        }
                    }
                } else {
                    // When paused, only react if another device started playback
                    if (presState.is_playing === true) {
                        console.log('📡 Poll detected playback started elsewhere');
                        this.isPlaying = true;
                        this.currentIndex = presState.sequence_index || 0;
                        this.duration = presState.duration || 10;
                        if (presState.sequence && presState.sequence.length > 0) {
                            this.slides = presState.sequence;
                        }
                        this.updateUI();
                        await this.fetchThumbnail();
                    }
                }
            }
            
            // Always update the current display info for visibility
            const globalState = await this.apiGet('/api/actions/get_global_variables/');
            if (globalState) {
                this.updateCurrentDisplay(globalState);
            }
        } catch (error) {
            console.error('Polling error:', error);
            this.updateConnectionStatus(false);
        }
    }
    
    // Throttled thumbnail fetch to prevent rapid API calls
    throttledFetchThumbnail() {
        const now = Date.now();

        // Throttle: max 1 fetch per 200ms
        if (now - this.lastThumbnailFetch < 200) {
            if (!this.pendingThumbnailFetch) {
                this.pendingThumbnailFetch = true;
                this.thumbnailThrottleTimer = setTimeout(() => {
                    this.pendingThumbnailFetch = false;
                    this.fetchThumbnail();
                }, 200);
            }
            return;
        }

        this.lastThumbnailFetch = now;
        this.fetchThumbnail();
    }

    // Generate cache key for a slide
    getCacheKey(indicator, state, type) {
        if (indicator === 'climate' && type) {
            return `${indicator}:${state}:${type}`;
        }
        return `${indicator}:${state}`;
    }

    // Fetch and cache a specific slide's image using PREFETCH API
    async fetchSlideImage(indicator, state, type = null, priority = 'normal') {
        const cacheKey = this.getCacheKey(indicator, state, type);

        // Return cached URL immediately if available
        if (this.imageCache.has(cacheKey)) {
            return this.imageCache.get(cacheKey);
        }

        // Prevent duplicate requests
        if (this.inFlightRequests.has(cacheKey)) {
            return null;
        }

        this.inFlightRequests.add(cacheKey);

        try {
            const timestamp = Date.now();

            // Build URL with PREFETCH mode params
            let url = `/api/actions/get_image_data/?_=${timestamp}&indicator=${indicator}`;

            if (indicator === 'climate') {
                const scenarioKey = this.CLIMATE_SCENARIO_KEYS[state] || state.toLowerCase().replace(/ /g, '_');
                url += `&scenario=${scenarioKey}&type=${type || 'utci'}`;
            } else {
                const scenarioKey = state.toLowerCase();
                url += `&scenario=${scenarioKey}`;
            }

            const response = await this.apiGet(url);

            if (response && response.image_data) {
                let imageUrl = response.image_data;
                if (imageUrl.startsWith('/')) {
                    imageUrl = `${API_BASE}${imageUrl}`;
                } else {
                    imageUrl = `${API_BASE}/media/${imageUrl}`;
                }

                // Preload image in browser cache
                if (!imageUrl.includes('.mp4')) {
                    const img = new Image();
                    img.src = imageUrl;
                    if (priority === 'high') {
                        await new Promise((resolve) => {
                            img.onload = resolve;
                            img.onerror = resolve;
                            setTimeout(resolve, 1500); // 1.5s timeout
                        });
                    }
                }

                this.imageCache.set(cacheKey, imageUrl);
                return imageUrl;
            }
        } catch (error) {
            console.error(`❌ Prefetch error ${indicator}:${state}`);
            return null;
        } finally {
            this.inFlightRequests.delete(cacheKey);
        }
    }

    // Preload upcoming slides for faster transitions
    async preloadSlides() {
        if (!this.slides || this.slides.length === 0) return;

        // Preload current + next 2 slides with high priority
        const priorityCount = Math.min(3, this.slides.length);
        for (let i = 0; i < priorityCount; i++) {
            const idx = (this.currentIndex + i) % this.slides.length;
            const slide = this.slides[idx];
            if (slide) {
                await this.fetchSlideImage(slide.indicator, slide.state, slide.type, 'high');
            }
        }

        // Preload remaining slides in background (fire and forget)
        for (let i = 0; i < this.slides.length; i++) {
            if (i < priorityCount) continue;
            const slide = this.slides[i];
            if (slide) {
                this.fetchSlideImage(slide.indicator, slide.state, slide.type, 'normal');
            }
        }
    }

    async fetchThumbnail() {
        try {
            const currentSlide = this.slides[this.currentIndex];
            if (!currentSlide) return;

            // Try cache first for instant display
            const cacheKey = this.getCacheKey(currentSlide.indicator, currentSlide.state, currentSlide.type);
            if (this.imageCache.has(cacheKey)) {
                this.thumbnailUrl = this.imageCache.get(cacheKey);
                this.renderPreview();

                // Preload next slide in background
                const nextIdx = (this.currentIndex + 1) % this.slides.length;
                const nextSlide = this.slides[nextIdx];
                if (nextSlide) {
                    this.fetchSlideImage(nextSlide.indicator, nextSlide.state, nextSlide.type, 'high');
                }
                return;
            }

            // Not cached - fetch with high priority
            const url = await this.fetchSlideImage(
                currentSlide.indicator,
                currentSlide.state,
                currentSlide.type,
                'high'
            );

            if (url) {
                this.thumbnailUrl = url;
                this.renderPreview();
            }
        } catch (error) {
            console.error('❌ Thumbnail error:', error);
            this.elements.previewContainer.innerHTML = `
                <div class="preview-placeholder">
                    <span>No preview</span>
                </div>
            `;
        }
    }

    renderPreview() {
        // Clean up existing media elements to prevent memory leaks
        const existingVideo = this.elements.previewContainer.querySelector('video');
        if (existingVideo) {
            existingVideo.pause();
            existingVideo.src = '';
            existingVideo.load();
        }

        if (!this.thumbnailUrl) {
            this.elements.previewContainer.innerHTML = `
                <div class="preview-placeholder">
                    <span>No preview</span>
                </div>
            `;
            return;
        }

        const isVideo = this.thumbnailUrl.includes('.mp4');

        if (isVideo) {
            this.elements.previewContainer.innerHTML = `
                <video src="${this.thumbnailUrl}" autoplay loop muted playsinline></video>
            `;
        } else {
            this.elements.previewContainer.innerHTML = `
                <img src="${this.thumbnailUrl}" alt="Preview" loading="lazy" />
            `;
        }
    }
    
    // Throttled UI update to prevent excessive DOM manipulation on mobile
    throttledUpdateUI() {
        const now = Date.now();

        // Throttle to max 10 updates per second (100ms minimum between updates)
        if (now - this.lastUpdateTime < 100) {
            // Schedule a delayed update if one isn't already pending
            if (!this.pendingUpdate) {
                this.pendingUpdate = true;
                setTimeout(() => {
                    this.pendingUpdate = false;
                    this.updateUI();
                }, 100);
            }
            return;
        }

        this.lastUpdateTime = now;
        this.updateUI();
    }

    updateUI() {
        // Play/pause button
        this.elements.playPauseBtn.classList.toggle('playing', this.isPlaying);

        // Navigation buttons
        this.elements.prevBtn.disabled = !this.isPlaying;
        this.elements.nextBtn.disabled = !this.isPlaying;

        // Counter
        this.elements.currentIndex.textContent = this.currentIndex + 1;
        this.elements.totalSlides.textContent = this.slides.length;

        // Duration
        this.elements.durationValue.textContent = `${this.duration}s`;

        // Add button state
        this.elements.addSlideBtn.disabled = this.allSlidesUsed();

        // Render slides list
        this.renderSlidesList();
    }
    
    updateCurrentDisplay(globalState) {
        const indicatorId = globalState.indicator_id;
        let indicatorKey = 'mobility';
        if (indicatorId === 2) indicatorKey = 'climate';

        this.elements.indicatorName.textContent = INDICATOR_CONFIG[indicatorKey]?.name || indicatorKey;

        const indicatorState = globalState.indicator_state || {};
        let stateName = '-';

        if (indicatorKey === 'climate') {
            const scenarioNames = {
                dense_highrise: 'Dense Highrise',
                existing: 'Existing',
                high_rises: 'High Rises',
                lowrise: 'Low Rise Dense',
                mass_tree_planting: 'Mass Tree Planting',
                open_public_space: 'Open Public Space',
                placemaking: 'Placemaking'
            };
            stateName = scenarioNames[indicatorState.scenario] || indicatorState.scenario || 'Existing';
            // Show type if available
            if (indicatorState.type) {
                stateName += ` (${indicatorState.type.toUpperCase()})`;
            }
        } else {
            stateName = indicatorState.label || indicatorState.scenario || 'Present';
            stateName = stateName.charAt(0).toUpperCase() + stateName.slice(1);
        }

        this.elements.stateName.textContent = stateName;
    }
    
    renderSlidesList() {
        if (!this.slides || this.slides.length === 0) {
            this.elements.slidesList.innerHTML = `
                <div class="loading-message">
                    <p>No slides configured</p>
                </div>
            `;
            return;
        }

        const html = this.slides.map((slide, index) => {
            const isActive = index === this.currentIndex;
            const indicatorName = INDICATOR_CONFIG[slide.indicator]?.name || slide.indicator;
            const canDelete = this.slides.length > 1;

            // For climate, show state + type; for others, just state
            let stateDisplay = slide.state;
            if (slide.indicator === 'climate' && slide.type) {
                stateDisplay = `${slide.state} (${slide.type.toUpperCase()})`;
            }

            return `
                <div class="slide-item ${isActive ? 'active' : ''}" data-index="${index}">
                    <div class="slide-number">${index + 1}</div>
                    <div class="slide-selectors">
                        <button class="slide-selector" data-action="indicator" data-index="${index}">
                            <span class="slide-selector-text">${indicatorName}</span>
                            <svg class="slide-selector-arrow" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
                        </button>
                        <button class="slide-selector" data-action="state" data-index="${index}">
                            <span class="slide-selector-text">${stateDisplay}</span>
                            <svg class="slide-selector-arrow" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
                        </button>
                    </div>
                    <button class="slide-delete-btn" data-action="delete" data-index="${index}" ${!canDelete ? 'disabled' : ''}>
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    </button>
                </div>
            `;
        }).join('');
        
        this.elements.slidesList.innerHTML = html;
        
        // Bind click handlers
        this.elements.slidesList.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const index = parseInt(btn.dataset.index, 10);
                
                if (action === 'indicator') {
                    this.openDropdown(index, 'indicator');
                } else if (action === 'state') {
                    this.openDropdown(index, 'state');
                } else if (action === 'delete') {
                    this.removeSlide(index);
                }
  });
});

        // Scroll active slide into view
        const activeSlide = this.elements.slidesList.querySelector('.slide-item.active');
        if (activeSlide) {
            activeSlide.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
    
    // Check if a slide is valid
    isValidSlide(indicator, state) {
        const validStates = STATE_CONFIG[indicator] || [];
        return validStates.includes(state);
    }
    
    // Check if a slide combo is already in use (includes type for climate)
    isSlideUsed(indicator, state, type = null, excludeIndex = -1) {
        return this.slides.some((slide, idx) => {
            if (idx === excludeIndex) return false;
            if (slide.indicator !== indicator || slide.state !== state) return false;
            // For climate slides, also check type
            if (indicator === 'climate') {
                return slide.type === type;
            }
            return true;
        });
    }
    
    // Get all valid slides (includes type variants for climate)
    getAllValidSlides() {
        const slides = [];
        Object.keys(INDICATOR_CONFIG).forEach(indicator => {
            const states = STATE_CONFIG[indicator] || [];
            states.forEach(state => {
                if (this.isValidSlide(indicator, state)) {
                    if (indicator === 'climate') {
                        // Climate has two types: utci and plan
                        CLIMATE_TYPES.forEach(type => {
                            slides.push({ indicator, state, type });
                        });
                    } else {
                        slides.push({ indicator, state });
                    }
                }
            });
        });
        return slides;
    }
    
    // Check if all slides are used
    allSlidesUsed() {
        return this.getAllValidSlides().every(slide =>
            this.isSlideUsed(slide.indicator, slide.state, slide.type)
        );
    }
    
    openDropdown(slideIndex, dropdownType) {
        this.activeDropdown = { slideIndex, dropdownType };
        const currentSlide = this.slides[slideIndex];

        let options = '';

        if (dropdownType === 'indicator') {
            Object.entries(INDICATOR_CONFIG).forEach(([key, config]) => {
                const hasValidStates = (STATE_CONFIG[key] || []).some(s => this.isValidSlide(key, s));
                if (!hasValidStates) return;

                const isSelected = currentSlide.indicator === key;
                options += `
                    <div class="dropdown-option ${isSelected ? 'selected' : ''}" data-value="${key}">
                        ${config.name}
                    </div>
                `;
            });
        } else {
            const states = STATE_CONFIG[currentSlide.indicator] || [];

            if (currentSlide.indicator === 'climate') {
                // For climate, show state + type combinations
                states.forEach(state => {
                    if (!this.isValidSlide(currentSlide.indicator, state)) return;

                    CLIMATE_TYPES.forEach(type => {
                        const isSelected = currentSlide.state === state && currentSlide.type === type;
                        const isUsed = this.isSlideUsed('climate', state, type, slideIndex);
                        const typeLabel = type.toUpperCase();

                        options += `
                            <div class="dropdown-option ${isSelected ? 'selected' : ''} ${isUsed && !isSelected ? 'disabled' : ''}"
                                 data-value="${state}" data-type="${type}">
                                ${state} (${typeLabel})
                                ${isUsed && !isSelected ? '<span class="dropdown-option-note">(in use)</span>' : ''}
                            </div>
                        `;
                    });
                });
            } else {
                // For mobility, show just states
                states.forEach(state => {
                    if (!this.isValidSlide(currentSlide.indicator, state)) return;

                    const isSelected = currentSlide.state === state;
                    const isUsed = this.isSlideUsed(currentSlide.indicator, state, null, slideIndex);

                    options += `
                        <div class="dropdown-option ${isSelected ? 'selected' : ''} ${isUsed && !isSelected ? 'disabled' : ''}" data-value="${state}">
                            ${state}
                            ${isUsed && !isSelected ? '<span class="dropdown-option-note">(in use)</span>' : ''}
                        </div>
                    `;
                });
            }
        }

        options += `<div class="dropdown-cancel">Cancel</div>`;

        this.elements.dropdownContent.innerHTML = options;
        this.elements.dropdownMenu.classList.add('open');

        // Bind option clicks
        this.elements.dropdownContent.querySelectorAll('.dropdown-option').forEach(opt => {
            opt.addEventListener('click', () => {
                if (opt.classList.contains('disabled')) return;
                const value = opt.dataset.value;
                const climateType = opt.dataset.type || null;
                this.handleDropdownSelection(value, climateType);
            });
        });

        this.elements.dropdownContent.querySelector('.dropdown-cancel').addEventListener('click', () => {
            this.closeDropdown();
        });
    }
    
    closeDropdown() {
        this.elements.dropdownMenu.classList.remove('open');
        this.activeDropdown = null;
    }
    
    async handleDropdownSelection(value, climateType = null) {
        if (!this.activeDropdown) return;

        const { slideIndex, dropdownType } = this.activeDropdown;
        const newSlides = [...this.slides];

        if (dropdownType === 'indicator') {
            // When changing indicator, find first available state+type combo
            if (value === 'climate') {
                // Find first unused climate state+type combo
                const states = STATE_CONFIG[value] || [];
                let foundSlide = null;
                for (const state of states) {
                    if (!this.isValidSlide(value, state)) continue;
                    for (const type of CLIMATE_TYPES) {
                        if (!this.isSlideUsed(value, state, type, slideIndex)) {
                            foundSlide = { indicator: value, state, type };
                            break;
                        }
                    }
                    if (foundSlide) break;
                }
                newSlides[slideIndex] = foundSlide || { indicator: value, state: states[0], type: 'utci' };
            } else {
                // For mobility, find first available state
                const availableStates = (STATE_CONFIG[value] || []).filter(s =>
                    this.isValidSlide(value, s) && !this.isSlideUsed(value, s, null, slideIndex)
                );
                const firstState = availableStates[0] || STATE_CONFIG[value]?.[0];
                newSlides[slideIndex] = { indicator: value, state: firstState };
            }
        } else {
            // State selection - for climate, climateType is provided
            if (newSlides[slideIndex].indicator === 'climate' && climateType) {
                newSlides[slideIndex] = { indicator: 'climate', state: value, type: climateType };
            } else {
                newSlides[slideIndex] = { ...newSlides[slideIndex], state: value };
            }
        }

        this.slides = newSlides;
        this.closeDropdown();

        // Sync with backend
        await this.syncSequence();
        this.updateUI();
    }
    
    async addSlide() {
        // Find first unused valid slide (including type for climate)
        const unusedSlide = this.getAllValidSlides().find(slide =>
            !this.isSlideUsed(slide.indicator, slide.state, slide.type)
        );

        if (unusedSlide) {
            this.slides = [...this.slides, unusedSlide];
            await this.syncSequence();
            this.updateUI();
        }
        // Don't add duplicates if all slides are used
    }
    
    async removeSlide(index) {
        if (this.slides.length <= 1) return;
        
        this.slides = this.slides.filter((_, i) => i !== index);
        
        // Adjust current index if needed
        if (this.currentIndex >= this.slides.length) {
            this.currentIndex = this.slides.length - 1;
        }
        
        await this.syncSequence();
        this.updateUI();
    }
    
    async syncSequence() {
        // Only sync when playing to avoid interfering with dashboard users
        if (!this.isPlaying) {
            console.log('Skipping sequence sync - remote is paused');
            return;
        }
        try {
            await this.apiPost('/api/actions/set_presentation_state/', {
                sequence: this.slides
            });
        } catch (error) {
            console.error('Error syncing sequence:', error);
        }
    }
    
    async togglePlayPause() {
        const newState = !this.isPlaying;
        
        try {
            if (newState) {
                // When starting to play, sync all local state to backend
                await this.apiPost('/api/actions/set_presentation_state/', {
                    is_playing: true,
                    sequence: this.slides,
                    sequence_index: this.currentIndex,
                    duration: this.duration
                });
            } else {
                // When pausing, just update play state
                await this.apiPost('/api/actions/set_presentation_state/', {
                    is_playing: false
                });
            }
            
            this.isPlaying = newState;
            this.updateUI();
        } catch (error) {
            console.error('Error toggling play/pause:', error);
        }
    }
    
    async skipToNext() {
        if (!this.isPlaying) return;
        
        const nextIndex = (this.currentIndex + 1) % this.slides.length;
        await this.jumpToSlide(nextIndex);
    }
    
    async skipToPrev() {
        if (!this.isPlaying) return;
        
        const prevIndex = (this.currentIndex - 1 + this.slides.length) % this.slides.length;
        await this.jumpToSlide(prevIndex);
    }
    
    async jumpToSlide(index) {
        try {
            await this.apiPost('/api/actions/set_presentation_state/', {
                sequence_index: index
            });
            
            this.currentIndex = index;
            this.updateUI();
            await this.fetchThumbnail();
        } catch (error) {
            console.error('Error jumping to slide:', error);
        }
    }
    
    async adjustDuration(delta) {
        const newDuration = Math.max(1, this.duration + delta);
        this.duration = newDuration;
        this.elements.durationValue.textContent = `${this.duration}s`;
        
        // Only sync when playing to avoid interfering with dashboard users
        if (!this.isPlaying) {
            console.log('Duration changed locally - will sync when playing');
            return;
        }
        
        try {
            await this.apiPost('/api/actions/set_presentation_state/', {
                duration: newDuration
            });
        } catch (error) {
            console.error('Error adjusting duration:', error);
        }
    }
    
    updateConnectionStatus(connected) {
        let indicator = document.querySelector('.connection-status');
        
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'connection-status';
            document.body.appendChild(indicator);
        }
        
        indicator.classList.toggle('disconnected', !connected);
    }
    
    async apiGet(endpoint) {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        return response.json();
    }
    
    async apiPost(endpoint, data) {
        const csrfToken = this.getCSRFToken();
        
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            credentials: 'include',
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        return response.json();
    }
    
    getCSRFToken() {
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'csrftoken') {
                return value;
            }
        }
        return null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.presentationRemote = new PresentationRemote();
});
