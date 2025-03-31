import React, { useState, useEffect } from 'react';
import RadarChart from './components/RadarChart';
import PieChart from './components/PieChart';
import BarChart from './components/BarChart.js';
import HorizontalStackedBar from './components/HorizontalStackedBar';
import './index.css';
import axios from 'axios';
import isEqual from 'lodash/isEqual';
import config from './config';

// Memoize components to avoid unnecessary re-renders
const MemoizedRadarChart = React.memo(RadarChart, (prevProps, nextProps) => isEqual(prevProps.data, nextProps.data));
const MemoizedPieChart = React.memo(PieChart);
const MemoizedBarChart = React.memo(BarChart, (prevProps, nextProps) => isEqual(prevProps.data, nextProps.data));
const MemoizedHorizontalStackedBar = React.memo(HorizontalStackedBar, (prevProps, nextProps) => isEqual(prevProps.data, nextProps.data));

const App = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    const apiUrl = config.api.getDashboardFeedUrl();
    console.log('Attempting to fetch data from:', apiUrl);

    let isMounted = true;
    let intervalId;
    let isFetching = false;

    const fetchData = async () => {
      if (isFetching) {
        console.log('Previous fetch still in progress, skipping...');
        return;
      }

      try {
        console.log('Starting data fetch from:', apiUrl);
        isFetching = true;
        const response = await axios.get(apiUrl);
        console.log('Received response from:', apiUrl);
        console.log('Response status:', response.status);
        console.log('Response data:', response.data);

        if (!isMounted) return;

        // Transform the data to match the expected format
        const transformedData = {
          horizontalStackedBars: {
            labels: ['Proximity'],
            datasets: [{
              label: 'Value',
              data: [response.data[0].data.total_population / 10000], // Normalize for display
              backgroundColor: config.charts.colors.primary
            }]
          },
          stackedBars: {
            labels: ['Density'],
            datasets: [{
              label: 'Value',
              data: [response.data[0].data.average_building_height],
              backgroundColor: config.charts.colors.secondary
            }]
          },
          radar: {
            labels: ['Proximity', 'Density', 'Diversity'],
            datasets: [{
              label: 'Values',
              data: [
                response.data[0].data.total_population / 10000,
                response.data[0].data.average_building_height,
                response.data[0].data.green_space_percentage
              ],
              backgroundColor: `rgba(${config.charts.colors.primary}, 0.2)`,
              borderColor: config.charts.colors.primary,
              pointBackgroundColor: config.charts.colors.primary
            }]
          },
          pieChart: {
            labels: ['Green Space', 'Other'],
            datasets: [{
              data: [
                response.data[0].data.green_space_percentage,
                100 - response.data[0].data.green_space_percentage
              ],
              backgroundColor: [config.charts.colors.secondary, config.charts.colors.tertiary]
            }]
          }
        };

        console.log('Transformed data:', transformedData);
        setData(transformedData);
        setLastUpdate(new Date().toLocaleString());
        setError(null);
      } catch (err) {
        console.error('Error fetching data from:', apiUrl);
        console.error('Error details:', err.message);
        if (err.response) {
          console.error('Response status:', err.response.status);
          console.error('Response data:', err.response.data);
        }
        if (isMounted) {
          setError(err.message);
        }
      } finally {
        isFetching = false;
      }
    };

    // Initial fetch
    fetchData();

    // Set up polling interval
    intervalId = setInterval(fetchData, config.polling.interval);
    console.log(`Set up polling interval of ${config.polling.interval / 1000} seconds`);

    return () => {
      console.log('Cleaning up...');
      isMounted = false;
      if (intervalId) {
        clearInterval(intervalId);
        console.log('Cleared polling interval');
      }
    };
  }, []);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        backgroundColor: '#1a1a1a',
        color: 'white',
        fontSize: '1.2em',
        flexDirection: 'column'
      }}>
        <div style={{
          width: '50px',
          height: '50px',
          border: '5px solid #f3f3f3',
          borderTop: '5px solid #3498db',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          marginBottom: '20px'
        }} />
        <div>Loading data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        backgroundColor: '#1a1a1a',
        color: '#ff4444',
        fontSize: '1.2em',
        flexDirection: 'column'
      }}>
        <div>Error loading data: {error}</div>
        <button 
          onClick={() => window.location.reload()} 
          style={{
            marginTop: '20px',
            padding: '10px 20px',
            backgroundColor: '#3498db',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer'
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div>
        <div>
          <h2
            style={{
              position: 'absolute',
              left: 20,
              top: 20,
              zIndex: 2,
              color: 'white',
              margin: -15,
              padding: -5,
            }}
          >
            {config.frontend.title}
          </h2>
        </div>

        <div className="column" style={{ position: 'relative', overflow: 'hidden' }}>
          <div className="column1">
            <div className="chart">
              <h3>Proximity</h3>
              <MemoizedHorizontalStackedBar data={data?.horizontalStackedBars} />
            </div>
            <div className="chart">
              <h3>Density</h3>
              <MemoizedBarChart data={data?.stackedBars} />
            </div>
          </div>

          <div className="column2" style={{ position: 'relative' }}>
            <div className="chart centered">
              <div style={{ textAlign: 'center' }}>
                <h3>Radar Chart</h3>
              </div>
              <MemoizedRadarChart data={data?.radar} />
              <div
                style={{
                  position: 'absolute',
                  top: 150,
                  right: 50,
                  color: '#00BFFF',
                  zIndex: 2,
                  fontSize: '30px',
                }}
              >
                <p>Proximity</p>
              </div>
              <div
                style={{
                  position: 'absolute',
                  top: 700,
                  right: 475,
                  color: '#FFFF00',
                  zIndex: 2,
                  fontSize: '30px',
                }}
              >
                <p>Diversity</p>
              </div>
              <div
                style={{
                  position: 'absolute',
                  top: 350,
                  right: 750,
                  color: 'white',
                  zIndex: 2,
                  fontSize: '30px',
                }}
              >
                <p>Density</p>
              </div>
            </div>
          </div>

          <div className="column3">
            <div className="chart">
              <h3>Land Use</h3>
              <MemoizedPieChart data={data?.pieChart} />
            </div>
            <div
              style={{
                position: 'absolute',
                top: 700,
                right: 150,
                color: 'white',
                zIndex: 2,
              }}
            >
              <img
                src={config.frontend.logo.url}
                alt="CityLab Biobío"
                style={{ width: config.frontend.logo.width }}
              />
            </div>
          </div>
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: 20, left: 20, color: 'white' }}>
        Last update: {lastUpdate ? lastUpdate : 'N/A'}
      </div>
    </div>
  );
};

export default App;