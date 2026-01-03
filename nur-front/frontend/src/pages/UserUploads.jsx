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
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SaveIcon from "@mui/icons-material/Save";
import FolderIcon from "@mui/icons-material/Folder";
import ImageIcon from "@mui/icons-material/Image";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import api from "../api";
import config from "../config";

const UserUploads = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [userUploadsFiles, setUserUploadsFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [pendingNameChanges, setPendingNameChanges] = useState({});
  const [newCategoryDialog, setNewCategoryDialog] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    if (selectedCategory) {
      fetchUserUploads();
    }
  }, [selectedCategory]);

  const fetchCategories = async () => {
    try {
      const response = await api.get("/api/user_upload_categories/");
      const cats = response.data;
      setCategories(cats);
      const defaultCat = cats.find((c) => c.is_default) || cats[0];
      if (defaultCat) {
        setSelectedCategory(defaultCat);
      } else {
        // No categories exist yet, stop showing loading
        setLoading(false);
      }
    } catch (err) {
      console.error("Error fetching categories:", err);
      setError("Failed to load categories");
      setLoading(false);
    }
  };

  const fetchUserUploads = async () => {
    if (!selectedCategory) return;
    try {
      setLoading(true);
      setError(null);
      const response = await api.get(`/api/user_uploads/?category=${selectedCategory.id}`);
      const uploads = response.data.map((upload) => ({
        id: upload.id,
        fileName: upload.original_filename,
        displayName: upload.display_name || upload.original_filename,
        imageUrl: upload.image_url,
        uploadedAt: upload.uploaded_at,
        categoryId: upload.category,
      }));
      setUserUploadsFiles(uploads);
      setPendingNameChanges({});
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

    if (!selectedCategory) {
      setError("Please select a category first");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      for (const file of files) {
        const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/bmp", "image/webp"];
        if (!validTypes.includes(file.type)) {
          setError(`Invalid file type: ${file.name}. Only images are allowed.`);
          continue;
        }

        if (file.size > 10 * 1024 * 1024) {
          setError(`File too large: ${file.name}. Maximum size is 10MB.`);
          continue;
        }

        const formData = new FormData();
        formData.append("image", file);
        formData.append("display_name", file.name);
        formData.append("category_id", selectedCategory.id);

        const response = await api.post("/api/user_uploads/", formData, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });

        const newUpload = {
          id: response.data.id,
          fileName: response.data.original_filename,
          displayName: response.data.display_name || response.data.original_filename,
          imageUrl: response.data.image_url,
          uploadedAt: response.data.uploaded_at,
          categoryId: response.data.category,
        };
        setUserUploadsFiles((prev) => [...prev, newUpload]);
      }
      await fetchUserUploads();
    } catch (err) {
      console.error("Error uploading file:", err);
      setError(err.response?.data?.error || "Failed to upload file");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleNameChange = (id, newName) => {
    setPendingNameChanges((prev) => ({ ...prev, [id]: newName }));
  };

  const handleSave = async () => {
    if (Object.keys(pendingNameChanges).length === 0) return;

    setSaving(true);
    setError(null);

    try {
      const savePromises = Object.entries(pendingNameChanges).map(([id, name]) =>
        api.patch(`/api/user_uploads/${id}/`, { display_name: name })
      );

      await Promise.all(savePromises);
      setPendingNameChanges({});
      await fetchUserUploads();
    } catch (err) {
      console.error("Error saving changes:", err);
      setError(err.response?.data?.error || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const removeFile = async (id) => {
    try {
      await api.delete(`/api/user_uploads/${id}/`);
      setUserUploadsFiles(userUploadsFiles.filter((f) => f.id !== id));
      const newPending = { ...pendingNameChanges };
      delete newPending[id];
      setPendingNameChanges(newPending);
    } catch (err) {
      console.error("Error deleting file:", err);
      setError("Failed to delete file");
    }
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;

    try {
      const response = await api.post("/api/user_upload_categories/", {
        name: newCategoryName.trim().toLowerCase().replace(/\s+/g, "_"),
        display_name: newCategoryName.trim(),
      });
      setCategories([...categories, response.data]);
      setSelectedCategory(response.data);
      setNewCategoryDialog(false);
      setNewCategoryName("");
    } catch (err) {
      console.error("Error creating category:", err);
      setError(err.response?.data?.error || "Failed to create category");
    }
  };

  const handleDeleteCategory = async (categoryId) => {
    if (categories.length <= 1) {
      setError("Cannot delete the last category");
      return;
    }

    try {
      await api.delete(`/api/user_upload_categories/${categoryId}/`);
      const newCategories = categories.filter((c) => c.id !== categoryId);
      setCategories(newCategories);
      if (selectedCategory?.id === categoryId) {
        const defaultCat = newCategories.find((c) => c.is_default) || newCategories[0];
        setSelectedCategory(defaultCat);
      }
    } catch (err) {
      console.error("Error deleting category:", err);
      setError("Failed to delete category");
    }
  };

  const handleBack = () => {
    navigate(-1);
  };

  const getImageUrl = (imageUrl) => {
    if (!imageUrl) return null;
    return imageUrl.startsWith("http") ? imageUrl : `${config.api.baseUrl}${imageUrl}`;
  };

  const hasUnsavedChanges = Object.keys(pendingNameChanges).length > 0;

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
          px: { xs: 2, sm: 3 },
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
              fontSize: { xs: "1.25rem", sm: "1.5rem" },
              letterSpacing: 0.5,
            }}
          >
            User Uploads
          </Typography>
        </Box>
      </Box>

      {/* Category Section */}
      <Box
        sx={{
          px: { xs: 2, sm: 3 },
          py: 2,
          borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
          flexShrink: 0,
          bgcolor: "rgba(0, 0, 0, 0.2)",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <FolderIcon sx={{ color: "rgba(255,255,255,0.7)", fontSize: 20 }} />
          <Typography variant="subtitle2" sx={{ color: "rgba(255,255,255,0.7)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
            Categories
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
          {categories.map((cat) => (
            <Chip
              key={cat.id}
              label={cat.display_name}
              onClick={() => setSelectedCategory(cat)}
              onDelete={categories.length > 1 ? () => handleDeleteCategory(cat.id) : undefined}
              deleteIcon={<DeleteOutlineIcon fontSize="small" />}
              sx={{
                bgcolor: selectedCategory?.id === cat.id ? "#64B5F6" : "rgba(255,255,255,0.08)",
                color: selectedCategory?.id === cat.id ? "white" : "rgba(255,255,255,0.7)",
                border: selectedCategory?.id === cat.id ? "2px solid #64B5F6" : "1px solid rgba(255,255,255,0.1)",
                fontWeight: selectedCategory?.id === cat.id ? 600 : 400,
                fontSize: { xs: "0.875rem", sm: "0.9375rem" },
                height: { xs: 32, sm: 36 },
                px: 1,
                "&:hover": {
                  bgcolor: selectedCategory?.id === cat.id ? "#42A5F5" : "rgba(255,255,255,0.12)",
                },
                "& .MuiChip-deleteIcon": {
                  color: selectedCategory?.id === cat.id ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.4)",
                  "&:hover": { color: "#ff5252" },
                },
              }}
            />
          ))}
          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setNewCategoryDialog(true)}
            sx={{
              color: "#4CAF50",
              borderColor: "rgba(76, 175, 80, 0.5)",
              "&:hover": {
                borderColor: "#4CAF50",
                bgcolor: "rgba(76, 175, 80, 0.1)",
              },
              height: { xs: 32, sm: 36 },
              fontSize: { xs: "0.875rem", sm: "0.9375rem" },
              textTransform: "none",
              fontWeight: 500,
            }}
          >
            Add New Category
          </Button>
        </Box>
      </Box>

      {/* Action Bar */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          px: { xs: 2, sm: 3 },
          py: 1.5,
          borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.5)", fontSize: { xs: "0.75rem", sm: "0.875rem" } }}>
            {selectedCategory ? `Category: ${selectedCategory.display_name}` : "Select a category"}
          </Typography>
          {userUploadsFiles.length > 0 && (
            <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.3)", fontSize: { xs: "0.75rem", sm: "0.875rem" } }}>
              • {userUploadsFiles.length} {userUploadsFiles.length === 1 ? "file" : "files"}
            </Typography>
          )}
        </Box>

        <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
          <Button
            variant="contained"
            component="label"
            disabled={uploading || !selectedCategory}
            startIcon={uploading ? <CircularProgress size={16} sx={{ color: "white" }} /> : <ImageIcon />}
            sx={{
              bgcolor: "#4CAF50",
              color: "white",
              "&:hover": { bgcolor: "#45a049" },
              "&.Mui-disabled": { opacity: 0.5, bgcolor: "rgba(76, 175, 80, 0.3)" },
              textTransform: "none",
              fontWeight: 600,
              fontSize: { xs: "0.875rem", sm: "0.9375rem" },
              px: { xs: 2, sm: 2.5 },
            }}
          >
            {uploading ? "Uploading..." : "Add Images"}
            <input
              type="file"
              hidden
              multiple
              accept="image/*"
              onChange={handleFileUpload}
              disabled={uploading || !selectedCategory}
            />
          </Button>

          {hasUnsavedChanges && (
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={16} sx={{ color: "white" }} /> : <SaveIcon />}
              onClick={handleSave}
              disabled={saving}
              sx={{
                bgcolor: "#64B5F6",
                color: "white",
                "&:hover": { bgcolor: "#42A5F5" },
                textTransform: "none",
                fontWeight: 600,
                fontSize: { xs: "0.875rem", sm: "0.9375rem" },
                px: { xs: 2, sm: 2.5 },
              }}
            >
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          )}
        </Box>
      </Box>

      {/* Content */}
      <Box
        sx={{
          flex: 1,
          overflowY: "auto",
          px: { xs: 2, sm: 3 },
          py: 2,
        }}
      >
        {error && (
          <Alert
            severity="error"
            sx={{ mb: 2, bgcolor: "rgba(211, 47, 47, 0.1)", color: "#ff5252", border: "1px solid rgba(255, 82, 82, 0.3)" }}
            onClose={() => setError(null)}
          >
            {error}
          </Alert>
        )}

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "50vh" }}>
            <CircularProgress />
          </Box>
        ) : categories.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "50vh",
              color: "rgba(255,255,255,0.3)",
            }}
          >
            <CloudUploadIcon sx={{ fontSize: 64, mb: 2, opacity: 0.5 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>
              No User Uploads Yet
            </Typography>
            <Typography variant="body2" sx={{ textAlign: "center", maxWidth: 300, mb: 2 }}>
              Create a category above to start organizing your uploads for use in presentations.
            </Typography>
          </Box>
        ) : !selectedCategory ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "50vh",
              color: "rgba(255,255,255,0.3)",
            }}
          >
            <FolderIcon sx={{ fontSize: 64, mb: 2, opacity: 0.5 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>
              No category selected
            </Typography>
            <Typography variant="body2">Select a category above or create a new one</Typography>
          </Box>
        ) : userUploadsFiles.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "50vh",
              color: "rgba(255,255,255,0.3)",
            }}
          >
            <ImageIcon sx={{ fontSize: 64, mb: 2, opacity: 0.5 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>
              No images in this category
            </Typography>
            <Typography variant="body2">Click "Add Images" to upload files</Typography>
          </Box>
        ) : (
          <Stack spacing={1.5}>
            {userUploadsFiles.map((file) => (
              <Paper
                key={file.id}
                sx={{
                  p: { xs: 1.5, sm: 2 },
                  bgcolor: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 2,
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  transition: "all 0.15s",
                  "&:hover": {
                    bgcolor: "rgba(255,255,255,0.05)",
                    borderColor: "rgba(100, 181, 246, 0.4)",
                  },
                }}
              >
                {file.imageUrl && (
                  <Box
                    sx={{
                      width: { xs: 80, sm: 100 },
                      height: { xs: 80, sm: 100 },
                      borderRadius: 1,
                      overflow: "hidden",
                      flexShrink: 0,
                      border: "1px solid rgba(255,255,255,0.1)",
                      bgcolor: "rgba(255,255,255,0.05)",
                    }}
                  >
                    <img
                      src={getImageUrl(file.imageUrl)}
                      alt={file.displayName}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  </Box>
                )}

                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "rgba(255,255,255,0.4)",
                      display: "block",
                      mb: 0.5,
                      fontSize: { xs: "0.7rem", sm: "0.75rem" },
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    Display Name
                  </Typography>
                  <TextField
                    variant="standard"
                    fullWidth
                    value={pendingNameChanges[file.id] !== undefined ? pendingNameChanges[file.id] : file.displayName}
                    onChange={(e) => handleNameChange(file.id, e.target.value)}
                    InputProps={{
                      disableUnderline: true,
                      sx: {
                        color: "white",
                        fontSize: { xs: "0.9375rem", sm: "1rem" },
                        fontWeight: 500,
                        p: 0,
                      },
                    }}
                    sx={{
                      "& .MuiInputBase-root": {
                        bgcolor: "rgba(255,255,255,0.05)",
                        borderRadius: "4px",
                        px: 1.5,
                        py: 0.75,
                        border: "1px solid rgba(255,255,255,0.1)",
                        "&:hover": { borderColor: "rgba(255,255,255,0.2)" },
                        "&:focus-within": { borderColor: "#64B5F6", borderWidth: "2px" },
                      },
                    }}
                  />
                  <Typography
                    variant="caption"
                    sx={{
                      color: "rgba(255,255,255,0.3)",
                      display: "block",
                      mt: 0.5,
                      fontSize: { xs: "0.7rem", sm: "0.75rem" },
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Original: {file.fileName}
                  </Typography>
                </Box>

                <IconButton
                  size="small"
                  onClick={() => removeFile(file.id)}
                  sx={{
                    color: "rgba(255,255,255,0.3)",
                    "&:hover": {
                      color: "#ff5252",
                      bgcolor: "rgba(255, 82, 82, 0.1)",
                    },
                  }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Paper>
            ))}
          </Stack>
        )}
      </Box>

      {/* New Category Dialog */}
      <Dialog
        open={newCategoryDialog}
        onClose={() => {
          setNewCategoryDialog(false);
          setNewCategoryName("");
        }}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: "#1a1a1f",
            color: "white",
          },
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>Create New Category</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Category Name"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newCategoryName.trim()) {
                handleCreateCategory();
              }
            }}
            sx={{
              mt: 1,
              "& .MuiInputLabel-root": { color: "rgba(255,255,255,0.7)" },
              "& .MuiOutlinedInput-root": {
                color: "white",
                "& fieldset": { borderColor: "rgba(255,255,255,0.2)" },
                "&:hover fieldset": { borderColor: "rgba(255,255,255,0.3)" },
                "&.Mui-focused fieldset": { borderColor: "#64B5F6" },
              },
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => {
              setNewCategoryDialog(false);
              setNewCategoryName("");
            }}
            sx={{ color: "rgba(255,255,255,0.7)" }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreateCategory}
            disabled={!newCategoryName.trim()}
            variant="contained"
            sx={{ bgcolor: "#64B5F6", "&:hover": { bgcolor: "#42A5F5" } }}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default UserUploads;
