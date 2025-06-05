import { Typography } from "@mui/material";

const MetricDisplay = ({ data, currentIndicator }) => {
  if (!data || !data.metrics) return null;

  const metrics = data.metrics;

  switch (currentIndicator) {
    case "mobility":
      return (
        <>
          <Typography variant="body1">
            Population: {metrics.total_population?.toLocaleString()}
          </Typography>
          <Typography variant="body1">
            Public Transport Coverage: {metrics.public_transport_coverage}%
          </Typography>
          <Typography variant="body1">
            Average Commute Time: {metrics.average_commute_time} min
          </Typography>
          <Typography variant="body1">
            Bike Lane Coverage: {metrics.bike_lane_coverage}%
          </Typography>
        </>
      );
    case "climate":
      return (
        <>
          <Typography variant="body1">
            Population: {metrics.total_population?.toLocaleString()}
          </Typography>
          <Typography variant="body1">
            Air Quality Index: {metrics.air_quality_index}
          </Typography>
          <Typography variant="body1">
            Carbon Emissions: {metrics.carbon_emissions?.toLocaleString()} tons
          </Typography>
          <Typography variant="body1">
            Renewable Energy: {metrics.renewable_energy_percentage}%
          </Typography>
          <Typography variant="body1">
            Green Space: {metrics.green_space_percentage}%
          </Typography>
        </>
      );
    case "land_use":
      return (
        <>
          <Typography variant="body1">
            Population: {metrics.total_population?.toLocaleString()}
          </Typography>
          <Typography variant="body1">
            Mixed Use Ratio: {metrics.mixed_use_ratio}%
          </Typography>
          <Typography variant="body1">
            Population Density: {metrics.population_density} people/km²
          </Typography>
          <Typography variant="body1">
            Public Space: {metrics.public_space_percentage}%
          </Typography>
          <Typography variant="body1">
            Avg Building Height: {metrics.average_building_height} m
          </Typography>
        </>
      );
    default:
      return null;
  }
};

export default MetricDisplay;
