const mongoose = require("mongoose");

const TemplateSchema = new mongoose.Schema({
  templateName: {
    type: String,
    required: [true,"please enter your template name"]
  },
  jenkinsURL: {
    type: String
  },
  jenkinsLogin: {
    type: String
  },
  jenkinsPassword: {
    type: String
  },
},{timestamps: true});

module.exports = mongoose.model("Templates", TemplateSchema);
