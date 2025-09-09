import React from "react";
import isEqual from "lodash/isEqual";
import { useAppData } from "../../DataContext";

import RadarChart from "../charts/RadarChart";
import PieChart from "../charts/PieChart";
import HorizontalStackedBar from "../charts/HorizontalStackedBar";
import StackedBarChart from "../charts/BarChart";
import ChartCard from "./ChartCard";


const IndicatorGraphs = () => {
    const {
        dashboardData: data,
        getTabLabels,
    } = useAppData();

    const tabLabels = getTabLabels();
    const [openInfo, setOpenInfo] = React.useState(false);


    return (
        <>
            <ChartCard
                title={tabLabels[0]}
                data={data?.horizontalStackedBars}
                MemoizedChart={MemoizedHorizontalStackedBar}
            />
            <ChartCard
                title={tabLabels[1]}
                data={data?.stackedBars}
                MemoizedChart={MemoizedBarChart}
            />
            <ChartCard
                title={tabLabels[2]}
                data={data?.radar}
                MemoizedChart={MemoizedRadarChart}
            />
            <ChartCard
                title={tabLabels[3]}
                data={data?.pieChart}
                MemoizedChart={MemoizedPieChart}
            />
        </>
    );
};

export default IndicatorGraphs;

// Memoize components to avoid unnecessary re-renders
const MemoizedRadarChart = React.memo(RadarChart, (prevProps, nextProps) =>
    isEqual(prevProps.data, nextProps.data),
);
const MemoizedPieChart = React.memo(PieChart);
const MemoizedBarChart = React.memo(StackedBarChart, (prevProps, nextProps) =>
    isEqual(prevProps.data, nextProps.data),
);
const MemoizedHorizontalStackedBar = React.memo(
    HorizontalStackedBar,
    (prevProps, nextProps) => isEqual(prevProps.data, nextProps.data),
);
