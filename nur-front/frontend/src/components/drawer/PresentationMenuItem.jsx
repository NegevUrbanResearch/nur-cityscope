import React from "react";
import {
  IconButton,
  Typography,
  Box,
  Stack,
  Paper,
  Button,
} from "@mui/material";

import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";


const PresentationMenuItem = ({ 
    step, 
    index, 
    indicatorConfig, 
    onMenuOpen, 
    onRemove, 
    showDelete,
    disabled,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDrop,
    isDragging,
    isDropTarget,
    isActive
}) => {
    const dropdownButtonStyle = {
        minWidth: "120px",
        height: "36px",
        justifyContent: "space-between",
        border: "1px solid rgba(255,255,255,0.2)",
        borderRadius: "4px",
        px: 2,
        backgroundColor: "rgba(255,255,255,0.05)",
        opacity: disabled ? 0.5 : 1,
        "&:hover": {
            backgroundColor: disabled ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.4)",
        }
    };

    // Determine background and border based on state
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
                // Show drop indicator line above the item when it's a drop target
                '&::before': isDropTarget ? {
                    content: '""',
                    position: 'absolute',
                    top: -8,
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
                draggable={!disabled}
                onDragStart={(e) => onDragStart?.(e, index)}
                onDragOver={(e) => onDragOver?.(e, index)}
                onDragEnd={onDragEnd}
                onDrop={(e) => onDrop?.(e, index)}
                sx={{ 
                    p: 2, 
                    bgcolor: getBgColor(),
                    border: getBorder(),
                    borderRadius: 2,
                    position: 'relative',
                    transition: 'all 0.15s ease-out',
                    transform: isDragging ? 'scale(1.02) rotate(1deg)' : 'scale(1)',
                    opacity: isDragging ? 0.9 : 1,
                    cursor: disabled ? 'default' : 'grab',
                    boxShadow: isDragging 
                        ? '0 8px 24px rgba(100, 181, 246, 0.4)' 
                        : isDropTarget 
                            ? '0 4px 12px rgba(76, 175, 80, 0.3)'
                            : 'none',
                    '&:hover': {
                        bgcolor: isActive ? 'rgba(100, 181, 246, 0.2)' : 'rgba(255,255,255,0.05)',
                        border: isActive ? '2px solid #64B5F6' : '1px solid rgba(255,255,255,0.15)',
                    },
                    '&:active': {
                        cursor: disabled ? 'default' : 'grabbing',
                    }
                }}
            >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <DragIndicatorIcon 
                            fontSize="small" 
                            sx={{ 
                                color: isDragging ? '#64B5F6' : disabled ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.4)',
                                cursor: disabled ? 'default' : 'grab',
                                transition: 'color 0.15s ease'
                            }} 
                        />
                        <Typography 
                            variant="caption" 
                            sx={{ 
                                color: isDragging ? '#64B5F6' : isActive ? '#64B5F6' : 'rgba(255,255,255,0.7)', 
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
                            disabled={disabled}
                            sx={{ 
                                color: disabled ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.3)', 
                                p: 0.5,
                                '&:hover': { color: disabled ? '' : '#ff5252', bgcolor: disabled ? '' : 'rgba(255, 82, 82, 0.1)' } 
                            }}
                        >
                            <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                    )}
                </Box>

                <Stack direction="row" spacing={1.5} alignItems="center">
                    <Button
                        sx={dropdownButtonStyle}
                        onClick={(e) => { e.stopPropagation(); onMenuOpen(e, index, 'indicator'); }}
                        disabled={disabled}
                        color="inherit"
                        endIcon={<ArrowDropDownIcon fontSize="small" sx={{ color: disabled ? 'rgba(255,255,255,0.3)' : '#64B5F6' }} />}
                    >
                        <Typography variant="body2" sx={{ textTransform: 'none', fontWeight: 500 }}>
                            {indicatorConfig[step.indicator]?.name.replace(' Dashboard', '') || step.indicator}
                        </Typography>
                    </Button>

                    <Button
                        sx={dropdownButtonStyle}
                        onClick={(e) => { e.stopPropagation(); onMenuOpen(e, index, 'state'); }}
                        disabled={disabled}
                        color="inherit"
                        endIcon={<ArrowDropDownIcon fontSize="small" sx={{ color: disabled ? 'rgba(255,255,255,0.3)' : '#64B5F6' }} />}
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

export default PresentationMenuItem;
