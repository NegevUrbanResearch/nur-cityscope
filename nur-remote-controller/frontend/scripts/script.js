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
        this.activeDropdown = null; // { slideIndex, type: 'indicator' | 'state' }
        
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
                this.updateConnectionStatus(true);
            };
            
            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    
                    if (message.type === 'presentation_update' && message.data) {
                        const data = message.data;
                        console.log('📡 WebSocket update:', data);
                        
                        const wasIndex = this.currentIndex;
                        
                        if (data.is_playing !== undefined) this.isPlaying = data.is_playing;
                        if (data.sequence_index !== undefined) this.currentIndex = data.sequence_index;
                        if (data.duration !== undefined) this.duration = data.duration;
                        if (data.sequence && Array.isArray(data.sequence)) this.slides = data.sequence;
                        
                        this.updateUI();
                        
                        // Fetch new thumbnail if slide changed
                        if (wasIndex !== this.currentIndex) {
                            this.fetchThumbnail();
                        }
                    }
                    
                    if (message.type === 'indicator_update' && message.data) {
                        // Update current display when indicator changes
                        this.updateCurrentDisplay(message.data);
                        this.fetchThumbnail();
                    }
                } catch (err) {
                    console.error('WebSocket message error:', err);
                }
            };
            
            this.ws.onclose = () => {
                console.log('✗ WebSocket disconnected, reconnecting...');
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
                    this.isPlaying = presState.is_playing || false;
                    this.currentIndex = presState.sequence_index || 0;
                    this.duration = presState.duration || 10;
                    this.slides = presState.sequence || this.getDefaultSlides();
                }
                
                this.updateUI();
                await this.fetchThumbnail();
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
        // Reduced polling frequency - WebSocket handles real-time updates
        setInterval(() => this.pollState(), 5000);
    }
    
    async pollState() {
        try {
            const presState = await this.apiGet('/api/actions/get_presentation_state/');
            
            if (presState) {
                this.connected = true;
                this.updateConnectionStatus(true);
                
                const wasIndex = this.currentIndex;
                const wasPlaying = this.isPlaying;
                
                this.isPlaying = presState.is_playing || false;
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
            }
            
            const globalState = await this.apiGet('/api/actions/get_global_variables/');
            if (globalState) {
                this.updateCurrentDisplay(globalState);
            }
        } catch (error) {
            console.error('Polling error:', error);
            this.updateConnectionStatus(false);
        }
    }
    
    async fetchThumbnail() {
        try {
            const currentSlide = this.slides[this.currentIndex];
            if (!currentSlide) return;
            
            const timestamp = Date.now();
            const response = await this.apiGet(`/api/actions/get_image_data/?_=${timestamp}&indicator=${currentSlide.indicator}`);
            
            if (response && response.image_data) {
                let url = response.image_data;
                if (url.startsWith('/')) {
                    url = `${API_BASE}${url}`;
            } else {
                    url = `${API_BASE}/media/${url}`;
                }
                this.thumbnailUrl = url;
                this.renderPreview();
            }
        } catch (error) {
            console.error('Error fetching thumbnail:', error);
            this.elements.previewContainer.innerHTML = `
                <div class="preview-placeholder">
                    <span>No preview available</span>
                </div>
            `;
        }
    }
    
    renderPreview() {
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
                <img src="${this.thumbnailUrl}" alt="Preview" />
            `;
        }
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
            
            return `
                <div class="slide-item ${isActive ? 'active' : ''}" data-index="${index}">
                    <div class="slide-number">${index + 1}</div>
                    <div class="slide-selectors">
                        <button class="slide-selector" data-action="indicator" data-index="${index}">
                            <span class="slide-selector-text">${indicatorName}</span>
                            <svg class="slide-selector-arrow" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
                        </button>
                        <button class="slide-selector" data-action="state" data-index="${index}">
                            <span class="slide-selector-text">${slide.state}</span>
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
    
    // Check if a slide combo is already in use
    isSlideUsed(indicator, state, excludeIndex = -1) {
        return this.slides.some((slide, idx) => 
            idx !== excludeIndex && slide.indicator === indicator && slide.state === state
        );
    }
    
    // Get all valid slides
    getAllValidSlides() {
        const slides = [];
        Object.keys(INDICATOR_CONFIG).forEach(indicator => {
            const states = STATE_CONFIG[indicator] || [];
            states.forEach(state => {
                if (this.isValidSlide(indicator, state)) {
                    slides.push({ indicator, state });
                }
            });
        });
        return slides;
    }
    
    // Check if all slides are used
    allSlidesUsed() {
        return this.getAllValidSlides().every(slide => 
            this.isSlideUsed(slide.indicator, slide.state)
        );
    }
    
    openDropdown(slideIndex, type) {
        this.activeDropdown = { slideIndex, type };
        const currentSlide = this.slides[slideIndex];
        
        let options = '';
        
        if (type === 'indicator') {
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
            states.forEach(state => {
                if (!this.isValidSlide(currentSlide.indicator, state)) return;
                
                const isSelected = currentSlide.state === state;
                const isUsed = this.isSlideUsed(currentSlide.indicator, state, slideIndex);
                
                options += `
                    <div class="dropdown-option ${isSelected ? 'selected' : ''} ${isUsed && !isSelected ? 'disabled' : ''}" data-value="${state}">
                        ${state}
                        ${isUsed && !isSelected ? '<span class="dropdown-option-note">(in use)</span>' : ''}
                    </div>
                `;
            });
        }
        
        options += `<div class="dropdown-cancel">Cancel</div>`;
        
        this.elements.dropdownContent.innerHTML = options;
        this.elements.dropdownMenu.classList.add('open');
        
        // Bind option clicks
        this.elements.dropdownContent.querySelectorAll('.dropdown-option').forEach(opt => {
            opt.addEventListener('click', () => {
                if (opt.classList.contains('disabled')) return;
                const value = opt.dataset.value;
                this.handleDropdownSelection(value);
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
    
    async handleDropdownSelection(value) {
        if (!this.activeDropdown) return;
        
        const { slideIndex, type } = this.activeDropdown;
        const newSlides = [...this.slides];
        
        if (type === 'indicator') {
            // When changing indicator, find first available state
            const availableStates = (STATE_CONFIG[value] || []).filter(s => 
                this.isValidSlide(value, s) && !this.isSlideUsed(value, s, slideIndex)
            );
            const firstState = availableStates[0] || STATE_CONFIG[value]?.[0];
            newSlides[slideIndex] = { indicator: value, state: firstState };
        } else {
            newSlides[slideIndex] = { ...newSlides[slideIndex], state: value };
        }
        
        this.slides = newSlides;
        this.closeDropdown();
        
        // Sync with backend
        await this.syncSequence();
        this.updateUI();
    }
    
    async addSlide() {
        // Find first unused valid slide
        const unusedSlide = this.getAllValidSlides().find(slide => 
            !this.isSlideUsed(slide.indicator, slide.state)
        );
        
        if (unusedSlide) {
            this.slides = [...this.slides, unusedSlide];
            await this.syncSequence();
            this.updateUI();
        }
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
            await this.apiPost('/api/actions/set_presentation_state/', {
                is_playing: newState
            });
            
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
        
        try {
            await this.apiPost('/api/actions/set_presentation_state/', {
                duration: newDuration
            });
            
            this.duration = newDuration;
            this.elements.durationValue.textContent = `${this.duration}s`;
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
