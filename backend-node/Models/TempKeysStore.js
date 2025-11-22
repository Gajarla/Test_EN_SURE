const mongoose = require('mongoose')

const TempVarSchema = new mongoose.Schema(
    {
        key: String,
        value: String,
        rId: String, //Release Id
        jobId: String, //Job Id
        mId: String, //Module Id
        createdBy: String,
        status: { type: String, Default: '1' },
    },
    { timestamps: true }
)

module.exports = mongoose.model('TempVars', TempVarSchema)
