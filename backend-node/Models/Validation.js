/**JSON rule validations */
const mongoose = require("mongoose");

const ModuleValidate = require("./ModuleValidate");
const ModuleValidateSchema = ModuleValidate.schema;

const ValidateSchema = new mongoose.Schema({
  ModuleValidate: {
    type: ModuleValidateSchema,
  },
});

module.exports = mongoose.model("Validation", ValidateSchema);
