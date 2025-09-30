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
        marginBottom: { xs: "12px", sm: "16px" },
        overflow: "hidden",
        backgroundColor: "rgba(30, 30, 30, 0.6)",
        borderRadius: "12px",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        backdropFilter: "blur(10px)",
        transition: "all 0.3s ease",
        "&:hover": {
          borderColor: "rgba(255, 255, 255, 0.2)",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
        },
      }}
      id={`chart-card-${title}`}
    >
      <CardHeader
        subheader={title}
        subheaderTypographyProps={{
          sx: {
            fontWeight: 600,
            fontSize: { xs: "0.95rem", sm: "1rem", md: "1.1rem" },
            color: "rgba(255, 255, 255, 0.95)",
          },
        }}
        sx={{
          py: { xs: 1, sm: 1.5 },
          px: { xs: 1.5, sm: 2 },
          borderBottom: expanded
            ? "1px solid rgba(255, 255, 255, 0.1)"
            : "none",
        }}
        action={
          <>
            <IconButton
              size="small"
              onClick={handleClickDialog}
              sx={{
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                mr: 0.5,
                transition: "all 0.2s ease",
                "&:hover": {
                  backgroundColor: "rgba(100, 181, 246, 0.15)",
                  color: "#64B5F6",
                  transform: "scale(1.1)",
                },
              }}
            >
              <VisibilityIcon fontSize="small" />
            </IconButton>
            <Dialog
              open={openDialog}
              slotProps={{
                paper: {
                  sx: {
                    width: { xs: "95vw", sm: "90vw", md: "85vw" },
                    minHeight: { xs: "60vh", sm: "50vh" },
                    backgroundColor: "rgba(18, 18, 18, 0.98)",
                    borderRadius: "16px",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                  },
                },
              }}
              slots={{
                transition: Transition,
              }}
              keepMounted
              onClose={handleClickDialog}
            >
              <DialogTitle
                sx={{
                  fontSize: { xs: "1.1rem", sm: "1.3rem" },
                  fontWeight: 600,
                  borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
                }}
              >
                {title}
              </DialogTitle>
              <DialogContent sx={{ pt: 3 }}>
                <MemoizedChart data={data} />
              </DialogContent>
            </Dialog>
            <ExpandMore
              expand={expanded}
              onClick={handleExpandClick}
              sx={{
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                transition: "all 0.2s ease",
                "&:hover": {
                  backgroundColor: "rgba(100, 181, 246, 0.15)",
                  color: "#64B5F6",
                },
              }}
            >
              <ExpandMoreIcon fontSize="small" />
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
            padding: { xs: "12px", sm: "16px" },
            overflow: "hidden",
            "&:last-child": {
              paddingBottom: { xs: "12px", sm: "16px" },
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
