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


const PresentationMenuItem = ({ 
    step, 
    index, 
    indicatorConfig, 
    onMenuOpen, 
    onRemove, 
    showDelete,
    disabled 
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

    return (
        <Paper 
            elevation={0}
            sx={{ 
                p: 2, 
                bgcolor: 'rgba(255,255,255,0.02)', 
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 2,
                position: 'relative',
                transition: 'all 0.2s',
                '&:hover': {
                    bgcolor: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.15)',
                }
            }}
        >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <Typography variant="caption" sx={{ color: '#64B5F6', fontWeight: 'bold', letterSpacing: 1 }}>
                    STATE {index + 1}
                </Typography>
                {showDelete && (
                    <IconButton 
                        size="small" 
                        onClick={() => onRemove(index)}
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
                    onClick={(e) => onMenuOpen(e, index, 'indicator')}
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
                    onClick={(e) => onMenuOpen(e, index, 'state')}
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
    );
};

export default PresentationMenuItem;
