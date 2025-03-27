// scripts.js

/**
 * Server address with IP and port
 * Example: 'http://127.0.0.1:8000'
 */
const server_address = `http://localhost:9900`; // Updated to use localhost

/**
 * Clase para manejar interacciones con la API
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
                'X-CSRFToken': this.getCSRFToken(), // Añade el token CSRF
            },
            credentials: 'include', // Incluye cookies si es necesario
            body: JSON.stringify(data),
        })
        .then(response => {
            if (!response.ok) {
                return response.text().then(text => {
                    throw new Error(`Error en la petición: ${response.status} - ${text}`);
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
                'X-CSRFToken': this.getCSRFToken(), // Añade el token CSRF
            },
            credentials: 'include', // Incluye cookies si es necesario
        })
        .then(response => {
            if (!response.ok) {
                return response.text().then(text => {
                    throw new Error(`Error en la petición: ${response.status} - ${text}`);
                });
            }
            return response.json();
        });
    }
}

// Inicialización de la clase APIClient con la URL base
const apiClient = new APIClient(`${server_address}/api`);

/**
 * Cambia el layer enviando un POST request a la API con el indicator_id.
 * @param {number} indicator_id - El ID del indicador a enviar.
 */
function cambiarLayer(indicator_id) {
    const payload = { indicator_id: indicator_id };

    apiClient.post('/actions/set_current_indicator/', payload)
        .then(data => {
            console.log('Layer cambiado con éxito:', data);
        })
        .catch(error => {
            console.error('Error al cambiar el layer:', error);
        });
}

/**
 * Cambia el estado enviando un POST request a la API con el estado actual.
 * @param {Object.<string, number>} currentState - Un objeto donde las claves son IDs de estado (como string) y los valores son 0 o 1.
 */
function cambiarState(currentState) {
    const payload = { state: currentState };

    apiClient.post('/actions/set_current_state/', payload)
        .then(data => {
            console.log('Layer cambiado con éxito:', data);
        })
        .catch(error => {
            console.error('Error al cambiar el layer:', error);
        });
}

// Obtener los indicadores desde el servidor y actualizar los botones
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
                    cambiarLayer(indicatorId);
                } else {
                    console.error('Indicator ID no es válido');
                }
            });

            buttonsContainer.appendChild(button);
        });
    })
    .catch(error => {
        console.error('Error al obtener los indicadores:', error);
    });


// Event listeners para manejar clicks
document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.querySelectorAll('.layer-button');

    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const indicatorId = parseInt(button.dataset.indicatorId, 10);
            if (!isNaN(indicatorId)) {
                cambiarLayer(indicatorId);
            } else {
                console.error('Indicator ID no es válido');
            }
        });
    });
});

/**
 * Actualiza el indicador actual en el DOM.
 */
function actualizarIndicadorActual() {
    apiClient.get('/actions/get_global_variables/')
        .then(data => {
            const indicatorId = data.indicator_id;
            const indicatorElement = document.querySelector('.indicator');

            apiClient.get('/indicators', {})
                .then(indicators => {
                    const currentIndicator = indicators.find(indicator => indicator.indicator_id === indicatorId);
                    if (currentIndicator) {
                        indicatorElement.textContent = currentIndicator.name;
                    } else {
                        indicatorElement.textContent = 'Desconocido';
                    }
                })
                .catch(error => {
                    console.error('Error al obtener los indicadores:', error);
                    indicatorElement.textContent = 'Error';
                });
        })
        .catch(error => {
            console.error('Error al obtener las variables globales:', error);
        });
}

// Llamar a la función para actualizar el indicador actual al cargar la página y cada 1 segundo
document.addEventListener('DOMContentLoaded', () => {
    actualizarIndicadorActual();
    setInterval(actualizarIndicadorActual, 1000);
});


/**
 * Genera los 7 botones en el contenedor 'state-buttons-container'.
 */
function generarStateButtons() {
    const stateButtonsContainer = document.querySelector('.state-buttons-container');
    stateButtonsContainer.innerHTML = '';

    for (let i = 1; i <= 7; i++) {
        const button = document.createElement('button');
        button.classList.add('state-button');
        button.classList.add('glowing-button');
        button.textContent = `P-${i}`;
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
                cambiarState(currentState);
            } else {
                console.error('State ID no es válido');
            }
        });

        stateButtonsContainer.appendChild(button);
    }
}

// Llamar a la función para generar los botones de estado al cargar la página
document.addEventListener('DOMContentLoaded', generarStateButtons);

/**
 * Genera los 2 botones en el contenedor 'reset-buttons-container'.
 */
function generarResetButtons() {
    const stateButtonsContainer = document.querySelector('.reset-buttons-container');
    stateButtonsContainer.innerHTML = '';

    const button_actual = document.createElement('button');
    button_actual.classList.add('reset-button');
    button_actual.classList.add('glowing-button');
    button_actual.textContent = `ACTUAL`;

    button_actual.addEventListener('click', () => {
        currentState = {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0};
        console.log('Current state of buttons:', currentState);
        if (currentState && typeof currentState === 'object' && Object.keys(currentState).length > 0) {
            cambiarState(currentState);
        } else {
            console.error('State ID no es válido');
        }
    });

    stateButtonsContainer.appendChild(button_actual);
    
    const button_futuro = document.createElement('button');
    button_futuro.classList.add('reset-button');
    button_futuro.classList.add('glowing-button');
    button_futuro.textContent = `FUTURO`;

    button_futuro.addEventListener('click', () => {
        currentState = {"1": 1, "2": 1, "3": 1, "4": 1, "5": 1, "6": 1, "7": 1};
        console.log('Current state of buttons:', currentState);
        if (currentState && typeof currentState === 'object' && Object.keys(currentState).length > 0) {
            cambiarState(currentState);
        } else {
            console.error('State ID no es válido');
        }
    });

    stateButtonsContainer.appendChild(button_futuro);
}

// Llamar a la función para generar los botones de estado al cargar la página
document.addEventListener('DOMContentLoaded', generarResetButtons);