const mongoose = require("mongoose");

const testCaseSchema = new mongoose.Schema({
  testCaseID: {
    type: String,
    required: [false],
    trim: true
  },
  testCaseTitle: {
    type: String,
    required: [false],
    trim: true
  },
  testCaseDescription: {
    type: String,
    required: [false],
    trim: true
  },
  dependsOn: {
    type: String,
    required: [false],
    trim: true
  },

  testCaseSteps: {
    type: [Object],
    required: [false],
    trim: true
  },

  tags: {
    type: Array,
    required: [false]
  },

  priority: {
    type: Array,
    required: [false]
  },
});

const testSuiteSchema = new mongoose.Schema({
  moduleID: {
    type: String,
    required: [true],
    trim: true
  },
  moduleName: {
    type: String,
    required: [true],
    trim: true,
    unquie: true
  },
  moduleDesc: {
    type: String,
    required: [true],
    trim: true
  },
  projectID: {
    type: String,
    required: [true],
    trim: true
  },
  testCases: {
    type: [testCaseSchema], // nested schema
    required: [true]

  },

}, { timestamps: true });

module.exports = mongoose.model("TestSuite", testSuiteSchema);