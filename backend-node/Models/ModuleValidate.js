/**json file upload validations */
const mongoose = require("mongoose");

const executionDataRules = new mongoose.Schema({
  testNodeProps: {
    type: [String],
  },
  validNavActions: {
    type: [String],
  },
  validValidateActions: {
    type: [String],
  },
});

const testDataRules = new mongoose.Schema({
  key: {
    type: [String],
  },
});

const ModuleValidateSchema = new mongoose.Schema({
  executionDataRules: {
    type: executionDataRules,
  },
  testDataRules: {
    type: testDataRules,
  },
});

module.exports = mongoose.model("ModuleValidate", ModuleValidateSchema);
