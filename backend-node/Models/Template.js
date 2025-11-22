const mongoose = require("mongoose");

const templateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "please enter project name"],
      trim: true,
    },

    endpoint: {
      type: String,
      required: [true, "please enter endpoint name"],
      trim: true,
    },

    username: {
      type: String,
      required: [true, "please enter user name"],
      trim: true,
    },

    password: {
      type: String,
      required: [true, "please enter password"],
      trim: true,
    },

    auth: {
      type: String,
      trim: true,
    },

    companyID: {
      type: String,
      required: [true, "please enter company Id"],
      trim: true,
    },

    createdBy: {
      type: String,
    },

    updatedBy: {
      type: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("template", templateSchema);
