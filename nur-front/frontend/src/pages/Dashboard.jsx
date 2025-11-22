import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { Box, Alert, Typography } from "@mui/material";
import api from "../api";
import { useAppData } from "../DataContext";
import config from "../config";
//import MetricDisplay from "../components/MetricDisplay";
import DeckGLMap from "../components/maps/DeckGLMap";
import { chartsDrawerWidth } from "../style/drawersStyles";
import globals from "../globals";

const Dashboard = ({ openCharts, isPresentationMode, togglePresentationMode }) => {
  const {
    dashboardData: data,
    currentIndicator,
    visualizationMode,
  } = useAppData();
  // Simple function to check if URL is HTML animation
  const isHtmlAnimation = (url) => url && url.includes(".html");

  // Function to check if URL is a video file
  const isVideoFile = (url) => {
    if (!url) return false;
    const videoExtensions = [".mp4", ".webm", ".ogg", ".avi", ".mov"];
    return videoExtensions.some((ext) => url.toLowerCase().includes(ext));
  };
  const [mapData, setMapData] = useState({
    url: null,
    type: null,
    loading: true,
    error: false,
  });

  // Refs to track image loading state
  const imageStates = useRef(new Map());
  const [currentImageUrl, setCurrentImageUrl] = useState(null);
  const [showLoadingMessage, setShowLoadingMessage] = useState(true);
  const lastIndicatorRef = useRef(currentIndicator);
  const loadingTimerRef = useRef(null);

  // Preload image and track its loading state - memoize to avoid dependency issues
  const preloadImage = useCallback(
    (url) => {
      // First clear any previous loading state for this URL
      imageStates.current.delete(url);

      // Mark this URL as loading
      imageStates.current.set(url, "loading");

      const img = new Image();
      img.onload = () => {
        // Only proceed if this is still the current indicator's image
        if (url.includes(currentIndicator)) {
          // Mark as loaded and update state to show this image
          imageStates.current.set(url, "loaded");
          setCurrentImageUrl(url);
          setShowLoadingMessage(false);
        }

        // Clear any pending loading timer
        if (loadingTimerRef.current) {
          clearTimeout(loadingTimerRef.current);
          loadingTimerRef.current = null;
        }
      };

      img.onerror = () => {
        console.error(`Failed to load image: ${url}`);

        // Mark as error but still try to show it
        imageStates.current.set(url, "error");

        // Only update UI if this is still the current indicator's image
        if (url.includes(currentIndicator)) {
          setCurrentImageUrl(url);
          setShowLoadingMessage(false);
        }

        // Clear any pending loading timer
        if (loadingTimerRef.current) {
          clearTimeout(loadingTimerRef.current);
          loadingTimerRef.current = null;
        }
      };

      img.src = url;
    },
    [currentIndicator]
  );

  // Fetch map data from API when indicator changes
  useEffect(() => {
    // Clear any existing loading timer
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
    }

    // Store a reference to any new timer we create
    let currentLoadingTimer = null;

    // When the indicator changes, we should show loading immediately
    // to prevent showing stale content
    if (lastIndicatorRef.current !== currentIndicator) {
      setShowLoadingMessage(true);
      // Clear the current image URL to prevent showing stale content
      setCurrentImageUrl(null);
    }

    lastIndicatorRef.current = currentIndicator;

    const fetchMapData = async () => {
      try {
        // Add cache-busting timestamp parameter
        const timestamp = Date.now();
        // Use our pre-configured api instance with relative URL
        const response = await api.get(
          `/api/actions/get_image_data/?_=${timestamp}&indicator=${currentIndicator}`
        );

        if (response.data && response.data.image_data) {
          // Correctly construct the URL using config.media.baseUrl
          let url = response.data.image_data.startsWith("/")
            ? `${config.media.baseUrl}${response.data.image_data}`
            : `${config.media.baseUrl}/media/${response.data.image_data}`;

          // Don't add cache-busting for HTML animations or videos to prevent reloads
          const isHtml = isHtmlAnimation(url);
          const isVideo = response.data.type === "video";

          if (!isHtml && !isVideo) {
            url += `?_=${timestamp}`;
          }

          setMapData({
            url,
            type: response.data.type || "map",
            loading: false,
            error: false,
          });

          // Only preload images (not HTML animations or videos)
          if (!isHtml && !isVideo) {
            preloadImage(url);
          }
        }
      } catch (err) {
        console.error("Error fetching map data:", err);

        // Fallback to default map based on indicator if API fails
        // Don't add cache-busting to HTML fallback URLs either
        const fallbackUrl = `${config.media.baseUrl}/media/maps/${currentIndicator}_2023.html`;

        setMapData({
          url: fallbackUrl,
          type: "map",
          loading: false,
          error: true,
          errorMessage: err.message,
        });
        setShowLoadingMessage(false);
      }
    };

    // Add a slight delay to allow the indicator change to propagate through the system
    setTimeout(() => {
      if (currentIndicator) {
        fetchMapData();
      }
    }, 100);

    return () => {
      // Use our local reference to the timer
      if (currentLoadingTimer) {
        clearTimeout(currentLoadingTimer);
      }
    };
  }, [currentIndicator, visualizationMode, preloadImage]);

  // Listen for climate state changes (scenario or type changes)
  useEffect(() => {
    const handleClimateStateChange = async () => {
      if (currentIndicator === "climate") {
        console.log(
          "🌡️ Climate state changed event received, refreshing image..."
        );

        // Add a small delay to ensure backend has updated globals.INDICATOR_STATE
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Fetch new image data
        try {
          const timestamp = Date.now();
          console.log(
            `📡 Fetching new climate image with timestamp: ${timestamp}`
          );
          const response = await api.get(
            `/api/actions/get_image_data/?_=${timestamp}&indicator=${currentIndicator}`
          );

          if (response.data && response.data.image_data) {
            console.log(`✓ Received image data: ${response.data.image_data}`);
            let url = response.data.image_data.startsWith("/")
              ? `${config.media.baseUrl}${response.data.image_data}`
              : `${config.media.baseUrl}/media/${response.data.image_data}`;

            const isHtml = isHtmlAnimation(url);
            const isVideo = response.data.type === "video";

            if (!isHtml && !isVideo) {
              url += `?_=${timestamp}`;
            }

            console.log(`🖼️ Setting new image URL: ${url}`);
            setMapData({
              url,
              type: response.data.type || "map",
              loading: false,
              error: false,
            });

            if (!isHtml && !isVideo) {
              preloadImage(url);
            }
          }
        } catch (err) {
          console.error("❌ Error refreshing climate image:", err);
        }
      }
    };

    window.addEventListener("climateStateChanged", handleClimateStateChange);

    return () => {
      window.removeEventListener(
        "climateStateChanged",
        handleClimateStateChange
      );
    };
  }, [currentIndicator, preloadImage]);

  // Listen for general indicator state changes (for mobility and other indicators)
  useEffect(() => {
    const handleIndicatorStateChange = async () => {
      if (currentIndicator !== "climate") {
        console.log(
          `📊 Indicator state changed event received for ${currentIndicator}, refreshing image...`
        );

        // Add a small delay to ensure backend has updated globals.INDICATOR_STATE
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Fetch new image data
        try {
          const timestamp = Date.now();
          console.log(
            `📡 Fetching new ${currentIndicator} image with timestamp: ${timestamp}`
          );
          const response = await api.get(
            `/api/actions/get_image_data/?_=${timestamp}&indicator=${currentIndicator}`
          );

          if (response.data && response.data.image_data) {
            console.log(`✓ Received image data: ${response.data.image_data}`);
            let url = response.data.image_data.startsWith("/")
              ? `${config.media.baseUrl}${response.data.image_data}`
              : `${config.media.baseUrl}/media/${response.data.image_data}`;

            const isHtml = isHtmlAnimation(url);
            const isVideo = response.data.type === "video";

            if (!isHtml && !isVideo) {
              url += `?_=${timestamp}`;
            }

            console.log(`🖼️ Setting new image URL: ${url}`);
            setMapData({
              url,
              type: response.data.type || "map",
              loading: false,
              error: false,
            });

            if (!isHtml && !isVideo) {
              preloadImage(url);
            }
          }
        } catch (err) {
          console.error(`❌ Error refreshing ${currentIndicator} image:`, err);
        }
      }
    };

    window.addEventListener(
      "indicatorStateChanged",
      handleIndicatorStateChange
    );

    return () => {
      window.removeEventListener(
        "indicatorStateChanged",
        handleIndicatorStateChange
      );
    };
  }, [currentIndicator, preloadImage]);

  // State for tracking current indicator state
  const [currentState, setCurrentState] = useState({
    year: 2023,
    scenario: "current",
  });

  // Listen for state changes and update currentState
  useEffect(() => {
    const handleStateChange = () => {
      console.log("Dashboard - State change event received, updating state");
      console.log("Dashboard - Current data?.metrics:", data?.metrics);
      console.log(
        "Dashboard - Current globals.INDICATOR_STATE:",
        globals.INDICATOR_STATE
      );

      // Get the current state from globals or data
      const newState = {
        year: globals.INDICATOR_STATE?.year || data?.metrics?.year || 2023,
        scenario:
          globals.INDICATOR_STATE?.scenario ||
          data?.metrics?.scenario ||
          "current",
      };
      console.log("Dashboard - Setting state to:", newState);
      setCurrentState(newState);
    };

    window.addEventListener("indicatorStateChanged", handleStateChange);
    window.addEventListener("stateChanged", handleStateChange);

    // Also poll for state changes every 1 second to ensure sync
    const pollInterval = setInterval(async () => {
      try {
        const response = await api.get("/api/actions/get_global_variables/");
        if (response.data?.indicator_state) {
          const backendState = response.data.indicator_state;
          const newState = {
            year: backendState.year || 2023,
            scenario: backendState.scenario || "current",
          };

          // Only update if different from current state
          if (
            newState.scenario !== currentState.scenario ||
            newState.year !== currentState.year
          ) {
            console.log(
              "Dashboard - Polling detected state change:",
              currentState,
              "->",
              newState
            );
            setCurrentState(newState);
          }
        }
      } catch (error) {
        console.error("Dashboard - Error polling backend state:", error);
      }
    }, 1000);

    return () => {
      window.removeEventListener("indicatorStateChanged", handleStateChange);
      window.removeEventListener("stateChanged", handleStateChange);
      clearInterval(pollInterval);
    };
  }, [data?.metrics, currentState]);

  // Memoize state object to prevent unnecessary re-renders and iframe reloads
  // Must be called before any early returns (Rules of Hooks)
  const state = useMemo(() => {
    const stateObj = {
      year: currentState.year,
      scenario: currentState.scenario,
    };

    // Only use data?.metrics as fallback if currentState is not set
    if (data?.metrics && (!currentState.year || !currentState.scenario)) {
      // We derive current year from formatted metrics
      // This assumes that the metrics are updated when the state changes
      if (data.metrics.year) {
        stateObj.year = data.metrics.year;
      }
      if (data.metrics.scenario) {
        stateObj.scenario = data.metrics.scenario;
      }
    }

    console.log("Dashboard - Final state object:", stateObj);
    return stateObj;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentState.year,
    currentState.scenario,
    data?.metrics?.year,
    data?.metrics?.scenario,
  ]);

  useEffect(() => {
    // Set body and html styling to ensure full viewport coverage
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    // Ensure scrolling is enabled
    document.body.style.overflow = "auto";
    document.body.style.backgroundColor = "#111116";
    document.documentElement.style.height = "100%";

    return () => {
      // Clean up styles when component unmounts
      document.body.style.margin = "";
      document.body.style.padding = "";
      document.body.style.overflow = "";
      document.body.style.backgroundColor = "";
      document.documentElement.style.height = "";
    };
  }, []);

  if (mapData.error) {
    return (
      <>
        <Box sx={{ height: "100%", width: "100%" }}>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Error loading visualization: Using fallback map
          </Alert>
          <iframe
            key={mapData.url} // Stable key to prevent recreation
            src={mapData.url}
            style={{
              width: "100%",
              height: "90%",
              border: "none",
            }}
            title={`${currentIndicator} map visualization`}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onError={(e) => {
              console.error("Failed to load fallback map:", e);
            }}
          />
        </Box>
      </>
    );
  }

  return (
    <Box
      sx={{
        width: openCharts
          ? {
              xs: 0,
              sm: `calc(100vw - ${chartsDrawerWidth.sm})`,
              md: `calc(100vw - ${chartsDrawerWidth.md})`,
              lg: `calc(100vw - ${chartsDrawerWidth.lg})`,
              xl: `calc(100vw - ${chartsDrawerWidth.xl})`,
            }
          : "100vw",
        marginLeft: {
          xs: 0,
          sm: `-${chartsDrawerWidth.sm}`,
          md: `-${chartsDrawerWidth.md}`,
          lg: `-${chartsDrawerWidth.lg}`,
          xl: `-${chartsDrawerWidth.xl}`,
        },
        height: "100vh",
        transition: (theme) =>
          theme.transitions.create("width", {
            duration: theme.transitions.duration.standard,
            easing: theme.transitions.easing.easeInOut,
          }),
      }}
    >

      {/* Conditional rendering based on presentation mode */}
      
      {visualizationMode === "deck" ? (
        // Show interactive Deck.GL map when in deck mode
        <DeckGLMap indicatorType={currentIndicator} state={state} />
      ) : (
        // Show traditional image/iframe/video view with caching for HTML animations
        <>
          {mapData.url && isHtmlAnimation(mapData.url) ? (
            // Use simple iframe for HTML animations (no cache-busting = no reloads)
            <iframe
              key={mapData.url} // Stable key to prevent recreation on sidebar toggle
              src={mapData.url}
              style={{
                width: "100%",
                height: "100%",
                border: "none",
              }}
              title={`${currentIndicator} visualization`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onLoad={() => {
                setShowLoadingMessage(false);
              }}
              onError={(e) => {
                console.error("Failed to load HTML animation:", e);
                setMapData((prev) => ({
                  ...prev,
                  error: true,
                  errorMessage: "Failed to load visualization animation",
                }));
              }}
            />
          ) : mapData.url && isVideoFile(mapData.url) ? (
            // Use video element for video files with looping
            <Box
              component="video"
              src={mapData.url}
              autoPlay
              loop
              muted
              playsInline
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
              onLoadedData={() => {
                setShowLoadingMessage(false);
              }}
              onError={(e) => {
                console.error("Failed to load video:", e);
                setMapData((prev) => ({
                  ...prev,
                  error: true,
                  errorMessage: "Failed to load visualization video",
                }));
              }}
            />
          ) : (
            // Use traditional image loading for non-HTML, non-video content
            <>
              {showLoadingMessage && ( // Only show loading message after delay (if still loading)
                <Box sx={{ display: "flex", height: "100%" }}>
                  <Typography variant="body1">
                    Loading visualization...
                  </Typography>
                </Box>
              )}
              {currentImageUrl && ( // Always render the current image when available
                <Box
                  component="img"
                  src={currentImageUrl}
                  alt={`${currentIndicator} visualization`}
                  sx={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    display: showLoadingMessage ? "none" : "block",
                  }}
                  onError={(e) => {
                    console.error("Failed to load image:", e);
                    // Don't use a fallback - let the user know there's an issue
                    setMapData((prev) => ({
                      ...prev,
                      error: true,
                      errorMessage: "Failed to load visualization image",
                    }));
                  }}
                />
              )}
            </>
          )}
        </>
      )}
    </Box>
  );
};

export default Dashboard;
