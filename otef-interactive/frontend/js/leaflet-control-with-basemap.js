// IMPROVED VERSION: Uses WGS84 with real basemap and transforms layers from EPSG:2039

// Define EPSG:2039 projection for transformation
proj4.defs('EPSG:2039', '+proj=tmerc +lat_0=31.73439361111111 +lon_0=35.20451694444445 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs');

// Model bounds (in EPSG:2039)
let modelBounds;

// Initialize map in WGS84 (standard Leaflet)
const map = L.map('map', {
    minZoom: 10,
    maxZoom: 19,
    zoomControl: true,
    maxBoundsViscosity: 1.0  // Prevent dragging outside bounds
});

// Add OpenStreetMap basemap
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
}).addTo(map);

// Alternative basemaps (can be switched)
const basemaps = {
    'OpenStreetMap': osmLayer,
    'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 19
    }),
    'Light': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        maxZoom: 19
    })
};

// Layer references
let parcelsLayer, roadsLayer, modelOverlay;

// Helper function to transform coordinates from EPSG:2039 to WGS84
function transformItmToWgs84(x, y) {
    const [lon, lat] = proj4('EPSG:2039', 'EPSG:4326', [x, y]);
    return [lat, lon];  // Return as [lat, lon] for Leaflet
}

// Helper function to transform GeoJSON from EPSG:2039 to WGS84
function transformGeojsonToWgs84(geojson) {
    const transformed = JSON.parse(JSON.stringify(geojson));  // Deep clone
    
    function transformCoords(coords, depth = 0) {
        if (depth > 10) return coords;  // Safety limit
        
        if (typeof coords[0] === 'number') {
            // This is a coordinate pair [x, y] in EPSG:2039
            const [lon, lat] = proj4('EPSG:2039', 'EPSG:4326', [coords[0], coords[1]]);
            return [lon, lat];
        } else {
            // Recurse into nested arrays
            return coords.map(c => transformCoords(c, depth + 1));
        }
    }
    
    // Transform each feature's geometry
    if (transformed.features) {
        transformed.features.forEach(feature => {
            if (feature.geometry && feature.geometry.coordinates) {
                feature.geometry.coordinates = transformCoords(feature.geometry.coordinates);
            }
        });
    }
    
    // Update CRS to WGS84
    transformed.crs = {
        type: 'name',
        properties: { name: 'EPSG:4326' }
    };
    
    return transformed;
}

// Load model bounds and initialize
fetch('data/model-bounds.json')
    .then(res => res.json())
    .then(bounds => {
        modelBounds = bounds;
        console.log('Model bounds loaded (EPSG:2039):', bounds);
        
        // Transform bounds to WGS84
        const [swLat, swLon] = transformItmToWgs84(bounds.west, bounds.south);
        const [neLat, neLon] = transformItmToWgs84(bounds.east, bounds.north);
        
        const wgs84Bounds = L.latLngBounds(
            L.latLng(swLat, swLon),
            L.latLng(neLat, neLon)
        );
        
        console.log('Model bounds in WGS84:', {
            sw: [swLat, swLon],
            ne: [neLat, neLon]
        });
        
        // Restrict map to model bounds only
        map.setMaxBounds(wgs84Bounds);
        map.fitBounds(wgs84Bounds);
        
        console.log('Map bounds restricted to model area');
        
        // Add model image overlay (hidden by default)
        modelOverlay = L.imageOverlay('data/model-transparent.png', wgs84Bounds, {
            opacity: 0.7,
            interactive: false,
            className: 'model-overlay'
        });  // Don't add to map on init
        
        window.modelLayer = modelOverlay;
        document.getElementById('toggleModel').checked = false;  // Unchecked by default
        
        console.log('Map initialized with WGS84 basemap!');
        
        // Load GeoJSON layers
        loadGeoJSONLayers();
    })
    .catch(error => {
        console.error('Error loading model bounds:', error);
    });

function loadGeoJSONLayers() {
    console.log('Loading GeoJSON layers (simplified versions for performance)...');
    
    // Load parcels (simplified)
    fetch('/otef-interactive/data-source/layers-simplified/migrashim_simplified.json')
        .then(res => res.json())
        .then(geojson => {
            console.log(`Loaded ${geojson.features.length} parcels (EPSG:2039, simplified)`);
            console.log('Transforming parcels to WGS84...');
            
            const transformed = transformGeojsonToWgs84(geojson);
            
            parcelsLayer = L.geoJSON(transformed, {
                style: typeof getParcelStyle === 'function' ? getParcelStyle : {
                    color: '#6495ED',
                    fillColor: '#6495ED',
                    weight: 1,
                    fillOpacity: 0.3,
                    opacity: 0.8
                },
                onEachFeature: (feature, layer) => {
                    // Bind popup with rich content
                    if (typeof createPopupContent === 'function') {
                        layer.bindPopup(() => createPopupContent(feature.properties));
                    }
                    
                    layer.on('click', () => {
                        showFeatureInfo(feature);
                    });
                }
            });  // Don't add to map on init
            
            window.parcelsLayer = parcelsLayer;
            const parcelToggle = document.getElementById('toggleParcels');
            parcelToggle.disabled = false;
            parcelToggle.checked = false;  // Unchecked by default
            parcelToggle.nextSibling.textContent = ' Parcels';
            console.log('Parcels layer ready (hidden by default)');
        })
        .catch(error => {
            console.error('Error loading parcels:', error);
            const parcelToggle = document.getElementById('toggleParcels');
            parcelToggle.nextSibling.textContent = ' Parcels (ERROR - check console)';
            alert('Failed to load parcels layer. Check browser console (F12) for details.');
        });
    
    // Load roads (fixed and simplified version)
    fetch('/otef-interactive/data-source/layers-simplified/small_roads_simplified.json')
        .then(res => res.json())
        .then(geojson => {
            console.log(`Loaded ${geojson.features.length} road features (EPSG:2039, simplified)`);
            
            // Roads are already in EPSG:2039 after fixing, so transform them
            console.log('Transforming roads to WGS84...');
            const transformed = transformGeojsonToWgs84(geojson);
            
            roadsLayer = L.geoJSON(transformed, {
                style: typeof getRoadStyle === 'function' ? getRoadStyle : {
                    color: '#FF8C00',
                    weight: 2,
                    opacity: 0.8
                },
                onEachFeature: (feature, layer) => {
                    layer.on('click', () => {
                        showFeatureInfo(feature);
                    });
                }
            }).addTo(map);  // Add to map on init (visible by default)
            
            window.roadsLayer = roadsLayer;
            const roadToggle = document.getElementById('toggleRoads');
            roadToggle.disabled = false;
            roadToggle.checked = true;  // Checked by default
            roadToggle.nextSibling.textContent = ' Roads';
            document.getElementById('roadsLegend').style.display = 'block';  // Show legend
            console.log('Roads layer ready and visible');
        })
        .catch(error => {
            console.error('Error loading roads:', error);
            const roadToggle = document.getElementById('toggleRoads');
            roadToggle.nextSibling.textContent = ' Roads (ERROR - check console)';
        });
}

// Send viewport updates on move (transform to EPSG:2039 for projection display)
// FIXED v2: Send all 4 corners to handle non-rectangular projection distortion
map.on('moveend', () => {
    // Get viewport size in pixels
    const size = map.getSize();
    
    // Get all 4 corners of the viewport in pixel coordinates
    const corners_pixel = {
        sw: L.point(0, size.y),          // bottom-left
        se: L.point(size.x, size.y),     // bottom-right  
        nw: L.point(0, 0),               // top-left
        ne: L.point(size.x, 0)           // top-right
    };
    
    // Convert each corner to WGS84
    const corners_wgs84 = {};
    for (const [name, pixel] of Object.entries(corners_pixel)) {
        corners_wgs84[name] = map.containerPointToLatLng(pixel);
    }
    
    // Transform each corner to EPSG:2039
    const corners_itm = {};
    for (const [name, latlng] of Object.entries(corners_wgs84)) {
        const [x, y] = proj4('EPSG:4326', 'EPSG:2039', [latlng.lng, latlng.lat]);
        corners_itm[name] = { x, y };
    }
    
    // Calculate bounding box from all 4 corners (handles trapezoid distortion)
    const all_x = Object.values(corners_itm).map(c => c.x);
    const all_y = Object.values(corners_itm).map(c => c.y);
    
    const bbox = [
        Math.min(...all_x),  // west
        Math.min(...all_y),  // south
        Math.max(...all_x),  // east
        Math.max(...all_y)   // north
    ];
    
    // Debug info
    const bboxWidth = bbox[2] - bbox[0];
    const bboxHeight = bbox[3] - bbox[1];
    
    console.log('[DEBUG] Viewport pixels:', size.x, 'x', size.y);
    console.log('[DEBUG] ITM corners:');
    console.log('  SW:', corners_itm.sw.x.toFixed(1), corners_itm.sw.y.toFixed(1));
    console.log('  SE:', corners_itm.se.x.toFixed(1), corners_itm.se.y.toFixed(1));
    console.log('  NW:', corners_itm.nw.x.toFixed(1), corners_itm.nw.y.toFixed(1));
    console.log('  NE:', corners_itm.ne.x.toFixed(1), corners_itm.ne.y.toFixed(1));
    console.log('[DEBUG] Bbox size:', bboxWidth.toFixed(1), 'x', bboxHeight.toFixed(1), 'm');
    
    // Update debug overlay
    if (window.DebugOverlay) {
        window.DebugOverlay.updateMapDimensions(size.x, size.y);
        window.DebugOverlay.setZoom(map.getZoom());
        window.DebugOverlay.updateSentBbox(bbox);
    }
    
    // Send via WebSocket - include corners for accurate quadrilateral rendering
    if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify({
            type: 'otef_viewport_update',
            bbox: bbox,
            corners: corners_itm,  // Send actual corners for precise rendering
            zoom: map.getZoom(),
            timestamp: Date.now()
        }));
        console.log('[FIXED v2] Sent 4-corner viewport (EPSG:2039)');
    }
});

// Feature click handler
map.on('click', (e) => {
    const latlng = e.latlng;
    // Transform to EPSG:2039 for display
    const [x, y] = proj4('EPSG:4326', 'EPSG:2039', [latlng.lng, latlng.lat]);
    
    showFeatureInfo({
        type: 'Point',
        coordinates: [latlng.lng, latlng.lat],
        properties: {
            'Latitude': latlng.lat.toFixed(6),
            'Longitude': latlng.lng.toFixed(6),
            'ITM X': Math.round(x),
            'ITM Y': Math.round(y),
            'Zoom': map.getZoom()
        }
    });
});

// UI Controls
document.getElementById('layerToggle').addEventListener('click', () => {
    document.getElementById('layerPanel').classList.toggle('hidden');
});

document.getElementById('toggleParcels').addEventListener('change', (e) => {
    if (window.parcelsLayer) {
        if (e.target.checked) {
            map.addLayer(window.parcelsLayer);
            document.getElementById('parcelsLegend').style.display = 'block';
        } else {
            map.removeLayer(window.parcelsLayer);
            document.getElementById('parcelsLegend').style.display = 'none';
        }
    }
});

document.getElementById('toggleRoads').addEventListener('change', (e) => {
    if (window.roadsLayer) {
        if (e.target.checked) {
            map.addLayer(window.roadsLayer);
            document.getElementById('roadsLegend').style.display = 'block';
        } else {
            map.removeLayer(window.roadsLayer);
            document.getElementById('roadsLegend').style.display = 'none';
        }
    }
});

document.getElementById('toggleModel').addEventListener('change', (e) => {
    if (window.modelLayer) {
        if (e.target.checked) {
            map.addLayer(window.modelLayer);
            document.getElementById('modelLegend').style.display = 'block';
        } else {
            map.removeLayer(window.modelLayer);
            document.getElementById('modelLegend').style.display = 'none';
        }
    }
});

// Add basemap control
L.control.layers(basemaps, null, { position: 'topleft' }).addTo(map);

function showFeatureInfo(feature) {
    const panel = document.getElementById('featureInfo');
    panel.innerHTML = '<h4>Feature Info</h4>';
    Object.entries(feature.properties).forEach(([key, value]) => {
        panel.innerHTML += `<p><strong>${key}:</strong> ${value}</p>`;
    });
    panel.classList.remove('hidden');
    
    // Auto-hide after 7 seconds
    setTimeout(() => panel.classList.add('hidden'), 7000);
}

