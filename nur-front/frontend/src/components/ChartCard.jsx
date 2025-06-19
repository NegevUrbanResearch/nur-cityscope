import React from "react";

import {
  IconButton,
  Collapse,
  Card,
  CardHeader,
  CardContent,
  styled,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { chartsDrawerWidth } from "../style/drawersStyles";
const ChartCard = ({ title, data, MemoizedChart }) => {
  const [expanded, setExpanded] = React.useState(false);

  const handleExpandClick = () => {
    setExpanded(!expanded);
  };

  return (
    <Card sx={{ maxWidth: chartsDrawerWidth }}>
      <CardHeader
        subheader={title}
        action={
          <ExpandMore
            expand={expanded}
            onClick={handleExpandClick}>
            <ExpandMoreIcon />
          </ExpandMore>
        }></CardHeader>
      <Collapse
        in={expanded}
        timeout="auto"
        unmountOnExit>
        <CardContent>
          <MemoizedChart data={data} />
        </CardContent>
      </Collapse>
    </Card>
  );
};

export default ChartCard;

const ExpandMore = styled((props) => {
  const { expand, ...other } = props;
  return <IconButton {...other} />;
})(({ theme }) => ({
  marginLeft: "auto",
  transition: theme.transitions.create("transform", {
    duration: theme.transitions.duration.shortest,
  }),
  variants: [
    {
      props: ({ expand }) => !expand,
      style: {
        transform: "rotate(0deg)",
      },
    },
    {
      props: ({ expand }) => !!expand,
      style: {
        transform: "rotate(180deg)",
      },
    },
  ],
}));
