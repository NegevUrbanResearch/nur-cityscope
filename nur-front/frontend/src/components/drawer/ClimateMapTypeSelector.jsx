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

  // Sync state from globals (event-driven, no polling)
  // Empty dependency array - listeners registered ONCE, handler reads from globals directly
  useEffect(() => {
    const handleClimateStateChange = () => {
      // Read current type from globals (updated by DataContext via WebSocket)
      const currentType = globals.INDICATOR_STATE?.type || "utci";
      // Use functional update to compare against current state without dependency
      setScenarioType(prev => currentType !== prev ? currentType : prev);
    };

    // Listen for climate state changes from DataContext (via WebSocket)
    window.addEventListener("climateStateChanged", handleClimateStateChange);
    window.addEventListener("indicatorStateChanged", handleClimateStateChange);

    // Initial sync
    handleClimateStateChange();

    return () => {
      window.removeEventListener("climateStateChanged", handleClimateStateChange);
      window.removeEventListener("indicatorStateChanged", handleClimateStateChange);
    };
  }, []); // Empty deps - register once, read globals directly

  const handleTypeChange = async (event, newType) => {
    if (newType !== null) {
      pausePresentationMode();

      // Optimistically update UI
      setScenarioType(newType);

      const currentScenario = globals.INDICATOR_STATE?.scenario || "existing";

      try {
        // Call API - backend will broadcast via WebSocket
        await api.post("/api/actions/set_climate_scenario/", {
          scenario: currentScenario,
          type: newType,
        });
        console.log(`✓ Climate type: ${newType}`);

        // WebSocket will update globals and dispatch events - no manual intervention needed
      } catch (error) {
        console.error("❌ Climate type change error:", error);
        // Revert optimistic update on error
        setScenarioType(globals.INDICATOR_STATE?.type || "utci");
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
