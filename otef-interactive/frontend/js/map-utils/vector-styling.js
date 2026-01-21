/**
 * Vector-based styling for OTEF layers
 * Provides rich visual styling based on land use and other properties
 */

// Land use color scheme (based on common Israeli planning color codes)
// This file is the single source of truth for land-use based styling across
// both the Leaflet GIS map and the projection display.
const LAND_USE_COLORS = {
    // Residential
    'מגורים': { fill: '#FFD700', stroke: '#B8860B', label: 'Residential' },
    'דיור': { fill: '#FFE4B5', stroke: '#DAA520', label: 'Housing' },

    // Commercial
    'מסחר': { fill: '#FF6B6B', stroke: '#CC5555', label: 'Commercial' },
    'משרדים': { fill: '#FFA07A', stroke: '#E68A6A', label: 'Offices' },

    // Industrial
    'תעשיה': { fill: '#9370DB', stroke: '#7B5CB5', label: 'Industry' },
    'תעשיה ומלאכה': { fill: '#8A2BE2', stroke: '#7020C0', label: 'Industry & Craft' },
    'מלאכה': { fill: '#BA55D3', stroke: '#9945B3', label: 'Craft' },

    // Open spaces
    'שטח ציבורי פתוח': { fill: '#90EE90', stroke: '#5FAD5F', label: 'Public Open Space' },
    'שטחים פתוחים': { fill: '#98FB98', stroke: '#6BCB6B', label: 'Open Spaces' },
    'גן': { fill: '#7CFC00', stroke: '#5CB000', label: 'Garden' },
    'פארק': { fill: '#ADFF2F', stroke: '#8FD327', label: 'Park' },

    // Agriculture & Forest
    'חקלאות': { fill: '#F0E68C', stroke: '#C4BA6C', label: 'Agriculture' },
    'יערות': { fill: '#228B22', stroke: '#1A6B1A', label: 'Forest' },
    'יערות - חורשות': { fill: '#2E8B57', stroke: '#256F47', label: 'Forest - Groves' },

    // Infrastructure
    'דרכים': { fill: '#C0C0C0', stroke: '#808080', label: 'Roads' },
    'שטח לדרכים': { fill: '#D3D3D3', stroke: '#A9A9A9', label: 'Road Area' },
    'דרך': { fill: '#BEBEBE', stroke: '#8E8E8E', label: 'Road' },
    'דרך קיימת או מאושרת': { fill: '#A9A9A9', stroke: '#787878', label: 'Existing/Approved Road' },
    'חניה': { fill: '#696969', stroke: '#505050', label: 'Parking' },

    // Public institutions
    'מוסד ציבורי': { fill: '#87CEEB', stroke: '#6BA5C7', label: 'Public Institution' },
    'מבנה ציבור': { fill: '#4682B4', stroke: '#376694', label: 'Public Building' },
    'חינוך': { fill: '#4169E1', stroke: '#3454B7', label: 'Education' },
    'בריאות': { fill: '#6495ED', stroke: '#5077C9', label: 'Health' },

    // Special use
    'ספורט': { fill: '#7FFFD4', stroke: '#65D3AF', label: 'Sports' },
    'תיירות': { fill: '#FF69B4', stroke: '#D5548F', label: 'Tourism' },
    'דת': { fill: '#E6E6FA', stroke: '#B8B8D8', label: 'Religion' },
    'בית עלמין': { fill: '#2F4F4F', stroke: '#1F3F3F', label: 'Cemetery' },

    // Default/Unknown
    'default': { fill: '#E0E0E0', stroke: '#B0B0B0', label: 'Other' }
};

/**
 * Internal helper to resolve a full land use color scheme from a raw value.
 * Keeps the matching logic centralized so both Leaflet and PMTiles styling
 * can share it without duplicating the mapping.
 */
function getLandUseScheme(landUseString) {
    const landUse = (landUseString || '').toString();
    return Object.entries(LAND_USE_COLORS).find(([key]) => landUse.includes(key))?.[1] || LAND_USE_COLORS.default;
}

/**
 * Helper for PMTiles / protomaps usage – returns only the fill color string.
 */
function getLandUseColor(landUseString) {
    return getLandUseScheme(landUseString).fill;
}

function getParcelStyle(feature) {
    const landUse = feature.properties?.TARGUMYEUD || feature.properties?.KVUZ_TRG || '';
    const scheme = getLandUseScheme(landUse);

    return {
        fillColor: scheme.fill,
        fillOpacity: 1.0,  // Solid fill for projector (GIS map handles its own opacity)
        color: scheme.stroke,
        weight: 1,
        opacity: 1.0
    };
}

function getRoadStyle() {
    return {
        fillColor: '#505050',
        fillOpacity: 0.7,
        color: '#303030',
        weight: 1,
        opacity: 0.9
    };
}

/**
 * Style for major roads (road-big.geojson) - uses MAVAT_NAME for categorization
 * "דרך ראשית" = Primary Road (red/brown, thicker)
 * "דרך אזורית" = Regional Road (orange/tan, medium)
 */
function getMajorRoadStyle(feature) {
    const roadType = feature.properties?.MAVAT_NAME || '';

    if (roadType.includes('ראשית')) {
        // Primary road - bold red/brown
        return {
            color: '#B22222',  // Fire brick red
            weight: 4,
            opacity: 0.9,
            lineCap: 'round',
            lineJoin: 'round'
        };
    } else {
        // Regional road - orange/tan
        return {
            color: '#CD853F',  // Peru/tan
            weight: 3,
            opacity: 0.85,
            lineCap: 'round',
            lineJoin: 'round'
        };
    }
}

/**
 * Style for small roads (Small-road-limited.geojson) - MultiPolygon, single style
 */
function getSmallRoadStyle() {
    return {
        fillColor: '#A0A0A0',  // Light gray
        fillOpacity: 0.6,
        color: '#707070',      // Medium gray stroke
        weight: 0.5,
        opacity: 0.8
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        LAND_USE_COLORS,
        getLandUseColor,
        getParcelStyle,
        getRoadStyle,
        getMajorRoadStyle,
        getSmallRoadStyle
    };
}

