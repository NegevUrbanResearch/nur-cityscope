import React, { createContext, useContext, useState, useEffect } from 'react';
import api from './api'; // Import the pre-configured api instance

import config from "./config";

const DataContext = createContext();

export const DataProvider = ({ children }) => {
  // Store the current indicator type (mobility, climate, land_use)
  const [currentIndicator, setCurrentIndicator] = useState('mobility');
  
  // Store the dashboard data for the current indicator
  const [dashboardData, setDashboardData] = useState(null);
  
  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Function to fetch data for the current indicator
  const fetchDashboardData = async (indicator) => {
    if (!indicator) return;
    
    // Use a relative URL with the api instance
    const endpoint = `/api/dashboard_feed_state/?dashboard_type=${indicator}`;
    console.log(`Fetching ${indicator} dashboard data from:`, endpoint);
    
    try {
      setLoading(true);
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
            labels: indicator === 'climate' 
              ? ["Green Space", "Other"] 
              : indicator === 'land_use' 
                ? ["Mixed Use", "Single Use"] 
                : ["Public Transport Coverage", "No Coverage"],
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

        console.log("Transformed dashboard data:", transformedData);
        setDashboardData(transformedData);
        setLastUpdate(new Date().toLocaleString());
        setError(null);
      } else {
        setError("No data available for this indicator");
      }
    } catch (err) {
      console.error(`Error fetching ${indicator} dashboard data:`, err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch data on indicator change
  useEffect(() => {
    let isMounted = true;
    let intervalId;

    const initData = async () => {
      await fetchDashboardData(currentIndicator);
      
      if (isMounted) {
        // Set up polling
        intervalId = setInterval(() => {
          fetchDashboardData(currentIndicator);
        }, config.polling.interval);
      }
    };

    initData();

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [currentIndicator]);

  // Function to switch indicators
  const changeIndicator = (newIndicator) => {
    if (newIndicator !== currentIndicator && 
        ['mobility', 'climate', 'land_use'].includes(newIndicator)) {
      setCurrentIndicator(newIndicator);
    }
  };

  return (
    <DataContext.Provider
      value={{
        dashboardData,
        currentIndicator,
        changeIndicator,
        loading,
        error,
        lastUpdate,
      }}
    >
      {children}
    </DataContext.Provider>
  );
};

export const useAppData = () => {
  return useContext(DataContext);
};




