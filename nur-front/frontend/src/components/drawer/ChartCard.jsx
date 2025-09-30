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

const ChartCard = ({ title, data, MemoizedChart, customHeader }) => {
  const [expanded, setExpanded] = React.useState(false);
  const [openDialog, setOpenDialog] = React.useState(false);
  const cardRef = React.useRef(null);

  const handleClickDialog = () => {
    setOpenDialog(!openDialog);
  };

  const handleExpandClick = () => {
    const wasExpanded = expanded;
    setExpanded(!expanded);

    // Auto-scroll to show expanded content after animation
    if (!wasExpanded && cardRef.current) {
      setTimeout(() => {
        // Find the drawer container to scroll within
        const drawerPaper = cardRef.current.closest(".MuiDrawer-paper");
        if (drawerPaper) {
          const cardRect = cardRef.current.getBoundingClientRect();
          const drawerRect = drawerPaper.getBoundingClientRect();

          // Check if card will be cut off when expanded (more generous threshold)
          if (cardRect.bottom > drawerRect.bottom - 200) {
            // Scroll the drawer container instead of using scrollIntoView
            const scrollTop = drawerPaper.scrollTop;
            const targetScrollTop =
              scrollTop + (cardRect.bottom - drawerRect.bottom) + 50;

            drawerPaper.scrollTo({
              top: targetScrollTop,
              behavior: "smooth",
            });
          }
        }
      }, 400); // Wait for collapse animation to complete
    }
  };

  return (
    <Card
      ref={cardRef}
      sx={{
        width: "100%",
        maxWidth: "100%",
        marginBottom: "16px",
        overflow: "hidden",
      }}
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
        sx={{
          width: "100%",
          maxWidth: "100%",
          overflow: "hidden",
        }}
        in={expanded}
        timeout="auto"
        unmountOnExit
      >
        <CardContent
          sx={{
            width: "100%",
            maxWidth: "100%",
            padding: "16px",
            overflow: "hidden",
            "&:last-child": {
              paddingBottom: "16px",
            },
          }}
        >
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
