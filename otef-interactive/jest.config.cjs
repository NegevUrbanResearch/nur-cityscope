module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.js"],
  transform: {
    "^.+\\.js$": "babel-jest",
  },
};
