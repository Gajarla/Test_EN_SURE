const mongoose = require('mongoose')

const defectSchema = new mongoose.Schema(
    {
        jobId: String,
        releaseId: String,
        moduleId: String,
        testCaseId: String,
        testNodeId: String,
        testStepId: String,
        summary: String,
        description: String,
        createdBy: {
            type: String,
        },
        updatedBy: {
            type: String,
        },
        defectTrack: mongoose.Schema.Types.Mixed,
        defectUrl: String,
        status: String,
        company: {
            type: String,
        },
        projectID: {
            type: String,
        },
    },
    { timestamps: true }
)

module.exports = mongoose.model('Defects', defectSchema)
