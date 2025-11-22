const mongoose = require("mongoose");

const tagSchema = new mongoose.Schema({
  tags: {
    type: [String],
    required: [true,"please enter Tag Name"],
    trim: true,
    unquie: true
  }
  
},{timestamps: true});

module.exports = mongoose.model("Tag", tagSchema);