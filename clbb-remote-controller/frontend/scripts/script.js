// CityScope Remote Controller script

/**
 * Server address configuration
 */
// Use relative URLs for API requests instead of hardcoded hostname and port
// This allows the controller to work correctly behind Nginx
const server_address = ``;  // Empty string for relative URLs

/**
 * API Client class for managing interactions with the backend
 */
class APIClient {
    constructor(baseUrl) {
        // Use window.location.origin if baseUrl is empty
        this.baseUrl = baseUrl || window.location.origin;
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
 * @param {number} stateId - The ID of the state to set
 */
function changeState(stateId) {
    const payload = { state_id: stateId };

    apiClient.post('/actions/set_current_state/', payload)
        .then(data => {
            console.log('State changed successfully:', data);
        })
        .catch(error => {
            console.error('Error changing state:', error);
        });
}

/**
 * Change the visualization mode by sending a POST request to the API
 * @param {string} mode - The visualization mode to set (image or map)
 */
function changeVisualizationMode(mode) {
    const payload = { mode: mode };

    apiClient.post('/actions/set_visualization_mode/', payload)
        .then(data => {
            console.log('Visualization mode changed successfully:', data);
        })
        .catch(error => {
            console.error('Error changing visualization mode:', error);
        });
}

// Fetch indicators from the server and create buttons
apiClient.get('/indicators', {})
    .then(data => {
        const buttonsContainer = document.querySelector('.buttons-container');
        buttonsContainer.innerHTML = '';

        // Only use the first 3 indicators as requested
        const limitedData = data.slice(0, 3);

        limitedData.forEach(indicator => {
            const button = document.createElement('button');
            button.classList.add('layer-button');
            button.classList.add('glowing-button');
            button.dataset.indicatorId = indicator.indicator_id;
            button.textContent = indicator.name.replace('[SAMPLE] ', '');

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
 * Fetch and display state buttons
 */
function generateStateButtons() {
    // Get the states container
    const stateButtonsContainer = document.querySelector('.state-buttons-container');
    stateButtonsContainer.innerHTML = '';

    // Fetch states from the API
    apiClient.get('/states', {})
        .then(states => {
            // Create a button for each state
            states.forEach(state => {
                const button = document.createElement('button');
                button.classList.add('state-button');
                button.classList.add('glowing-button');
                button.dataset.stateId = state.id;
                
                // Display a more user-friendly label
                const yearLabel = state.state_values.year;
                button.textContent = state.state_values.label.replace('[SAMPLE] ', '');
                
                button.addEventListener('click', () => {
                    // Update active button styling
                    document.querySelectorAll('.state-button').forEach(btn => {
                        btn.classList.remove('active');
                        btn.classList.remove('neon-button');
                        btn.classList.add('glowing-button');
                    });
                    
                    button.classList.remove('glowing-button');
                    button.classList.add('neon-button');
                    button.classList.add('active');
                    
                    // Call the API to change the state
                    changeState(state.id);
                });
                
                stateButtonsContainer.appendChild(button);
            });
        })
        .catch(error => {
            console.error('Error fetching states:', error);
        });
}

// Generate state buttons when the page loads
document.addEventListener('DOMContentLoaded', generateStateButtons);

/**
 * Generate configuration buttons for visualization modes
 */
function generateConfigButtons() {
    const configContainer = document.querySelector('.reset-buttons-container');
    configContainer.innerHTML = '';

    // Define configuration options
    const configs = [
        { name: "Image View", value: "image" },
        { name: "Map View", value: "map" }
    ];

    // Create buttons for each configuration
    configs.forEach(config => {
        const button = document.createElement('button');
        button.classList.add('config-button');
        button.classList.add('glowing-button');
        button.dataset.configValue = config.value;
        button.textContent = config.name;

        button.addEventListener('click', () => {
            // Update active button styling
            document.querySelectorAll('.config-button').forEach(btn => {
                btn.classList.remove('active');
                btn.classList.remove('neon-button');
                btn.classList.add('glowing-button');
            });
            
            button.classList.remove('glowing-button');
            button.classList.add('neon-button');
            button.classList.add('active');
            
            // In a real implementation, this would call an API to change the view mode
            console.log(`Configuration changed to: ${config.value}`);
        });

        configContainer.appendChild(button);
    });
}

// Generate configuration buttons when the page loads
document.addEventListener('DOMContentLoaded', generateConfigButtons);