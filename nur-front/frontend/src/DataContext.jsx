import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import api from "./api"; // Import the pre-configured api instance
import isEqual from "lodash/isEqual";

import config from "./config";
import globals from "./globals";

const DataContext = createContext();

// Define indicator configurations for easy addition of new indicators
const INDICATOR_CONFIG = {
  mobility: {
    id: 1,
    name: "Mobility Dashboard",
    metrics: [
      "public_transport_coverage",
      "average_commute_time",
      "bike_lane_coverage",
    ],
    tabLabels: [
      "Trips Over Time",
      "Mode Split by Destination",
      "Distance Distribution",
    ],
    pieChartLabels: ["Public Transport Coverage", "No Coverage"],
  },
  climate: {
    id: 2,
    name: "Climate Dashboard",
    metrics: [
      "air_quality_index",
      "carbon_emissions",
      "renewable_energy_percentage",
      "green_space_percentage",
    ],
    tabLabels: ["Emissions", "Green Space", "Radar Analysis", "Sustainability"],
    pieChartLabels: ["Green Space", "Other"],
  },
  // Add new indicators here following the same pattern
};

// Climate scenarios configuration
const CLIMATE_SCENARIOS = {
  dense_highrise: "Dense Highrise",
  existing: "Existing",
  high_rises: "High Rises",
  lowrise: "Low Rise Dense",
  mass_tree_planting: "Mass Tree Planting",
  open_public_space: "Open Public Space",
  placemaking: "Placemaking",
};

const STATE_CONFIG = {
  mobility: ["Present", "Survey"],
  climate: Object.values(CLIMATE_SCENARIOS),
};

// Reverse mapping from ID to indicator type
const ID_TO_INDICATOR = Object.fromEntries(
  Object.entries(INDICATOR_CONFIG).map(([key, config]) => [config.id, key])
);

// Helper to get initial indicator from URL
const getInitialIndicator = () => {
  if (typeof window !== "undefined") {
    const match = window.location.pathname.match(
      /dashboard\/(mobility|climate|land_use)/
    );
    if (match) return match[1];
  }
  return "mobility";
};

export const DataProvider = ({ children }) => {
  // Store the current indicator type (mobility, climate, land_use)
  const [currentIndicator, setCurrentIndicator] = useState(
    getInitialIndicator()
  );

  // Store the dashboard data for the current indicator
  const [dashboardData, setDashboardData] = useState(null);

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  // presentation mode state
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // Use refs to prevent unnecessary re-renders during frequent polling
  const defaultInd = Object.keys(INDICATOR_CONFIG)[0];
  const defaultSt = STATE_CONFIG[defaultInd]?.[0];
  const [presentationSequence, setPresentationSequence] = useState([
    { indicator: defaultInd, state: defaultSt }
  ]);

  const [sequenceIndex, setSequenceIndex] = useState(0);
  const [globalDuration, setGlobalDuration] = useState(10);

  const presentationTimerRef = useRef(null);
  const indicatorRef = useRef(currentIndicator);
  const lastCheckedRef = useRef(Date.now());
  const debounceTimerRef = useRef(null);
  const [visualizationMode, setVisualizationMode] = useState("deck");
  const visualizationModeRef = useRef(visualizationMode);

  const [prevIndicator, setPrevIndicator] = useState(null);
  const [prevVisualizationMode, setPrevVisualizationMode] = useState(null);
  

  // Update refs when state changes
  useEffect(() => {
    indicatorRef.current = currentIndicator;
  }, [currentIndicator]);

  useEffect(() => {
    visualizationModeRef.current = visualizationMode;
  }, [visualizationMode]);

  // Function to initialize dashboard data
  // Note: Chart data is loaded directly from CSV files in the components (MobilityGraphs, ClimateGraphs)
  // This function just sets up the basic state
  const fetchDashboardData = useCallback(
    async (indicator) => {
      if (!indicator) return;

      try {
        // Only show loading on initial load
        const isInitialLoad = !dashboardData;
        if (isInitialLoad) {
          setLoading(true);
        }

        // For now, we just set a minimal data structure
        // The actual chart data is loaded from CSV files in the individual graph components
        const transformedData = {
          indicator: indicator,
          // Metrics can be loaded from CSV or set as placeholders
          metrics: {},
        };

        if (!dashboardData || !isEqual(dashboardData, transformedData)) {
          setDashboardData(transformedData);
          setLastUpdate(new Date().toLocaleString());
        }

        setError(null);
        setLoading(false);
      } catch (err) {
        console.error(`Error initializing ${indicator} dashboard:`, err);
        setError(err.message);
        setLoading(false);
      }
    },
    [dashboardData, loading]
  );

  const handleVisualizationModeChange = useCallback((event, newMode) => {
    if (newMode !== null) {
      setVisualizationMode(newMode);

      // Update the backend visualization mode
      const backendMode = newMode === "deck" ? "map" : "image";
      api
        .post("/api/actions/set_visualization_mode/", {
          mode: backendMode,
        })
        .then(() => {
          // Trigger event for remote controller to update
          window.dispatchEvent(
            new CustomEvent("visualizationModeChanged", {
              detail: { mode: backendMode },
            })
          );
        })
        .catch((err) => {
          console.error("Error setting visualization mode:", err);
        });
    }
  }, []);

  // Track previous climate state to detect changes
  const prevClimateStateRef = useRef({ scenario: null, type: null });

  // Track previous indicator state for all indicators to detect changes
  const prevIndicatorStateRef = useRef(null);

  // Check for remote controller changes with debouncing to reduce flickering
  const checkRemoteChanges = useCallback(async () => {
    // Limit API calls to prevent overloading
    const now = Date.now();
    if (now - lastCheckedRef.current < 150) return; // Minimum interval between checks
    lastCheckedRef.current = now;

    try {
      const response = await api.get("/api/actions/get_global_variables/");
      if (response.data) {
        // Update our local globals to match server
        if (response.data.indicator_state) {
          globals.INDICATOR_STATE = response.data.indicator_state;
        }

        // Handle visualization mode changes from remote controller
        if (response.data.visualization_mode) {
          globals.VISUALIZATION_MODE = response.data.visualization_mode;

          // Update local state if different from current
          const newMode =
            response.data.visualization_mode === "map" ? "deck" : "image";
          if (newMode !== visualizationModeRef.current) {
            console.log(
              `Remote controller changed visualization mode to: ${newMode}`
            );
            setVisualizationMode(newMode);
          }
        }

        // Handle indicator changes
        if (response.data.indicator_id !== undefined) {
          globals.INDICATOR_ID = response.data.indicator_id;

          // Convert indicator_id to number if it's a string
          const indicatorId = parseInt(response.data.indicator_id, 10);
          const newIndicator = ID_TO_INDICATOR[indicatorId];

          if (newIndicator && newIndicator !== indicatorRef.current) {
            console.log(
              `Remote controller changed indicator to: ${newIndicator}`
            );

            // Clear any pending timer to prevent race conditions
            if (debounceTimerRef.current) {
              clearTimeout(debounceTimerRef.current);
            }

            // Update state after a small delay to allow the previous operations to complete
            debounceTimerRef.current = setTimeout(() => {
              // Set loading state before changing the indicator to prevent flickering
              setLoading(true);

              // Update the indicator
              setCurrentIndicator(newIndicator);

              // Give a small delay before allowing new data fetches to complete the transition
              setTimeout(() => {
                setLoading(false);
              }, 500);
            }, 100);
          }
        }

        // Check for climate state changes (scenario or type) - this should happen regardless of indicator change
        // Only check if we're currently on the climate indicator
        if (
          indicatorRef.current === "climate" &&
          response.data.indicator_state
        ) {
          const currentScenario = response.data.indicator_state.scenario;
          const currentType = response.data.indicator_state.type;
          const prevScenario = prevClimateStateRef.current.scenario;
          const prevType = prevClimateStateRef.current.type;

          // Detect if scenario or type changed
          if (
            (currentScenario && currentScenario !== prevScenario) ||
            (currentType && currentType !== prevType)
          ) {
            console.log(
              `🌡️ Climate state changed: ${prevScenario}(${prevType}) → ${currentScenario}(${currentType})`
            );

            // Update tracked state
            prevClimateStateRef.current = {
              scenario: currentScenario,
              type: currentType,
            };

            // Trigger the climateStateChanged event
            window.dispatchEvent(new CustomEvent("climateStateChanged"));
          } else if (!prevScenario && currentScenario) {
            // Initial state setup
            prevClimateStateRef.current = {
              scenario: currentScenario,
              type: currentType,
            };
          }
        }

        // Check for general indicator state changes (for mobility and other indicators)
        // This handles state changes like mobility Present/Survey
        if (
          indicatorRef.current !== "climate" &&
          response.data.indicator_state
        ) {
          const currentStateStr = JSON.stringify(response.data.indicator_state);
          const prevStateStr = prevIndicatorStateRef.current;

          if (prevStateStr && currentStateStr !== prevStateStr) {
            console.log(
              `📊 Indicator state changed for ${indicatorRef.current}: ${prevStateStr} → ${currentStateStr}`
            );

            // Update tracked state
            prevIndicatorStateRef.current = currentStateStr;

            // Trigger a general state change event
            window.dispatchEvent(new CustomEvent("indicatorStateChanged"));
            // Also trigger the stateChanged event for compatibility with remote controller
            window.dispatchEvent(new CustomEvent("stateChanged"));
          } else if (!prevStateStr) {
            // Initial state setup
            prevIndicatorStateRef.current = currentStateStr;
          }
        }
      }
    } catch (err) {
      console.error("Error checking remote changes:", err);
    }
  }, []);

  // Initialize data and polling
  useEffect(() => {
    let isMounted = true;
    let checkIntervalId;
    // Capture the current timer ID to avoid cleanup issues
    const currentTimerRef = debounceTimerRef.current;

    const initData = async () => {
      if (isMounted) {
        try {
          // Initialize basic dashboard state
          await fetchDashboardData(currentIndicator);
        } catch (err) {
          console.error("Error in initial data setup:", err);
        }

        // Set up polling for remote controller changes only
        // (Chart data is loaded from CSV files in components, no polling needed)
        checkIntervalId = setInterval(() => {
          if (isMounted) {
            checkRemoteChanges();
          }
        }, 200); // Poll every 200ms for remote controller responsiveness
      }
    };

    initData();

    return () => {
      isMounted = false;
      clearInterval(checkIntervalId);
      // Clear the timer that was active when this effect ran
      if (currentTimerRef) {
        clearTimeout(currentTimerRef);
      }
    };
  }, [currentIndicator, fetchDashboardData, checkRemoteChanges]);

  // Function to change state (climate scenario or mobility state)
  const changeState = useCallback(
    async (stateName) => {
      if (currentIndicator === "climate") {
        // Find the scenario key from the display name
        const scenarioKey = Object.entries(CLIMATE_SCENARIOS).find(
          ([key, displayName]) => displayName === stateName
        )?.[0];

        if (scenarioKey) {
          try {
            // Get current visualization type (default to 'utci')
            const currentType = globals.INDICATOR_STATE?.type || "utci";

            await api.post("/api/actions/set_climate_scenario/", {
              scenario: scenarioKey,
              type: currentType,
            });
            console.log(
              `✓ Changed climate state to ${stateName} (${scenarioKey})`
            );

            // Update local globals
            globals.INDICATOR_STATE = {
              scenario: scenarioKey,
              type: currentType,
              label: `${stateName} - ${currentType.toUpperCase()}`,
            };

            // Trigger a custom event to notify Dashboard of the change
            window.dispatchEvent(new CustomEvent("climateStateChanged"));
          } catch (error) {
            console.error("Error changing climate state:", error);
          }
        }
      } else if (currentIndicator === "mobility") {
        // Handle mobility states (Present/Survey)
        const scenarioKey = stateName.toLowerCase(); // "Present" -> "present", "Survey" -> "survey"

        try {
          // Get the state ID from the backend
          const response = await api.get("/api/states/");
          const targetState = response.data.find(
            (s) => s.state_values && s.state_values.scenario === scenarioKey
          );

          if (targetState) {
            console.log(`✓ Found state for ${scenarioKey}:`, targetState);

            // Send the state change request
            await api.post("/api/actions/set_current_state/", {
              state_id: targetState.id,
            });

            console.log(
              `✓ Changed mobility state to ${stateName} (${scenarioKey})`
            );

            // Update local globals
            globals.INDICATOR_STATE = {
              year: 2023,
              scenario: scenarioKey,
              label: stateName,
            };

            // Trigger events to notify components of the change
            window.dispatchEvent(new CustomEvent("indicatorStateChanged"));
            window.dispatchEvent(new CustomEvent("stateChanged"));
          } else {
            console.error(`❌ State not found for ${scenarioKey}`);
          }
        } catch (error) {
          console.error("Error changing mobility state:", error);
        }
      }
    },
    [currentIndicator]
  );

  // Function to switch indicators
  const changeIndicator = useCallback(
    (newIndicator) => {
      if (
        newIndicator !== currentIndicator &&
        Object.keys(INDICATOR_CONFIG).includes(newIndicator)
      ) {
        console.log(`Changing indicator to: ${newIndicator}`);

        // Set loading state first to prevent flickering
        setLoading(true);

        // Clear existing dashboard data to prevent showing stale data
        setDashboardData(null);

        // Set the indicator locally
        setCurrentIndicator(newIndicator);

        // Update the remote controller by sending the change to the API
        const indicatorId = INDICATOR_CONFIG[newIndicator]?.id;
        if (indicatorId) {
          // Send the change to the API
          api
            .post("/api/actions/set_current_indicator/", {
              indicator_id: indicatorId,
            })
            .then(() => {
              console.log(
                `Updated remote controller to ${newIndicator} (ID: ${indicatorId})`
              );

              // Trigger a data fetch for the new indicator
              fetchDashboardData(newIndicator);

              // Give the system time to complete the transition before clearing loading state
              setTimeout(() => {
                setLoading(false);
              }, 500);
            })
            .catch((err) => {
              console.error("Error updating remote controller:", err);
              setLoading(false);
            });
        } else {
          // Even if we can't update the remote, we should fetch data for the new indicator
          fetchDashboardData(newIndicator);
          setTimeout(() => {
            setLoading(false);
          }, 500);
        }
      }
    },
    [currentIndicator, fetchDashboardData]
  );

    // presentation timer logic
    useEffect(() => {
      if (presentationTimerRef.current) {
          clearTimeout(presentationTimerRef.current);
          presentationTimerRef.current = null;
      }
  
      if (isPresentationMode && isPlaying && presentationSequence.length > 0) {
          const currentStep = presentationSequence[sequenceIndex];
          
          console.log(`[Presentation] Playing Step ${sequenceIndex + 1}/${presentationSequence.length}:`, currentStep);
  
          if (currentStep.indicator !== indicatorRef.current) { 
              changeIndicator(currentStep.indicator);
          }
          
          setTimeout(() => {
              changeState(currentStep.state);
          }, 500);
  
          const durationMs = globalDuration * 1000;
          presentationTimerRef.current = setTimeout(() => {
              setSequenceIndex((prevIndex) => (prevIndex + 1) % presentationSequence.length);
          }, durationMs);
      }
  
      return () => {
          if (presentationTimerRef.current) {
              clearTimeout(presentationTimerRef.current);
          }
      };
    }, [
        isPresentationMode, 
        isPlaying, 
        sequenceIndex, 
        presentationSequence, 
        globalDuration, 
        changeIndicator, 
        changeState 
    ]);
  
    const togglePresentationMode = useCallback((isEntering) => {
        if (isEntering) {
            console.log("✓ Starting Presentation Mode");
            // Save current state
            setPrevIndicator(indicatorRef.current);
            setPrevVisualizationMode(visualizationModeRef.current);
            
            setSequenceIndex(0);
            
            // Force 'image' mode for presentation
            if (visualizationModeRef.current !== 'image') {
                 handleVisualizationModeChange(null, 'image');
            }
  
            setIsPresentationMode(true);
            // Auto-start playing when entering presentation mode
            setIsPlaying(true);
        } else {
            console.log("✓ Stopping Presentation Mode");
            setIsPlaying(false);
            setIsPresentationMode(false);
            
            // Restore state
            setTimeout(() => {
                if (prevIndicator) changeIndicator(prevIndicator);
                if (prevVisualizationMode) handleVisualizationModeChange(null, prevVisualizationMode);
            }, 100);
        }
    }, [prevIndicator, prevVisualizationMode, changeIndicator, handleVisualizationModeChange]);
  
    const skipToNextStep = useCallback(() => {
      if (presentationTimerRef.current) {
          clearTimeout(presentationTimerRef.current);
          presentationTimerRef.current = null;
      }
      
      // Update the sequence index to the next step (including looping)
      setSequenceIndex((prevIndex) => {
          if (!presentationSequence || presentationSequence.length === 0) return 0;
          return (prevIndex + 1) % presentationSequence.length;
      });
  }, [presentationSequence]);

    const skipToPrevStep = useCallback(() => {
      if (presentationTimerRef.current) {
          clearTimeout(presentationTimerRef.current);
          presentationTimerRef.current = null;
      }
      
      // Update the sequence index to the previous step (including looping)
      setSequenceIndex((prevIndex) => {
          if (!presentationSequence || presentationSequence.length === 0) return 0;
          return (prevIndex - 1 + presentationSequence.length) % presentationSequence.length;
      });
  }, [presentationSequence]);
  

  // Value object with additional helpers for the new indicator system
  const contextValue = {
    dashboardData,
    currentIndicator,
    changeIndicator,
    changeState,
    loading,
    error,
    StateConfig: STATE_CONFIG,
    ClimateScenarios: CLIMATE_SCENARIOS,
    lastUpdate,
    indicatorConfig: INDICATOR_CONFIG,
    // Helper methods for getting indicator-specific information
    getIndicatorTitle: () =>
      INDICATOR_CONFIG[currentIndicator]?.name || "Dashboard",
    getTabLabels: () =>
      INDICATOR_CONFIG[currentIndicator]?.tabLabels || [
        "Tab 1",
        "Tab 2",
        "Tab 3",
        "Tab 4",
      ],
    visualizationMode,
    handleVisualizationModeChange,
    isPresentationMode, 
    togglePresentationMode, 
    presentationSequence, 
    setPresentationSequence,
    isPlaying, 
    setIsPlaying, 
    sequenceIndex, 
    setSequenceIndex,
    globalDuration, 
    setGlobalDuration,
    skipToNextStep,
    skipToPrevStep
  };

  return (
    <DataContext.Provider value={contextValue}>{children}</DataContext.Provider>
  );
};

export const useAppData = () => {
  return useContext(DataContext);
};
