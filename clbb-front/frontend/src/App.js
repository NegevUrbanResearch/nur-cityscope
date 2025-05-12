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
import Map1 from "./pages/map1";
import Map2 from "./pages/map2";
import Map3 from "./pages/map3";

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
            <Route path="/" element={<Map1 />} />
            <Route path="/map2" element={<Map2 />} />
            <Route path="/map3" element={<Map3 />} />
          </Routes>
        </Box>
      </ThemeProvider>
    </Box>
  );
};

export default App;
