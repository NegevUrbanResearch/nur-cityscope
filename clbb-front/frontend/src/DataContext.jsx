import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

import config from "./config";


const DataContext = createContext();

export const DataProvider = ({ children }) => {
    
  const [map1data, setMap1Data] = useState(null);
  const [map2data, setMap2Data] = useState(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);


  useEffect(() => {
    const apiUrl = config.api.getDashboardFeedUrl();
    console.log("Attempting to fetch data from:", apiUrl);

    let isMounted = true;
    let intervalId;
    let isFetching = false;

    const fetchData = async () => {
      if (isFetching) {
        console.log("Previous fetch still in progress, skipping...");
        return;
      }

      try {
        console.log("Starting data fetch from:", apiUrl);
        isFetching = true;
        const response = await axios.get(apiUrl);
        console.log("Received response from:", apiUrl);
        console.log("Response status:", response.status);
        console.log("Response data:", response.data);

        if (!isMounted) return;

        // Transform the data to match the expected format
        const transformedData = {
          // Direct mapping for radar chart - it expects categories, valuesSet1, valuesSet2
          radar: response.data[0].data.radar,

          // Direct mapping for horizontal stacked bar chart - it expects bars with name and values
          horizontalStackedBars: response.data[0].data.horizontalStackedBar,

          // Direct mapping for stacked bar chart - it expects bars with name and values
          stackedBars: response.data[0].data.stackedBar,

          // Pie chart data transformation
          pieChart: {
            labels: ["Green Space", "Other"],
            datasets: [
              {
                data: [
                  response.data[0].data.green_space_percentage,
                  100 - response.data[0].data.green_space_percentage,
                ],
                backgroundColor: [
                  config.charts.colors.secondary,
                  config.charts.colors.tertiary,
                ],
              },
            ],
          },
        };

        console.log("Transformed data:", transformedData);
        setMap1Data(transformedData);
        setLastUpdate(new Date().toLocaleString());
        setError(null);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching data from:", apiUrl);
        console.error("Error details:", err.message);
        if (err.response) {
          console.error("Response status:", err.response.status);
          console.error("Response data:", err.response.data);
        }
        if (isMounted) {
          setError(err.message);
        }
      } finally {
        isFetching = false;
      }
    }

    fetchData();

    intervalId = setInterval(fetchData, config.polling.interval);
    console.log(`Set polling interval of ${config.polling.interval / 1000} seconds`);

    return () => {
      console.log("Cleaning up...");
      isMounted = false;
      clearInterval(intervalId);
    };
  }, []);

  return (
    <DataContext.Provider
      value={{
        map1data,
        map2data,
        loading,
        error,
        lastUpdate,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}


export const useAppData = ()=> {
  return useContext(DataContext);
}




