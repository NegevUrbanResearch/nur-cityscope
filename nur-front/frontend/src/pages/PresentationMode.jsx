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
                            {step.state}
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
        currentIndicator
    } = useAppData();
    
    // Get all valid slides
    const allValidSlides = useMemo(() => {
        const slides = [];
        Object.keys(indicatorConfig).forEach(indicator => {
            const states = StateConfig[indicator] || [];
            states.forEach(state => {
                if (isValidSlide(indicator, state)) {
                    slides.push({ indicator, state });
                }
            });
        });
        return slides;
    }, [indicatorConfig, StateConfig]);

    // Check if a slide combination is already used
    const isSlideUsed = (indicator, state, excludeIndex = -1) => {
        return presentationSequence.some((step, idx) => 
            idx !== excludeIndex && step.indicator === indicator && step.state === state
        );
    };

    const defaultIndicator = Object.keys(indicatorConfig)[0];
    const defaultState = StateConfig[defaultIndicator]?.find(s => isValidSlide(defaultIndicator, s));

    const [activeMenu, setActiveMenu] = useState(null);
    const [draggedIndex, setDraggedIndex] = useState(null);
    const [dropTargetIndex, setDropTargetIndex] = useState(null);
    const [justDroppedIndex, setJustDroppedIndex] = useState(null);
    const [openInfo, setOpenInfo] = useState(false);
    const [thumbnailUrl, setThumbnailUrl] = useState(null);

    // Enter presentation mode when page loads
    useEffect(() => {
        if (!isPresentationMode) {
            togglePresentationMode(true);
        }
    }, [isPresentationMode, togglePresentationMode]);

    // Fetch thumbnail for current slide
    useEffect(() => {
        const fetchThumbnail = async () => {
            try {
                const timestamp = Date.now();
                const response = await api.get(
                    `/api/actions/get_image_data/?_=${timestamp}&indicator=${currentIndicator}`
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
        fetchThumbnail();
    }, [currentIndicator, sequenceIndex]);

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

    const handleSelection = (indicator, state) => {
        if (!activeMenu) return;
        
        const { index, type } = activeMenu;
        const newSequence = [...presentationSequence];
        
        if (type === 'indicator') {
            // When changing indicator, find first unused valid state
            const availableStates = StateConfig[indicator]?.filter(s => 
                isValidSlide(indicator, s) && !isSlideUsed(indicator, s, index)
            ) || [];
            const firstState = availableStates[0] || StateConfig[indicator]?.[0];
            newSequence[index] = { indicator, state: firstState };
        } else {
            newSequence[index] = { ...newSequence[index], state };
        }
        
        setPresentationSequence(newSequence);
        handleMenuClose();
    };

    const addStep = () => {
        // Find first unused valid slide
        const unusedSlide = allValidSlides.find(slide => 
            !isSlideUsed(slide.indicator, slide.state)
        );
        
        if (unusedSlide) {
            setPresentationSequence([...presentationSequence, unusedSlide]);
        } else {
            // Fallback if all used
            const newStep = { indicator: defaultIndicator, state: defaultState };
            setPresentationSequence([...presentationSequence, newStep]);
        }
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

    const currentStep = presentationSequence[sequenceIndex];
    const allSlidesUsed = allValidSlides.every(slide => 
        isSlideUsed(slide.indicator, slide.state)
    );

    const isVideo = thumbnailUrl?.includes('.mp4');

    return (
        <Box sx={{ minHeight: '100vh', bgcolor: '#0a0a0f', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', px: 3, py: 2 }}>
                <img
                    src={config.frontend.logo.url}
                    alt="nur"
                    style={{ width: '80px', filter: 'brightness(0) invert(1)' }}
                />
                <Typography variant="h4" sx={{ color: 'white', fontWeight: 600, flex: 1, textAlign: 'center', letterSpacing: 1 }}>
                    Presentation Mode
                </Typography>
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

            {/* Main Content */}
            <Box sx={{ flex: 1, display: 'flex', p: 3, gap: 3 }}>
                {/* Left Panel - Current Slide */}
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    {/* Large Thumbnail */}
                    {thumbnailUrl && (
                        <Box sx={{ 
                            width: '100%',
                            maxWidth: 720,
                            aspectRatio: '16/10',
                            mb: 3, 
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

                    <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.5)', mb: 1, letterSpacing: 2, textTransform: 'uppercase' }}>
                        Now Showing
                    </Typography>
                    <Typography variant="h3" sx={{ color: 'white', mb: 4, fontWeight: 500 }}>
                        {indicatorConfig[currentStep?.indicator]?.name.replace(' Dashboard', '')} - {currentStep?.state}
                    </Typography>

                    {/* Navigation & Timer Controls */}
                    <Stack direction="row" spacing={3} alignItems="center">
                        <IconButton 
                            onClick={skipToPrevStep}  
                            sx={{ 
                                color: 'white', 
                                bgcolor: 'rgba(255,255,255,0.08)', 
                                width: 56, 
                                height: 56,
                                '&:hover': { bgcolor: 'rgba(255,255,255,0.15)' } 
                            }}
                        >
                            <NavigateBeforeIcon sx={{ fontSize: 32 }} />
                        </IconButton>
                        
                        <Box sx={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: 2,
                            bgcolor: 'rgba(255,255,255,0.05)',
                            borderRadius: 2,
                            px: 3,
                            py: 1.5
                        }}>
                            <Typography variant="h5" sx={{ color: 'white', fontWeight: 500, minWidth: 70, textAlign: 'center' }}>
                                {sequenceIndex + 1} / {presentationSequence.length}
                            </Typography>
                            <Box sx={{ width: 1, height: 30, bgcolor: 'rgba(255,255,255,0.15)' }} />
                            <Stack direction="row" alignItems="center" spacing={1}>
                                <IconButton 
                                    size="small"
                                    onClick={() => setGlobalDuration(Math.max(1, globalDuration - 1))}
                                    sx={{ color: 'rgba(255,255,255,0.6)', '&:hover': { color: 'white' } }}
                                >
                                    <Typography variant="h6">−</Typography>
                                </IconButton>
                                <Typography variant="h5" sx={{ color: 'white', minWidth: 60, textAlign: 'center' }}>
                                    {globalDuration}s
                                </Typography>
                                <IconButton 
                                    size="small"
                                    onClick={() => setGlobalDuration(globalDuration + 1)}
                                    sx={{ color: 'rgba(255,255,255,0.6)', '&:hover': { color: 'white' } }}
                                >
                                    <Typography variant="h6">+</Typography>
                                </IconButton>
                            </Stack>
                        </Box>
                        
                        <IconButton 
                            onClick={skipToNextStep}  
                            sx={{ 
                                color: 'white', 
                                bgcolor: 'rgba(255,255,255,0.08)', 
                                width: 56, 
                                height: 56,
                                '&:hover': { bgcolor: 'rgba(255,255,255,0.15)' } 
                            }}
                        >
                            <NavigateNextIcon sx={{ fontSize: 32 }} />
                        </IconButton>
                    </Stack>
                </Box>

                {/* Right Panel - Slide List */}
                <Box sx={{ width: 380, display: 'flex', flexDirection: 'column', bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 2, overflow: 'hidden' }}>
                    <Typography variant="h6" sx={{ color: 'white', fontWeight: 600, p: 2, bgcolor: 'rgba(0,0,0,0.2)' }}>
                        Slide Sequence
                    </Typography>
                    
                    <Box sx={{ flex: 1, overflowY: 'auto', p: 1.5 }} onDragLeave={() => setDropTargetIndex(null)}>
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

                {activeMenu?.type === 'state' && StateConfig[presentationSequence[activeMenu.index]?.indicator]?.map((st) => {
                    // Check if valid and if already used
                    const indicator = presentationSequence[activeMenu.index]?.indicator;
                    if (!isValidSlide(indicator, st)) return null;
                    
                    const isUsed = isSlideUsed(indicator, st, activeMenu.index);
                    const isCurrentSelection = presentationSequence[activeMenu.index]?.state === st;
                    
                    return (
                        <MenuItem 
                            key={st} 
                            onClick={() => !isUsed && handleSelection(indicator, st)}
                            selected={isCurrentSelection}
                            disabled={isUsed && !isCurrentSelection}
                            sx={{
                                opacity: isUsed && !isCurrentSelection ? 0.4 : 1,
                                '&.Mui-disabled': {
                                    opacity: 0.4,
                                }
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
                })}
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
