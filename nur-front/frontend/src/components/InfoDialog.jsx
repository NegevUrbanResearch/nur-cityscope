import React from "react";
import {
  DialogContentText,
  DialogTitle,
  Dialog,
  DialogContent,
  Slide,
} from "@mui/material";

const Transition = React.forwardRef(function Transition(props, ref) {
  return (
    <Slide
      direction="up"
      ref={ref}
      {...props}
    />
  );
});

const InfoDialog = ({ openInfo, handleCloseInfo }) => {
  return (
    <Dialog
      open={openInfo}
      slots={{
        transition: Transition,
      }}
      keepMounted
      onClose={handleCloseInfo}>
      <DialogTitle>Info Title</DialogTitle>
      <DialogContent>
        <DialogContentText>Info will be displayed here.</DialogContentText>
      </DialogContent>
    </Dialog>
  );
};

export default InfoDialog;
