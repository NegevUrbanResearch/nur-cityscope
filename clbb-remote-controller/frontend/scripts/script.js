// CityScope Remote Controller script

/**
 * Server address configuration
 */
const server_address = `http://localhost:9900`;

/**
 * API Client class for managing interactions with the backend
 */
class APIClient {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    getCSRFToken() {
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'csrftoken') {
                return value;
            }
        }
        return null;
    }

    post(endpoint, data) {
        return fetch(`${this.baseUrl}${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': this.getCSRFToken(), // Add CSRF token
            },
            credentials: 'include', // Include cookies if needed
            body: JSON.stringify(data),
        })
        .then(response => {
            if (!response.ok) {
                return response.text().then(text => {
                    throw new Error(`Request error: ${response.status} - ${text}`);
                });
            }
            return response.json();
        });
    }

    get(endpoint, params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const urlWithParams = queryString ? `${this.baseUrl}${endpoint}?${queryString}` : `${this.baseUrl}${endpoint}`;
        return fetch(urlWithParams, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': this.getCSRFToken(), // Add CSRF token
            },
            credentials: 'include', // Include cookies if needed
        })
        .then(response => {
            if (!response.ok) {
                return response.text().then(text => {
                    throw new Error(`Request error: ${response.status} - ${text}`);
                });
            }
            return response.json();
        });
    }
}

// Initialize the APIClient with the base URL
const apiClient = new APIClient(`${server_address}/api`);

/**
 * Change the active indicator layer by sending a POST request to the API
 * @param {number} indicatorId - The ID of the indicator to set
 */
function changeIndicator(indicatorId) {
    const payload = { indicator_id: indicatorId };

    apiClient.post('/actions/set_current_indicator/', payload)
        .then(data => {
            console.log('Indicator changed successfully:', data);
        })
        .catch(error => {
            console.error('Error changing indicator:', error);
        });
}

/**
 * Change the current state by sending a POST request to the API
 * @param {Object.<string, number>} currentState - An object where keys are state IDs (as strings) and values are 0 or 1
 */
function changeState(currentState) {
    const payload = { state: currentState };

    apiClient.post('/actions/set_current_state/', payload)
        .then(data => {
            console.log('State changed successfully:', data);
        })
        .catch(error => {
            console.error('Error changing state:', error);
        });
}

// Fetch indicators from the server and create buttons
apiClient.get('/indicators', {})
    .then(data => {
        const buttonsContainer = document.querySelector('.buttons-container');
        buttonsContainer.innerHTML = '';

        data.forEach(indicator => {
            const button = document.createElement('button');
            button.classList.add('layer-button');
            button.classList.add('glowing-button');
            button.dataset.indicatorId = indicator.indicator_id;
            button.textContent = indicator.name;

            button.addEventListener('click', () => {
                const indicatorId = parseInt(button.dataset.indicatorId, 10);
                if (!isNaN(indicatorId)) {
                    changeIndicator(indicatorId);
                    
                    // Update active button styling
                    document.querySelectorAll('.layer-button').forEach(btn => {
                        btn.classList.remove('active');
                    });
                    button.classList.add('active');
                } else {
                    console.error('Invalid indicator ID');
                }
            });

            buttonsContainer.appendChild(button);
        });
    })
    .catch(error => {
        console.error('Error fetching indicators:', error);
    });


// Set up event listeners for layer buttons
document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.querySelectorAll('.layer-button');

    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const indicatorId = parseInt(button.dataset.indicatorId, 10);
            if (!isNaN(indicatorId)) {
                changeIndicator(indicatorId);
            } else {
                console.error('Invalid indicator ID');
            }
        });
    });
});

/**
 * Update the current indicator display in the DOM
 */
function updateCurrentIndicator() {
    apiClient.get('/actions/get_global_variables/')
        .then(data => {
            const indicatorId = data.indicator_id;
            const indicatorElement = document.querySelector('.indicator');

            apiClient.get('/indicators', {})
                .then(indicators => {
                    const currentIndicator = indicators.find(indicator => indicator.indicator_id === indicatorId);
                    if (currentIndicator) {
                        indicatorElement.textContent = currentIndicator.name;
                        
                        // Update active button styling
                        document.querySelectorAll('.layer-button').forEach(btn => {
                            if (parseInt(btn.dataset.indicatorId, 10) === indicatorId) {
                                btn.classList.add('active');
                            } else {
                                btn.classList.remove('active');
                            }
                        });
                    } else {
                        indicatorElement.textContent = 'Unknown';
                    }
                })
                .catch(error => {
                    console.error('Error fetching indicators:', error);
                    indicatorElement.textContent = 'Error';
                });
        })
        .catch(error => {
            console.error('Error fetching global variables:', error);
        });
}

// Update the current indicator when the page loads and every second
document.addEventListener('DOMContentLoaded', () => {
    updateCurrentIndicator();
    setInterval(updateCurrentIndicator, 1000);
});


/**
 * Generate the state control buttons in the 'state-buttons-container'
 */
function generateStateButtons() {
    const stateButtonsContainer = document.querySelector('.state-buttons-container');
    stateButtonsContainer.innerHTML = '';

    for (let i = 1; i <= 7; i++) {
        const button = document.createElement('button');
        button.classList.add('state-button');
        button.classList.add('glowing-button');
        button.textContent = `State ${i}`;
        button.dataset.stateId = i;
        button.dataset.stateBin = 0

        button.addEventListener('click', () => {
            button.dataset.stateBin = button.dataset.stateBin === '0' ? '1' : '0';
            const currentState = Array.from(document.querySelectorAll('.state-button')).reduce((acc, button) => {
                const stateId = button.dataset.stateId;
                acc[stateId] = button.dataset.stateBin === '1' ? 1 : 0;
                return acc;
            }, {});
            console.log('Current state of buttons:', currentState);
            
            if(button.dataset.stateBin === '1') {
                button.classList.remove('glowing-button');
                button.classList.add('neon-button');
            }
            else {
                button.classList.remove('neon-button');
                button.classList.add('glowing-button');
            }

            if (currentState && typeof currentState === 'object' && Object.keys(currentState).length > 0) {
                changeState(currentState);
            } else {
                console.error('Invalid state data');
            }
        });

        stateButtonsContainer.appendChild(button);
    }
}

// Generate state buttons when the page loads
document.addEventListener('DOMContentLoaded', generateStateButtons);

/**
 * Generate the quick action buttons in the 'reset-buttons-container'
 */
function generateQuickActionButtons() {
    const resetButtonsContainer = document.querySelector('.reset-buttons-container');
    resetButtonsContainer.innerHTML = '';

    // Current state button
    const currentButton = document.createElement('button');
    currentButton.classList.add('reset-button');
    currentButton.classList.add('glowing-button');
    currentButton.textContent = `Current State`;

    currentButton.addEventListener('click', () => {
        const currentState = {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0};
        console.log('Setting current state:', currentState);
        
        // Update button states visually
        document.querySelectorAll('.state-button').forEach(btn => {
            btn.dataset.stateBin = '0';
            btn.classList.remove('neon-button');
            btn.classList.add('glowing-button');
        });
        
        if (currentState && typeof currentState === 'object' && Object.keys(currentState).length > 0) {
            changeState(currentState);
        } else {
            console.error('Invalid state data');
        }
    });

    resetButtonsContainer.appendChild(currentButton);
    
    // Future state button
    const futureButton = document.createElement('button');
    futureButton.classList.add('reset-button');
    futureButton.classList.add('glowing-button');
    futureButton.textContent = `Future State`;

    futureButton.addEventListener('click', () => {
        const futureState = {"1": 1, "2": 1, "3": 1, "4": 1, "5": 1, "6": 1, "7": 1};
        console.log('Setting future state:', futureState);
        
        // Update button states visually
        document.querySelectorAll('.state-button').forEach(btn => {
            btn.dataset.stateBin = '1';
            btn.classList.remove('glowing-button');
            btn.classList.add('neon-button');
        });
        
        if (futureState && typeof futureState === 'object' && Object.keys(futureState).length > 0) {
            changeState(futureState);
        } else {
            console.error('Invalid state data');
        }
    });

    resetButtonsContainer.appendChild(futureButton);
}

// Generate quick action buttons when the page loads
document.addEventListener('DOMContentLoaded', generateQuickActionButtons);