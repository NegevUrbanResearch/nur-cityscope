import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import api from './api'; // Import the pre-configured api instance
import isEqual from 'lodash/isEqual';

import config from "./config";
import globals from "./globals";

const DataContext = createContext();

// Define indicator configurations for easy addition of new indicators
const INDICATOR_CONFIG = {
  mobility: {
    id: 1,
    name: 'Mobility Dashboard',
    metrics: [
      'public_transport_coverage',
      'average_commute_time',
      'bike_lane_coverage'
    ],
    tabLabels: ["Accessibility", "Modal Split", "Radar Analysis", "Coverage"],
    pieChartLabels: ["Public Transport Coverage", "No Coverage"]
  },
  climate: {
    id: 2,
    name: 'Climate Dashboard',
    metrics: [
      'air_quality_index',
      'carbon_emissions',
      'renewable_energy_percentage',
      'green_space_percentage'
    ],
    tabLabels: ["Emissions", "Green Space", "Radar Analysis", "Sustainability"],
    pieChartLabels: ["Green Space", "Other"]
  },
  land_use: {
    id: 3,
    name: 'Land Use Dashboard',
    metrics: [
      'mixed_use_ratio',
      'population_density',
      'public_space_percentage',
      'average_building_height'
    ],
    tabLabels: ["Density", "Land Use Mix", "Radar Analysis", "Building Types"],
    pieChartLabels: ["Mixed Use", "Single Use"]
  }
  // Add new indicators here following the same pattern
};

// Reverse mapping from ID to indicator type
const ID_TO_INDICATOR = Object.fromEntries(
  Object.entries(INDICATOR_CONFIG).map(([key, config]) => [config.id, key])
);

export const DataProvider = ({ children }) => {
  // Store the current indicator type (mobility, climate, land_use)
  const [currentIndicator, setCurrentIndicator] = useState('mobility');
  
  // Store the dashboard data for the current indicator
  const [dashboardData, setDashboardData] = useState(null);
  
  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  
  // Use refs to prevent unnecessary re-renders during frequent polling
  const indicatorRef = useRef(currentIndicator);
  const lastCheckedRef = useRef(Date.now());
  const debounceTimerRef = useRef(null);

  // Update ref when state changes
  useEffect(() => {
    indicatorRef.current = currentIndicator;
  }, [currentIndicator]);

  // Function to fetch data for the current indicator
  const fetchDashboardData = useCallback(async (indicator) => {
    if (!indicator) return;
    
    // Check if we have a specific year to use
    const currentYear = globals.INDICATOR_STATE?.year || 2023;
    
    // Use a relative URL with the api instance
    const endpoint = `/api/dashboard_feed_state/?dashboard_type=${indicator}&year=${currentYear}`;
    console.log(`Fetching ${indicator} dashboard data from:`, endpoint);
    
    try {
      // Only show loading on initial load or on error recovery, not during polling
      const isInitialLoad = !dashboardData;
      if (isInitialLoad) {
        setLoading(true);
      }
      
      const response = await api.get(endpoint);
      
      if (response.data && response.data.length > 0) {
        // Transform the data to match the expected format
        const transformedData = {
          // Direct mapping for radar chart
          radar: response.data[0].data.radar,

          // Direct mapping for horizontal stacked bar chart
          horizontalStackedBars: response.data[0].data.horizontalStackedBar,

          // Direct mapping for stacked bar chart
          stackedBars: response.data[0].data.stackedBar,

          // Metrics data
          metrics: {
            total_population: response.data[0].data.total_population || 0,
            // Include indicator-specific metrics
            ...(indicator === 'mobility' && {
              public_transport_coverage: response.data[0].data.public_transport_coverage || 0,
              average_commute_time: response.data[0].data.average_commute_time || 0,
              bike_lane_coverage: response.data[0].data.bike_lane_coverage || 0
            }),
            ...(indicator === 'climate' && {
              air_quality_index: response.data[0].data.air_quality_index || 0,
              carbon_emissions: response.data[0].data.carbon_emissions || 0,
              renewable_energy_percentage: response.data[0].data.renewable_energy_percentage || 0,
              green_space_percentage: response.data[0].data.green_space_percentage || 0
            }),
            ...(indicator === 'land_use' && {
              mixed_use_ratio: response.data[0].data.mixed_use_ratio || 0,
              population_density: response.data[0].data.population_density || 0,
              public_space_percentage: response.data[0].data.public_space_percentage || 0,
              average_building_height: response.data[0].data.average_building_height || 0
            })
          },

          // Pie chart data using appropriate metric based on indicator
          pieChart: {
            labels: INDICATOR_CONFIG[indicator]?.pieChartLabels || ["Data", "Other"],
            datasets: [
              {
                data: indicator === 'climate' 
                  ? [
                    response.data[0].data.green_space_percentage || 0,
                    100 - (response.data[0].data.green_space_percentage || 0)
                  ] 
                  : indicator === 'land_use' 
                    ? [
                      response.data[0].data.mixed_use_ratio || 0,
                      100 - (response.data[0].data.mixed_use_ratio || 0)
                    ] 
                    : [
                      response.data[0].data.public_transport_coverage || 0,
                      100 - (response.data[0].data.public_transport_coverage || 0)
                    ],
                backgroundColor: [
                  config.charts.colors.secondary,
                  config.charts.colors.tertiary,
                ],
              },
            ],
          },

          // Additional data
          trafficLight: response.data[0].data.trafficLight,
          dataTable: response.data[0].data.dataTable
        };

        // Only log on initial load to reduce console noise during polling
        if (isInitialLoad) {
          console.log("Transformed dashboard data:", transformedData);
        }
        
        // Deep compare the new data with existing data to avoid unnecessary renders
        if (!dashboardData || !isEqual(dashboardData, transformedData)) {
          setDashboardData(transformedData);
          setLastUpdate(new Date().toLocaleString());
        }
        
        setError(null);
      } else {
        if (isInitialLoad) {
          setError("No data available for this indicator");
        }
      }
    } catch (err) {
      console.error(`Error fetching ${indicator} dashboard data:`, err);
      setError(err.message);
    } finally {
      if (loading) {
        setLoading(false);
      }
    }
  }, [dashboardData, loading]);

  // Check for remote controller changes with debouncing to reduce flickering
  const checkRemoteChanges = useCallback(async () => {
    // Limit API calls to prevent overloading
    const now = Date.now();
    if (now - lastCheckedRef.current < 150) return; // Minimum interval between checks
    lastCheckedRef.current = now;
    
    try {
      const response = await api.get('/api/actions/get_global_variables/');
      if (response.data) {
        // Update our local globals to match server
        if (response.data.indicator_state) {
          globals.INDICATOR_STATE = response.data.indicator_state;
        }
        if (response.data.visualization_mode) {
          globals.VISUALIZATION_MODE = response.data.visualization_mode;
        }
        
        // Handle indicator changes
        if (response.data.indicator_id !== undefined) {
          globals.INDICATOR_ID = response.data.indicator_id;
          
          // Convert indicator_id to number if it's a string
          const indicatorId = parseInt(response.data.indicator_id, 10);
          const newIndicator = ID_TO_INDICATOR[indicatorId];
          
          if (newIndicator && newIndicator !== indicatorRef.current) {
            console.log(`Remote controller changed indicator to: ${newIndicator}`);
            
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
      }
    } catch (err) {
      console.error('Error checking remote changes:', err);
    }
  }, []);

  // Initialize data and polling
  useEffect(() => {
    let isMounted = true;
    let dataIntervalId;
    let checkIntervalId;
    // Capture the current timer ID to avoid cleanup issues
    const currentTimerRef = debounceTimerRef.current;

    const initData = async () => {
      if (isMounted) {
        try {
          await fetchDashboardData(currentIndicator);
        } catch (err) {
          console.error('Error in initial data fetch:', err);
        }
        
        // Set up polling for dashboard data - at a slower rate
        dataIntervalId = setInterval(() => {
          if (isMounted) {
            fetchDashboardData(currentIndicator).catch(err => {
              console.error('Error in dashboard data polling:', err);
            });
          }
        }, config.polling.interval);
        
        // Set up frequent polling for remote controller changes
        checkIntervalId = setInterval(() => {
          if (isMounted) {
            checkRemoteChanges();
          }
        }, 200); // Poll every 200ms for good balance between responsiveness and performance
      }
    };

    initData();

    return () => {
      isMounted = false;
      clearInterval(dataIntervalId);
      clearInterval(checkIntervalId);
      // Clear the timer that was active when this effect ran
      if (currentTimerRef) {
        clearTimeout(currentTimerRef);
      }
    };
  }, [currentIndicator, fetchDashboardData, checkRemoteChanges]);

  // Function to switch indicators
  const changeIndicator = useCallback((newIndicator) => {
    if (newIndicator !== currentIndicator && 
        Object.keys(INDICATOR_CONFIG).includes(newIndicator)) {
      
      // Set loading state first to prevent flickering
      setLoading(true);
      
      // Set the indicator locally
      setCurrentIndicator(newIndicator);
      
      // Update the remote controller by sending the change to the API
      const indicatorId = INDICATOR_CONFIG[newIndicator]?.id;
      if (indicatorId) {
        // Send the change to the API
        api.post('/api/actions/set_current_indicator/', { indicator_id: indicatorId })
          .then(() => {
            console.log(`Updated remote controller to ${newIndicator} (ID: ${indicatorId})`);
            
            // Give the system time to complete the transition before clearing loading state
            setTimeout(() => {
              setLoading(false);
            }, 500);
          })
          .catch(err => {
            console.error('Error updating remote controller:', err);
            setLoading(false);
          });
      } else {
        setLoading(false);
      }
    }
  }, [currentIndicator]);

  // Value object with additional helpers for the new indicator system
  const contextValue = {
    dashboardData,
    currentIndicator,
    changeIndicator,
    loading,
    error,
    lastUpdate,
    indicatorConfig: INDICATOR_CONFIG,
    // Helper methods for getting indicator-specific information
    getIndicatorTitle: () => INDICATOR_CONFIG[currentIndicator]?.name || "Dashboard",
    getTabLabels: () => INDICATOR_CONFIG[currentIndicator]?.tabLabels || ["Tab 1", "Tab 2", "Tab 3", "Tab 4"],
  };

  return (
    <DataContext.Provider value={contextValue}>
      {children}
    </DataContext.Provider>
  );
};

export const useAppData = () => {
  return useContext(DataContext);
};




