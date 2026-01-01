import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  IconButton,
  TextField,
  Stack,
  Paper,
  Tooltip,
  CircularProgress,
  Alert,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import api from "../api";
import config from "../config";

const UserUploads = () => {
  const navigate = useNavigate();
  const [userUploadsFiles, setUserUploadsFiles] = useState([]);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch user uploads from API
  useEffect(() => {
    fetchUserUploads();
  }, []);

  const fetchUserUploads = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get("/api/user_uploads/");
      const uploads = response.data.map((upload) => ({
        id: upload.id,
        fileName: upload.original_filename,
        displayName: upload.display_name || upload.original_filename,
        imageUrl: upload.image_url,
        uploadedAt: upload.uploaded_at,
      }));
      setUserUploadsFiles(uploads);
    } catch (err) {
      console.error("Error fetching user uploads:", err);
      setError("Failed to load user uploads");
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setUploading(true);
    setError(null);

    try {
      for (const file of files) {
        // Validate file type
        const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/bmp", "image/webp"];
        if (!validTypes.includes(file.type)) {
          setError(`Invalid file type: ${file.name}. Only images are allowed.`);
          continue;
        }

        // Validate file size (10MB max)
        if (file.size > 10 * 1024 * 1024) {
          setError(`File too large: ${file.name}. Maximum size is 10MB.`);
          continue;
        }

        const formData = new FormData();
        formData.append("image", file);
        formData.append("display_name", file.name);

        const response = await api.post("/api/user_uploads/", formData, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });

        // Add to local state
        const newUpload = {
          id: response.data.id,
          fileName: response.data.original_filename,
          displayName: response.data.display_name || response.data.original_filename,
          imageUrl: response.data.image_url,
          uploadedAt: response.data.uploaded_at,
        };
        setUserUploadsFiles((prev) => [...prev, newUpload]);
      }
    } catch (err) {
      console.error("Error uploading file:", err);
      setError(err.response?.data?.error || "Failed to upload file");
    } finally {
      setUploading(false);
      // Reset file input
      e.target.value = "";
    }
  };

  const removeFile = async (id) => {
    try {
      await api.delete(`/api/user_uploads/${id}/`);
      setUserUploadsFiles(userUploadsFiles.filter((f) => f.id !== id));
    } catch (err) {
      console.error("Error deleting file:", err);
      setError("Failed to delete file");
    }
  };

  const updateFileName = async (id, newName) => {
    try {
      await api.patch(`/api/user_uploads/${id}/`, { display_name: newName });
      setUserUploadsFiles(
        userUploadsFiles.map((f) => (f.id === id ? { ...f, displayName: newName } : f))
      );
    } catch (err) {
      console.error("Error updating file name:", err);
      setError("Failed to update file name");
    }
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

  const handleBack = () => {
    navigate(-1);
  };

  return (
    <Box
      sx={{
        height: "100vh",
        bgcolor: "#0a0a0f",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 3,
          py: 2,
          borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton
            onClick={handleBack}
            sx={{
              color: "rgba(255,255,255,0.7)",
              "&:hover": { color: "white", bgcolor: "rgba(255,255,255,0.1)" },
            }}
          >
            <ArrowBackIcon />
          </IconButton>
          <Typography
            variant="h5"
            sx={{
              color: "white",
              fontWeight: 600,
              fontSize: "1.5rem",
              letterSpacing: 0.5,
            }}
          >
            User Uploads
          </Typography>
        </Box>
      </Box>

      {/* Content */}
      <Box
        sx={{
          flex: 1,
          overflowY: "auto",
          px: 3,
          py: 3,
        }}
      >
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "50vh" }}>
            <CircularProgress />
          </Box>
        ) : (
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

                {/* Thumbnail */}
                {file.imageUrl && (
                  <Box
                    sx={{
                      width: 80,
                      height: 80,
                      borderRadius: 1,
                      overflow: "hidden",
                      flexShrink: 0,
                      border: "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    <img
                      src={file.imageUrl && (file.imageUrl.startsWith("http") ? file.imageUrl : `${config.api.baseUrl}${file.imageUrl}`)}
                      alt={file.displayName}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  </Box>
                )}

                <Box sx={{ flexGrow: 1 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "#64B5F6",
                      fontWeight: "bold",
                      letterSpacing: 1,
                      display: "block",
                      mb: 0.5,
                      textTransform: "uppercase",
                    }}
                  >
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
                  <Typography
                    variant="caption"
                    sx={{
                      color: "rgba(255,255,255,0.3)",
                      display: "block",
                      mt: 0.5,
                      fontStyle: "italic",
                    }}
                  >
                    File: {file.fileName}
                  </Typography>
                </Box>

                <Tooltip title="Remove File">
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
                disabled={uploading}
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
                  "&.Mui-disabled": {
                    opacity: 0.5,
                  },
                }}
              >
                {uploading ? (
                  <CircularProgress size={20} sx={{ color: "#4CAF50" }} />
                ) : (
                  <AddIcon />
                )}
                <input
                  type="file"
                  hidden
                  multiple
                  accept="image/*"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
              </IconButton>
            </Box>
          </Stack>
        )}
      </Box>
    </Box>
  );
};

export default UserUploads;

