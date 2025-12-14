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
                            {indicatorConfig[step.indicator]?.name.replace(' Dashboard', '') || step.indicator}
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
                            {step.indicator === 'climate' && step.type ? `${step.state} (${step.type.toUpperCase()})` : step.state}
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
        skipToNextStep,
        skipToPrevStep,
        isPresentationMode,
        togglePresentationMode,
        isPlaying,
        togglePlayPause,
        currentIndicator
    } = useAppData();
    
    // Get all valid slides (including both UTCI and Plan for climate)
    const allValidSlides = useMemo(() => {
        const slides = [];
        Object.keys(indicatorConfig).forEach(indicator => {
            const states = StateConfig[indicator] || [];
            states.forEach(state => {
                if (isValidSlide(indicator, state)) {
                    if (indicator === 'climate') {
                        // For climate, create both UTCI and Plan versions
                        slides.push({ indicator, state, type: 'utci' });
                        slides.push({ indicator, state, type: 'plan' });
                    } else {
                        slides.push({ indicator, state });
                    }
                }
            });
        });
        return slides;
    }, [indicatorConfig, StateConfig]);

    // Check if a slide combination is already used (including type for climate)
    const isSlideUsed = (indicator, state, type, excludeIndex = -1) => {
        return presentationSequence.some((step, idx) => {
            if (idx === excludeIndex) return false;
            if (step.indicator !== indicator || step.state !== state) return false;
            // For climate, also check type
            if (indicator === 'climate') {
                return step.type === type;
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

    // Enter presentation mode when page loads (but don't auto-start playing)
    useEffect(() => {
        if (!isPresentationMode) {
            togglePresentationMode(true, false); // Enter presentation mode, but paused
        }
    }, [isPresentationMode, togglePresentationMode]);

    // Helper function to generate cache key for a slide (include type for climate)
    const getCacheKey = (indicator, state, type) => {
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
    const fetchAndCacheImage = React.useCallback(async (indicator, state, type, priority = 'normal') => {
        const cacheKey = getCacheKey(indicator, state, type);

        // Check if already cached
        if (imageCacheRef.current.has(cacheKey)) {
            return imageCacheRef.current.get(cacheKey);
        }

        // Prevent duplicate requests
        if (inFlightRequestsRef.current.has(cacheKey)) {
            return null;
        }

        inFlightRequestsRef.current.add(cacheKey);

        try {
            const timestamp = Date.now();

            // Build URL with PREFETCH mode params - this fetches specific images without modifying backend state
            let url = `/api/actions/get_image_data/?_=${timestamp}&indicator=${indicator}`;

            if (indicator === 'climate') {
                // For climate, convert display name to scenario key and add type
                const scenarioKey = CLIMATE_SCENARIO_KEYS[state] || state.toLowerCase().replace(/ /g, '_');
                url += `&scenario=${scenarioKey}&type=${type || 'utci'}`;
            } else {
                // For mobility/other, convert display name to scenario key
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
    }, []);

    // Aggressive preloading: preload all slides immediately, prioritizing upcoming ones
    useEffect(() => {
        if (!presentationSequence || presentationSequence.length === 0) return;

        const preloadAllSlides = async () => {
            setIsPreloading(true);
            console.log(`🚀 Prefetching ${presentationSequence.length} slides`);

            // Priority 1: Current slide (must be instant)
            const currentSlide = presentationSequence[sequenceIndex];
            if (currentSlide) {
                await fetchAndCacheImage(currentSlide.indicator, currentSlide.state, currentSlide.type, 'high');
            }

            // Priority 2: Next 3 slides (high priority, await to ensure they're ready)
            const highPriorityCount = Math.min(3, presentationSequence.length);
            for (let i = 1; i <= highPriorityCount; i++) {
                const idx = (sequenceIndex + i) % presentationSequence.length;
                const slide = presentationSequence[idx];
                if (slide && idx !== sequenceIndex) {
                    await fetchAndCacheImage(slide.indicator, slide.state, slide.type, 'high');
                }
            }

            // Priority 3: Remaining slides (background, fire and forget)
            for (let i = 0; i < presentationSequence.length; i++) {
                if (i === sequenceIndex) continue;
                const isHighPriority = i <= (sequenceIndex + highPriorityCount) % presentationSequence.length && i > sequenceIndex;
                if (!isHighPriority) {
                    const slide = presentationSequence[i];
                    fetchAndCacheImage(slide.indicator, slide.state, slide.type, 'normal'); // No await - background
                }
            }

            setIsPreloading(false);
            console.log(`✓ Prefetch complete`);
        };

        preloadAllSlides();
    }, [presentationSequence, fetchAndCacheImage]);

    // Update thumbnail when current slide changes
    useEffect(() => {
        if (!currentStep) return;

        const updateThumbnail = async () => {
            const cacheKey = getCacheKey(currentStep.indicator, currentStep.state, currentStep.type);

            // Check cache first
            if (imageCacheRef.current.has(cacheKey)) {
                const cachedUrl = imageCacheRef.current.get(cacheKey);
                setThumbnailUrl(cachedUrl);

                // Preload next slide in background
                const nextIndex = (sequenceIndex + 1) % presentationSequence.length;
                const nextSlide = presentationSequence[nextIndex];
                if (nextSlide) {
                    fetchAndCacheImage(nextSlide.indicator, nextSlide.state, nextSlide.type, 'high');
                }
            } else {
                // Not cached yet, fetch it
                const url = await fetchAndCacheImage(currentStep.indicator, currentStep.state, currentStep.type, 'high');
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
                    `/api/actions/get_image_data/?_=${timestamp}&indicator=${indicator}`
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
    }, []); // Empty deps - register once, use ref for current indicator

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

    const handleSelection = (indicator, state, slideType = null) => {
        if (!activeMenu) return;

        const { index, type: menuType } = activeMenu;
        const newSequence = [...presentationSequence];
        const currentSlide = newSequence[index];

        if (menuType === 'indicator') {
            // When changing indicator, find first unused valid state
            // For climate, also need to find unused type
            if (indicator === 'climate') {
                // Find first unused climate state+type combo
                const availableSlide = StateConfig[indicator]?.flatMap(s => {
                    if (!isValidSlide(indicator, s)) return [];
                    const slides = [];
                    if (!isSlideUsed(indicator, s, 'utci', index)) slides.push({ state: s, type: 'utci' });
                    if (!isSlideUsed(indicator, s, 'plan', index)) slides.push({ state: s, type: 'plan' });
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
                    isValidSlide(indicator, s) && !isSlideUsed(indicator, s, null, index)
                ) || [];
                const firstState = availableStates[0] || StateConfig[indicator]?.[0];
                newSequence[index] = { indicator, state: firstState };
            }
        } else if (menuType === 'state') {
            // Changing state - for climate, slideType contains the new type
            if (currentSlide.indicator === 'climate' && slideType) {
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
        // Find first unused valid slide (must pass type for proper climate detection)
        const unusedSlide = allValidSlides.find(slide =>
            !isSlideUsed(slide.indicator, slide.state, slide.type)
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
        isSlideUsed(slide.indicator, slide.state, slide.type)
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
                <Box sx={{ display: 'flex', gap: 1 }}>
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
                        {indicatorConfig[currentStep?.indicator]?.name.replace(' Dashboard', '')} - {currentStep?.indicator === 'climate' && currentStep?.type ? `${currentStep?.state} (${currentStep.type.toUpperCase()})` : currentStep?.state}
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
                                {sequenceIndex + 1} / {presentationSequence.length}
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
                            {presentationSequence.map((step, index) => (
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
                            ))}
                        </Stack>
                        
                        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
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
                {activeMenu?.type === 'indicator' && Object.keys(indicatorConfig).map((key) => {
                    // Check if this indicator has any valid unused states
                    const hasValidStates = StateConfig[key]?.some(s => isValidSlide(key, s));
                    if (!hasValidStates) return null;
                    
                    return (
                        <MenuItem 
                            key={key} 
                            onClick={() => handleSelection(key, null)}
                            selected={presentationSequence[activeMenu.index]?.indicator === key}
                        >
                            {indicatorConfig[key].name.replace(' Dashboard', '')}
                        </MenuItem>
                    );
                })}

                {activeMenu?.type === 'state' && (() => {
                    const indicator = presentationSequence[activeMenu.index]?.indicator;
                    const currentSlide = presentationSequence[activeMenu.index];
                    const states = StateConfig[indicator] || [];

                    if (indicator === 'climate') {
                        // For climate, show state+type combinations
                        const items = [];
                        states.forEach(st => {
                            if (!isValidSlide(indicator, st)) return;
                            ['utci', 'plan'].forEach(type => {
                                const isUsed = isSlideUsed(indicator, st, type, activeMenu.index);
                                const isCurrentSelection = currentSlide?.state === st && currentSlide?.type === type;
                                items.push(
                                    <MenuItem
                                        key={`${st}-${type}`}
                                        onClick={() => !isUsed && handleSelection(indicator, st, type)}
                                        selected={isCurrentSelection}
                                        disabled={isUsed && !isCurrentSelection}
                                        sx={{
                                            opacity: isUsed && !isCurrentSelection ? 0.4 : 1,
                                            '&.Mui-disabled': { opacity: 0.4 }
                                        }}
                                    >
                                        {st} ({type.toUpperCase()})
                                        {isUsed && !isCurrentSelection && (
                                            <Typography variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                                                (in use)
                                            </Typography>
                                        )}
                                    </MenuItem>
                                );
                            });
                        });
                        return items;
                    } else {
                        // For non-climate indicators, show just states
                        return states.map(st => {
                            if (!isValidSlide(indicator, st)) return null;
                            const isUsed = isSlideUsed(indicator, st, null, activeMenu.index);
                            const isCurrentSelection = currentSlide?.state === st;
                            return (
                                <MenuItem
                                    key={st}
                                    onClick={() => !isUsed && handleSelection(indicator, st)}
                                    selected={isCurrentSelection}
                                    disabled={isUsed && !isCurrentSelection}
                                    sx={{
                                        opacity: isUsed && !isCurrentSelection ? 0.4 : 1,
                                        '&.Mui-disabled': { opacity: 0.4 }
                                    }}
                                >
                                    {st}
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
