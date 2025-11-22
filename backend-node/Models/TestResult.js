const mongoose = require("mongoose");

const TestResultsSchema = new mongoose.Schema({
  testResults: {
    type: Object
  },
});

module.exports = mongoose.model("TestResults", TestResultsSchema);
