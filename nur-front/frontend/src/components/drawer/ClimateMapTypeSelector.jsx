import React, { useEffect, useState } from "react";
import {
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Box,
} from "@mui/material";
import api from "../../api";
import globals from "../../globals";
import { useAppData } from "../../DataContext";

const ClimateMapTypeSelector = () => {
  const { pausePresentationMode } = useAppData();
  const [scenarioType, setScenarioType] = useState(
    globals.INDICATOR_STATE?.type || "utci"
  );

  // Fetch the current climate state from the backend on mount
  useEffect(() => {
    const fetchCurrentState = async () => {
      try {
        const response = await api.get(
          "/api/actions/get_current_dashboard_data/"
        );
        if (response.data && response.data.state) {
          const backendType = response.data.state.type || "utci";
          console.log(`✓ Synced climate type from backend: ${backendType}`);
          setScenarioType(backendType);

          globals.INDICATOR_STATE = {
            ...globals.INDICATOR_STATE,
            ...response.data.state,
          };
        }
      } catch (error) {
        console.error("Error fetching current climate state:", error);
      }
    };

    fetchCurrentState();
  }, []);

  // Listen for climate state changes from remote controller or other sources
  useEffect(() => {
    const handleClimateStateChange = async () => {
      console.log(
        "🔄 Climate state changed event detected, syncing button state..."
      );
      try {
        const response = await api.get(
          "/api/actions/get_current_dashboard_data/"
        );
        if (response.data && response.data.state) {
          const backendType = response.data.state.type || "utci";
          console.log(`✓ Updated button state to: ${backendType}`);
          setScenarioType(backendType);

          globals.INDICATOR_STATE = {
            ...globals.INDICATOR_STATE,
            ...response.data.state,
          };
        }
      } catch (error) {
        console.error("Error syncing climate state:", error);
      }
    };

    window.addEventListener("climateStateChanged", handleClimateStateChange);

    return () => {
      window.removeEventListener(
        "climateStateChanged",
        handleClimateStateChange
      );
    };
  }, []);

  // Poll backend for changes from remote controller every 2 seconds
  useEffect(() => {
    const pollBackend = async () => {
      try {
        const response = await api.get(
          "/api/actions/get_current_dashboard_data/"
        );
        if (response.data && response.data.state) {
          const backendType = response.data.state.type || "utci";

          // Only update if the backend state differs from current state
          if (backendType !== scenarioType) {
            console.log(
              `🔄 Backend state changed to: ${backendType}, updating button...`
            );
            setScenarioType(backendType);

            globals.INDICATOR_STATE = {
              ...globals.INDICATOR_STATE,
              ...response.data.state,
            };

            // Trigger event to update Dashboard image
            window.dispatchEvent(new CustomEvent("climateStateChanged"));
          }
        }
      } catch (error) {
        console.error("Error polling backend state:", error);
      }
    };

    // Poll every 500ms for responsive state sync
    const intervalId = setInterval(pollBackend, 500);

    return () => clearInterval(intervalId);
  }, [scenarioType]);

  const handleTypeChange = async (event, newType) => {
    if (newType !== null) {
      pausePresentationMode(); // Pause auto-advance when user clicks
      setScenarioType(newType);

      const currentScenario = globals.INDICATOR_STATE?.scenario || "existing";

      try {
        await api.post("/api/actions/set_climate_scenario/", {
          scenario: currentScenario,
          type: newType,
        });
        console.log(`✓ Updated to ${newType} view for ${currentScenario}`);

        globals.INDICATOR_STATE = {
          ...globals.INDICATOR_STATE,
          type: newType,
          scenario: currentScenario,
        };

        window.dispatchEvent(new CustomEvent("climateStateChanged"));
      } catch (error) {
        console.error("Error updating climate scenario type:", error);
      }
    }
  };

  return (
    <Box
      sx={{
        px: { xs: 1.5, sm: 2 },
        pt: { xs: 1.5, sm: 2 },
        pb: { xs: 1, sm: 1.5 },
        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
      }}
    >
      <ToggleButtonGroup
        value={scenarioType}
        exclusive
        onChange={handleTypeChange}
        aria-label="scenario type"
        fullWidth
        sx={{
          display: "flex",
          gap: 1,
          "& .MuiToggleButton-root": {
            flex: 1,
            height: { xs: "36px", sm: "40px" },
            py: 0,
            px: { xs: 1.5, sm: 2 },
            color: "rgba(255, 255, 255, 0.7)",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            borderRadius: "6px",
            textTransform: "none",
            fontSize: { xs: "0.95rem", sm: "1rem" },
            fontWeight: 600,
            letterSpacing: "0.3px",
            transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
            "&:hover": {
              backgroundColor: "rgba(100, 181, 246, 0.12)",
              borderColor: "rgba(100, 181, 246, 0.5)",
              transform: "translateY(-1px)",
              boxShadow: "0 4px 12px rgba(100, 181, 246, 0.15)",
            },
            "&.Mui-selected": {
              backgroundColor: "rgba(100, 181, 246, 0.18)",
              color: "#64B5F6",
              borderColor: "#64B5F6",
              fontWeight: 700,
              boxShadow: "0 2px 8px rgba(100, 181, 246, 0.2)",
              "&:hover": {
                backgroundColor: "rgba(100, 181, 246, 0.25)",
                transform: "translateY(-1px)",
                boxShadow: "0 4px 12px rgba(100, 181, 246, 0.25)",
              },
            },
          },
        }}
      >
        <ToggleButton value="utci">UTCI</ToggleButton>
        <ToggleButton value="plan">Plan</ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
};

export default ClimateMapTypeSelector;
