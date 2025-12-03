import React , { useState } from "react";
import PresentationMenuItem from "./PresentationMenuItem.jsx"

import {
  IconButton,
  Typography,
  Box,
  Menu,
  MenuItem,
  TextField,
  Stack,
  InputAdornment
} from "@mui/material";
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import RestartAltIcon from '@mui/icons-material/RestartAlt';


import { useAppData } from "../../DataContext";


const PresentationModeSettings = () => {
    const { 
        indicatorConfig, 
        StateConfig,
        presentationSequence, 
        setPresentationSequence,
        isPlaying,
        setIsPlaying,
        globalDuration,
        setGlobalDuration,
        setSequenceIndex 
    } = useAppData();
    
    const defaultIndicator = Object.keys(indicatorConfig)[0];
    const defaultState = StateConfig[defaultIndicator]?.[0];

    const [activeMenu, setActiveMenu] = useState(null);

    const handleMenuOpen = (event, index, type) => {
        if (isPlaying) return;
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
    
    // פונקציית Restart: עוצרת את הנגינה ומאפסת את האינדקס
    const handleRestart = () => {
        setIsPlaying(false);
        // מאפסים את האינדקס ב-DataContext כדי להתחיל מהתחלה
        setSequenceIndex(0); 
        console.log("Presentation sequence reset to start and edit mode enabled.");
    };

    return (
        <Box sx={{ 
            p: 2, 
            height: '100%', 
            display: 'flex', 
            flexDirection: 'column', 
            color: 'white' 
        }}>
            <Typography variant="h6" sx={{ color: '#64B5F6', fontWeight: 600, mb: 3, textAlign: 'center' }}>
                Presentation Setup
            </Typography>

            <Box sx={{ mb: 3, px: 1 }}>
                <TextField
                    label="Slide Duration"
                    type="number"
                    variant="outlined"
                    size="small"
                    value={globalDuration}
                    onChange={(e) => setGlobalDuration(Math.max(1, parseInt(e.target.value) || 5))}
                    disabled={isPlaying}
                    fullWidth
                    InputProps={{
                        endAdornment: <InputAdornment position="end" sx={{ color: 'rgba(255,255,255,0.5)' }}>sec</InputAdornment>,
                    }}
                    sx={{ 
                        opacity: isPlaying ? 0.6 : 1,
                        '& .MuiOutlinedInput-root': { color: 'white', backgroundColor: 'rgba(255,255,255,0.05)' },
                        '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.7)' },
                        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.2)' },
                        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.4)' },
                        '& input': { textAlign: 'center', color: 'white' }
                    }}
                />
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', pr: 1, mb: 2 }}>
                <Stack spacing={2}>
                    {presentationSequence.map((step, index) => (
                        <PresentationMenuItem
                            key={index}
                            index={index}
                            step={step}
                            indicatorConfig={indicatorConfig}
                            onMenuOpen={handleMenuOpen}
                            onRemove={removeStep}
                            showDelete={presentationSequence.length > 1}
                            disabled={isPlaying}
                        />
                    ))}
                </Stack>
                
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
                    <IconButton 
                        onClick={addStep} 
                        disabled={isPlaying}
                        sx={{ 
                            color: isPlaying ? 'rgba(255,255,255,0.3)' : '#4CAF50', 
                            bgcolor: isPlaying ? 'transparent' : 'rgba(76, 175, 80, 0.1)',
                            '&:hover': { 
                                bgcolor: isPlaying ? 'transparent' : 'rgba(76, 175, 80, 0.2)',
                                transform: isPlaying ? 'none' : 'scale(1.1)' 
                            } 
                        }}
                    >
                        <AddCircleOutlineIcon fontSize="large" />
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

            <Box sx={{ pt: 2 }}>
                <Stack direction="row" justifyContent="center" spacing={3} alignItems="center">
                    
                        <IconButton onClick={handleRestart} sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: 'white' } }}>
                            <RestartAltIcon />
                        </IconButton>
                 
                    
                    <IconButton 
                        onClick={() => setIsPlaying(!isPlaying)} 
                        sx={{ 
                            color: isPlaying ? 'white' : 'black', 
                            bgcolor: isPlaying ? 'rgba(255,255,255,0.1)' : '#64B5F6', 
                            width: 56, 
                            height: 56,
                            '&:hover': { bgcolor: isPlaying ? 'rgba(255,255,255,0.2)' : '#42A5F5' } 
                        }}
                    >
                        {isPlaying ? <PauseIcon fontSize="large" /> : <PlayArrowIcon fontSize="large" />}
                    </IconButton>
                </Stack>
            </Box>
        </Box>
    );
};

export default PresentationModeSettings;
