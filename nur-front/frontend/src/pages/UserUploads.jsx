import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  IconButton,
  TextField,
  Stack,
  CircularProgress,
  Alert,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  useTheme,
  useMediaQuery,
  Collapse,
  List,
  ListItemButton,
  ListItemText,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RefreshIcon from "@mui/icons-material/Refresh";
import api from "../api";
import config from "../config";

const UserUploads = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  // File hierarchy state
  const [hierarchy, setHierarchy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [selectedItem, setSelectedItem] = useState(null);

  // Dialog states
  const [addIndicatorDialog, setAddIndicatorDialog] = useState(false);
  const [uploadDialog, setUploadDialog] = useState(false);
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState(null);

  // Form states
  const [newIndicator, setNewIndicator] = useState({
    table_id: "",
    name: "",
  });
  const [uploadState, setUploadState] = useState({
    indicatorId: null,
    stateName: "",
    file: null,
  });
  const [uploading, setUploading] = useState(false);

  // Fetch hierarchy on mount
  useEffect(() => {
    fetchHierarchy();
  }, []);

  const fetchHierarchy = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get("/api/actions/get_file_hierarchy/");
      setHierarchy(response.data);
    } catch (err) {
      console.error("Error fetching hierarchy:", err);
      setError("Failed to load file hierarchy. Make sure the backend server is running.");
    } finally {
      setLoading(false);
    }
  };

  const toggleNode = (nodeId) => {
    setExpandedNodes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  const handleSelectItem = (type, item, parent = null, grandParent = null) => {
    setSelectedItem({ type, item, parent, grandParent });
  };

  // Create indicator
  const handleCreateIndicator = async () => {
    if (!newIndicator.table_id || !newIndicator.name) {
      setError("Table and name are required");
      return;
    }

    try {
      await api.post("/api/indicators/", {
        table_id: newIndicator.table_id,
        name: newIndicator.name,
        category: "mobility", // Default category for UGC
        has_states: true,
      });
      setAddIndicatorDialog(false);
      setNewIndicator({ table_id: "", name: "" });
      fetchHierarchy();
    } catch (err) {
      console.error("Error creating indicator:", err);
      setError(err.response?.data?.error || "Failed to create indicator");
    }
  };

  // Delete handler
  const handleDelete = async () => {
    if (!deleteConfirmDialog) return;

    const { type, id } = deleteConfirmDialog;

    try {
      if (type === "indicator") {
        await api.delete(`/api/indicators/${id}/`);
      } else if (type === "state") {
        await api.delete(`/api/states/${id}/`);
      } else if (type === "media") {
        await api.delete(`/api/indicator_images/${id}/`);
      }
      setDeleteConfirmDialog(null);
      setSelectedItem(null);
      fetchHierarchy();
    } catch (err) {
      console.error("Error deleting:", err);
      setError(err.response?.data?.error || "Failed to delete item");
      setDeleteConfirmDialog(null);
    }
  };

  // Upload media (creates state + media in one flow)
  const handleUploadMedia = async () => {
    if (!uploadState.indicatorId || !uploadState.file || !uploadState.stateName) {
      setError("Please fill in all fields and select a file");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      // Step 1: Create a new state
      const stateResponse = await api.post("/api/states/", {
        scenario_name: uploadState.stateName,
        scenario_type: "general",
        state_values: {},
      });

      // Step 2: Create indicator data link
      const indicatorDataResponse = await api.post("/api/indicator_data/", {
        indicator: uploadState.indicatorId,
        state: stateResponse.data.id,
      });

      // Step 3: Upload the media file
      const formData = new FormData();
      formData.append("image", uploadState.file);
      formData.append("indicatorData", indicatorDataResponse.data.id);

      // Determine media type from extension
      const ext = uploadState.file.name.split(".").pop().toLowerCase();
      let mediaType = "image";
      if (["mp4", "webm", "ogg", "avi", "mov"].includes(ext)) {
        mediaType = "video";
      } else if (["html", "htm"].includes(ext)) {
        mediaType = "html_map";
      } else if (ext === "json") {
        mediaType = "deckgl_layer";
      }
      formData.append("media_type", mediaType);

      await api.post("/api/indicator_images/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setUploadDialog(false);
      setUploadState({ indicatorId: null, stateName: "", file: null });
      fetchHierarchy();
    } catch (err) {
      console.error("Error uploading:", err);
      setError(err.response?.data?.error || "Failed to upload media");
    } finally {
      setUploading(false);
    }
  };

  const getMediaUrl = (url) => {
    if (!url) return null;
    if (url.startsWith("http")) return url;
    // Match Dashboard.jsx URL construction logic
    return url.startsWith("/")
      ? `${config.media.baseUrl}${url}`
      : `${config.media.baseUrl}/media/${url}`;
  };

  // Render tree node for table
  const renderTableNode = (table) => {
    const nodeId = `table-${table.id}`;
    const isExpanded = expandedNodes.has(nodeId);
    const isSelected = selectedItem?.type === "table" && selectedItem?.item?.id === table.id;

    return (
      <Box key={table.id}>
        <ListItemButton
          onClick={() => {
            toggleNode(nodeId);
            handleSelectItem("table", table);
          }}
          selected={isSelected}
          sx={{ py: 0.75 }}
        >
          <ListItemText
            primary={table.display_name || table.name}
            primaryTypographyProps={{ fontWeight: 600, fontSize: "0.9rem" }}
          />
          <Typography variant="caption" sx={{ color: "text.secondary", mr: 1 }}>
            {table.indicators?.length || 0}
          </Typography>
          {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </ListItemButton>
        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
          <List component="div" disablePadding>
            {table.indicators?.map((indicator) => renderIndicatorNode(indicator, table))}
          </List>
        </Collapse>
      </Box>
    );
  };

  // Render tree node for indicator
  const renderIndicatorNode = (indicator, table) => {
    const nodeId = `indicator-${indicator.id}`;
    const isExpanded = expandedNodes.has(nodeId);
    const isSelected = selectedItem?.type === "indicator" && selectedItem?.item?.id === indicator.id;

    return (
      <Box key={indicator.id}>
        <ListItemButton
          onClick={() => {
            toggleNode(nodeId);
            handleSelectItem("indicator", indicator, table);
          }}
          selected={isSelected}
          sx={{ pl: 3, py: 0.5 }}
        >
          <ListItemText
            primary={indicator.name}
            primaryTypographyProps={{ fontSize: "0.85rem" }}
          />
          <Typography variant="caption" sx={{ color: "text.secondary", mr: 1 }}>
            {indicator.states?.length || 0}
          </Typography>
          {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </ListItemButton>
        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
          <List component="div" disablePadding>
            {indicator.states?.map((state) => renderStateNode(state, indicator, table))}
          </List>
        </Collapse>
      </Box>
    );
  };

  // Render tree node for state
  const renderStateNode = (state, indicator, table) => {
    const nodeId = `state-${state.id}`;
    const isExpanded = expandedNodes.has(nodeId);
    const isSelected = selectedItem?.type === "state" && selectedItem?.item?.id === state.id;
    const stateName = state.scenario_name || JSON.stringify(state.state_values);

    return (
      <Box key={state.id}>
        <ListItemButton
          onClick={() => {
            toggleNode(nodeId);
            handleSelectItem("state", state, indicator, table);
          }}
          selected={isSelected}
          sx={{ pl: 5, py: 0.5 }}
        >
          <ListItemText
            primary={stateName}
            primaryTypographyProps={{ fontSize: "0.8rem" }}
          />
          <Typography variant="caption" sx={{ color: "text.secondary", mr: 1, fontSize: "0.7rem" }}>
            {state.media?.length || 0}
          </Typography>
          {isExpanded ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
        </ListItemButton>
        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
          <List component="div" disablePadding>
            {state.media?.map((media) => renderMediaNode(media, state, indicator))}
          </List>
        </Collapse>
      </Box>
    );
  };

  // Render tree node for media
  const renderMediaNode = (media, state, indicator) => {
    const isSelected = selectedItem?.type === "media" && selectedItem?.item?.id === media.id;
    const fileName = media.url?.split("/").pop() || "Unknown";

    return (
      <ListItemButton
        key={media.id}
        onClick={() => handleSelectItem("media", media, state, indicator)}
        selected={isSelected}
        sx={{ pl: 7, py: 0.25 }}
      >
        <ListItemText
          primary={fileName}
          primaryTypographyProps={{ fontSize: "0.75rem", color: "text.secondary" }}
        />
      </ListItemButton>
    );
  };

  // Render preview panel
  const renderPreviewPanel = () => {
    if (!selectedItem) {
      return (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "text.secondary", p: 3 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>Select an item</Typography>
          <Typography variant="body2">Click on an item in the tree to view details</Typography>
        </Box>
      );
    }

    const { type, item, parent } = selectedItem;

    return (
      <Box sx={{ p: 3, height: "100%", display: "flex", flexDirection: "column" }}>
        {type === "table" && (
          <>
            <Typography variant="h6" sx={{ mb: 2 }}>{item.display_name || item.name}</Typography>
            <Typography variant="body2" color="text.secondary">Database Table</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>Indicators: {item.indicators?.length || 0}</Typography>
          </>
        )}

        {type === "indicator" && (
          <>
            <Typography variant="h6" sx={{ mb: 2 }}>{item.name}</Typography>
            <Typography variant="body2" color="text.secondary">Indicator</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>Table: {parent?.display_name || parent?.name}</Typography>
            <Typography variant="body2">States: {item.states?.length || 0}</Typography>
            {item.is_user_generated && (
              <Box sx={{ mt: 3 }}>
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<CloudUploadIcon />}
                    onClick={() => {
                      setUploadState({ ...uploadState, indicatorId: item.id, stateName: "", file: null });
                      setUploadDialog(true);
                    }}
                  >
                    Upload Media
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    color="error"
                    startIcon={<DeleteOutlineIcon />}
                    onClick={() => setDeleteConfirmDialog({ type: "indicator", id: item.id, name: item.name })}
                  >
                    Delete
                  </Button>
                </Stack>
              </Box>
            )}
          </>
        )}

        {type === "state" && (
          <>
            <Typography variant="h6" sx={{ mb: 2 }}>{item.scenario_name || "State"}</Typography>
            <Typography variant="body2" color="text.secondary">State / Scenario</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>Indicator: {parent?.name}</Typography>
            <Typography variant="body2">Media Files: {item.media?.length || 0}</Typography>
            {item.is_user_generated && (
              <Box sx={{ mt: 3 }}>
                <Button
                  variant="outlined"
                  size="small"
                  color="error"
                  startIcon={<DeleteOutlineIcon />}
                  onClick={() => setDeleteConfirmDialog({ type: "state", id: item.id, name: item.scenario_name || "State" })}
                >
                  Delete State
                </Button>
              </Box>
            )}
          </>
        )}

        {type === "media" && (
          <>
            <Typography variant="h6" sx={{ mb: 2, wordBreak: "break-all" }}>
              {item.url?.split("/").pop() || "Media File"}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {item.media_type?.toUpperCase() || "FILE"}
            </Typography>

            {/* Media Preview */}
            <Box sx={{ flex: 1, minHeight: 200, mb: 2, bgcolor: "action.hover", borderRadius: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
              {item.media_type === "image" && item.url && (
                <Box
                  component="img"
                  src={getMediaUrl(item.url)}
                  alt="Preview"
                  onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "block"; }}
                  sx={{ maxWidth: "100%", maxHeight: 300, objectFit: "contain" }}
                />
              )}
              {item.media_type === "video" && item.url && (
                <Box
                  component="video"
                  src={getMediaUrl(item.url)}
                  controls
                  onError={(e) => { e.target.style.display = "none"; }}
                  sx={{ maxWidth: "100%", maxHeight: 300 }}
                />
              )}
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ display: item.media_type === "image" || item.media_type === "video" ? "none" : "block" }}
              >
                {item.url ? "Preview not available" : "File not found"}
              </Typography>
            </Box>

            <Stack direction="row" spacing={1}>
              {item.url && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => window.open(getMediaUrl(item.url), "_blank")}
                >
                  Open in New Tab
                </Button>
              )}
              <Button
                variant="outlined"
                size="small"
                color="error"
                startIcon={<DeleteOutlineIcon />}
                onClick={() => setDeleteConfirmDialog({ type: "media", id: item.id, name: item.url?.split("/").pop() || "Media" })}
              >
                Delete
              </Button>
            </Stack>
          </>
        )}
      </Box>
    );
  };

  // Get all indicators for upload dialog dropdown
  const getAllIndicators = () => {
    const indicators = [];
    hierarchy.forEach((table) => {
      table.indicators?.forEach((ind) => {
        if (ind.is_user_generated) {
          indicators.push({ ...ind, tableName: table.display_name || table.name });
        }
      });
    });
    return indicators;
  };

  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <IconButton onClick={() => navigate(-1)} size="small">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            User-Generated Content
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          <IconButton onClick={fetchHierarchy} size="small" title="Refresh">
            <RefreshIcon />
          </IconButton>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setAddIndicatorDialog(true)}
          >
            New Indicator
          </Button>
        </Box>
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mx: 2, mt: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Main Content - Split View */}
      <Box sx={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left Panel - Tree Browser */}
        <Box sx={{ width: isMobile ? "100%" : 300, minWidth: 250, borderRight: 1, borderColor: "divider", overflow: "auto" }}>
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "50vh" }}>
              <CircularProgress size={32} />
            </Box>
          ) : hierarchy.length === 0 ? (
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50vh", color: "text.secondary", p: 3 }}>
              <Typography variant="body1" sx={{ mb: 1 }}>No tables found</Typography>
              <Typography variant="body2">Tables will appear once the database is populated</Typography>
            </Box>
          ) : (
            <List component="nav" sx={{ p: 0.5 }}>
              {hierarchy.map((table) => renderTableNode(table))}
            </List>
          )}
        </Box>

        {/* Right Panel - Preview */}
        {!isMobile && (
          <Box sx={{ flex: 1, overflow: "auto" }}>
            {renderPreviewPanel()}
          </Box>
        )}
      </Box>

      {/* Add Indicator Dialog */}
      <Dialog open={addIndicatorDialog} onClose={() => setAddIndicatorDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Indicator</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Table</InputLabel>
              <Select
                value={newIndicator.table_id}
                label="Table"
                onChange={(e) => setNewIndicator({ ...newIndicator, table_id: e.target.value })}
              >
                {hierarchy.map((table) => (
                  <MenuItem key={table.id} value={table.id}>
                    {table.display_name || table.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="Indicator Name"
              value={newIndicator.name}
              onChange={(e) => setNewIndicator({ ...newIndicator, name: e.target.value })}
              placeholder="e.g., My Custom Visualization"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddIndicatorDialog(false)}>Cancel</Button>
          <Button onClick={handleCreateIndicator} variant="contained" disabled={!newIndicator.table_id || !newIndicator.name}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Upload Media Dialog */}
      <Dialog
        open={uploadDialog}
        onClose={() => {
          setUploadDialog(false);
          setUploadState({ indicatorId: null, stateName: "", file: null });
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Upload Media</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Indicator</InputLabel>
              <Select
                value={uploadState.indicatorId || ""}
                label="Indicator"
                onChange={(e) => setUploadState({ ...uploadState, indicatorId: e.target.value })}
              >
                {getAllIndicators().map((ind) => (
                  <MenuItem key={ind.id} value={ind.id}>
                    {ind.tableName} / {ind.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="State Name"
              value={uploadState.stateName}
              onChange={(e) => setUploadState({ ...uploadState, stateName: e.target.value })}
              placeholder="e.g., Present, 2030, Scenario A"
              helperText="This will create a new state for the selected indicator"
            />
            <Box>
              <Button variant="outlined" component="label" fullWidth>
                {uploadState.file ? uploadState.file.name : "Select File"}
                <input
                  type="file"
                  hidden
                  accept="image/*,video/*,.html,.htm,.json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setUploadState({ ...uploadState, file });
                      // Auto-fill state name from filename if empty
                      if (!uploadState.stateName) {
                        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
                        setUploadState((prev) => ({ ...prev, file, stateName: nameWithoutExt }));
                      }
                    }
                  }}
                />
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                Supports images, videos, HTML files, and JSON
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setUploadDialog(false);
              setUploadState({ indicatorId: null, stateName: "", file: null });
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUploadMedia}
            variant="contained"
            disabled={!uploadState.indicatorId || !uploadState.stateName || !uploadState.file || uploading}
          >
            {uploading ? <CircularProgress size={24} /> : "Upload"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmDialog} onClose={() => setDeleteConfirmDialog(null)}>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete "{deleteConfirmDialog?.name}"?
          </Typography>
          {deleteConfirmDialog?.type === "indicator" && (
            <Typography color="text.secondary" sx={{ mt: 1, fontSize: "0.875rem" }}>
              This will also delete all associated states and media files.
            </Typography>
          )}
          {deleteConfirmDialog?.type === "state" && (
            <Typography color="text.secondary" sx={{ mt: 1, fontSize: "0.875rem" }}>
              This will also delete all associated media files.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmDialog(null)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default UserUploads;
