// CityScope Remote Controller script

/**
 * Server address configuration
 */
// Use relative URLs for API requests instead of hardcoded hostname and port
// This allows the controller to work correctly behind Nginx
const server_address = ``; // Empty string for relative URLs

/**
 * Global state tracking
 */
let currentIndicatorId = null;
let currentIndicatorCategory = null;
let currentClimateType = "utci"; // Track current climate type (utci or plan)
let currentClimateScenario = "existing"; // Track current climate scenario
let indicatorsCache = null; // Cache indicators to reduce API calls

/**
 * Climate scenario mapping
 */
const CLIMATE_SCENARIOS = {
  dense_highrise: "Dense Highrise",
  existing: "Existing",
  high_rises: "High Rises",
  lowrise: "Low Rise Dense",
  mass_tree_planting: "Mass Tree Planting",
  open_public_space: "Open Public Space",
  placemaking: "Placemaking",
};

/**
 * API Client class for managing interactions with the backend
 */
class APIClient {
  constructor(baseUrl) {
    // Use window.location.origin if baseUrl is empty
    this.baseUrl = baseUrl || window.location.origin;
  }

  getCSRFToken() {
    const cookies = document.cookie.split(";");
    for (let cookie of cookies) {
      const [name, value] = cookie.trim().split("=");
      if (name === "csrftoken") {
        return value;
      }
    }
    return null;
  }

  post(endpoint, data) {
    return fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": this.getCSRFToken(), // Add CSRF token
      },
      credentials: "include", // Include cookies if needed
      body: JSON.stringify(data),
    }).then((response) => {
      if (!response.ok) {
        return response.text().then((text) => {
          throw new Error(`Request error: ${response.status} - ${text}`);
        });
      }
      return response.json();
    });
  }

  get(endpoint, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const urlWithParams = queryString
      ? `${this.baseUrl}${endpoint}?${queryString}`
      : `${this.baseUrl}${endpoint}`;
    return fetch(urlWithParams, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": this.getCSRFToken(), // Add CSRF token
      },
      credentials: "include", // Include cookies if needed
    }).then((response) => {
      if (!response.ok) {
        return response.text().then((text) => {
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
 * @param {string} category - The category of the indicator (mobility or climate)
 */
function changeIndicator(indicatorId, category) {
  const payload = { indicator_id: indicatorId };

  apiClient
    .post("/actions/set_current_indicator/", payload)
    .then((data) => {
      console.log("Indicator changed successfully:", data);
      currentIndicatorId = indicatorId;
      currentIndicatorCategory = category;

      // If switching TO climate, reset to default climate state
      if (category === "climate") {
        currentClimateScenario = "existing";
        currentClimateType = "utci";
        console.log(
          `🔄 Initialized climate state: ${currentClimateScenario} (${currentClimateType})`
        );
      }

      // Regenerate state buttons and quick actions for the new indicator
      generateStateButtons();
      generateQuickActions();
    })
    .catch((error) => {
      console.error("Error changing indicator:", error);
    });
}

/**
 * Change the current climate scenario
 * @param {string} scenario - The scenario name (e.g., 'existing', 'dense_highrise')
 * @param {string} type - The type ('utci' or 'plan')
 */
function changeClimateScenario(scenario, type) {
  console.log(`🔄 Changing climate scenario: ${scenario} (${type})`);
  const payload = { scenario: scenario, type: type };

  apiClient
    .post("/actions/set_climate_scenario/", payload)
    .then((data) => {
      console.log("✓ Climate scenario changed successfully:", data);
      // Update local state
      currentClimateScenario = scenario;
      currentClimateType = type;

      // Trigger event for dashboard to update immediately
      window.dispatchEvent(new CustomEvent("climateStateChanged"));
    })
    .catch((error) => {
      console.error("❌ Error changing climate scenario:", error);
    });
}

/**
 * Change the current state by sending a POST request to the API
 * @param {number} stateId - The ID of the state to set
 */
function changeState(stateId) {
  console.log(`🔄 Changing state to ID: ${stateId}`);
  const payload = { state_id: stateId };

  apiClient
    .post("/actions/set_current_state/", payload)
    .then((data) => {
      console.log("✓ State changed successfully:", data);

      // Trigger event for dashboard to update
      window.dispatchEvent(new CustomEvent("stateChanged"));
    })
    .catch((error) => {
      console.error("❌ Error changing state:", error);
    });
}

/**
 * Change the visualization mode by sending a POST request to the API
 * @param {string} mode - The visualization mode to set (image or map)
 */
function changeVisualizationMode(mode) {
  console.log(`🔄 Changing visualization mode to: ${mode}`);
  const payload = { mode: mode };

  apiClient
    .post("/actions/set_visualization_mode/", payload)
    .then((data) => {
      console.log("✓ Visualization mode changed successfully:", data);

      // Trigger a refresh by dispatching a custom event
      window.dispatchEvent(
        new CustomEvent("visualizationModeChanged", { detail: { mode } })
      );
    })
    .catch((error) => {
      console.error("❌ Error changing visualization mode:", error);
    });
}

// Fetch indicators from the server and create buttons
apiClient
  .get("/indicators", {})
  .then((data) => {
    indicatorsCache = data; // Cache the indicators
    const buttonsContainer = document.querySelector(".buttons-container");
    buttonsContainer.innerHTML = "";

    // Only use the first 3 indicators as requested
    const limitedData = data.slice(0, 3);

    limitedData.forEach((indicator) => {
      const button = document.createElement("button");
      button.classList.add("layer-button");
      button.classList.add("glowing-button");
      button.dataset.indicatorId = indicator.indicator_id;
      button.dataset.category = indicator.category || "mobility";
      button.textContent = indicator.name.replace(" ", "");

      button.addEventListener("click", () => {
        const indicatorId = parseInt(button.dataset.indicatorId, 10);
        const category = button.dataset.category;
        if (!isNaN(indicatorId)) {
          changeIndicator(indicatorId, category);

          // Update active button styling
          document.querySelectorAll(".layer-button").forEach((btn) => {
            btn.classList.remove("active");
          });
          button.classList.add("active");
        } else {
          console.error("Invalid indicator ID");
        }
      });

      buttonsContainer.appendChild(button);
    });
  })
  .catch((error) => {
    console.error("Error fetching indicators:", error);
  });

/**
 * Update the current indicator display in the DOM
 * @param {boolean} shouldRegenerateButtons - Whether to regenerate state/action buttons
 * @returns {Promise} Promise that resolves when update is complete
 */
function updateCurrentIndicator(shouldRegenerateButtons = false) {
  return apiClient
    .get("/actions/get_global_variables/")
    .then((data) => {
      const indicatorId = data.indicator_id;
      const indicatorState = data.indicator_state || {};
      const visualizationMode = data.visualization_mode || "image";
      const indicatorElement = document.querySelector(".indicator");

      // Use cached indicators if available
      if (indicatorsCache) {
        const currentIndicator = indicatorsCache.find(
          (indicator) => indicator.indicator_id === indicatorId
        );
        if (currentIndicator) {
          indicatorElement.textContent = currentIndicator.name;

          // Track if category changed
          const categoryChanged =
            currentIndicatorCategory !== currentIndicator.category;

          // Update global state tracking
          currentIndicatorId = indicatorId;
          currentIndicatorCategory = currentIndicator.category || "mobility";

          // Sync state from backend based on category
          if (currentIndicator.category === "climate") {
            // For climate: sync scenario and type from backend
            if (
              indicatorState.scenario &&
              indicatorState.scenario in CLIMATE_SCENARIOS
            ) {
              currentClimateScenario = indicatorState.scenario;
              console.log(
                `📡 Synced climate scenario: ${currentClimateScenario}`
              );
            } else {
              // Reset to default if switching to climate or if scenario is invalid
              currentClimateScenario = "existing";
              console.log(
                `📡 Reset climate scenario to default: ${currentClimateScenario}`
              );
            }
            if (
              indicatorState.type &&
              (indicatorState.type === "utci" || indicatorState.type === "plan")
            ) {
              currentClimateType = indicatorState.type;
              console.log(`📡 Synced climate type: ${currentClimateType}`);
            } else {
              currentClimateType = "utci";
              console.log(
                `📡 Reset climate type to default: ${currentClimateType}`
              );
            }
          }

          // Update active button styling only
          document.querySelectorAll(".layer-button").forEach((btn) => {
            if (parseInt(btn.dataset.indicatorId, 10) === indicatorId) {
              btn.classList.add("active");
            } else {
              btn.classList.remove("active");
            }
          });

          // Regenerate buttons if requested or if category changed
          if (shouldRegenerateButtons || categoryChanged) {
            generateStateButtons();
            generateQuickActions();
          } else {
            // Even if not regenerating, update the active states
            updateButtonStates(indicatorState, visualizationMode);
          }
        } else {
          indicatorElement.textContent = "Unknown";
        }
      }
    })
    .catch((error) => {
      console.error("Error fetching global variables:", error);
    });
}

/**
 * Update button active states based on current backend state
 * @param {Object} indicatorState - Current indicator state from backend
 * @param {string} visualizationMode - Current visualization mode (image or map)
 */
function updateButtonStates(indicatorState, visualizationMode) {
  // Update state buttons based on current state
  if (currentIndicatorCategory === "climate") {
    // Highlight the active climate scenario button
    const activeScenario = indicatorState.scenario || "existing";
    document.querySelectorAll(".state-button").forEach((btn) => {
      if (btn.dataset.scenario === activeScenario) {
        btn.classList.remove("glowing-button");
        btn.classList.add("neon-button");
        btn.classList.add("active");
      } else {
        btn.classList.remove("neon-button");
        btn.classList.remove("active");
        btn.classList.add("glowing-button");
      }
    });

    // Highlight the active climate type button (utci or plan)
    const activeType = indicatorState.type || "utci";
    document.querySelectorAll(".config-button").forEach((btn) => {
      if (btn.dataset.configValue === activeType) {
        btn.classList.remove("glowing-button");
        btn.classList.add("neon-button");
        btn.classList.add("active");
      } else {
        btn.classList.remove("neon-button");
        btn.classList.remove("active");
        btn.classList.add("glowing-button");
      }
    });
  } else if (currentIndicatorCategory === "mobility") {
    // Highlight the active mobility state button (present or future)
    const activeScenario = indicatorState.scenario || "present";
    document.querySelectorAll(".state-button").forEach((btn) => {
      if (btn.dataset.scenario === activeScenario) {
        btn.classList.remove("glowing-button");
        btn.classList.add("neon-button");
        btn.classList.add("active");
      } else {
        btn.classList.remove("neon-button");
        btn.classList.remove("active");
        btn.classList.add("glowing-button");
      }
    });

    // Highlight the active visualization mode button (image or map)
    document.querySelectorAll(".config-button").forEach((btn) => {
      if (btn.dataset.configValue === visualizationMode) {
        btn.classList.remove("glowing-button");
        btn.classList.add("neon-button");
        btn.classList.add("active");
      } else {
        btn.classList.remove("neon-button");
        btn.classList.remove("active");
        btn.classList.add("glowing-button");
      }
    });
  }
}

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => {
  // Function to do initial setup once indicators are loaded
  const initializeRemoteController = () => {
    if (indicatorsCache) {
      console.log("✓ Indicators loaded, initializing remote controller");
      updateCurrentIndicator(true);
    } else {
      console.log("⏳ Waiting for indicators to load...");
      setTimeout(initializeRemoteController, 200);
    }
  };

  // Start initialization after a short delay
  setTimeout(initializeRemoteController, 300);

  // Update indicator display every second (but don't regenerate buttons unless category changed)
  setInterval(() => updateCurrentIndicator(false), 1000);

  // Listen for climate state changes from the dashboard
  window.addEventListener("climateStateChanged", () => {
    console.log(
      "🌡️ Remote controller received climate state change event from dashboard"
    );
    // Fetch updated state and update buttons
    updateCurrentIndicator(false);
  });

  // Listen for general indicator state changes from the dashboard
  window.addEventListener("indicatorStateChanged", () => {
    console.log(
      "📊 Remote controller received indicator state change event from dashboard"
    );
    // Fetch updated state and update buttons
    updateCurrentIndicator(false);
  });

  // Listen for visualization mode changes from the dashboard
  window.addEventListener("visualizationModeChanged", (event) => {
    console.log(
      "🗺️ Remote controller received visualization mode change event from dashboard"
    );
    // Fetch updated state and update buttons
    updateCurrentIndicator(false);
  });
});

/**
 * Fetch and display state buttons dynamically based on current indicator
 */
function generateStateButtons() {
  const stateButtonsContainer = document.querySelector(
    ".state-buttons-container"
  );
  stateButtonsContainer.innerHTML = "";

  if (!currentIndicatorCategory) {
    console.log(
      "⚠️ No indicator selected yet, skipping state buttons generation"
    );
    return;
  }

  console.log(`🔄 Generating state buttons for: ${currentIndicatorCategory}`);

  if (currentIndicatorCategory === "climate") {
    // For climate: show the 7 climate scenarios (not the 14 states)
    Object.keys(CLIMATE_SCENARIOS).forEach((scenarioKey) => {
      const button = document.createElement("button");
      button.classList.add("state-button");
      button.classList.add("glowing-button");
      button.dataset.scenario = scenarioKey;
      button.textContent = CLIMATE_SCENARIOS[scenarioKey];

      // Highlight if this matches current scenario
      if (scenarioKey === currentClimateScenario) {
        button.classList.remove("glowing-button");
        button.classList.add("neon-button");
        button.classList.add("active");
      }

      button.addEventListener("click", () => {
        console.log(
          `🌡️ Climate scenario clicked: ${scenarioKey} (type: ${currentClimateType})`
        );

        // Update active button styling
        document.querySelectorAll(".state-button").forEach((btn) => {
          btn.classList.remove("active");
          btn.classList.remove("neon-button");
          btn.classList.add("glowing-button");
        });

        button.classList.remove("glowing-button");
        button.classList.add("neon-button");
        button.classList.add("active");

        // Use the tracked current type
        changeClimateScenario(scenarioKey, currentClimateType);
      });

      stateButtonsContainer.appendChild(button);
    });

    // Fetch current state and update button highlighting (with slight delay to ensure DOM is ready)
    setTimeout(() => {
      apiClient
        .get("/actions/get_global_variables/")
        .then((data) => {
          const indicatorState = data.indicator_state || {};
          const visualizationMode = data.visualization_mode || "image";
          updateButtonStates(indicatorState, visualizationMode);
        })
        .catch((err) => {
          console.error("Error fetching state for button highlighting:", err);
        });
    }, 100);
  } else if (currentIndicatorCategory === "mobility") {
    // For mobility: show Present and Future
    const mobilityStates = [
      { key: "present", label: "Present" },
      { key: "future", label: "Future" },
    ];

    // Fetch current state first to know what to highlight
    apiClient
      .get("/actions/get_global_variables/")
      .then((data) => {
        const indicatorState = data.indicator_state || {};
        const currentScenario = indicatorState.scenario || "present";

        mobilityStates.forEach((state) => {
          const button = document.createElement("button");
          button.classList.add("state-button");
          button.classList.add("glowing-button");
          button.dataset.scenario = state.key;
          button.textContent = state.label;

          // Highlight if this matches current state
          if (state.key === currentScenario) {
            button.classList.remove("glowing-button");
            button.classList.add("neon-button");
            button.classList.add("active");
          }

          button.addEventListener("click", () => {
            console.log(`🚗 Mobility state clicked: ${state.key}`);

            // Update active button styling
            document.querySelectorAll(".state-button").forEach((btn) => {
              btn.classList.remove("active");
              btn.classList.remove("neon-button");
              btn.classList.add("glowing-button");
            });

            button.classList.remove("glowing-button");
            button.classList.add("neon-button");
            button.classList.add("active");

            // Find the state ID for this scenario
            apiClient
              .get("/states", {})
              .then((states) => {
                console.log(`📋 States from API:`, states);
                const targetState = states.find(
                  (s) => s.state_values && s.state_values.scenario === state.key
                );
                if (targetState) {
                  console.log(`✓ Found state for ${state.key}:`, targetState);
                  changeState(targetState.id);
                } else {
                  console.error(
                    `❌ State not found for ${state.key}. Available states:`,
                    states.map((s) => ({
                      id: s.id,
                      scenario: s.state_values?.scenario,
                      label: s.state_values?.label,
                    }))
                  );
                }
              })
              .catch((error) => {
                console.error("❌ Error fetching states:", error);
              });
          });

          stateButtonsContainer.appendChild(button);
        });

        // Fetch current state and update button highlighting (with slight delay to ensure DOM is ready)
        setTimeout(() => {
          apiClient
            .get("/actions/get_global_variables/")
            .then((data) => {
              const indicatorState = data.indicator_state || {};
              const visualizationMode = data.visualization_mode || "image";
              updateButtonStates(indicatorState, visualizationMode);
            })
            .catch((err) => {
              console.error(
                "Error fetching state for button highlighting:",
                err
              );
            });
        }, 100);
      })
      .catch((err) => {
        console.error("Error fetching state for mobility buttons:", err);
      });
  }
}

/**
 * Generate quick action buttons dynamically based on current indicator
 */
function generateQuickActions() {
  const configContainer = document.querySelector(".reset-buttons-container");
  configContainer.innerHTML = "";

  if (!currentIndicatorCategory) {
    console.log(
      "⚠️ No indicator selected yet, skipping quick actions generation"
    );
    return;
  }

  console.log(`🔄 Generating quick actions for: ${currentIndicatorCategory}`);

  if (currentIndicatorCategory === "climate") {
    // For climate: toggle between UTCI and Plan
    const climateTypes = [
      { name: "UTCI", value: "utci" },
      { name: "Plan", value: "plan" },
    ];

    climateTypes.forEach((type) => {
      const button = document.createElement("button");
      button.classList.add("config-button");
      button.classList.add("glowing-button");
      button.dataset.configValue = type.value;
      button.textContent = type.name;

      // Highlight if this matches current type
      if (type.value === currentClimateType) {
        button.classList.remove("glowing-button");
        button.classList.add("neon-button");
        button.classList.add("active");
      }

      button.addEventListener("click", () => {
        console.log(
          `🌡️ Climate type toggle clicked: ${type.value} (scenario: ${currentClimateScenario})`
        );

        // Update active button styling
        document.querySelectorAll(".config-button").forEach((btn) => {
          btn.classList.remove("active");
          btn.classList.remove("neon-button");
          btn.classList.add("glowing-button");
        });

        button.classList.remove("glowing-button");
        button.classList.add("neon-button");
        button.classList.add("active");

        // Use the tracked current scenario
        changeClimateScenario(currentClimateScenario, type.value);
      });

      configContainer.appendChild(button);
    });

    // Fetch current state and update button highlighting
    apiClient
      .get("/actions/get_global_variables/")
      .then((data) => {
        const indicatorState = data.indicator_state || {};
        const visualizationMode = data.visualization_mode || "image";
        updateButtonStates(indicatorState, visualizationMode);
      })
      .catch((err) => {
        console.error("Error fetching state for button highlighting:", err);
      });
  } else if (currentIndicatorCategory === "mobility") {
    // For mobility: toggle between Image and Map (static vs interactive)
    const mobilityModes = [
      { name: "Static Image", value: "image" },
      { name: "Interactive Map", value: "map" },
    ];

    // Fetch current visualization mode first
    apiClient
      .get("/actions/get_global_variables/")
      .then((data) => {
        const visualizationMode = data.visualization_mode || "image";

        mobilityModes.forEach((mode) => {
          const button = document.createElement("button");
          button.classList.add("config-button");
          button.classList.add("glowing-button");
          button.dataset.configValue = mode.value;
          button.textContent = mode.name;

          // Highlight if this matches current mode
          if (mode.value === visualizationMode) {
            button.classList.remove("glowing-button");
            button.classList.add("neon-button");
            button.classList.add("active");
          }

          button.addEventListener("click", () => {
            console.log(
              `🗺️ Mobility visualization mode clicked: ${mode.value}`
            );

            // Update active button styling
            document.querySelectorAll(".config-button").forEach((btn) => {
              btn.classList.remove("active");
              btn.classList.remove("neon-button");
              btn.classList.add("glowing-button");
            });

            button.classList.remove("glowing-button");
            button.classList.add("neon-button");
            button.classList.add("active");

            // Call the API to change the visualization mode
            changeVisualizationMode(mode.value);
          });

          configContainer.appendChild(button);
        });

        // Fetch current state and update button highlighting (with slight delay to ensure DOM is ready)
        setTimeout(() => {
          apiClient
            .get("/actions/get_global_variables/")
            .then((data) => {
              const indicatorState = data.indicator_state || {};
              const visualizationMode = data.visualization_mode || "image";
              updateButtonStates(indicatorState, visualizationMode);
            })
            .catch((err) => {
              console.error(
                "Error fetching state for button highlighting:",
                err
              );
            });
        }, 100);
      })
      .catch((err) => {
        console.error("Error fetching state for mobility mode buttons:", err);
      });
  }
}
