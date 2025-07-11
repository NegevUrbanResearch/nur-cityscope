import React, { useState, useEffect, useMemo } from 'react';
import { DeckGL } from '@deck.gl/react';
import { ScatterplotLayer, GeoJsonLayer } from '@deck.gl/layers';
import { HexagonLayer } from '@deck.gl/aggregation-layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { LightingEffect } from '@deck.gl/core';
import { Map } from 'react-map-gl';
import { Box, Typography, CircularProgress } from '@mui/material';
import api from '../../api';
import config from '../../config';
import 'mapbox-gl/dist/mapbox-gl.css';

// Use the default style from config
const MAPBOX_STYLE = config.map.defaultStyle;

// Default initial view state (Ben Gurion University coordinates)
const INITIAL_VIEW_STATE = {
  longitude: 34.7996,
  latitude: 31.2614,
  zoom: 14,
  pitch: 35,
  bearing: 0
};

/**
 * DeckGLMap component renders different visualizations based on indicator type
 * 
 * @param {Object} props - Component props
 * @param {string} props.indicatorType - Type of indicator ('mobility', 'climate', 'land_use')
 * @param {Object} props.state - Current state (year, scenario, etc.)
 */
const DeckGLMap = ({ indicatorType, state }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  // Use a state variable to control animation time instead of dynamic function
  const [animationTime, setAnimationTime] = useState(0);

  // Animation timer effect
  useEffect(() => {
    // Only run animation for mobility indicator type
    if (indicatorType === 'mobility' && data && data.trips) {
      const animationTimer = setInterval(() => {
        setAnimationTime(time => (time + 1) % 1000);
      }, 100);
      
      return () => clearInterval(animationTimer);
    }
  }, [indicatorType, data]);

  // Fetch data when indicator or state changes
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Add cache-busting query param and include year if available
        const timestamp = Date.now();
        const yearParam = state && state.year ? `&year=${state.year}` : '';
        
        // Fetch data from our new endpoint that does the processing in the backend
        const response = await api.get(`/api/actions/get_deckgl_data/?_=${timestamp}&indicator=${indicatorType}${yearParam}`);
        
        if (response.data) {
          // Data is already processed by the backend
          setData(response.data);
          
          // Update view state if bounds are provided
          if (response.data.metadata && response.data.metadata.bounds) {
            const { west, south, east, north } = response.data.metadata.bounds;
            
            // Check if Ben Gurion University is within the bounds
            const bguLng = 34.7996;
            const bguLat = 31.2614;
            
            // Set longitude and latitude
            let longitude, latitude;
            
            if (bguLng >= west && bguLng <= east && bguLat >= south && bguLat <= north) {
              // BGU is within bounds, use it as center
              longitude = bguLng;
              latitude = bguLat;
            } else {
              // Otherwise use the center of the bounds
              longitude = (west + east) / 2;
              latitude = (south + north) / 2;
            }
            
            // Calculate appropriate zoom level
            const latDiff = Math.abs(north - south);
            const lngDiff = Math.abs(east - west);
            const maxDiff = Math.max(latDiff, lngDiff);
            const zoom = Math.floor(8 - Math.log2(maxDiff));
            
            setViewState({
              longitude,
              latitude,
              zoom: Math.min(Math.max(zoom, 12), 15), // Keep zoom relatively close
              pitch: 35,
              bearing: 0
            });
          }
        } else {
          throw new Error('No data found in response');
        }
      } catch (err) {
        console.error('Error fetching map data:', err);
        setError(err.message);
        
        // We don't need fallback data as the backend generates it
        // But we could still set default view state
        setViewState(INITIAL_VIEW_STATE);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [indicatorType, state]);

  // Get appropriate layers based on indicator type
  const layers = useMemo(() => {
    if (!data) return [];
    
    switch (indicatorType) {
      case 'mobility':
        return [
          // Trips layer for movement patterns
          new TripsLayer({
            id: 'trips-layer',
            data: data.trips || [],
            getPath: d => d.path,
            getTimestamps: d => d.timestamps,
            getColor: [255, 153, 51],  // Brighter orange
            opacity: 0.9,
            widthMinPixels: 3,
            jointRounded: true,
            capRounded: true,
            trailLength: 200,
            currentTime: animationTime
          }),
          // Roads or transit network
          new GeoJsonLayer({
            id: 'transit-layer',
            data: data.transit || data.features || [],
            pickable: true,
            stroked: false,
            filled: true,
            extruded: true,
            lineWidthScale: 20,
            lineWidthMinPixels: 2,
            getFillColor: d => d.properties?.color || [80, 210, 200, 180],  // Teal CityScope color
            getLineColor: [255, 255, 255],
            getPointRadius: 100,
            getLineWidth: 1,
            getElevation: 40
          })
        ];
        
      case 'climate':
        return [
          // Heat map for climate data
          new HeatmapLayer({
            id: 'heat-layer',
            data: data.points || data.features || [],
            getPosition: d => d.coordinates || d.geometry?.coordinates,
            getWeight: d => d.properties?.intensity || 1,
            radiusPixels: 60,
            intensity: 1.5,
            threshold: 0.03,
            colorRange: [
              [29, 145, 192],   // CityScope blue
              [65, 182, 196],   // CityScope teal
              [127, 205, 187],  // CityScope light green
              [199, 233, 180],  // CityScope pale green
              [252, 174, 97],   // CityScope orange
              [244, 109, 67]    // CityScope red
            ]
          }),
          // GeoJSON layer for boundaries or zones
          new GeoJsonLayer({
            id: 'geojson-layer',
            data: data.boundaries || data.features || [],
            pickable: true,
            stroked: true,
            filled: true,
            extruded: false,
            lineWidthScale: 20,
            lineWidthMinPixels: 2,
            getFillColor: d => d.properties?.colorArray || [120, 120, 220, 40],  // Bluish tint
            getLineColor: [200, 200, 255],
            getLineWidth: 1
          })
        ];
        
      case 'land_use':
        return [
          // Hexagon layer for land use density
          new HexagonLayer({
            id: 'hexagon-layer',
            data: data.points || data.features || [],
            getPosition: d => d.coordinates || d.geometry?.coordinates,
            getElevationWeight: d => d.properties?.height || 1,
            getColorWeight: d => d.properties?.color_value || 1,
            elevationScale: 120,
            extruded: true,
            radius: 80,
            coverage: 0.85,
            upperPercentile: 90,
            material: {
              ambient: 0.64,
              diffuse: 0.6,
              shininess: 32,
              specularColor: [51, 51, 51]
            },
            colorRange: [
              [29, 145, 192],   // CityScope blue
              [65, 182, 196],   // CityScope teal
              [127, 205, 187],  // CityScope light green
              [199, 233, 180],  // CityScope pale green
              [252, 174, 97],   // CityScope orange
              [244, 109, 67]    // CityScope red
            ]
          }),
          // Buildings as 3D extrusions
          new GeoJsonLayer({
            id: 'buildings-layer',
            data: data.buildings || data.features || [],
            pickable: true,
            stroked: true,
            filled: true,
            extruded: true,
            lineWidthScale: 20,
            lineWidthMinPixels: 2,
            getFillColor: d => d.properties?.color || [160, 160, 180, 200],
            getLineColor: [255, 255, 255],
            getLineWidth: 1,
            getElevation: d => d.properties?.height || 10
          })
        ];
        
      default:
        return [
          // Default layer showing points of interest
          new ScatterplotLayer({
            id: 'scatterplot-layer',
            data: data.points || data.features || [],
            getPosition: d => d.coordinates || d.geometry?.coordinates,
            getRadius: d => d.properties?.radius || 50,
            getFillColor: d => d.properties?.color || [255, 140, 0],
            pickable: true,
            opacity: 0.8,
            stroked: true,
            radiusScale: 6,
            radiusMinPixels: 3,
            radiusMaxPixels: 100,
            lineWidthMinPixels: 1
          })
        ];
    }
  }, [data, indicatorType, animationTime]);

  if (loading) {
    return (
      <Box 
        sx={{ 
          height: '100%', 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center',
          bgcolor: 'rgba(0,0,0,0.1)',
          borderRadius: 1 
        }}
      >
        <CircularProgress />
        <Typography variant="body1" sx={{ ml: 2 }}>
          Loading visualization...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box 
        sx={{ 
          height: '100%', 
          display: 'flex', 
          flexDirection: 'column',
          justifyContent: 'center', 
          alignItems: 'center',
          bgcolor: 'rgba(0,0,0,0.1)',
          borderRadius: 1,
          padding: 2
        }}
      >
        <Typography variant="h6" color="error" gutterBottom>
          Error loading visualization
        </Typography>
        <Typography variant="body2">
          {error}
        </Typography>
        <Typography variant="body2" sx={{ mt: 2 }}>
          Please try switching to image mode or refreshing the page.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ 
      position: 'relative', 
      width: '100%', 
      height: '100%', 
      overflow: 'hidden',
      '& canvas': {
        position: 'static !important'
      } 
    }}>
      <DeckGL
        layers={layers}
        initialViewState={viewState}
        controller={true}
        style={{ position: 'relative', width: '100%', height: '100%' }}
        effects={[
          new LightingEffect({
            ambientLight: {
              color: [255, 255, 255],
              intensity: 0.85
            },
            pointLights: [
              {
                color: [255, 255, 255],
                intensity: 0.8,
                position: [viewState.longitude, viewState.latitude, 10000]
              }
            ]
          })
        ]}
      >
        <Map 
          mapStyle={MAPBOX_STYLE}
          preventStyleDiffing={true}
          reuseMaps
          mapboxAccessToken={config.map.accessToken}
          mapOptions={{
            logoPosition: 'bottom-right',
            style: {
              'light': {
                'anchor': 'viewport',
                'color': '#fff',
                'intensity': 0.4
              }
            }
          }}
        />
      </DeckGL>
    </Box>
  );
};

export default DeckGLMap; 