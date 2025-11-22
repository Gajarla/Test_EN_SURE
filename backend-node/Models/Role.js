const mongoose = require('mongoose')

const roleSchema = new mongoose.Schema(
    {
        roleID: {
            type: String,
            required: [true, 'please enter ROLE ID'],
            trim: true,
            unquie: true,
        },

        roleName: {
            type: String,
            required: [true, 'please enter role name'],
            trim: true,
            unquie: true,
        },
        status: {
            type: Number,
            default: 1,
        }, // 1 - Active , 0 - In Avtice / Deleted
        createdBy: {
            type: String,
        },
        updatedBy: {
            type: String,
        },
    },
    { timestamps: true }
)

module.exports = mongoose.model('Role', roleSchema)
