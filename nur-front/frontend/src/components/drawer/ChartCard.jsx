import React from "react";

import {
  IconButton,
  Collapse,
  Card,
  CardHeader,
  CardContent,
  styled,
  DialogTitle,
  Dialog,
  DialogContent,
  Slide,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import VisibilityIcon from "@mui/icons-material/Visibility";

import { chartsDrawerWidth } from "../../style/drawersStyles";
const ChartCard = ({ title, data, MemoizedChart, customHeader }) => {
  const [expanded, setExpanded] = React.useState(false);
  const [openDialog, setOpenDialog] = React.useState(false);

  const handleClickDialog = () => {
    setOpenDialog(!openDialog);
  };

  const handleExpandClick = () => {
    setExpanded(!expanded);
  };

  return (
    <Card
      sx={{ width: `calc(${chartsDrawerWidth} - 1vw)` }}
      id={`chart-card-${title}`}
    >
      <CardHeader
        subheader={title}
        action={
          <>
            <IconButton size="small" onClick={handleClickDialog}>
              <VisibilityIcon />
            </IconButton>
            <Dialog
              open={openDialog}
              slotProps={{
                paper: { sx: { width: "95vw", minHeight: "50vh" } },
              }}
              slots={{
                transition: Transition,
              }}
              keepMounted
              onClose={handleClickDialog}
            >
              <DialogTitle>{title}</DialogTitle>
              <DialogContent>
                <MemoizedChart data={data} />
              </DialogContent>
            </Dialog>
            <ExpandMore expand={expanded} onClick={handleExpandClick}>
              <ExpandMoreIcon />
            </ExpandMore>
          </>
        }
      ></CardHeader>
      <Collapse
        sx={{ width: `calc(${chartsDrawerWidth} - 1vw)` }}
        in={expanded}
        timeout="auto"
        unmountOnExit
      >
        <CardContent sx={{ width: `calc(${chartsDrawerWidth} - 1vw)` }}>
          {customHeader}
          <MemoizedChart data={data} />
        </CardContent>
      </Collapse>
    </Card>
  );
};

export default ChartCard;

const Transition = React.forwardRef(function Transition(props, ref) {
  return <Slide direction="up" ref={ref} {...props} />;
});

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
