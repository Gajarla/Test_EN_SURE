const mongoose = require("mongoose");

const AllJobsSchema = new mongoose.Schema({
  jenkinsJobID: {
    type: String
  },
  jenkinsJobName: {
    type: String
  },
  rpid: {
    type: String
  },
  uuid: {
    type: String
  },
  launchname: {
    type: String
  },
  number: {
    type: String
  },
  jsonFiles: {
    type: String
  },
  tags: {
    type: String
  },
  startTime: {
    type: String
  },
  datetime: {
    type: String
  },
  approximateDuration: {
    type: String
  },
  endTime: {
    type: String
  },
  failed: {
    type: Number
  },
  lastModified: {
    type: String
  },
  userID: {
    type: String
  },
  projectID: {
    type: String
  },
  passed: {
    type: Number
  },
  skipped: {
    type: Number
  },
  status: {
    type: String
  },
  total: {
    type: Number
  },
  releaseID: {
    type: String
  },
});

module.exports = mongoose.model("Jobdetails", AllJobsSchema);
