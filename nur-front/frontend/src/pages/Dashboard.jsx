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
import DeckGLMap from "../components/maps/DeckGLMap";
import { chartsDrawerWidth } from "../style/drawersStyles";
import globals from "../globals";

const Dashboard = ({ openCharts}) => {
  const {
    dashboardData: data,
    currentIndicator,
    visualizationMode,
    activeUserUpload,
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

  // Image cache with LRU eviction (max 30 images for better presentation performance)
  const imageCacheRef = useRef(new Map());
  const MAX_CACHE_SIZE = 30;

  const [currentImageUrl, setCurrentImageUrl] = useState(null);
  const [showLoadingMessage, setShowLoadingMessage] = useState(true);
  const lastIndicatorRef = useRef(currentIndicator);
  const loadingTimerRef = useRef(null);
  // Track the expected URL to prevent showing stale images
  const expectedUrlRef = useRef(null);
  // Track last fetched state to prevent redundant refreshes
  const lastFetchedStateRef = useRef(null);

  // Track current image URL in a ref to avoid dependency issues
  const currentImageUrlRef = useRef(currentImageUrl);
  useEffect(() => {
    currentImageUrlRef.current = currentImageUrl;
  }, [currentImageUrl]);

  // Helper to add image to cache with LRU eviction
  const addToCache = useCallback((url, imageObject) => {
    // Remove if already exists (will re-add at end for LRU)
    if (imageCacheRef.current.has(url)) {
      imageCacheRef.current.delete(url);
    }

    // Evict oldest if at capacity
    if (imageCacheRef.current.size >= MAX_CACHE_SIZE) {
      const firstKey = imageCacheRef.current.keys().next().value;
      imageCacheRef.current.delete(firstKey);
    }

    // Add to end (most recently used)
    imageCacheRef.current.set(url, imageObject);
  }, []);

  // Preload image with caching - memoize to avoid dependency issues
  const preloadImage = useCallback(
    (url) => {
      // Extract base URL without cache-busting param for comparison
      const baseUrl = url.split("?")[0];
      const currentBaseUrl = currentImageUrlRef.current?.split("?")[0];

      // If we're loading the same image (just different cache param), keep showing current
      const isSameImage = baseUrl === currentBaseUrl;

      // Check if image is already cached
      if (imageCacheRef.current.has(url)) {
        setCurrentImageUrl(url);
        setShowLoadingMessage(false);
        expectedUrlRef.current = url;
        return;
      }

      // Track expected URL
      expectedUrlRef.current = url;

      // Only clear current image if it's a different image
      if (!isSameImage) {
        setCurrentImageUrl(null);
        setShowLoadingMessage(true);
      }

      const img = new Image();
      img.onload = () => {
        // Only proceed if this is still the expected URL (prevents stale images)
        if (url === expectedUrlRef.current) {
          // Add to cache
          addToCache(url, img);

          // Update state to show this image
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

        // Only update UI if this is still the expected URL
        if (url === expectedUrlRef.current) {
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
    [addToCache]
  );

  // Fetch map data from API when indicator changes
  useEffect(() => {
    // If user upload is active, skip normal fetching and show pause mode
    if (activeUserUpload) {
      setShowLoadingMessage(false);
      const imageUrl = activeUserUpload.imageUrl.startsWith("http") 
        ? activeUserUpload.imageUrl 
        : `${config.api.baseUrl}${activeUserUpload.imageUrl}`;
      setCurrentImageUrl(imageUrl);
      setMapData({
        url: imageUrl,
        type: "image",
        loading: false,
        error: false,
      });
      return;
    }

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
      // Clear last fetched state so new indicator gets fresh data
      lastFetchedStateRef.current = null;
    }

    lastIndicatorRef.current = currentIndicator;

    const fetchMapData = async (retryCount = 0) => {
      const maxRetries = 3;
      const baseDelay = 300;

      try {
        // Add cache-busting timestamp parameter
        const timestamp = Date.now();
        // Use our pre-configured api instance with relative URL
        const response = await api.get(
          `/api/actions/get_image_data/?_=${timestamp}&indicator=${currentIndicator}&table=idistrict&exclude_ugc=true`
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

          // Track what we just fetched to prevent redundant refreshes
          if (currentIndicator === "climate") {
            lastFetchedStateRef.current = `${globals.INDICATOR_STATE?.scenario}-${globals.INDICATOR_STATE?.type}`;
          } else {
            lastFetchedStateRef.current = `${currentIndicator}-${globals.INDICATOR_STATE?.scenario}`;
          }

          // Only preload images (not HTML animations or videos)
          if (!isHtml && !isVideo) {
            preloadImage(url);
          }
        }
      } catch (err) {
        // Check if it's a 404 and we have retries left
        const is404 = err.response?.status === 404;
        
        if (is404 && retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount);
          console.log(`Dashboard - 404 error, retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
          setTimeout(() => fetchMapData(retryCount + 1), delay);
          return;
        }

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
  }, [currentIndicator, visualizationMode, preloadImage, activeUserUpload]);

  // State for tracking current indicator state
  const [currentState, setCurrentState] = useState({
    year: 2023,
    scenario: "present",
  });

  // Use refs to access latest values without causing effect re-runs
  const currentIndicatorRef = useRef(currentIndicator);
  const preloadImageRef = useRef(preloadImage);

  useEffect(() => {
    currentIndicatorRef.current = currentIndicator;
  }, [currentIndicator]);

  useEffect(() => {
    preloadImageRef.current = preloadImage;
  }, [preloadImage]);

  // Debounce ref to prevent multiple rapid refreshes
  const refreshDebounceRef = useRef(null);

  // CONSOLIDATED: Single effect for ALL state change events
  // This prevents duplicate listeners and ensures consistent handling
  useEffect(() => {
    const handleStateChangeEvent = async (eventType) => {
      // Skip state changes when user upload is active (pause mode)
      if (activeUserUpload) {
        return;
      }
      
      const indicator = currentIndicatorRef.current;

      // Update currentState for display (always do this)
      let scenario = globals.INDICATOR_STATE?.scenario;
      if (!scenario || scenario === "current") {
        scenario = indicator === "climate" ? "existing" : "present";
      }
      setCurrentState({
        year: globals.INDICATOR_STATE?.year || 2023,
        scenario: scenario,
      });

      // Debounce image refresh to prevent multiple rapid fetches
      if (refreshDebounceRef.current) {
        clearTimeout(refreshDebounceRef.current);
      }

      refreshDebounceRef.current = setTimeout(async () => {
        // Check if we should refresh image based on indicator type
        const isClimateEvent = eventType === "climateStateChanged";
        const shouldRefresh = (indicator === "climate" && isClimateEvent) ||
                              (indicator !== "climate" && !isClimateEvent);

        if (!shouldRefresh && eventType !== "stateChanged") {
          return;
        }

        // Build state key for deduplication
        const currentStateKey = indicator === "climate"
          ? `${globals.INDICATOR_STATE?.scenario}-${globals.INDICATOR_STATE?.type}`
          : `${indicator}-${globals.INDICATOR_STATE?.scenario}`;

        if (lastFetchedStateRef.current === currentStateKey) {
          return; // Already fetched this state
        }

        console.log(`📊 State changed for ${indicator}, refreshing image...`);
        lastFetchedStateRef.current = currentStateKey;

        // Small delay to ensure backend state is committed
        await new Promise((resolve) => setTimeout(resolve, 50));

        try {
          const timestamp = Date.now();
          const response = await api.get(
            `/api/actions/get_image_data/?_=${timestamp}&indicator=${indicator}&table=idistrict&exclude_ugc=true`
          );

          if (response.data && response.data.image_data) {
            let url = response.data.image_data.startsWith("/")
              ? `${config.media.baseUrl}${response.data.image_data}`
              : `${config.media.baseUrl}/media/${response.data.image_data}`;

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

            if (!isHtml && !isVideo) {
              preloadImageRef.current(url);
            }
          }
        } catch (err) {
          console.error(`❌ Error refreshing ${indicator} image:`, err);
        }
      }, 100); // 100ms debounce
    };

    // Create stable handler functions
    const onClimateChange = () => handleStateChangeEvent("climateStateChanged");
    const onIndicatorChange = () => handleStateChangeEvent("indicatorStateChanged");
    const onStateChange = () => handleStateChangeEvent("stateChanged");

    // Register all listeners ONCE
    window.addEventListener("climateStateChanged", onClimateChange);
    window.addEventListener("indicatorStateChanged", onIndicatorChange);
    window.addEventListener("stateChanged", onStateChange);

    return () => {
      window.removeEventListener("climateStateChanged", onClimateChange);
      window.removeEventListener("indicatorStateChanged", onIndicatorChange);
      window.removeEventListener("stateChanged", onStateChange);
      if (refreshDebounceRef.current) {
        clearTimeout(refreshDebounceRef.current);
      }
    };
  }, [activeUserUpload]); // Include activeUserUpload to skip when in pause mode

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
        position: "relative",
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
