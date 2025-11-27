import React , { useState } from "react";
import PresentationMenuItem from "./PresentationMenuItem.jsx"

import {
  IconButton,
  Typography,
  Tooltip,
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
    const { indicatorConfig, StateConfig } = useAppData();
    
    const defaultIndicator = Object.keys(indicatorConfig)[0];
    const defaultState = StateConfig[defaultIndicator]?.[0];
    
    const [presentationSequence, setPresentationSequence] = useState([
        { indicator: defaultIndicator, state: defaultState }
    ]);

    const [globalDuration, setGlobalDuration] = useState(10); 
    const [isPlaying, setIsPlaying] = useState(false); 

    const [activeMenu, setActiveMenu] = useState(null);

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
                    onChange={(e) => setGlobalDuration(parseInt(e.target.value) || 5)}
                    disabled={isPlaying}
                    fullWidth
                    InputProps={{
                        endAdornment: <InputAdornment position="end" sx={{ color: 'rgba(255,255,255,0.5)' }}>sec</InputAdornment>,
                    }}
                    sx={{ 
                       opacity: isPlaying ? 0.6 : 1,
                        '& .MuiOutlinedInput-root': { 
                            color: 'white',
                            backgroundColor: 'rgba(255,255,255,0.05)'
                        },
                        '& .MuiInputLabel-root': { color: 'rgba(255,255,255,0.7)' },
                        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.2)' },
                        '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.4)' },
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
                            border: isPlaying ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(76, 175, 80, 0.3)',
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
                PaperProps={{
                    sx: {
                        mt: 0.5,
                        minWidth: "150px",
                        maxHeight: "300px",
                        backgroundColor: "rgba(25, 25, 25, 0.98)",
                        backdropFilter: "blur(16px)",
                        border: "1px solid rgba(255, 255, 255, 0.12)",
                        borderRadius: "8px",
                        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
                        "& .MuiMenuItem-root": {
                            fontSize: "0.9rem",
                            color: "rgba(255,255,255,0.85)",
                            "&:hover": { backgroundColor: "rgba(100, 181, 246, 0.12)" },
                            "&.Mui-selected": { 
                                backgroundColor: "rgba(100, 181, 246, 0.18)",
                                borderLeft: "3px solid #64B5F6",
                                color: "#64B5F6"
                            }
                        }
                    },
                }}
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
                <Stack direction="row" justifyContent="center" spacing={3} alignItems="center">
                    <Tooltip title="Restart Sequence">
                        <IconButton onClick={() => console.log('Restart')} sx={{ color: 'rgba(255,255,255,0.7)', '&:hover': { color: 'white' } }}>
                            <RestartAltIcon />
                        </IconButton>
                    </Tooltip>
                    
                    <IconButton 
                        onClick={() =>{
                            console.log(presentationSequence);
                            setIsPlaying(!isPlaying)}} 
                        sx={{ 
                            color: isPlaying ? 'white' : 'black', 
                            bgcolor: isPlaying ? 'rgba(255,255,255,0.1)' : '#64B5F6', 
                            width: 56, 
                            height: 56,
                            border: isPlaying ? '1px solid rgba(255,255,255,0.3)' : 'none',
                            '&:hover': { 
                                bgcolor: isPlaying ? 'rgba(255,255,255,0.2)' : '#42A5F5' 
                            } 
                        }}
                    >
                        {isPlaying ? <PauseIcon fontSize="large" /> : <PlayArrowIcon fontSize="large" />}
                    </IconButton>
                </Stack>
                <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 1.5, color: 'rgba(255,255,255,0.5)' }}>
                      {isPlaying ? 'Sequence Running... (Controls Locked)' : 'Ready to Edit / Start'}
                </Typography>
            </Box>
        </Box>
    );
};

export default PresentationModeSettings;
