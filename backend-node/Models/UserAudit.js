const mongoose = require('mongoose')

const userAuditSchema = new mongoose.Schema(
    {
        action: String, // Project Update or ..etc
        activityType: String, //UPDATE, DELETE
        ref_id: String, // Referance Id project id or module id ..etc
        backUp: [mongoose.Schema.Types.Mixed], //If update or delete backup last data
        status: {
            type: Number,
            default: 1,
        }, // 1 - Active , 0 - In Avtice / Deleted
        company: {
            type: String,
            // required: [true, 'please enter your company'],
        },
    },
    { timestamps: true }
)

module.exports = mongoose.model('userAudit', userAuditSchema)
