import React , { useState } from "react";
import PresentationMenuItem from "./PresentationMenuItem.jsx"

import {
  IconButton,
  Box,
  Menu,
  MenuItem,
  TextField,
  Stack,
  InputAdornment,
  Typography
} from "@mui/material";
import AddIcon from '@mui/icons-material/Add';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';

import { useAppData } from "../../DataContext";


const PresentationModeSettings = () => {
    const { 
        indicatorConfig, 
        StateConfig,
        presentationSequence, 
        setPresentationSequence,
        globalDuration,
        setGlobalDuration,
        sequenceIndex,
        skipToNextStep,
        skipToPrevStep
    } = useAppData();
    
    const defaultIndicator = Object.keys(indicatorConfig)[0];
    const defaultState = StateConfig[defaultIndicator]?.[0];

    const [activeMenu, setActiveMenu] = useState(null);
    const [draggedIndex, setDraggedIndex] = useState(null);
    const [dropTargetIndex, setDropTargetIndex] = useState(null);
    const [justDroppedIndex, setJustDroppedIndex] = useState(null);

    const handleMenuOpen = (event, index, type) => {
        setActiveMenu({ index, type, anchorEl: event.currentTarget });
    };

    const handleMenuClose = () => {
        setActiveMenu(null);
    };

    const handleSelection = (value) => {
        if (!activeMenu) return;
        
        const { index, type } = activeMenu;
        const newSequence = [...presentationSequence];
        
        if (type === 'indicator') {
            const firstState = StateConfig[value]?.[0];
            newSequence[index] = { indicator: value, state: firstState };
        } else {
            newSequence[index] = { ...newSequence[index], state: value };
        }
        
        setPresentationSequence(newSequence);
        handleMenuClose();
    };

    const addStep = () => {
        const newStep = { 
            indicator: defaultIndicator, 
            state: defaultState 
        };
        setPresentationSequence([...presentationSequence, newStep]);
    };

    const removeStep = (index) => {
        if (presentationSequence.length > 1) {
            const newSequence = presentationSequence.filter((_, i) => i !== index);
            setPresentationSequence(newSequence);
        }
    };

    // Drag and drop handlers
    const handleDragStart = (e, index) => {
        setDraggedIndex(index);
        setJustDroppedIndex(null);
        e.dataTransfer.effectAllowed = 'move';
        // Add a slight delay for the drag image to look better
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
        
        // Remove from old position
        newSequence.splice(draggedIndex, 1);
        // Adjust target index if needed after removal
        const adjustedTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
        // Insert at new position
        newSequence.splice(adjustedTargetIndex, 0, draggedItem);
        
        setPresentationSequence(newSequence);
        
        // Show success feedback
        setJustDroppedIndex(adjustedTargetIndex);
        setTimeout(() => setJustDroppedIndex(null), 600);
        
        setDraggedIndex(null);
        setDropTargetIndex(null);
    };

    const handleDragEnd = () => {
        setDraggedIndex(null);
        setDropTargetIndex(null);
    };

    const handleDragLeave = () => {
        setDropTargetIndex(null);
    };

    return (
        <Box sx={{ 
            p: 2, 
            height: '100%', 
            display: 'flex', 
            flexDirection: 'column', 
            color: 'white' 
        }}>

            <Box sx={{ mb: 3, px: 1 }}>
                <TextField
                    label="Slide Duration"
                    type="number"
                    variant="outlined"
                    size="small"
                    value={globalDuration}
                    onChange={(e) => setGlobalDuration(Math.max(1, parseInt(e.target.value) || 5))}
                    fullWidth
                    InputProps={{
                        endAdornment: <InputAdornment position="end" sx={{ color: 'rgba(255,255,255,0.5)' }}>sec</InputAdornment>,
                    }}
                    sx={{ 
                        '& .MuiOutlinedInput-root': { color: 'white', backgroundColor: 'rgba(255,255,255,0.05)' },
                        '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.7)' },
                        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.2)' },
                        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.4)' },
                        '& input': { textAlign: 'center', color: 'white' }
                    }}
                />
            </Box>

            <Box 
                sx={{ flexGrow: 1, overflowY: 'auto', pr: 1, mb: 2 }}
                onDragLeave={handleDragLeave}
            >
                <Stack spacing={2}>
                    {presentationSequence.map((step, index) => (
                        <Box
                            key={index}
                            sx={{
                                // Success animation when dropped
                                animation: justDroppedIndex === index 
                                    ? 'dropSuccess 0.5s ease-out' 
                                    : 'none',
                                '@keyframes dropSuccess': {
                                    '0%': { 
                                        transform: 'scale(1.05)',
                                        boxShadow: '0 0 20px rgba(76, 175, 80, 0.8)'
                                    },
                                    '50%': { 
                                        transform: 'scale(1.02)',
                                        boxShadow: '0 0 30px rgba(76, 175, 80, 0.6)'
                                    },
                                    '100%': { 
                                        transform: 'scale(1)',
                                        boxShadow: 'none'
                                    }
                                }
                            }}
                        >
                            <PresentationMenuItem
                                index={index}
                                step={step}
                                indicatorConfig={indicatorConfig}
                                onMenuOpen={handleMenuOpen}
                                onRemove={removeStep}
                                showDelete={presentationSequence.length > 1}
                                disabled={false}
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
                
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
                    <IconButton 
                        onClick={addStep} 
                        sx={{ 
                            color: '#4CAF50', 
                            bgcolor: 'rgba(76, 175, 80, 0.1)',
                            '&:hover': { 
                                bgcolor: 'rgba(76, 175, 80, 0.2)',
                                transform: 'scale(1.1)' 
                            } 
                        }}
                    >
                        <AddIcon fontSize="large" />
                    </IconButton>
                </Box>
            </Box>

            <Menu
                anchorEl={activeMenu?.anchorEl}
                open={Boolean(activeMenu)}
                onClose={handleMenuClose}
            >
                {activeMenu?.type === 'indicator' && Object.keys(indicatorConfig).map((key) => (
                    <MenuItem 
                        key={key} 
                        onClick={() => handleSelection(key)}
                        selected={presentationSequence[activeMenu.index].indicator === key}
                    >
                        {indicatorConfig[key].name.replace(' Dashboard', '')}
                    </MenuItem>
                ))}

                {activeMenu?.type === 'state' && StateConfig[presentationSequence[activeMenu.index].indicator]?.map((st) => (
                    <MenuItem 
                        key={st} 
                        onClick={() => handleSelection(st)}
                        selected={presentationSequence[activeMenu.index].state === st}
                    >
                        {st}
                    </MenuItem>
                ))}
            </Menu>

            <Box sx={{ pt: 2, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <Typography 
                    variant="caption" 
                    sx={{ 
                        display: 'block', 
                        textAlign: 'center', 
                        color: 'rgba(255,255,255,0.5)', 
                        mb: 1.5 
                    }}
                >
                    Slide {sequenceIndex + 1} of {presentationSequence.length}
                </Typography>
                <Stack direction="row" justifyContent="center" spacing={4} alignItems="center">
                    <IconButton 
                        onClick={skipToPrevStep}  
                        sx={{ 
                            color: 'white',
                            bgcolor: 'rgba(255,255,255,0.1)',
                            width: 56,
                            height: 56,
                            '&:hover': { 
                                bgcolor: 'rgba(255,255,255,0.2)',
                                transform: 'scale(1.05)'
                            },
                            transition: 'all 0.2s ease'
                        }}
                    >
                        <NavigateBeforeIcon fontSize="large" />
                    </IconButton>
                    
                    <IconButton 
                        onClick={skipToNextStep}  
                        sx={{ 
                            color: 'white',
                            bgcolor: 'rgba(255,255,255,0.1)',
                            width: 56,
                            height: 56,
                            '&:hover': { 
                                bgcolor: 'rgba(255,255,255,0.2)',
                                transform: 'scale(1.05)'
                            },
                            transition: 'all 0.2s ease'
                        }}
                    >
                        <NavigateNextIcon fontSize="large" />
                    </IconButton>
                </Stack>
            </Box>
        </Box>
    );
};

export default PresentationModeSettings;
