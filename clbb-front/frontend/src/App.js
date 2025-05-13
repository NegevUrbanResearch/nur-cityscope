import React from "react";
import "./style/index.css";
import {
  Box,
  CssBaseline,
  ThemeProvider,
  CircularProgress,
  Typography,
  Button,
} from "@mui/material";
import { Routes, Route } from "react-router-dom";

import darkTheme from "./theme";
import { useAppData } from "./DataContext";

import Navbar from "./components/Navbar";
import Mobility from "./pages/Mobility";
import Climate from "./pages/Climate";
import LandUse from "./pages/LandUse";

const App = () => {
  const { loading, error } = useAppData();
  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <Box>
      <ThemeProvider theme={darkTheme}>
        <CssBaseline />
        <Navbar />

        <Box component="main" sx={{ mt: 8, p: 3 }}>
          <Routes>
            {/* the default page is now map 1 */}
            <Route path="/" element={<Mobility />} />
            <Route path="/climate" element={<Climate />} />
            <Route path="/land_use" element={<LandUse />} />
          </Routes>
        </Box>
      </ThemeProvider>
    </Box>
  );
};

export default App;
