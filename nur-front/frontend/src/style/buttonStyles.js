const buttonStyles = {
  textTransform: "none",
  py: 0,
  px: { xs: 1.5, sm: 2 },
  border: "1px solid rgba(255, 255, 255, 0.2)",
  borderRadius: "6px",
  backgroundColor: "rgba(255, 255, 255, 0.05)",
  transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
  "&:hover": {
    backgroundColor: "rgba(100, 181, 246, 0.12)",
    borderColor: "rgba(100, 181, 246, 0.5)",
    transform: "translateY(-1px)",
    boxShadow: "0 4px 12px rgba(100, 181, 246, 0.15)",
  },
  "&:disabled": {
    borderColor: "rgba(255, 255, 255, 0.1)",
    color: "rgba(255, 255, 255, 0.3)",
    backgroundColor: "rgba(255, 255, 255, 0.02)",
  },
};

export default buttonStyles;