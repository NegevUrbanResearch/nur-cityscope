
  import React,{useState} from "react";
  import {
    IconButton,
    Box,
    TextField, Stack, Paper, Typography,
  Tooltip
  } from "@mui/material";
  
  import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
  import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
  import AddIcon from "@mui/icons-material/Add";
  
  
  const FilesManagement = () => {  
    const [userUploadsFiles, setUserUploadsFiles] = useState([]);
    const [draggedIndex, setDraggedIndex] = useState(null);
  
    const handleFileUpload = (e) => {
      const uploaded = Array.from(e.target.files);
      const newEntries = uploaded.map((file, index) => ({
        id: Math.random().toString(36).substr(2, 9),
        fileName: file.name,
        displayName: `File ${userUploadsFiles.length + index + 1}`,
      }));
      setUserUploadsFiles([...userUploadsFiles, ...newEntries]);
    };
  
    const removeFile = (id) => {
      setUserUploadsFiles(userUploadsFiles.filter((f) => f.id !== id));
    };
  
    const updateFileName = (id, newName) => {
      setUserUploadsFiles(userUploadsFiles.map(f => f.id === id ? { ...f, displayName: newName } : f));
    };

    const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const newSequence = [...userUploadsFiles];
    const draggedItem = newSequence[draggedIndex];
    newSequence.splice(draggedIndex, 1);
    newSequence.splice(targetIndex, 0, draggedItem);

    setUserUploadsFiles(newSequence);
    setDraggedIndex(null);
  };

    return (
    <Box
          sx={{
        px: 2,
        pb: 2,
        pt: 3,
        overflowX: "hidden",
        overflowY: "auto",
        flexGrow: 1,
        display: "flex",
        flexDirection: "column",
      }}
        >
          <Typography variant="h6" 
          sx={{
          color: "white",
          mb: 3,
          fontWeight: 600,
          fontSize: "1.1rem",
          letterSpacing: 0.5,
        }}          >
            Files Management
          </Typography>
  
          <Stack spacing={2}>
            {userUploadsFiles.map((file, index) => (
              <Paper
                key={file.id}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, index)}
                sx={{
              p: 2,
              backgroundColor: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              gap: 2,
              transition: "all 0.15s ease-out",
              cursor: "grab",
              "&:hover": {
                backgroundColor: "rgba(255,255,255,0.05)",
                borderColor: "rgba(100, 181, 246, 0.4)",
              },
              "&:active": { cursor: "grabbing" },
              opacity: draggedIndex === index ? 0.4 : 1,
            }}
              >
                <DragIndicatorIcon sx={{ color: "rgba(255,255,255,0.4)", cursor: "grab" }} />
                
                <Box sx={{ flexGrow: 1 }}>
                  <Typography variant="caption" 
                  sx={{
                  color: "#64B5F6",
                  fontWeight: "bold",
                  letterSpacing: 1,
                  display: "block",
                  mb: 0.5,
                  textTransform: "uppercase",
                }}>
                    FILE {index + 1}
                  </Typography>
                  <TextField
                    variant="standard"
                    fullWidth
                    value={file.displayName}
                    onChange={(e) => updateFileName(file.id, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
                InputProps={{
                  disableUnderline: true,
                  sx: {
                    color: "white",
                    fontSize: "0.95rem",
                    fontWeight: 500,
                    p: 0,
                  },
                }}
                sx={{
                  "& .MuiInputBase-root": {
                    backgroundColor: "rgba(255,255,255,0.05)",
                    borderRadius: "4px",
                    px: 1,
                    py: 0.5,
                    border: "1px solid rgba(255,255,255,0.1)",
                    "&:hover": { borderColor: "rgba(255,255,255,0.2)" },
                  },
                }}
                  />
                  <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.3)", display: "block", mt: 0.5,
                  fontStyle: "italic", }}>
                    File: {file.fileName}
                  </Typography>
                </Box>
  
               <Tooltip title="Remove State">
              <IconButton
                size="small"
                onClick={() => removeFile(file.id)}
                sx={{
                  color: "rgba(255,255,255,0.3)",
                  "&:hover": {
                    color: "#ff5252",
                    backgroundColor: "rgba(255, 82, 82, 0.1)",
                  },
                }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
              </Paper>
            ))}
  
            <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
              <IconButton
                component="label"
                sx={{
              color: "#4CAF50",
              bgcolor: "rgba(76, 175, 80, 0.1)",
              width: 42,
              height: 42,
              border: "1px solid rgba(76, 175, 80, 0.3)",
              transition: "all 0.2s",
              "&:hover": {
                bgcolor: "rgba(76, 175, 80, 0.2)",
                transform: "scale(1.1)",
              },
            }}
              >
                <input type="file" hidden multiple onChange={handleFileUpload} />
                <AddIcon />
              </IconButton>
            </Box>
          </Stack>
        </Box>
    );
  };
  
  export default FilesManagement;
  