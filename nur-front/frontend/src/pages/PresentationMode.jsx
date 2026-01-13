import React, { useState, useEffect, useMemo } from "react";
import {
  Box,
  IconButton,
  Typography,
  Stack,
  Menu,
  MenuItem,
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  Slide,
} from "@mui/material";
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";

import { useAppData } from "../DataContext";
import config from "../config";
import api from "../api";
import { useTheme, useMediaQuery } from "@mui/material";

// Slides that should NOT be shown (HTML content that doesn't work in projection)
const EXCLUDED_SLIDES = {
    mobility: ['Survey'], // Survey is HTML
};

// Check if a slide is valid (not excluded)
const isValidSlide = (indicator, state) => {
    const excluded = EXCLUDED_SLIDES[indicator] || [];
    return !excluded.includes(state);
};

// Dialog transition
const Transition = React.forwardRef(function Transition(props, ref) {
    return <Slide direction="up" ref={ref} {...props} />;
});

// Slide Item Component
const SlideItem = ({ 
    step, 
    index, 
    indicatorConfig,
    userUploadCategories,
    onMenuOpen, 
    onRemove, 
    showDelete,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDrop,
    isDragging,
    isDropTarget,
    isActive
}) => {
    const getBgColor = () => {
        if (isDragging) return 'rgba(100, 181, 246, 0.3)';
        if (isDropTarget) return 'rgba(76, 175, 80, 0.2)';
        if (isActive) return 'rgba(100, 181, 246, 0.15)';
        return 'rgba(255,255,255,0.02)';
    };

    const getBorder = () => {
        if (isDragging) return '2px dashed #64B5F6';
        if (isDropTarget) return '2px solid #4CAF50';
        if (isActive) return '2px solid #64B5F6';
        return '1px solid rgba(255,255,255,0.08)';
    };

    return (
        <Box
            sx={{
                position: 'relative',
                '&::before': isDropTarget ? {
                    content: '""',
                    position: 'absolute',
                    top: -6,
                    left: 0,
                    right: 0,
                    height: 3,
                    backgroundColor: '#4CAF50',
                    borderRadius: 2,
                    boxShadow: '0 0 8px rgba(76, 175, 80, 0.6)',
                } : {}
            }}
        >
            <Paper 
                elevation={isDragging ? 8 : 0}
                draggable
                onDragStart={(e) => onDragStart?.(e, index)}
                onDragOver={(e) => onDragOver?.(e, index)}
                onDragEnd={onDragEnd}
                onDrop={(e) => onDrop?.(e, index)}
                sx={{ 
                    p: 2, 
                    bgcolor: getBgColor(),
                    border: getBorder(),
                    borderRadius: 2,
                    transition: 'all 0.15s ease-out',
                    transform: isDragging ? 'scale(1.02) rotate(1deg)' : 'scale(1)',
                    cursor: 'grab',
                    boxShadow: isDragging 
                        ? '0 8px 24px rgba(100, 181, 246, 0.4)' 
                        : isDropTarget 
                            ? '0 4px 12px rgba(76, 175, 80, 0.3)'
                            : 'none',
                    '&:hover': {
                        bgcolor: isActive ? 'rgba(100, 181, 246, 0.2)' : 'rgba(255,255,255,0.05)',
                    },
                    '&:active': { cursor: 'grabbing' }
                }}
            >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <DragIndicatorIcon 
                            fontSize="small" 
                            sx={{ color: isDragging ? '#64B5F6' : 'rgba(255,255,255,0.4)' }} 
                        />
                        <Typography 
                            variant="caption" 
                            sx={{ 
                                color: isDragging || isActive ? '#64B5F6' : 'rgba(255,255,255,0.7)', 
                                fontWeight: 'bold', 
                                letterSpacing: 1 
                            }}
                        >
                            SLIDE {index + 1}
                        </Typography>
                    </Box>
                    {showDelete && (
                        <IconButton 
                            size="small" 
                            onClick={(e) => { e.stopPropagation(); onRemove(index); }}
                            sx={{ 
                                color: 'rgba(255,255,255,0.3)', 
                                p: 0.5,
                                '&:hover': { color: '#ff5252', bgcolor: 'rgba(255, 82, 82, 0.1)' } 
                            }}
                        >
                            <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                    )}
                </Box>

                <Stack direction="row" spacing={1} alignItems="center">
                    <Button
                        size="small"
                        sx={{
                            flex: 1,
                            justifyContent: "space-between",
                            border: "1px solid rgba(255,255,255,0.2)",
                            borderRadius: "4px",
                            px: 1.5,
                            py: 0.5,
                            backgroundColor: "rgba(255,255,255,0.05)",
                            "&:hover": {
                                backgroundColor: "rgba(255,255,255,0.1)",
                            }
                        }}
                        onClick={(e) => { e.stopPropagation(); onMenuOpen(e, index, 'indicator'); }}
                        color="inherit"
                        endIcon={<ArrowDropDownIcon fontSize="small" sx={{ color: '#64B5F6' }} />}
                    >
                        <Typography variant="body2" sx={{ textTransform: 'none', fontWeight: 500 }}>
                            {!step.indicator 
                                ? 'No indicator'
                                : step.indicator.startsWith('user_upload') 
                                    ? (step.categoryName 
                                        ? userUploadCategories.find(c => c.name === step.categoryName)?.display_name || 'User Upload'
                                        : 'User Upload')
                                    : step.indicator.startsWith('ugc_')
                                        ? (step.indicatorName || step.indicator)
                                        : indicatorConfig[step.indicator]?.name.replace(' Dashboard', '') || step.indicator || 'No indicator'
                            }
                        </Typography>
                    </Button>

                    <Typography sx={{ color: 'rgba(255,255,255,0.3)' }}>-</Typography>

                    <Button
                        size="small"
                        sx={{
                            flex: 1,
                            justifyContent: "space-between",
                            border: "1px solid rgba(255,255,255,0.2)",
                            borderRadius: "4px",
                            px: 1.5,
                            py: 0.5,
                            backgroundColor: "rgba(255,255,255,0.05)",
                            "&:hover": {
                                backgroundColor: "rgba(255,255,255,0.1)",
                            }
                        }}
                        onClick={(e) => { e.stopPropagation(); onMenuOpen(e, index, 'state'); }}
                        color="inherit"
                        endIcon={<ArrowDropDownIcon fontSize="small" sx={{ color: '#64B5F6' }} />}
                    >
                        <Typography variant="body2" sx={{ textTransform: 'none', fontWeight: 500 }}>
                            {!step.state 
                                ? 'No state'
                                : step.indicator === 'climate' && step.type 
                                    ? `${step.state} (${step.type.toUpperCase()})` 
                                    : step.state
                            }
                        </Typography>
                    </Button>
                </Stack>
            </Paper>
        </Box>
    );
};

// Main Presentation Mode Page
const PresentationMode = () => {
    const { 
        indicatorConfig, 
        StateConfig,
        presentationSequence, 
        setPresentationSequence,
        globalDuration,
        setGlobalDuration,
        sequenceIndex,
        setSequenceIndex,
        skipToNextStep,
        skipToPrevStep,
        isPresentationMode,
        togglePresentationMode,
        isPlaying,
        togglePlayPause,
        currentIndicator,
        changeIndicator,
        changeState,
        enterPauseMode,
        exitPauseMode,
        activeUserUpload,
        currentTable,
        availableTables,
        changeTable,
    } = useAppData();
    
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
    const isTablet = useMediaQuery(theme.breakpoints.between("sm", "md"));
    const [tableMenuAnchor, setTableMenuAnchor] = useState(null);
    
    const [userUploads, setUserUploads] = useState([]);
    const [userUploadCategories, setUserUploadCategories] = useState([]);
    const [fileHierarchy, setFileHierarchy] = useState([]);
    const [tableIndicators, setTableIndicators] = useState([]);
    const [tableStates, setTableStates] = useState([]);
    
    // Fetch indicators and states for current table
    useEffect(() => {
        const fetchTableData = async () => {
            try {
                // Fetch indicators for current table (include UGC indicators)
                const indicatorsResponse = await api.get(`/api/indicators/?table=${currentTable}&include_ugc=true`);
                const indicators = indicatorsResponse.data || [];
                setTableIndicators(indicators);
                
                // Fetch file hierarchy for current table to get states
                const hierarchyResponse = await api.get(`/api/actions/get_file_hierarchy/?table=${currentTable}`);
                const hierarchy = hierarchyResponse.data || [];
                setFileHierarchy(hierarchy);
                
                // Extract states from hierarchy
                const states = new Set();
                hierarchy.forEach(table => {
                    if (table.indicators) {
                        table.indicators.forEach(indicator => {
                            if (indicator.states) {
                                indicator.states.forEach(state => {
                                    // For climate, we need scenario_name and scenario_type
                                    if (indicator.category === 'climate') {
                                        if (state.scenario_name) {
                                            states.add(JSON.stringify({
                                                scenario_name: state.scenario_name,
                                                scenario_type: state.scenario_type || 'utci'
                                            }));
                                        }
                                    } else {
                                        // For mobility, use scenario from state_values
                                        if (state.state_values?.scenario) {
                                            states.add(state.state_values.scenario);
                                        }
                                    }
                                });
                            }
                        });
                    }
                });
                setTableStates(Array.from(states));
                
                // Clear presentation sequence when table changes (slides from old table are invalid)
                setPresentationSequence([]);
                setSequenceIndex(0);
            } catch (err) {
                console.error("Error fetching table data:", err);
                setTableIndicators([]);
                setTableStates([]);
                setPresentationSequence([]);
            }
        };
        
        fetchTableData();
    }, [currentTable, setPresentationSequence]);
    
    // Get all valid slides filtered by current table
    const allValidSlides = useMemo(() => {
        const slides = [];
        
        // Only include indicators that exist in the current table
        const availableIndicatorNames = new Set(tableIndicators.map(ind => {
            // Map indicator_id to indicator name (mobility=1, climate=2)
            if (ind.indicator_id === 1) return 'mobility';
            if (ind.indicator_id === 2) return 'climate';
            return null;
        }).filter(Boolean));
        
        // Build slides from available indicators in current table
        availableIndicatorNames.forEach(indicatorName => {
            if (!indicatorConfig[indicatorName]) return;
            
            // Get states for this indicator from the table data
            const indicator = tableIndicators.find(ind => {
                if (indicatorName === 'mobility') return ind.indicator_id === 1;
                if (indicatorName === 'climate') return ind.indicator_id === 2;
                return false;
            });
            
            if (!indicator) return;
            
            // Find states for this indicator from file hierarchy
            const indicatorStates = [];
            fileHierarchy.forEach(table => {
                if (table.name === currentTable && table.indicators) {
                    const tableIndicator = table.indicators.find(ind => 
                        ind.indicator_id === indicator.indicator_id
                    );
                    if (tableIndicator && tableIndicator.states) {
                        tableIndicator.states.forEach(state => {
                            if (indicatorName === 'climate') {
                                // Climate states need scenario_name and type
                                if (state.scenario_name) {
                                    const scenarioType = state.scenario_type || 'utci';
                                    // Map scenario_name to display name
                                    const scenarioDisplayNames = {
                                        'dense_highrise': 'Dense Highrise',
                                        'existing': 'Existing',
                                        'high_rises': 'High Rises',
                                        'lowrise': 'Low Rise Dense',
                                        'mass_tree_planting': 'Mass Tree Planting',
                                        'open_public_space': 'Open Public Space',
                                        'placemaking': 'Placemaking'
                                    };
                                    const displayName = scenarioDisplayNames[state.scenario_name] || state.scenario_name;
                                    indicatorStates.push({ name: displayName, type: scenarioType });
                                }
                            } else {
                                // Mobility states
                                if (state.state_values?.scenario) {
                                    const scenario = state.state_values.scenario;
                                    const displayName = scenario.charAt(0).toUpperCase() + scenario.slice(1);
                                    indicatorStates.push({ name: displayName });
                                }
                            }
                        });
                    }
                }
            });
            
            // Create slides from states
            indicatorStates.forEach(stateData => {
                if (indicatorName === 'climate') {
                    if (isValidSlide(indicatorName, stateData.name)) {
                        slides.push({ 
                            indicator: indicatorName, 
                            state: stateData.name, 
                            type: stateData.type || 'utci' 
                        });
                    }
                } else {
                    if (isValidSlide(indicatorName, stateData.name)) {
                        slides.push({ indicator: indicatorName, state: stateData.name });
                    }
                }
            });
        });
        
        // Add UGC indicators from file hierarchy (filtered by current table)
        if (Array.isArray(fileHierarchy)) {
            fileHierarchy
                .filter(table => table.name === currentTable)
                .forEach(table => {
                    if (table.indicators) {
                        table.indicators
                            .filter(ind => ind.is_user_generated)
                            .forEach(indicator => {
                                if (indicator.states) {
                                    indicator.states.forEach(state => {
                                        slides.push({
                                            indicator: `ugc_${indicator.id}`,
                                            state: state.scenario_name || JSON.stringify(state.state_values),
                                            indicatorId: indicator.id,
                                            stateId: state.id,
                                            indicatorDataId: state.indicator_data_id,
                                            indicatorName: indicator.name,
                                            tableName: table.display_name || table.name,
                                            isUGC: true,
                                            media: state.media || []
                                        });
                                    });
                                }
                            });
                    }
                });
        }

        // Add user uploads as slides - grouped by category
        const uploads = Array.isArray(userUploads) ? userUploads : [];
        for (let i = 0; i < uploads.length; i++) {
            const upload = uploads[i];
            if (upload && upload.id) {
                slides.push({
                    indicator: upload.categoryName ? `user_upload_${upload.categoryName}` : 'user_upload',
                    state: upload.displayName || upload.original_filename || 'User Upload',
                    uploadId: upload.id,
                    imageUrl: upload.imageUrl,
                    categoryName: upload.categoryName
                });
            }
        }
        return slides;
    }, [indicatorConfig, StateConfig, userUploads, fileHierarchy, currentTable, tableIndicators]);

    // Check if a slide combination is already used (including type for climate, uploadId for user uploads, and stateId for UGC)
    const isSlideUsed = (indicator, state, type, uploadId, stateId, excludeIndex = -1) => {
        return presentationSequence.some((step, idx) => {
            if (idx === excludeIndex) return false;
            if (step.indicator !== indicator || step.state !== state) return false;
            // For climate, also check type
            if (indicator === 'climate') {
                return step.type === type;
            }
            // For user uploads, check uploadId
            if (indicator.startsWith('user_upload')) {
                return step.uploadId === uploadId;
            }
            // For UGC indicators, check stateId
            if (indicator.startsWith('ugc_')) {
                return step.stateId === stateId;
            }
            return true;
        });
    };

    const [activeMenu, setActiveMenu] = useState(null);
    const [draggedIndex, setDraggedIndex] = useState(null);
    const [dropTargetIndex, setDropTargetIndex] = useState(null);
    const [justDroppedIndex, setJustDroppedIndex] = useState(null);
    const [openInfo, setOpenInfo] = useState(false);
    const [thumbnailUrl, setThumbnailUrl] = useState(null);

    // Image cache to store preloaded images
    const imageCacheRef = React.useRef(new Map());
    const [isPreloading, setIsPreloading] = useState(false);

    // Track in-flight requests to prevent duplicate fetches
    const inFlightRequestsRef = React.useRef(new Set());

    const currentStep = presentationSequence[sequenceIndex];

    // Fetch user uploads and categories on component mount
    useEffect(() => {
        const fetchData = async () => {
            try {
                const [uploadsResponse, categoriesResponse] = await Promise.all([
                    api.get("/api/user_uploads/"),
                    api.get("/api/user_upload_categories/")
                ]);

                const categories = categoriesResponse.data;
                setUserUploadCategories(categories);

                const uploads = uploadsResponse.data.map((upload) => {
                    const category = categories.find(c => c.id === upload.category);
                    return {
                        id: upload.id,
                        displayName: upload.display_name || upload.original_filename,
                        imageUrl: upload.image_url,
                        categoryName: category ? category.name : null,
                        categoryDisplayName: category ? category.display_name : null,
                    };
                });
                setUserUploads(uploads);
            } catch (err) {
                console.error("Error fetching data:", err);
            }
        };
        fetchData();
    }, []);

    // Enter presentation mode when page loads (but don't auto-start playing)
    useEffect(() => {
        if (!isPresentationMode) {
            togglePresentationMode(true, false); // Enter presentation mode, but paused
        }
    }, [isPresentationMode, togglePresentationMode]);

    // Helper function to generate cache key for a slide (include type for climate, uploadId for user uploads, stateId for UGC)
    const getCacheKey = (indicator, state, type, uploadId, stateId) => {
        if (indicator.startsWith('user_upload') && uploadId) {
            return `user_upload:${uploadId}`;
        }
        if (indicator.startsWith('ugc_') && stateId) {
            return `ugc:${stateId}`;
        }
        if (indicator === 'climate' && type) {
            return `${indicator}:${state}:${type}`;
        }
        return `${indicator}:${state}`;
    };

    // Climate scenario display name to key mapping
    const CLIMATE_SCENARIO_KEYS = {
        'Dense Highrise': 'dense_highrise',
        'Existing': 'existing',
        'High Rises': 'high_rises',
        'Low Rise Dense': 'lowrise',
        'Mass Tree Planting': 'mass_tree_planting',
        'Open Public Space': 'open_public_space',
        'Placemaking': 'placemaking'
    };

    // Helper function to fetch and cache an image for a specific slide
    // Uses PREFETCH mode API params to fetch specific states without modifying backend globals
    const fetchAndCacheImage = React.useCallback(async (indicator, state, type, uploadId, imageUrl, priority = 'normal', stateId = null) => {
        const cacheKey = getCacheKey(indicator, state, type, uploadId, stateId);

        // Check if already cached
        if (imageCacheRef.current.has(cacheKey)) {
            return imageCacheRef.current.get(cacheKey);
        }

        // For user uploads, use the provided imageUrl directly
        if (indicator.startsWith('user_upload') && imageUrl) {
            const fullUrl = imageUrl.startsWith("http") ? imageUrl : `${config.api.baseUrl}${imageUrl}`;
            
            // Preload the image in browser cache
            const img = new Image();
            img.src = fullUrl;
            if (priority === 'high') {
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    setTimeout(resolve, 2000); // 2s timeout
                });
            }

            imageCacheRef.current.set(cacheKey, fullUrl);
            return fullUrl;
        }

        // For UGC indicators, get media from file hierarchy
        if (indicator.startsWith('ugc_') && stateId) {
            // Find the media from file hierarchy
            const indicatorId = parseInt(indicator.replace('ugc_', ''));
            const tableData = fileHierarchy.find(t => t.name === currentTable);
            const tableIndicator = tableData?.indicators?.find(ind => ind.id === indicatorId && ind.is_user_generated);
            
            if (tableIndicator && tableIndicator.states) {
                const matchingState = tableIndicator.states.find(s => s.id === stateId);
                if (matchingState && matchingState.media && matchingState.media.length > 0) {
                    // Get first image/video media
                    const mediaItem = matchingState.media.find(m => m.media_type === 'image' || m.media_type === 'video');
                    if (mediaItem) {
                        const mediaUrl = mediaItem.url;
                        const fullUrl = mediaUrl.startsWith("http") 
                            ? mediaUrl 
                            : mediaUrl.startsWith("/")
                                ? `${config.media.baseUrl}${mediaUrl}`
                                : `${config.media.baseUrl}/media/${mediaUrl}`;
                        
                        // Preload the image in browser cache
                        const img = new Image();
                        img.src = fullUrl;
                        if (priority === 'high') {
                            await new Promise((resolve, reject) => {
                                img.onload = resolve;
                                img.onerror = reject;
                                setTimeout(resolve, 2000); // 2s timeout
                            });
                        }

                        imageCacheRef.current.set(cacheKey, fullUrl);
                        return fullUrl;
                    }
                }
            }
            
            console.error(`❌ No media found for UGC indicator ${indicator}, stateId ${stateId}`);
            return null;
        }

        // Prevent duplicate requests
        if (inFlightRequestsRef.current.has(cacheKey)) {
            return null;
        }

        inFlightRequestsRef.current.add(cacheKey);

        try {
            const timestamp = Date.now();

            // Build URL with PREFETCH mode params - this fetches specific images without modifying backend state
            // Only for standard indicators (mobility, climate)
            if (indicator !== 'mobility' && indicator !== 'climate') {
                console.error(`❌ Attempted to fetch non-standard indicator via API: ${indicator}`);
                return null;
            }

            let url = `/api/actions/get_image_data/?_=${timestamp}&indicator=${indicator}&table=${currentTable}`;

            if (indicator === 'climate') {
                // For climate, convert display name to scenario key and add type
                const scenarioKey = CLIMATE_SCENARIO_KEYS[state] || state.toLowerCase().replace(/ /g, '_');
                url += `&scenario=${scenarioKey}&type=${type || 'utci'}`;
            } else {
                // For mobility, convert display name to scenario key
                const scenarioKey = state.toLowerCase(); // "Present" -> "present"
                url += `&scenario=${scenarioKey}`;
            }

            const response = await api.get(url);

            if (response.data?.image_data) {
                let imageUrl = response.data.image_data.startsWith("/")
                    ? `${config.media.baseUrl}${response.data.image_data}`
                    : `${config.media.baseUrl}/media/${response.data.image_data}`;

                // Preload the image in browser cache
                if (!imageUrl.includes('.mp4')) {
                    const img = new Image();
                    img.src = imageUrl;
                    if (priority === 'high') {
                        await new Promise((resolve, reject) => {
                            img.onload = resolve;
                            img.onerror = reject;
                            setTimeout(resolve, 2000); // 2s timeout
                        });
                    }
                }

                imageCacheRef.current.set(cacheKey, imageUrl);
                return imageUrl;
            }
        } catch (err) {
            console.error(`❌ Prefetch error ${indicator}:${state}${type ? ':' + type : ''}`);
            return null;
        } finally {
            inFlightRequestsRef.current.delete(cacheKey);
        }
    }, [currentTable, fileHierarchy]);

    // Aggressive preloading: preload all slides immediately, prioritizing upcoming ones
    useEffect(() => {
        if (!presentationSequence || presentationSequence.length === 0) return;

        const preloadAllSlides = async () => {
            setIsPreloading(true);
            console.log(`🚀 Prefetching ${presentationSequence.length} slides`);

            // Priority 1: Current slide (must be instant)
            const currentSlide = presentationSequence[sequenceIndex];
            if (currentSlide) {
                await fetchAndCacheImage(
                    currentSlide.indicator, 
                    currentSlide.state, 
                    currentSlide.type || null, 
                    currentSlide.uploadId || null,
                    currentSlide.imageUrl || null,
                    'high',
                    currentSlide.stateId || null
                );
            }

            // Priority 2: Next 3 slides (high priority, await to ensure they're ready)
            const highPriorityCount = Math.min(3, presentationSequence.length);
            for (let i = 1; i <= highPriorityCount; i++) {
                const idx = (sequenceIndex + i) % presentationSequence.length;
                const slide = presentationSequence[idx];
                if (slide && idx !== sequenceIndex) {
                    await fetchAndCacheImage(
                        slide.indicator, 
                        slide.state, 
                        slide.type || null, 
                        slide.uploadId || null,
                        slide.imageUrl || null,
                        'high',
                        slide.stateId || null
                    );
                }
            }

            // Priority 3: Remaining slides (background, fire and forget)
            for (let i = 0; i < presentationSequence.length; i++) {
                if (i === sequenceIndex) continue;
                const isHighPriority = i <= (sequenceIndex + highPriorityCount) % presentationSequence.length && i > sequenceIndex;
                if (!isHighPriority) {
                    const slide = presentationSequence[i];
                    fetchAndCacheImage(
                        slide.indicator, 
                        slide.state, 
                        slide.type || null, 
                        slide.uploadId || null,
                        slide.imageUrl || null,
                        'normal',
                        slide.stateId || null
                    ); // No await - background
                }
            }

            setIsPreloading(false);
            console.log(`✓ Prefetch complete`);
        };

        preloadAllSlides();
    }, [presentationSequence, fetchAndCacheImage, sequenceIndex, currentTable]);

    // Update thumbnail when current slide changes
    useEffect(() => {
        if (!currentStep) return;

        const updateThumbnail = async () => {
            const cacheKey = getCacheKey(
                currentStep.indicator, 
                currentStep.state, 
                currentStep.type || null, 
                currentStep.uploadId || null,
                currentStep.stateId || null
            );

            // Check cache first
            if (imageCacheRef.current.has(cacheKey)) {
                const cachedUrl = imageCacheRef.current.get(cacheKey);
                setThumbnailUrl(cachedUrl);

                // Preload next slide in background
                const nextIndex = (sequenceIndex + 1) % presentationSequence.length;
                const nextSlide = presentationSequence[nextIndex];
                if (nextSlide) {
                    fetchAndCacheImage(
                        nextSlide.indicator, 
                        nextSlide.state, 
                        nextSlide.type || null, 
                        nextSlide.uploadId || null,
                        nextSlide.imageUrl || null,
                        'high',
                        nextSlide.stateId || null
                    );
                }
            } else {
                // Not cached yet, fetch it
                const url = await fetchAndCacheImage(
                    currentStep.indicator, 
                    currentStep.state, 
                    currentStep.type || null, 
                    currentStep.uploadId || null,
                    currentStep.imageUrl || null,
                    'high',
                    currentStep.stateId || null
                );
                if (url) {
                    setThumbnailUrl(url);
                }
            }
        };

        updateThumbnail();
    }, [currentStep, sequenceIndex, presentationSequence, fetchAndCacheImage]);

    // Use ref to access currentIndicator without causing listener re-registration
    const currentIndicatorRef = React.useRef(currentIndicator);
    React.useEffect(() => {
        currentIndicatorRef.current = currentIndicator;
    }, [currentIndicator]);

    // Throttle ref for thumbnail fetches
    const thumbnailFetchThrottleRef = React.useRef(null);
    const lastThumbnailFetchRef = React.useRef(0);

    // Listen for state change events (for manual state changes outside of presentation sequence)
    // Empty dependency - listeners registered ONCE, use ref for current indicator
    useEffect(() => {
        const fetchThumbnail = async () => {
            const now = Date.now();

            // Throttle: max 1 fetch per 200ms
            if (now - lastThumbnailFetchRef.current < 200) {
                // Schedule a delayed fetch if one isn't pending
                if (!thumbnailFetchThrottleRef.current) {
                    thumbnailFetchThrottleRef.current = setTimeout(() => {
                        thumbnailFetchThrottleRef.current = null;
                        fetchThumbnail();
                    }, 200);
                }
                return;
            }
            lastThumbnailFetchRef.current = now;

            // Small delay to ensure backend state is fully updated
            await new Promise(resolve => setTimeout(resolve, 100));

            try {
                const timestamp = Date.now();
                const indicator = currentIndicatorRef.current;
                const response = await api.get(
                    `/api/actions/get_image_data/?_=${timestamp}&indicator=${indicator}&table=${currentTable}`
                );
                if (response.data?.image_data) {
                    let url = response.data.image_data.startsWith("/")
                        ? `${config.media.baseUrl}${response.data.image_data}`
                        : `${config.media.baseUrl}/media/${response.data.image_data}`;
                    setThumbnailUrl(url);
                }
            } catch (err) {
                console.error("Error fetching thumbnail:", err);
            }
        };

        // Listen for state change events (fired AFTER backend state is updated)
        window.addEventListener("climateStateChanged", fetchThumbnail);
        window.addEventListener("stateChanged", fetchThumbnail);
        window.addEventListener("indicatorStateChanged", fetchThumbnail);

        return () => {
            window.removeEventListener("climateStateChanged", fetchThumbnail);
            window.removeEventListener("stateChanged", fetchThumbnail);
            window.removeEventListener("indicatorStateChanged", fetchThumbnail);
            if (thumbnailFetchThrottleRef.current) {
                clearTimeout(thumbnailFetchThrottleRef.current);
            }
        };
    }, [currentTable]); // Include currentTable to refetch when table changes

    const handleExit = () => {
        togglePresentationMode(false);
        // Reload the page to ensure clean state (using basename /dashboard)
        window.location.href = '/dashboard/mobility';
    };

    const handleMenuOpen = (event, index, type) => {
        setActiveMenu({ index, type, anchorEl: event.currentTarget });
    };

    const handleMenuClose = () => {
        setActiveMenu(null);
    };

    const handleSelection = (indicator, state, slideType = null, uploadId = null, imageUrl = null, stateId = null, indicatorName = null, tableName = null) => {
        if (!activeMenu) return;

        const { index, type: menuType } = activeMenu;
        const newSequence = [...presentationSequence];
        const currentSlide = newSequence[index];

        if (menuType === 'indicator') {
            // When changing indicator, find first unused valid state
            // For climate, also need to find unused type
            // For user_upload categories, find first unused upload from that category
            // For UGC indicators, find first unused state from file hierarchy
            if (indicator.startsWith('ugc_')) {
                const indicatorId = parseInt(indicator.replace('ugc_', ''));
                const tableData = fileHierarchy.find(t => t.name === currentTable);
                const tableIndicator = tableData?.indicators?.find(ind => ind.id === indicatorId && ind.is_user_generated);
                
                if (tableIndicator && tableIndicator.states) {
                    const availableState = tableIndicator.states.find(s => 
                        !isSlideUsed(indicator, s.scenario_name || JSON.stringify(s.state_values), null, null, s.id, index)
                    );
                    if (availableState) {
                        newSequence[index] = {
                            indicator: indicator,
                            state: availableState.scenario_name || JSON.stringify(availableState.state_values),
                            indicatorId: indicatorId,
                            stateId: availableState.id,
                            indicatorDataId: availableState.indicator_data_id,
                            indicatorName: tableIndicator.name,
                            tableName: tableData?.display_name || tableData?.name,
                            isUGC: true,
                            media: availableState.media || []
                        };
                    } else if (tableIndicator.states.length > 0) {
                        // Fallback to first state
                        const firstState = tableIndicator.states[0];
                        newSequence[index] = {
                            indicator: indicator,
                            state: firstState.scenario_name || JSON.stringify(firstState.state_values),
                            indicatorId: indicatorId,
                            stateId: firstState.id,
                            indicatorDataId: firstState.indicator_data_id,
                            indicatorName: tableIndicator.name,
                            tableName: tableData?.display_name || tableData?.name,
                            isUGC: true,
                            media: firstState.media || []
                        };
                    }
                }
            } else if (indicator.startsWith('user_upload')) {
                const categoryName = indicator.replace('user_upload_', '');
                const categoryUploads = userUploads.filter(u => 
                    categoryName ? u.categoryName === categoryName : !u.categoryName
                );
                    const availableUpload = categoryUploads.find(upload => 
                    !isSlideUsed(indicator, upload.displayName, null, upload.id, null, index)
                );
                if (availableUpload) {
                    newSequence[index] = { 
                        indicator: indicator, 
                        state: availableUpload.displayName,
                        uploadId: availableUpload.id,
                        imageUrl: availableUpload.imageUrl,
                        categoryName: availableUpload.categoryName
                    };
                } else if (categoryUploads.length > 0) {
                    // Fallback to first upload from category
                    const firstUpload = categoryUploads[0];
                    newSequence[index] = { 
                        indicator: indicator, 
                        state: firstUpload.displayName,
                        uploadId: firstUpload.id,
                        imageUrl: firstUpload.imageUrl,
                        categoryName: firstUpload.categoryName
                    };
                }
            } else if (indicator === 'climate') {
                // Find first unused climate state+type combo
                const availableSlide = StateConfig[indicator]?.flatMap(s => {
                    if (!isValidSlide(indicator, s)) return [];
                    const slides = [];
                    if (!isSlideUsed(indicator, s, 'utci', null, null, index)) slides.push({ state: s, type: 'utci' });
                    if (!isSlideUsed(indicator, s, 'plan', null, null, index)) slides.push({ state: s, type: 'plan' });
                    return slides;
                })?.[0];
                if (availableSlide) {
                    newSequence[index] = { indicator, state: availableSlide.state, type: availableSlide.type };
                } else {
                    // Fallback to first state
                    const firstState = StateConfig[indicator]?.[0];
                    newSequence[index] = { indicator, state: firstState, type: 'utci' };
                }
            } else {
                // Non-climate indicator
                const availableStates = StateConfig[indicator]?.filter(s =>
                    isValidSlide(indicator, s) && !isSlideUsed(indicator, s, null, null, null, index)
                ) || [];
                const firstState = availableStates[0] || StateConfig[indicator]?.[0];
                newSequence[index] = { indicator, state: firstState };
            }
        } else if (menuType === 'state') {
            // Changing state - for climate, slideType contains the new type
            // For user_upload, uploadId and imageUrl are provided
            // For UGC, stateId, indicatorName, and tableName are provided
            if (indicator.startsWith('ugc_') && stateId && indicatorName) {
                const indicatorId = parseInt(indicator.replace('ugc_', ''));
                const tableData = fileHierarchy.find(t => t.name === currentTable);
                const tableIndicator = tableData?.indicators?.find(ind => ind.id === indicatorId && ind.is_user_generated);
                const selectedState = tableIndicator?.states?.find(s => s.id === stateId);
                
                newSequence[index] = {
                    indicator: indicator,
                    state: state,
                    indicatorId: indicatorId,
                    stateId: stateId,
                    indicatorDataId: selectedState?.indicator_data_id,
                    indicatorName: indicatorName,
                    tableName: tableName,
                    isUGC: true,
                    media: selectedState?.media || []
                };
            } else if (indicator.startsWith('user_upload') && uploadId && imageUrl) {
                const categoryName = indicator.replace('user_upload_', '');
                newSequence[index] = { 
                    indicator: indicator, 
                    state, 
                    uploadId, 
                    imageUrl,
                    categoryName: categoryName || null
                };
            } else if (currentSlide.indicator === 'climate' && slideType) {
                newSequence[index] = { ...currentSlide, state, type: slideType };
            } else {
                newSequence[index] = { ...currentSlide, state };
            }
        } else if (menuType === 'type') {
            // Changing type (climate only)
            newSequence[index] = { ...currentSlide, type: slideType };
        }

        setPresentationSequence(newSequence);
        handleMenuClose();
    };

    const addStep = () => {
        // Find first unused valid slide (must pass type for proper climate detection, uploadId for user uploads)
        const unusedSlide = allValidSlides.find(slide =>
            !isSlideUsed(slide.indicator, slide.state, slide.type, slide.uploadId, slide.stateId)
        );

        if (unusedSlide) {
            setPresentationSequence([...presentationSequence, unusedSlide]);
        }
        // No fallback - don't add duplicates when all slides are used
    };

    const removeStep = (index) => {
        if (presentationSequence.length > 1) {
            setPresentationSequence(presentationSequence.filter((_, i) => i !== index));
        }
    };

    // Drag and drop handlers
    const handleDragStart = (e, index) => {
        setDraggedIndex(index);
        setJustDroppedIndex(null);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index.toString());
    };

    const handleDragOver = (e, index) => {
        e.preventDefault();
        if (draggedIndex === null || draggedIndex === index) {
            setDropTargetIndex(null);
            return;
        }
        setDropTargetIndex(index);
    };

    const handleDrop = (e, targetIndex) => {
        e.preventDefault();
        if (draggedIndex === null || draggedIndex === targetIndex) return;
        
        const newSequence = [...presentationSequence];
        const draggedItem = newSequence[draggedIndex];
        newSequence.splice(draggedIndex, 1);
        const adjustedTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
        newSequence.splice(adjustedTargetIndex, 0, draggedItem);
        
        setPresentationSequence(newSequence);
        setJustDroppedIndex(adjustedTargetIndex);
        setTimeout(() => setJustDroppedIndex(null), 600);
        
        setDraggedIndex(null);
        setDropTargetIndex(null);
    };

    const handleDragEnd = () => {
        setDraggedIndex(null);
        setDropTargetIndex(null);
    };

    const allSlidesUsed = allValidSlides.every(slide =>
        isSlideUsed(slide.indicator, slide.state, slide.type, slide.uploadId, slide.stateId)
    );

    const isVideo = thumbnailUrl?.includes('.mp4');

    return (
        <Box sx={{ height: '100vh', bgcolor: '#0a0a0f', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 3, py: 2, flexShrink: 0 }}>
                <img
                    src={config.frontend.logo.url}
                    alt="nur"
                    style={{ width: '80px', filter: 'brightness(0) invert(1)' }}
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {/* Table Selector */}
                    <Button
                        onClick={(e) => setTableMenuAnchor(e.currentTarget)}
                        endIcon={<ArrowDropDownIcon />}
                        sx={{
                            color: 'rgba(255,255,255,0.8)',
                            border: '1px solid rgba(255,255,255,0.2)',
                            borderRadius: '4px',
                            px: 2,
                            py: 0.5,
                            textTransform: 'none',
                            fontSize: '0.9rem',
                            '&:hover': {
                                backgroundColor: 'rgba(255,255,255,0.1)',
                                borderColor: '#64B5F6',
                            }
                        }}
                    >
                        {availableTables.find(t => t.name === currentTable)?.display_name || currentTable}
                    </Button>
                    
                    <IconButton 
                        onClick={() => setOpenInfo(true)}
                        sx={{ color: 'rgba(255,255,255,0.6)', '&:hover': { color: 'white' } }}
                    >
                        <InfoOutlinedIcon sx={{ fontSize: 28 }} />
                    </IconButton>
                    <IconButton 
                        onClick={handleExit}
                        sx={{ color: 'rgba(255,255,255,0.6)', '&:hover': { color: 'white' } }}
                    >
                        <CloseIcon sx={{ fontSize: 28 }} />
                    </IconButton>
                </Box>
            </Box>
            
            {/* Table Menu */}
            <Menu
                anchorEl={tableMenuAnchor}
                open={Boolean(tableMenuAnchor)}
                onClose={() => setTableMenuAnchor(null)}
                PaperProps={{
                    sx: {
                        backgroundColor: "rgba(25, 25, 25, 0.98)",
                        backdropFilter: "blur(16px)",
                        border: "1px solid rgba(255, 255, 255, 0.12)",
                        borderRadius: "8px",
                        minWidth: 200,
                    },
                }}
            >
                {availableTables && availableTables.length > 0 ? (
                    availableTables.map((table) => {
                        const isCurrentTable = table.name === currentTable;
                        return (
                            <MenuItem
                                key={table.id || table.name}
                                onClick={() => {
                                    changeTable(table.name);
                                    setTableMenuAnchor(null);
                                }}
                                sx={{
                                    py: 1,
                                    px: 2,
                                    backgroundColor: isCurrentTable ? "rgba(100, 181, 246, 0.12)" : "transparent",
                                    borderLeft: isCurrentTable ? "3px solid #64B5F6" : "3px solid transparent",
                                    transition: "all 0.15s ease",
                                    "&:hover": {
                                        backgroundColor: "rgba(100, 181, 246, 0.18)",
                                        borderLeft: "3px solid #64B5F6",
                                    },
                                }}
                            >
                                <Typography
                                    variant="body1"
                                    sx={{
                                        fontSize: "0.95rem",
                                        fontWeight: isCurrentTable ? 600 : 500,
                                        color: isCurrentTable ? "#64B5F6" : "rgba(255, 255, 255, 0.85)",
                                    }}
                                >
                                    {table.display_name || table.name}
                                </Typography>
                            </MenuItem>
                        );
                    })
                ) : (
                    <MenuItem disabled>
                        <Typography variant="body2" sx={{ color: "rgba(255, 255, 255, 0.5)" }}>
                            No tables available
                        </Typography>
                    </MenuItem>
                )}
            </Menu>

            {/* Main Content */}
            <Box sx={{ flex: 1, display: 'flex', p: 3, gap: 3, overflow: 'hidden', minHeight: 0 }}>
                {/* Left Panel - Current Slide */}
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {/* Large Thumbnail */}
                    {thumbnailUrl && (
                        <Box sx={{ 
                            width: '90%',
                            maxWidth: 900,
                            aspectRatio: '16/10',
                            mb: 2, 
                            borderRadius: 2, 
                            overflow: 'hidden',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
                        }}>
                            {isVideo ? (
                                <video 
                                    src={thumbnailUrl} 
                                    autoPlay 
                                    loop 
                                    muted 
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                />
                            ) : (
                                <img 
                                    src={thumbnailUrl} 
                                    alt="Current slide"
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                />
                            )}
                        </Box>
                    )}

                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)', letterSpacing: 2, textTransform: 'uppercase' }}>
                        Now Showing
                    </Typography>
                    <Typography variant="h5" sx={{ color: 'white', mb: 3, fontWeight: 500 }}>
                        {!currentStep 
                            ? 'No slide selected'
                            : currentStep?.indicator?.startsWith('user_upload') 
                                ? `${currentStep?.categoryName ? userUploadCategories.find(c => c.name === currentStep.categoryName)?.display_name || 'User Upload' : 'User Upload'} - ${currentStep?.state || 'No state'}`
                                : currentStep?.indicator?.startsWith('ugc_')
                                    ? `${currentStep?.indicatorName || currentStep?.indicator || 'UGC Indicator'} - ${currentStep?.state || 'No state'}`
                                    : `${indicatorConfig[currentStep?.indicator]?.name.replace(' Dashboard', '') || currentStep?.indicator || 'No indicator'} - ${currentStep?.indicator === 'climate' && currentStep?.type ? `${currentStep?.state || 'No state'} (${currentStep.type.toUpperCase()})` : (currentStep?.state || 'No state')}`
                        }
                    </Typography>

                    {/* Navigation & Timer Controls */}
                    <Stack direction="row" spacing={2} alignItems="center">
                        <IconButton 
                            onClick={skipToPrevStep}
                            disabled={!isPlaying}
                            sx={{ 
                                color: isPlaying ? 'white' : 'rgba(255,255,255,0.3)', 
                                bgcolor: 'rgba(255,255,255,0.08)', 
                                width: 64, 
                                height: 64,
                                '&:hover': { bgcolor: isPlaying ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)' },
                                '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)' }
                            }}
                        >
                            <NavigateBeforeIcon sx={{ fontSize: 36 }} />
                        </IconButton>
                        
                        <Box sx={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: 3,
                            bgcolor: 'rgba(255,255,255,0.05)',
                            borderRadius: 3,
                            px: 4,
                            py: 2
                        }}>
                            <Typography variant="h4" sx={{ color: 'white', fontWeight: 600, minWidth: 90, textAlign: 'center' }}>
                                {presentationSequence.length > 0 ? `${sequenceIndex + 1} / ${presentationSequence.length}` : '0 / 0'}
                            </Typography>
                            <Box sx={{ width: 2, height: 40, bgcolor: 'rgba(255,255,255,0.15)', borderRadius: 1 }} />
                            <IconButton 
                                onClick={togglePlayPause}
                                sx={{ 
                                    color: isPlaying ? '#4CAF50' : '#FF9800', 
                                    bgcolor: isPlaying ? 'rgba(76, 175, 80, 0.15)' : 'rgba(255, 152, 0, 0.15)',
                                    width: 56,
                                    height: 56,
                                    border: isPlaying ? '2px solid #4CAF50' : '2px solid #FF9800',
                                    '&:hover': { 
                                        bgcolor: isPlaying ? 'rgba(76, 175, 80, 0.25)' : 'rgba(255, 152, 0, 0.25)' 
                                    } 
                                }}
                            >
                                {isPlaying ? <PauseIcon sx={{ fontSize: 32 }} /> : <PlayArrowIcon sx={{ fontSize: 32 }} />}
                            </IconButton>
                            <Box sx={{ width: 2, height: 40, bgcolor: 'rgba(255,255,255,0.15)', borderRadius: 1 }} />
                            <Stack direction="row" alignItems="center" spacing={1.5}>
                                <IconButton 
                                    onClick={() => setGlobalDuration(Math.max(1, globalDuration - 1))}
                                    sx={{ 
                                        color: 'rgba(255,255,255,0.7)', 
                                        bgcolor: 'rgba(255,255,255,0.08)',
                                        width: 40,
                                        height: 40,
                                        '&:hover': { color: 'white', bgcolor: 'rgba(255,255,255,0.15)' } 
                                    }}
                                >
                                    <Typography variant="h5" sx={{ fontWeight: 300 }}>−</Typography>
                                </IconButton>
                                <Typography variant="h4" sx={{ color: 'white', minWidth: 70, textAlign: 'center', fontWeight: 500 }}>
                                    {globalDuration}s
                                </Typography>
                                <IconButton 
                                    onClick={() => setGlobalDuration(globalDuration + 1)}
                                    sx={{ 
                                        color: 'rgba(255,255,255,0.7)', 
                                        bgcolor: 'rgba(255,255,255,0.08)',
                                        width: 40,
                                        height: 40,
                                        '&:hover': { color: 'white', bgcolor: 'rgba(255,255,255,0.15)' } 
                                    }}
                                >
                                    <Typography variant="h5" sx={{ fontWeight: 300 }}>+</Typography>
                                </IconButton>
                            </Stack>
                        </Box>
                        
                        <IconButton 
                            onClick={skipToNextStep}
                            disabled={!isPlaying}
                            sx={{ 
                                color: isPlaying ? 'white' : 'rgba(255,255,255,0.3)', 
                                bgcolor: 'rgba(255,255,255,0.08)', 
                                width: 64, 
                                height: 64,
                                '&:hover': { bgcolor: isPlaying ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)' },
                                '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)' }
                            }}
                        >
                            <NavigateNextIcon sx={{ fontSize: 36 }} />
                        </IconButton>
                    </Stack>
                </Box>

                {/* Right Panel - Slide List */}
                <Box sx={{ 
                    width: 380, 
                    height: '100%',
                    display: 'flex', 
                    flexDirection: 'column', 
                    bgcolor: 'rgba(255,255,255,0.02)', 
                    borderRadius: 2, 
                    overflow: 'hidden',
                    flexShrink: 0
                }}>
                    <Typography variant="h6" sx={{ color: 'white', fontWeight: 600, p: 2, bgcolor: 'rgba(0,0,0,0.2)', flexShrink: 0 }}>
                        Sequence
                    </Typography>
                    
                    <Box 
                        sx={{ 
                            flex: 1, 
                            overflowY: 'auto', 
                            minHeight: 0,
                            p: 1.5,
                            '&::-webkit-scrollbar': {
                                width: 8,
                            },
                            '&::-webkit-scrollbar-track': {
                                bgcolor: 'rgba(255,255,255,0.05)',
                                borderRadius: 4,
                            },
                            '&::-webkit-scrollbar-thumb': {
                                bgcolor: 'rgba(255,255,255,0.2)',
                                borderRadius: 4,
                                '&:hover': {
                                    bgcolor: 'rgba(255,255,255,0.35)',
                                }
                            }
                        }} 
                        onDragLeave={() => setDropTargetIndex(null)}
                    >
                        <Stack spacing={1}>
                            {presentationSequence.length === 0 ? (
                                <Box sx={{ p: 3, textAlign: 'center' }}>
                                    <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)', mb: 1 }}>
                                        No slides in sequence
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.3)' }}>
                                        Click + to add a slide
                                    </Typography>
                                </Box>
                            ) : (
                                presentationSequence.map((step, index) => (
                                <Box
                                    key={index}
                                    sx={{
                                        animation: justDroppedIndex === index ? 'dropSuccess 0.4s ease-out' : 'none',
                                        '@keyframes dropSuccess': {
                                            '0%': { transform: 'scale(1.03)', boxShadow: '0 0 15px rgba(76, 175, 80, 0.6)' },
                                            '100%': { transform: 'scale(1)', boxShadow: 'none' }
                                        }
                                    }}
                                >
                                    <SlideItem
                                        index={index}
                                        step={step}
                                        indicatorConfig={indicatorConfig}
                                        userUploadCategories={userUploadCategories}
                                        onMenuOpen={handleMenuOpen}
                                        onRemove={removeStep}
                                        showDelete={presentationSequence.length > 1}
                                        onDragStart={handleDragStart}
                                        onDragOver={handleDragOver}
                                        onDragEnd={handleDragEnd}
                                        onDrop={handleDrop}
                                        isDragging={draggedIndex === index}
                                        isDropTarget={dropTargetIndex === index && draggedIndex !== index}
                                        isActive={sequenceIndex === index}
                                    />
                                </Box>
                            ))
                            )}
                        </Stack>
                        
                        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                            {allValidSlides.length === 0 ? (
                                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', p: 2 }}>
                                    No indicators available for this table
                                </Typography>
                            ) : (
                                <IconButton 
                                    onClick={addStep}
                                    disabled={allSlidesUsed}
                                    size="small"
                                    sx={{ 
                                        color: allSlidesUsed ? 'rgba(255,255,255,0.2)' : '#4CAF50', 
                                        bgcolor: allSlidesUsed ? 'transparent' : 'rgba(76, 175, 80, 0.1)',
                                        '&:hover': { bgcolor: 'rgba(76, 175, 80, 0.2)' },
                                        '&.Mui-disabled': { color: 'rgba(255,255,255,0.2)' }
                                    }}
                                >
                                    <AddIcon />
                                </IconButton>
                            )}
                        </Box>
                    </Box>
                </Box>
            </Box>

            {/* Dropdown Menus */}
            <Menu
                anchorEl={activeMenu?.anchorEl}
                open={Boolean(activeMenu)}
                onClose={handleMenuClose}
            >
                {activeMenu?.type === 'indicator' && (
                    <>
                        {tableIndicators.length === 0 ? (
                            <MenuItem disabled>
                                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)' }}>
                                    No indicators available for this table
                                </Typography>
                            </MenuItem>
                        ) : (
                            tableIndicators
                                .map(ind => {
                                    // Map indicator_id to indicator name
                                    if (ind.indicator_id === 1) return { key: 'mobility', indicator: ind };
                                    if (ind.indicator_id === 2) return { key: 'climate', indicator: ind };
                                    return null;
                                })
                                .filter(Boolean)
                                .map(({ key, indicator }) => {
                                    // Check if this indicator has states in the current table
                                    const hasStates = fileHierarchy
                                        .filter(table => table.name === currentTable)
                                        .some(table => 
                                            table.indicators?.some(ind => 
                                                ind.indicator_id === indicator.indicator_id && 
                                                ind.states && 
                                                ind.states.length > 0
                                            )
                                        );
                                    
                                    if (!hasStates) return null;
                                    
                                    return (
                                        <MenuItem 
                                            key={key} 
                                            onClick={() => handleSelection(key, null)}
                                            selected={presentationSequence[activeMenu.index]?.indicator === key}
                                        >
                                            {indicatorConfig[key]?.name.replace(' Dashboard', '') || indicator.name}
                                        </MenuItem>
                                    );
                                })
                        )}
                        {/* Add UGC indicators from file hierarchy */}
                        {fileHierarchy
                            .filter(table => table.name === currentTable)
                            .flatMap(table => 
                                (table.indicators || [])
                                    .filter(ind => ind.is_user_generated)
                                    .map(indicator => ({
                                        key: `ugc_${indicator.id}`,
                                        name: indicator.name,
                                        indicator
                                    }))
                            )
                            .map(({ key, name, indicator }) => {
                                // Check if this indicator has states
                                const hasStates = indicator.states && indicator.states.length > 0;
                                if (!hasStates) return null;
                                
                                return (
                                    <MenuItem 
                                        key={key}
                                        onClick={() => handleSelection(key, null)}
                                        selected={presentationSequence[activeMenu.index]?.indicator === key}
                                    >
                                        {name}
                                    </MenuItem>
                                );
                            })}
                        {userUploadCategories.map((category) => {
                            const categoryUploads = userUploads.filter(u => u.categoryName === category.name);
                            if (categoryUploads.length === 0) return null;
                            const indicatorKey = `user_upload_${category.name}`;
                            return (
                                <MenuItem 
                                    key={indicatorKey}
                                    onClick={() => handleSelection(indicatorKey, null)}
                                    selected={presentationSequence[activeMenu.index]?.indicator === indicatorKey}
                                >
                                    {category.display_name}
                                </MenuItem>
                            );
                        })}
                        {userUploads.filter(u => !u.categoryName).length > 0 && (
                            <MenuItem 
                                onClick={() => handleSelection('user_upload', null)}
                                selected={presentationSequence[activeMenu.index]?.indicator === 'user_upload'}
                            >
                                User Uploads
                            </MenuItem>
                        )}
                    </>
                )}

                {activeMenu?.type === 'state' && (() => {
                    const indicator = presentationSequence[activeMenu.index]?.indicator;
                    const currentSlide = presentationSequence[activeMenu.index];
                    
                    // Get states from file hierarchy for current table
                    const getTableStates = () => {
                        const states = [];
                        fileHierarchy
                            .filter(table => table.name === currentTable)
                            .forEach(table => {
                                if (table.indicators) {
                                    const tableIndicator = table.indicators.find(ind => {
                                        if (indicator === 'mobility') return ind.indicator_id === 1;
                                        if (indicator === 'climate') return ind.indicator_id === 2;
                                        return false;
                                    });
                                    
                                    if (tableIndicator && tableIndicator.states) {
                                        tableIndicator.states.forEach(state => {
                                            if (indicator === 'climate') {
                                                if (state.scenario_name) {
                                                    const scenarioDisplayNames = {
                                                        'dense_highrise': 'Dense Highrise',
                                                        'existing': 'Existing',
                                                        'high_rises': 'High Rises',
                                                        'lowrise': 'Low Rise Dense',
                                                        'mass_tree_planting': 'Mass Tree Planting',
                                                        'open_public_space': 'Open Public Space',
                                                        'placemaking': 'Placemaking'
                                                    };
                                                    const displayName = scenarioDisplayNames[state.scenario_name] || state.scenario_name;
                                                    states.push({ 
                                                        name: displayName, 
                                                        type: state.scenario_type || 'utci',
                                                        scenario_name: state.scenario_name
                                                    });
                                                }
                                            } else {
                                                if (state.state_values?.scenario) {
                                                    const scenario = state.state_values.scenario;
                                                    const displayName = scenario.charAt(0).toUpperCase() + scenario.slice(1);
                                                    states.push({ name: displayName, scenario });
                                                }
                                            }
                                        });
                                    }
                                }
                            });
                        return states;
                    };
                    
                    const tableStates = getTableStates();

                    if (indicator.startsWith('ugc_')) {
                        // For UGC indicators, show states from file hierarchy
                        const indicatorId = parseInt(indicator.replace('ugc_', ''));
                        const tableData = fileHierarchy.find(t => t.name === currentTable);
                        const tableIndicator = tableData?.indicators?.find(ind => ind.id === indicatorId && ind.is_user_generated);
                        
                        if (!tableIndicator || !tableIndicator.states || tableIndicator.states.length === 0) {
                            return (
                                <MenuItem disabled>
                                    <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)' }}>
                                        No states available for this indicator
                                    </Typography>
                                </MenuItem>
                            );
                        }
                        
                        return tableIndicator.states.map(state => {
                            const stateName = state.scenario_name || JSON.stringify(state.state_values);
                            const isUsed = isSlideUsed(indicator, stateName, null, null, state.id, activeMenu.index);
                            const isCurrentSelection = currentSlide?.stateId === state.id;
                            
                            return (
                                <MenuItem
                                    key={state.id}
                                    onClick={() => !isUsed && handleSelection(indicator, stateName, null, null, null, state.id, tableIndicator.name, tableData?.display_name || tableData?.name)}
                                    selected={isCurrentSelection}
                                    disabled={isUsed && !isCurrentSelection}
                                    sx={{
                                        opacity: isUsed && !isCurrentSelection ? 0.4 : 1,
                                        '&.Mui-disabled': { opacity: 0.4 }
                                    }}
                                >
                                    {stateName}
                                    {isUsed && !isCurrentSelection && (
                                        <Typography variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                                            (in use)
                                        </Typography>
                                    )}
                                </MenuItem>
                            );
                        });
                    } else if (indicator.startsWith('user_upload')) {
                        // For user uploads, show list of uploads from the selected category
                        const categoryName = indicator.replace('user_upload_', '');
                        const categoryUploads = userUploads.filter(u => 
                            categoryName ? u.categoryName === categoryName : !u.categoryName
                        );
                        return categoryUploads.map(upload => {
                            const isUsed = isSlideUsed(indicator, upload.displayName, null, upload.id, null, activeMenu.index);
                            const isCurrentSelection = currentSlide?.uploadId === upload.id;
                            return (
                                <MenuItem
                                    key={upload.id}
                                    onClick={() => !isUsed && handleSelection(indicator, upload.displayName, null, upload.id, upload.imageUrl)}
                                    selected={isCurrentSelection}
                                    disabled={isUsed && !isCurrentSelection}
                                    sx={{
                                        opacity: isUsed && !isCurrentSelection ? 0.4 : 1,
                                        '&.Mui-disabled': { opacity: 0.4 }
                                    }}
                                >
                                    {upload.displayName}
                                    {isUsed && !isCurrentSelection && (
                                        <Typography variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                                            (in use)
                                        </Typography>
                                    )}
                                </MenuItem>
                            );
                        });
                    } else if (indicator === 'climate') {
                        // For climate, show state+type combinations from table
                        if (tableStates.length === 0) {
                            return (
                                <MenuItem disabled>
                                    <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)' }}>
                                        No states available for this indicator
                                    </Typography>
                                </MenuItem>
                            );
                        }
                        
                        const items = [];
                        const uniqueStates = new Map();
                        tableStates.forEach(state => {
                            const key = `${state.name}-${state.type}`;
                            if (!uniqueStates.has(key)) {
                                uniqueStates.set(key, state);
                            }
                        });
                        
                        Array.from(uniqueStates.values()).forEach(state => {
                            if (!isValidSlide(indicator, state.name)) return;
                            const isUsed = isSlideUsed(indicator, state.name, state.type, null, null, activeMenu.index);
                            const isCurrentSelection = currentSlide?.state === state.name && currentSlide?.type === state.type;
                            items.push(
                                <MenuItem
                                    key={`${state.name}-${state.type}`}
                                    onClick={() => !isUsed && handleSelection(indicator, state.name, state.type)}
                                    selected={isCurrentSelection}
                                    disabled={isUsed && !isCurrentSelection}
                                    sx={{
                                        opacity: isUsed && !isCurrentSelection ? 0.4 : 1,
                                        '&.Mui-disabled': { opacity: 0.4 }
                                    }}
                                >
                                    {state.name} ({state.type.toUpperCase()})
                                    {isUsed && !isCurrentSelection && (
                                        <Typography variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                                            (in use)
                                        </Typography>
                                    )}
                                </MenuItem>
                            );
                        });
                        return items;
                    } else {
                        // For non-climate indicators, show just states from table
                        if (tableStates.length === 0) {
                            return (
                                <MenuItem disabled>
                                    <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)' }}>
                                        No states available for this indicator
                                    </Typography>
                                </MenuItem>
                            );
                        }
                        
                        return tableStates.map(state => {
                            if (!isValidSlide(indicator, state.name)) return null;
                            const isUsed = isSlideUsed(indicator, state.name, null, null, null, activeMenu.index);
                            const isCurrentSelection = currentSlide?.state === state.name;
                            return (
                                <MenuItem
                                    key={state.name}
                                    onClick={() => !isUsed && handleSelection(indicator, state.name)}
                                    selected={isCurrentSelection}
                                    disabled={isUsed && !isCurrentSelection}
                                    sx={{
                                        opacity: isUsed && !isCurrentSelection ? 0.4 : 1,
                                        '&.Mui-disabled': { opacity: 0.4 }
                                    }}
                                >
                                    {state.name}
                                    {isUsed && !isCurrentSelection && (
                                        <Typography variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                                            (in use)
                                        </Typography>
                                    )}
                                </MenuItem>
                            );
                        });
                    }
                })()}
            </Menu>

            {/* Info Dialog */}
            <Dialog
                open={openInfo}
                TransitionComponent={Transition}
                keepMounted
                onClose={() => setOpenInfo(false)}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle sx={{ pb: 1 }}>
                    How to Use Presentation Mode
                </DialogTitle>
                <DialogContent>
                    <DialogContentText component="div">
                        <Typography variant="subtitle2" gutterBottom sx={{ color: 'primary.main', mt: 1 }}>
                            Managing Slides
                        </Typography>
                        <Typography variant="body2" paragraph>
                            • Click the <strong>+</strong> button to add a new slide (automatically picks the next unused one)
                            <br />
                            • Click the dropdown buttons to change the indicator or state for each slide
                            <br />
                            • Drag slides using the grip icon to reorder them
                            <br />
                            • Click the trash icon to remove a slide
                        </Typography>
                        
                        <Typography variant="subtitle2" gutterBottom sx={{ color: 'primary.main' }}>
                            Navigation
                        </Typography>
                        <Typography variant="body2" paragraph>
                            • Use the <strong>←</strong> and <strong>→</strong> buttons to navigate between slides
                            <br />
                            • Slides advance automatically based on the duration setting
                            <br />
                            • Adjust the <strong>Auto-advance</strong> time to control how long each slide displays
                        </Typography>
                        
                        <Typography variant="subtitle2" gutterBottom sx={{ color: 'primary.main' }}>
                            Projection
                        </Typography>
                        <Typography variant="body2" paragraph>
                            • The presentation controls what is displayed on the projection screen
                            <br />
                            • Changes are synced in real-time with the projection view
                            <br />
                            • Only image and video slides are available (interactive maps are excluded)
                        </Typography>
                        
                        <Typography variant="subtitle2" gutterBottom sx={{ color: 'primary.main' }}>
                            Tips
                        </Typography>
                        <Typography variant="body2">
                            • Each slide can only be used once to avoid duplicates
                            <br />
                            • Used states appear greyed out in the dropdown
                            <br />
                            • Click <strong>X</strong> to exit and return to the dashboard
                        </Typography>
                    </DialogContentText>
                </DialogContent>
            </Dialog>
        </Box>
    );
};

export default PresentationMode;
