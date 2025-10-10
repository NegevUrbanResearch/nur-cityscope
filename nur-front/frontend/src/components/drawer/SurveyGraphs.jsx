import React, { useEffect, useState } from "react";
import ChartCard from "./ChartCard";
import SpiderChart from "../charts/SpiderChart";
import DotChart from "../charts/DotChart";
import SurveyBarChart from "../charts/SurveyBarChart";

const SurveyGraphs = () => {
  const [routeFactorsData, setRouteFactorsData] = useState(null);
  const [distancePerceptionData, setDistancePerceptionData] = useState(null);
  const [walkingDistancesData, setWalkingDistancesData] = useState(null);

  useEffect(() => {
    // Load route choice factors data
    fetch(`${process.env.PUBLIC_URL}/survey-data/route_choice_factors.json`)
      .then(response => response.json())
      .then(data => {
        console.log("✓ Route choice factors data loaded:", data);
        setRouteFactorsData(data);
      })
      .catch(error => {
        console.error("Error loading route choice factors data:", error);
      });

    // Load distance perception data
    fetch(`${process.env.PUBLIC_URL}/survey-data/distance_perception.json`)
      .then(response => response.json())
      .then(data => {
        console.log("✓ Distance perception data loaded:", data);
        setDistancePerceptionData(data);
      })
      .catch(error => {
        console.error("Error loading distance perception data:", error);
      });

    // Load walking distances data
    fetch(`${process.env.PUBLIC_URL}/survey-data/walking_distances.json`)
      .then(response => response.json())
      .then(data => {
        console.log("✓ Walking distances data loaded:", data);
        setWalkingDistancesData(data);
      })
      .catch(error => {
        console.error("Error loading walking distances data:", error);
      });
  }, []);

  return (
    <>
      <ChartCard
        title="Route Choice Factors"
        data={routeFactorsData}
        MemoizedChart={SpiderChart}
      />

      <ChartCard
        title="Distance Perception vs Reality"
        data={distancePerceptionData}
        MemoizedChart={DotChart}
      />

      <ChartCard
        title="Walking Distance Distribution"
        data={walkingDistancesData}
        MemoizedChart={SurveyBarChart}
      />
    </>
  );
};

export default SurveyGraphs;