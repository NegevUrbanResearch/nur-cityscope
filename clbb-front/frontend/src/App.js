import React, { useState, useEffect, useRef } from 'react';
import RadarChart from './componentes/RadarChart';
import PieChart from './componentes/PieChart';
import BarChart from './componentes/BarChart.js';
import HorizontalStackedBar from './componentes/HorizontalStackedBar';
import TableComponent from './componentes/tablaHeap.js';
import './index.css';
import axios from 'axios';
import isEqual from 'lodash/isEqual';

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
  const prevStateRef = useRef(null);

  useEffect(() => {
    const apiUrl = 'http://localhost:9900/api/dashboard_feed_state/';

    let isMounted = true;
    let intervalId;
    let isFetching = false;

    const fetchData = async () => {
      if (isFetching) return;
      isFetching = true;
      try {
        console.log('Fetching data from:', apiUrl);
        const response = await axios.get(apiUrl);
        console.log('Raw API Response:', response.data);
        
        // Transform the data to match the expected format
        const transformedData = {
          barrasHorizontalesStackeadas: {
            labels: ['Proximity'],
            datasets: [{
              label: 'Value',
              data: [response.data[0].data.total_population / 10000], // Normalize for display
              backgroundColor: '#3498db'
            }]
          },
          barrasStackeadas: {
            labels: ['Density'],
            datasets: [{
              label: 'Value',
              data: [response.data[0].data.average_building_height],
              backgroundColor: '#2ecc71'
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
              backgroundColor: 'rgba(52, 152, 219, 0.2)',
              borderColor: '#3498db',
              pointBackgroundColor: '#3498db'
            }]
          },
          graficoDeTorta: {
            labels: ['Green Space', 'Other'],
            datasets: [{
              data: [
                response.data[0].data.green_space_percentage,
                100 - response.data[0].data.green_space_percentage
              ],
              backgroundColor: ['#2ecc71', '#95a5a6']
            }]
          }
        };

        console.log('Transformed Data:', transformedData);

        if (!isMounted) return;

        setData(transformedData);
        setLastUpdate(new Date());
        setLoading(false);
        setError(null);
      } catch (err) {
        console.error('Error fetching data:', err);
        if (isMounted) {
          setError(err.message);
          setLoading(false);
        }
      } finally {
        isFetching = false;
      }
    };

    // Initial fetch
    fetchData();

    // Set up polling interval
    intervalId = setInterval(fetchData, 1000);

    // Cleanup function
    return () => {
      isMounted = false;
      if (intervalId) {
        clearInterval(intervalId);
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
            Dashboard Control Panel
          </h2>
        </div>

        <div className="columna" style={{ position: 'relative', overflow: 'hidden' }}>
          <div className="columna1">
            <div className="grafico">
              <h3>Proximity</h3>
              <MemoizedHorizontalStackedBar data={data?.barrasHorizontalesStackeadas} />
            </div>
            <div className="grafico">
              <h3>Density</h3>
              <MemoizedBarChart data={data?.barrasStackeadas} />
            </div>
          </div>

          <div className="columna2" style={{ position: 'relative' }}>
            <div className="grafico centrado">
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

          <div className="columna3">
            <div className="grafico">
              <h3>Land Use</h3>
              <MemoizedPieChart data={data?.graficoDeTorta} />
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
                src="https://citylabbiobio.cl/wp-content/uploads/2023/08/logo-CLBB-ch.png"
                alt="CityLab Biobío"
                style={{ width: '200px' }}
              />
            </div>
          </div>
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: 20, left: 20, color: 'white' }}>
        Last update: {lastUpdate ? lastUpdate.toLocaleTimeString() : 'N/A'}
      </div>
    </div>
  );
};

export default App;
