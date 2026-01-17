import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography } from '@mui/material';
import { useAppData } from '../DataContext';

const TableSwitcherPopup = () => {
  const { currentTable, availableTables, changeTable } = useAppData();
  const [isOpen, setIsOpen] = useState(false);

  const switchToNextTable = useCallback(() => {
    if (availableTables.length === 0) return;
    
    const currentIndex = availableTables.findIndex(t => t.name === currentTable);
    const nextIndex = (currentIndex + 1) % availableTables.length;
    const nextTable = availableTables[nextIndex];
    
    if (nextTable && nextTable.name !== currentTable) {
      changeTable(nextTable.name);
    }
  }, [availableTables, currentTable, changeTable]);

  const handleKeyDown = useCallback((event) => {
    if (event.key.toLowerCase() === 'z' && event.shiftKey) {
      event.preventDefault();
      setIsOpen(prev => !prev);
    } else if (event.key.toLowerCase() === 't' && !event.shiftKey) {
      event.preventDefault();
      switchToNextTable();
    } else if (isOpen && event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
    }
  }, [isOpen, switchToNextTable]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  if (!isOpen) return null;

  const currentTableDisplayName = availableTables.find(t => t.name === currentTable)?.display_name || currentTable;

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 10,
        right: 10,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        color: 'white',
        padding: 2,
        borderRadius: 1,
        fontFamily: 'Arial, sans-serif',
        zIndex: 10000,
        minWidth: 280,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
      }}
    >
      <Typography variant="h6" sx={{ marginBottom: 1.5, color: '#64B5F6', fontSize: '1.1rem' }}>
        Table Switcher
      </Typography>
      
      <Box sx={{ marginBottom: 1.5 }}>
        <Typography variant="body2" sx={{ marginBottom: 0.5, color: 'rgba(255,255,255,0.7)' }}>
          Current Table:
        </Typography>
        <Typography variant="body1" sx={{ fontWeight: 600, color: '#64B5F6' }}>
          {currentTableDisplayName}
        </Typography>
      </Box>

      <Box sx={{ marginBottom: 1.5 }}>
        <Typography variant="body2" sx={{ marginBottom: 0.5, color: 'rgba(255,255,255,0.7)' }}>
          Available Tables:
        </Typography>
        {availableTables.map((table) => {
          const isCurrent = table.name === currentTable;
          return (
            <Typography
              key={table.name}
              variant="body2"
              sx={{
                padding: 0.5,
                backgroundColor: isCurrent ? 'rgba(100, 181, 246, 0.2)' : 'transparent',
                borderRadius: 0.5,
                color: isCurrent ? '#64B5F6' : 'rgba(255,255,255,0.85)',
                fontWeight: isCurrent ? 600 : 400,
              }}
            >
              {table.display_name || table.name}
            </Typography>
          );
        })}
      </Box>

      <Box sx={{ marginTop: 2, paddingTop: 1.5, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <Typography variant="body2" sx={{ marginBottom: 1, color: 'rgba(255,255,255,0.7)' }}>
          <strong>Keyboard Shortcuts:</strong>
        </Typography>
        <Typography variant="body2" sx={{ fontSize: '0.85rem', lineHeight: 1.6 }}>
          <strong>Shift+Z</strong> - Toggle this panel<br />
          <strong>T</strong> - Switch to next table<br />
          <strong>Esc</strong> - Close panel
        </Typography>
      </Box>
    </Box>
  );
};

export default TableSwitcherPopup;
