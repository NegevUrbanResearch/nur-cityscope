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
import { logErrorToBackend } from "./utils/errorLogger";

import config from "./config";
import globals from "./globals";

const DataContext = createContext();

// Default table name for indicators
const DEFAULT_TABLE = "idistrict";

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

const APP_ROUTES_CONFIG = {
  default:{displayName:"Default", url:"http://localhost/dashboard/mobility"},
 // app_a: {displayName:"App A", url:"http://localhost/dashboard/mobility"},
}

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
  // Store the current table name (idistrict, otef, etc.)
  const [currentTable, setCurrentTable] = useState(DEFAULT_TABLE);
  const [availableTables, setAvailableTables] = useState([]);

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
  
  // user upload pause mode state
  const [activeUserUpload, setActiveUserUpload] = useState(null); // { id, imageUrl, displayName, categoryName, isPermanent }
  const [pausedIndicatorState, setPausedIndicatorState] = useState(null); // Store state before pause to restore later

  // Use refs to prevent unnecessary re-renders during frequent polling
  // Start with empty sequence - user must add slides manually
  const [presentationSequence, setPresentationSequenceInternal] = useState([]);
  
  // Wrapper to sync sequence with backend when changed
  const setPresentationSequence = useCallback((newSequence) => {
    setPresentationSequenceInternal(newSequence);
    presentationSequenceRef.current = newSequence;
    // Sync sequence to backend if in presentation mode
    if (isPresentationModeRef.current) {
      setTimeout(() => {
        api.post("/api/actions/set_presentation_state/", {
          sequence: newSequence
        }).then(() => {
          console.log(`✓ Synced sequence to backend: ${newSequence.length} slides`);
        }).catch(err => console.error("Error syncing sequence:", err));
      }, 0);
    }
    // Sync with backend if in presentation mode
    if (isPresentationModeRef.current) {
      api.post("/api/actions/set_presentation_state/", { 
        sequence: newSequence 
      }).catch(err => console.error("Error syncing sequence:", err));
    }
  }, []);

  const [sequenceIndex, setSequenceIndexInternal] = useState(0);
  const [globalDuration, setGlobalDurationInternal] = useState(10);
  
  // Wrapper to sync sequence index with backend
  const setSequenceIndex = useCallback((newIndexOrFn) => {
    setSequenceIndexInternal((prev) => {
      const newIndex = typeof newIndexOrFn === 'function' ? newIndexOrFn(prev) : newIndexOrFn;
      // Sync with backend if in presentation mode - use async to ensure it happens
      if (isPresentationModeRef.current) {
        // Use setTimeout to ensure state update happens first, then sync
        setTimeout(() => {
          api.post("/api/actions/set_presentation_state/", { 
            sequence_index: newIndex 
          }).then(() => {
            console.log(`✓ Synced sequence index to backend: ${newIndex}`);
          }).catch(err => console.error("Error syncing index:", err));
        }, 0);
      }
      return newIndex;
    });
  }, []);
  
  // Wrapper to sync duration with backend
  const setGlobalDuration = useCallback((newDuration) => {
    setGlobalDurationInternal(newDuration);
    globalDurationRef.current = newDuration;
    // Sync with backend if in presentation mode
    if (isPresentationModeRef.current) {
      setTimeout(() => {
        api.post("/api/actions/set_presentation_state/", { 
          duration: newDuration 
        }).then(() => {
          console.log(`✓ Synced duration to backend: ${newDuration}s`);
        }).catch(err => console.error("Error syncing duration:", err));
      }, 0);
    }
  }, []);

  const presentationTimerRef = useRef(null);
  const indicatorRef = useRef(currentIndicator);
  const lastCheckedRef = useRef(Date.now());
  const debounceTimerRef = useRef(null);
  const indicatorChangeInProgressRef = useRef(null); // Track ongoing indicator changes to ignore stale WebSocket updates
  const [visualizationMode, setVisualizationMode] = useState("image");
  const visualizationModeRef = useRef(visualizationMode);
  const isPresentationModeRef = useRef(isPresentationMode);
  const isPlayingRef = useRef(isPlaying);
  const presentationSequenceRef = useRef(presentationSequence);
  const globalDurationRef = useRef(globalDuration);

  const [prevIndicator, setPrevIndicator] = useState(null);
  const [prevVisualizationMode, setPrevVisualizationMode] = useState(null);
  
  // Refs for functions to avoid circular dependencies
  const changeIndicatorRef = useRef(null);
  const handleVisualizationModeChangeRef = useRef(null);
  
  // WebSocket connection ref
  const wsRef = useRef(null);
  const wsReconnectTimeoutRef = useRef(null);
  const wsConnectedRef = useRef(false); // Track WebSocket connection state
  const lastWsUpdateRef = useRef(0); // Track last WebSocket update timestamp
  
  // Track active user upload ID in ref to avoid circular dependency in effects
  const activeUserUploadRef = useRef(null);

  // Update refs when state changes
  useEffect(() => {
    indicatorRef.current = currentIndicator;
    isPresentationModeRef.current = isPresentationMode;
    isPlayingRef.current = isPlaying;
    presentationSequenceRef.current = presentationSequence;
    globalDurationRef.current = globalDuration;
  }, [currentIndicator]);

  useEffect(() => {
    visualizationModeRef.current = visualizationMode;
  }, [visualizationMode]);

  useEffect(() => {
    isPresentationModeRef.current = isPresentationMode;
  }, [isPresentationMode]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    presentationSequenceRef.current = presentationSequence;
  }, [presentationSequence]);

  useEffect(() => {
    globalDurationRef.current = globalDuration;
  }, [globalDuration]);

  // Keep active user upload ref in sync
  useEffect(() => {
    activeUserUploadRef.current = activeUserUpload?.id || null;
  }, [activeUserUpload]);

  // WebSocket connection for real-time sync
  useEffect(() => {
    const connectWebSocket = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/presentation/`;

      console.log('🔌 WebSocket connecting...');

      try {
        wsRef.current = new WebSocket(wsUrl);

        wsRef.current.onopen = () => {
          console.log('✓ WebSocket connected');
          wsConnectedRef.current = true;
        };

        wsRef.current.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            // Track last WebSocket update time to prevent polling conflicts
            lastWsUpdateRef.current = Date.now();

            if (message.type === 'presentation_update' && message.data) {
              const data = message.data;

              if (!isPresentationModeRef.current) {
                return;
              }

              console.log('📡 WS: presentation update');

              // Update presentation state from WebSocket (use internal setters to avoid loops)
              if (data.is_playing !== undefined) {
                setIsPlaying(data.is_playing);
              }
              if (data.sequence_index !== undefined) {
                setSequenceIndexInternal(data.sequence_index);
              }
              if (data.duration !== undefined) {
                setGlobalDurationInternal(data.duration);
              }
              if (data.sequence && Array.isArray(data.sequence)) {
                // Only update sequence if it's actually different (prevents double updates)
                const currentSeq = presentationSequenceRef.current;
                const newSeq = data.sequence;
                const isDifferent = currentSeq.length !== newSeq.length ||
                  newSeq.some((s, i) => {
                    const curr = currentSeq[i];
                    return !curr || s.indicator !== curr.indicator || s.state !== curr.state || s.type !== curr.type;
                  });
                if (isDifferent) {
                  setPresentationSequenceInternal(data.sequence);
                }
              }
            }

            if (message.type === 'indicator_update' && message.data) {
              const data = message.data;
              console.log('📡 WS: indicator update');

              // Handle active user upload updates from other tabs/remote controller
              // Use ref to check current value and avoid circular updates
              if (data.active_user_upload !== undefined) {
                const currentUploadId = activeUserUploadRef.current;
                const newUploadId = data.active_user_upload?.id || null;
                
                // Only update if actually different
                if (newUploadId !== currentUploadId) {
                  if (data.active_user_upload === null) {
                    setActiveUserUpload(null);
                  } else if (data.active_user_upload.id) {
                    setActiveUserUpload({
                      id: data.active_user_upload.id,
                      imageUrl: data.active_user_upload.image_url,
                      displayName: data.active_user_upload.display_name,
                    });
                  }
                }
              }

              if (data.indicator_id !== undefined) {
                const newIndicator = ID_TO_INDICATOR[data.indicator_id];

                // Guard against stale updates during indicator change
                if (indicatorChangeInProgressRef.current) {
                  if (newIndicator !== indicatorChangeInProgressRef.current) {
                    return;
                  }
                }

                if (newIndicator && newIndicator !== indicatorRef.current) {
                  setCurrentIndicator(newIndicator);
                }
              }

              if (data.indicator_state) {
                const state = { ...data.indicator_state };
                if (state.scenario === "current") {
                  state.scenario = "present";
                }
                globals.INDICATOR_STATE = state;
                window.dispatchEvent(new CustomEvent("indicatorStateChanged"));
                if (indicatorRef.current === 'climate') {
                  window.dispatchEvent(new CustomEvent("climateStateChanged"));
                }
              }

              if (data.visualization_mode) {
                const newMode = data.visualization_mode === "map" ? "deck" : "image";
                if (newMode !== visualizationModeRef.current) {
                  setVisualizationMode(newMode);
                }
              }
            }
          } catch (err) {
            console.error('❌ WebSocket parse error:', err);
          }
        };

        wsRef.current.onclose = () => {
          console.log('✗ WebSocket disconnected, reconnecting...');
          wsConnectedRef.current = false;
          wsReconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
        };

        wsRef.current.onerror = (error) => {
          console.error('❌ WebSocket error:', error);
          // Log to backend
          logErrorToBackend(error, {
            type: 'WebSocketError',
            component: 'DataContext',
            additionalData: {
              wsUrl: wsUrl,
            },
          });
        };
      } catch (err) {
        console.error('❌ WebSocket connection failed:', err);
        wsReconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
      }
    };

    connectWebSocket();

    return () => {
      if (wsReconnectTimeoutRef.current) {
        clearTimeout(wsReconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

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

  // Polling fallback - only used if WebSocket fails (runs every 10s)
  const checkRemoteChanges = useCallback(async () => {
    const now = Date.now();
    if (now - lastCheckedRef.current < 500) return;
    lastCheckedRef.current = now;

    // Skip polling if WebSocket is connected AND received update recently (within 15s)
    // This prevents race conditions between WS updates and polling
    if (wsConnectedRef.current && (now - lastWsUpdateRef.current < 15000)) {
      return; // WebSocket is handling updates
    }

    try {
      const response = await api.get("/api/actions/get_global_variables/");
      if (!response.data) return;

      // Update globals state
      if (response.data.indicator_state) {
        const state = { ...response.data.indicator_state };
        if (state.scenario === "current") {
          state.scenario = "present";
        }
        globals.INDICATOR_STATE = state;
      }

      // Visualization mode sync
      if (response.data.visualization_mode) {
        globals.VISUALIZATION_MODE = response.data.visualization_mode;
        const newMode = response.data.visualization_mode === "map" ? "deck" : "image";
        if (newMode !== visualizationModeRef.current) {
          setVisualizationMode(newMode);
        }
      }

      // Presentation playing state (cross-tab sync)
      if (response.data.presentation_playing !== undefined && isPresentationModeRef.current) {
        const backendPlaying = response.data.presentation_playing;
        if (backendPlaying !== isPlayingRef.current) {
          setIsPlaying(backendPlaying);
        }
      }

      // Indicator changes
      if (response.data.indicator_id !== undefined) {
        globals.INDICATOR_ID = response.data.indicator_id;
        const indicatorId = parseInt(response.data.indicator_id, 10);
        const newIndicator = ID_TO_INDICATOR[indicatorId];

        if (indicatorChangeInProgressRef.current && newIndicator !== indicatorChangeInProgressRef.current) {
          return;
        }

        if (newIndicator && newIndicator !== indicatorRef.current) {
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
          }

          debounceTimerRef.current = setTimeout(() => {
            setLoading(true);
            setCurrentIndicator(newIndicator);
            setTimeout(() => setLoading(false), 500);
          }, 100);
        }
      }

      // Climate state changes
      if (indicatorRef.current === "climate" && response.data.indicator_state) {
        const currentScenario = response.data.indicator_state.scenario;
        const currentType = response.data.indicator_state.type;
        const prevScenario = prevClimateStateRef.current.scenario;
        const prevType = prevClimateStateRef.current.type;

        if ((currentScenario && currentScenario !== prevScenario) || (currentType && currentType !== prevType)) {
          prevClimateStateRef.current = { scenario: currentScenario, type: currentType };
          window.dispatchEvent(new CustomEvent("climateStateChanged"));
        } else if (!prevScenario && currentScenario) {
          prevClimateStateRef.current = { scenario: currentScenario, type: currentType };
        }
      }

      // Other indicator state changes
      if (indicatorRef.current !== "climate" && response.data.indicator_state) {
        const currentStateStr = JSON.stringify(response.data.indicator_state);
        const prevStateStr = prevIndicatorStateRef.current;

        if (prevStateStr && currentStateStr !== prevStateStr) {
          prevIndicatorStateRef.current = currentStateStr;
          window.dispatchEvent(new CustomEvent("indicatorStateChanged"));
          window.dispatchEvent(new CustomEvent("stateChanged"));
        } else if (!prevStateStr) {
          prevIndicatorStateRef.current = currentStateStr;
        }
      }
    } catch (err) {
      console.error("❌ Polling error:", err);
    }
  }, []);

  // Fetch available tables on mount
  useEffect(() => {
    const fetchTables = async () => {
      try {
        const response = await api.get("/api/tables/?is_active=true");
        if (response.data && Array.isArray(response.data)) {
          setAvailableTables(response.data);
          // If current table is not in available tables, switch to default
          const tableExists = response.data.some(t => t.name === currentTable);
          if (!tableExists && response.data.length > 0) {
            setCurrentTable(DEFAULT_TABLE);
          }
        }
      } catch (err) {
        console.error("Error fetching tables:", err);
      }
    };
    fetchTables();
  }, []);

  // Function to change table
  const changeTable = useCallback(async (tableName) => {
    if (tableName !== currentTable) {
      setCurrentTable(tableName);
      // Clear dashboard data to force refresh with new table
      setDashboardData(null);
      // Refresh current indicator with new table
      if (currentIndicator) {
        const indicatorId = INDICATOR_CONFIG[currentIndicator]?.id;
        if (indicatorId) {
          try {
            await api.post("/api/actions/set_current_indicator/", {
              indicator_id: indicatorId,
              table: tableName,
            });
          } catch (err) {
            console.error("Error updating indicator with new table:", err);
          }
        }
      }
    }
  }, [currentTable, currentIndicator]);

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

        // Set up polling as fallback only (WebSocket handles real-time updates)
        // Very low frequency - only for recovery if WebSocket fails
        checkIntervalId = setInterval(() => {
          if (isMounted) {
            checkRemoteChanges();
          }
        }, 10000); // Poll every 10s as emergency fallback only
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

  // Pause presentation mode via backend API (works across browser tabs)
  const pausePresentationMode = useCallback(async () => {
    // Always try to pause via backend, even if local state thinks we're not playing
    // This ensures cross-tab sync works
    console.log("📌 Manual override: pausing presentation mode via backend");
    try {
      const response = await api.post("/api/actions/set_presentation_state/", { is_playing: false });
      if (response.data?.status === "ok") {
        setIsPlaying(false);
      }
    } catch (err) {
      console.error("Error pausing presentation:", err);
      // Still set local state to false to be safe
      setIsPlaying(false);
    }
  }, []);

  // Resume presentation mode via backend API
  const resumePresentationMode = useCallback(async () => {
    // Guard: only resume if in presentation mode
    if (!isPresentationModeRef.current) {
      console.log("⚠️ Resume blocked: not in presentation mode");
      return;
    }
    
    console.log("▶️ Resuming presentation mode via backend");
    try {
      const response = await api.post("/api/actions/set_presentation_state/", { is_playing: true });
      if (response.data?.status === "ok") {
        setIsPlaying(true);
      }
    } catch (err) {
      console.error("Error resuming presentation:", err);
    }
  }, []);

  // Enter pause mode when user upload is selected
  const enterPauseMode = useCallback(async (upload) => {
    console.log("⏸️ Entering pause mode for user upload:", upload.displayName);
    
    // Save current state before pausing
    setPausedIndicatorState({
      indicator: currentIndicator,
      indicatorState: { ...globals.INDICATOR_STATE },
      visualizationMode: visualizationModeRef.current
    });
    
    // Set active user upload locally
    setActiveUserUpload(upload);
    
    // Sync with backend so projection module displays the user upload
    try {
      await api.post("/api/actions/set_active_user_upload/", {
        upload_id: upload.id
      });
      console.log("✓ Synced active user upload with backend");
    } catch (err) {
      console.error("Error syncing active user upload:", err);
    }
  }, [currentIndicator]);

  // Exit pause mode and resume dashboard control
  const exitPauseMode = useCallback(async () => {
    console.log("▶️ Exiting pause mode, resuming dashboard control");
    
    // Clear active user upload locally
    setActiveUserUpload(null);
    
    // Clear active user upload on backend
    try {
      await api.post("/api/actions/set_active_user_upload/", {
        upload_id: null
      });
      console.log("✓ Cleared active user upload on backend");
    } catch (err) {
      console.error("Error clearing active user upload:", err);
    }
    
    // Restore previous state if available
    if (pausedIndicatorState) {
      const { indicator, indicatorState, visualizationMode } = pausedIndicatorState;
      
      // Restore indicator if it changed
      if (indicator !== indicatorRef.current) {
        changeIndicatorRef.current?.(indicator);
      }
      
      // Restore visualization mode if it changed
      if (visualizationMode && visualizationMode !== visualizationModeRef.current) {
        handleVisualizationModeChangeRef.current?.(null, visualizationMode);
      }
      
      // Restore indicator state
      if (indicatorState) {
        globals.INDICATOR_STATE = indicatorState;
        window.dispatchEvent(new CustomEvent("indicatorStateChanged"));
        if (indicator === 'climate') {
          window.dispatchEvent(new CustomEvent("climateStateChanged"));
        }
      }
      
      setPausedIndicatorState(null);
    }
    
    // Resume presentation mode if it was active
    if (isPresentationModeRef.current) {
      api.post("/api/actions/set_presentation_state/", { is_playing: true })
        .then(response => {
          if (response.data?.status === "ok") {
            setIsPlaying(true);
          }
        })
        .catch(err => console.error("Error resuming presentation:", err));
    }
  }, [pausedIndicatorState]);

  // Toggle play/pause via backend API
  const togglePlayPause = useCallback(async () => {
    // Guard: only allow toggle in presentation mode
    if (!isPresentationModeRef.current) {
      console.log("⚠️ Toggle blocked: not in presentation mode");
      return;
    }
    
    const newState = !isPlayingRef.current;
    try {
      const response = await api.post("/api/actions/set_presentation_state/", { is_playing: newState });
      if (response.data?.status === "ok") {
        setIsPlaying(newState);
        console.log(`✓ Presentation ${newState ? 'resumed' : 'paused'}`);
      }
    } catch (err) {
      console.error("Error toggling presentation:", err);
      // Attempt to sync state from backend on error
      try {
        const syncResponse = await api.get("/api/actions/get_presentation_state/");
        if (syncResponse.data?.is_playing !== undefined) {
          setIsPlaying(syncResponse.data.is_playing);
        }
      } catch (syncErr) {
        console.error("Error syncing presentation state:", syncErr);
      }
    }
  }, []);

  // Function to change state (climate scenario or mobility state)
  // For climate, type can be 'utci' or 'plan'
  const changeState = useCallback(
    async (stateName, climateType = null) => {
      // Use ref to get the actual current indicator to avoid stale closures
      const actualIndicator = indicatorRef.current;

      // Check if this is a climate scenario by looking it up in CLIMATE_SCENARIOS
      const isClimateScenario = Object.values(CLIMATE_SCENARIOS).includes(stateName);

      // Handle climate scenarios - use actualIndicator or check if stateName is a climate scenario
      if (actualIndicator === "climate" || (isClimateScenario && actualIndicator !== "mobility")) {
        // Find the scenario key from the display name
        const scenarioKey = Object.entries(CLIMATE_SCENARIOS).find(
          ([key, displayName]) => displayName === stateName
        )?.[0];

        if (scenarioKey) {
          try {
            // Use provided type, fall back to current type, then default to 'utci'
            const targetType = climateType || globals.INDICATOR_STATE?.type || "utci";

            await api.post("/api/actions/set_climate_scenario/", {
              scenario: scenarioKey,
              type: targetType,
            });
            console.log(
              `✓ Changed climate state to ${stateName} (${scenarioKey}) type: ${targetType}`
            );

            // Update local globals
            globals.INDICATOR_STATE = {
              scenario: scenarioKey,
              type: targetType,
              label: `${stateName} - ${targetType.toUpperCase()}`,
            };

            // Trigger a custom event to notify Dashboard of the change
            window.dispatchEvent(new CustomEvent("climateStateChanged"));
          } catch (error) {
            console.error("Error changing climate state:", error);
          }
        } else {
          console.error(`❌ Climate scenario not found for: ${stateName}`);
        }
      } else if (actualIndicator === "mobility") {
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
  // When targetState is provided (presentation mode), this performs an ATOMIC transition
  // by setting the state BEFORE broadcasting to prevent flashing
  // For climate, climateType specifies 'utci' or 'plan'
  const changeIndicator = useCallback(
    async (newIndicator, targetState = null, climateType = null) => {
      if (
        newIndicator !== currentIndicator &&
        Object.keys(INDICATOR_CONFIG).includes(newIndicator)
      ) {
        console.log(`Changing indicator to: ${newIndicator}${targetState ? ` with state: ${targetState}` : ''}${climateType ? ` type: ${climateType}` : ''}`);

        // Set loading state first to prevent flickering
        setLoading(true);

        // Clear existing dashboard data to prevent showing stale data
        setDashboardData(null);

        // Mark that we're changing to this indicator - guards against stale WebSocket updates
        indicatorChangeInProgressRef.current = newIndicator;

        // ATOMIC TRANSITION: When targetState is provided, set globals FIRST before any API calls
        // This ensures Dashboard won't render with wrong state during transition
        if (targetState) {
          // Pre-set the target state in globals BEFORE changing indicator
          if (newIndicator === "climate") {
            // Find the scenario key from the display name
            const scenarioKey = Object.entries(CLIMATE_SCENARIOS).find(
              ([key, displayName]) => displayName === targetState
            )?.[0] || "existing";
            // Use provided climateType, or default to 'utci'
            const targetType = climateType || "utci";
            globals.INDICATOR_STATE = {
              scenario: scenarioKey,
              type: targetType,
              label: `${targetState} - ${targetType.toUpperCase()}`
            };
          } else {
            // Mobility state
            const scenarioKey = targetState.toLowerCase();
            globals.INDICATOR_STATE = {
              year: 2023,
              scenario: scenarioKey,
              label: targetState
            };
          }
          console.log(`✓ Pre-set target state for ${newIndicator}:`, globals.INDICATOR_STATE);
        } else {
          // No target state - set default
          if (newIndicator === "climate") {
            globals.INDICATOR_STATE = { scenario: "existing", type: "utci", label: "Existing - UTCI" };
          } else {
            globals.INDICATOR_STATE = { year: 2023, scenario: "present", label: "Present" };
          }
          console.log(`✓ Set default state for ${newIndicator}:`, globals.INDICATOR_STATE);
        }

        // Set the indicator locally AFTER globals are set
        setCurrentIndicator(newIndicator);

        const indicatorId = INDICATOR_CONFIG[newIndicator]?.id;
        if (indicatorId) {
          try {
            // ATOMIC: Set both indicator AND state in rapid succession before WebSocket broadcasts
            // First set the indicator
            await api.post("/api/actions/set_current_indicator/", {
              indicator_id: indicatorId,
              table: currentTable,
            });
            console.log(`Updated indicator to ${newIndicator} (ID: ${indicatorId})`);

            // Immediately set the state (no delay) if we have a target
            if (targetState) {
              // Call changeState but don't wait for events - the globals are already set
              if (newIndicator === "climate") {
                const scenarioKey = Object.entries(CLIMATE_SCENARIOS).find(
                  ([key, displayName]) => displayName === targetState
                )?.[0];
                if (scenarioKey) {
                  const targetType = climateType || "utci";
                  await api.post("/api/actions/set_climate_scenario/", {
                    scenario: scenarioKey,
                    type: targetType,
                  });
                }
              } else {
                // Mobility state - find and set
                const scenarioKey = targetState.toLowerCase();
                const statesResponse = await api.get("/api/states/");
                const targetStateObj = statesResponse.data.find(
                  (s) => s.state_values && s.state_values.scenario === scenarioKey
                );
                if (targetStateObj) {
                  await api.post("/api/actions/set_current_state/", {
                    state_id: targetStateObj.id,
                  });
                }
              }
              console.log(`✓ Atomically set state to: ${targetState}${climateType ? ` (${climateType})` : ''}`);
            }

            // Now trigger data fetch - state is already correct
            fetchDashboardData(newIndicator);

            // Give the system time to complete the transition
            setTimeout(() => {
              setLoading(false);
              indicatorChangeInProgressRef.current = null;
            }, 300);
          } catch (err) {
            console.error("Error during indicator change:", err);
            setLoading(false);
            indicatorChangeInProgressRef.current = null;
          }
        } else {
          // No indicator ID found
          fetchDashboardData(newIndicator);
          setTimeout(() => {
            setLoading(false);
            indicatorChangeInProgressRef.current = null;
          }, 300);
        }
      }
    },
    [currentIndicator, fetchDashboardData]
  );

  // Update refs to avoid circular dependencies
  useEffect(() => {
    changeIndicatorRef.current = changeIndicator;
  }, [changeIndicator]);

  useEffect(() => {
    handleVisualizationModeChangeRef.current = handleVisualizationModeChange;
  }, [handleVisualizationModeChange]);

    // presentation timer logic
    useEffect(() => {
      // Always clear any existing timer first
      if (presentationTimerRef.current) {
          clearTimeout(presentationTimerRef.current);
          presentationTimerRef.current = null;
      }
  
      // Guard: only run when presentation mode is active, playing, and has slides
      if (!isPresentationMode || !isPlaying || !presentationSequence || presentationSequence.length === 0) {
          return;
      }

      // Validate sequence index is in bounds
      const safeIndex = Math.max(0, Math.min(sequenceIndex, presentationSequence.length - 1));
      const currentStep = presentationSequence[safeIndex];
      
      // Guard: validate currentStep exists and has required properties
      if (!currentStep || !currentStep.indicator || !currentStep.state) {
          console.error("⚠️ Invalid presentation step:", currentStep);
          return;
      }
      
      console.log(`[Presentation] Playing Step ${safeIndex + 1}/${presentationSequence.length}:`, currentStep);

      // Check if this is a user upload
      const isUserUpload = currentStep.indicator.startsWith('user_upload');
      
      if (isUserUpload) {
          // User upload - only update if different from current (use ref to avoid circular dependency)
          const currentUploadId = activeUserUploadRef.current;
          
          if (currentUploadId !== currentStep.uploadId) {
              console.log("📸 User upload detected:", currentStep.state);
              const upload = {
                  id: currentStep.uploadId,
                  imageUrl: currentStep.imageUrl,
                  displayName: currentStep.state,
                  categoryName: currentStep.categoryName
              };
              
              // Set locally
              setActiveUserUpload(upload);
              
              // Sync with backend for projection
              api.post("/api/actions/set_active_user_upload/", { upload_id: upload.id })
                  .catch(err => console.error("Error syncing user upload:", err));
          }
      } else {
          // Regular indicator - clear user upload if active (use ref to check)
          if (activeUserUploadRef.current) {
              console.log("🔄 Switching from user upload to indicator");
              setActiveUserUpload(null);
              
              // Clear on backend
              api.post("/api/actions/set_active_user_upload/", { upload_id: null })
                  .catch(err => console.error("Error clearing user upload:", err));
          }
          
          // Change indicator if needed, passing target state and type to avoid showing default state
          if (currentStep.indicator !== indicatorRef.current) {
              changeIndicator(currentStep.indicator, currentStep.state, currentStep.type);
          } else {
              // Indicator is already correct, just change the state (and type for climate)
              changeState(currentStep.state, currentStep.type);
          }
      }

      // Set up timer for next slide
      const durationMs = Math.max(1000, globalDuration * 1000); // Minimum 1 second
      presentationTimerRef.current = setTimeout(() => {
          // Guard: verify still playing before advancing
          if (isPlayingRef.current && isPresentationModeRef.current) {
              // Use ref to get latest sequence length, avoiding stale closure
              const currentSequenceLength = presentationSequenceRef.current?.length || 1;
              const nextIndex = (safeIndex + 1) % currentSequenceLength;
              console.log(`[Presentation] Auto-advancing to slide ${nextIndex + 1}/${currentSequenceLength}`);
              setSequenceIndex(nextIndex);
          }
      }, durationMs);
  
      return () => {
          if (presentationTimerRef.current) {
              clearTimeout(presentationTimerRef.current);
              presentationTimerRef.current = null;
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
  
    const togglePresentationMode = useCallback(async (isEntering, autoPlay = false) => {
        if (isEntering) {
            console.log("✓ Starting Presentation Mode");
            // Save current state
            setPrevIndicator(indicatorRef.current);
            setPrevVisualizationMode(visualizationModeRef.current);

            // Force 'image' mode for presentation
            if (visualizationModeRef.current !== 'image') {
                 handleVisualizationModeChange(null, 'image');
            }

            // First, try to fetch existing presentation state from backend
            // This ensures we sync with any existing remote controller session
            try {
                const existingState = await api.get("/api/actions/get_presentation_state/");
                if (existingState.data && existingState.data.sequence && existingState.data.sequence.length > 0) {
                    // Backend has existing state - sync with it
                    console.log("📡 Syncing with existing presentation state from backend");
                    setPresentationSequence(existingState.data.sequence);
                    setSequenceIndex(existingState.data.sequence_index || 0);
                    setGlobalDuration(existingState.data.duration || 10);
                    setIsPresentationMode(true);
                    // Don't auto-play if backend isn't playing (respect remote controller state)
                    setIsPlaying(existingState.data.is_playing || autoPlay);
                    return;
                }
            } catch (err) {
                console.log("No existing presentation state, starting fresh");
            }

            // No existing state - start fresh
            setIsPresentationMode(true);
            // Update ref immediately so togglePlayPause works
            isPresentationModeRef.current = true;
            setSequenceIndex(0);
            setIsPlaying(autoPlay);
            isPlayingRef.current = autoPlay;

            // Sync our state to backend for remote controller
            try {
                await api.post("/api/actions/set_presentation_state/", {
                    is_playing: autoPlay,
                    sequence: presentationSequenceRef.current || [],
                    sequence_index: 0,
                    duration: globalDurationRef.current
                });
                console.log("✓ Presentation state synced to backend");
            } catch (err) {
                console.error("Error syncing presentation state:", err);
            }
        } else {
            console.log("✓ Stopping Presentation Mode");
            setIsPlaying(false);
            setIsPresentationMode(false);
            // Sync with backend
            try {
                await api.post("/api/actions/set_presentation_state/", { is_playing: false });
            } catch (err) {
                console.error("Error syncing presentation state:", err);
            }
            
            // Restore state
            setTimeout(() => {
                if (prevIndicator) changeIndicator(prevIndicator);
                if (prevVisualizationMode) handleVisualizationModeChange(null, prevVisualizationMode);
            }, 100);
        }
    }, [prevIndicator, prevVisualizationMode, changeIndicator, handleVisualizationModeChange]);
  
    const skipToNextStep = useCallback(() => {
      // Guard: only allow skipping when playing
      if (!isPlayingRef.current) {
          console.log("⚠️ Skip blocked: presentation is paused");
          return;
      }
      
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
      // Guard: only allow skipping when playing
      if (!isPlayingRef.current) {
          console.log("⚠️ Skip blocked: presentation is paused");
          return;
      }
      
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
  

  // Exit presentation mode completely and return to mobility present
  const exitPresentationAndResume = useCallback(async () => {
    console.log("🔄 Exiting presentation mode and returning to default dashboard");
    
    // Clear active user upload locally and on backend
    setActiveUserUpload(null);
    try {
      await api.post("/api/actions/set_active_user_upload/", { upload_id: null });
    } catch (err) {
      console.error("Error clearing active user upload:", err);
    }
    
    // Stop presentation mode
    setIsPlaying(false);
    setIsPresentationMode(false);
    
    // Sync with backend
    try {
      await api.post("/api/actions/set_presentation_state/", { is_playing: false });
    } catch (err) {
      console.error("Error stopping presentation:", err);
    }
    
    // Clear saved state
    setPausedIndicatorState(null);
    
    // Return to mobility present
    setTimeout(() => {
      changeIndicatorRef.current?.("mobility", "Present");
    }, 100);
  }, []);

  // Value object with additional helpers for the new indicator system
  const contextValue = {
    dashboardData,
    currentIndicator,
    currentTable,
    availableTables,
    changeTable,
    changeIndicator,
    changeState,
    pausePresentationMode,
    resumePresentationMode,
    togglePlayPause,
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
    skipToPrevStep,
    activeUserUpload,
    setActiveUserUpload,
    enterPauseMode,
    exitPauseMode,
    exitPresentationAndResume,
    APP_ROUTES_CONFIG
  };

  return (
    <DataContext.Provider value={contextValue}>{children}</DataContext.Provider>
  );
};

export const useAppData = () => {
  return useContext(DataContext);
};
