const mongoose = require('mongoose')

const roleManagerSchema = new mongoose.Schema(
    {
        rid: String, // Object Id from Role Schema
        roleId: String, // Role ID from Role Schema
        clientId: String, // object id from userSchema
        components: [mongoose.Schema.Types.Mixed],
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

module.exports = mongoose.model('roleManager', roleManagerSchema)

// components mixed schema example
// components:[
//     {"projects" : {"view" : true, "create" : true, "edit" : true, "delete" : true}},
// 	{"projectModules" : {"view" : true, "create" : true, "edit" : true, "delete" : true}},
// 	{"releases" : {"view" : true, "create" : true, "edit" : true, "delete" : true, "run" : false, "clone" : true}},
// 	{"testRuns" : {"view" : true, "create" : true, "edit" : true, "delete" : true, "rerun" : false}},
// 	{"users" : {"view" : true, "create" : true, "edit" : true, "delete" : true}},
// 	{"clients" : {"view" : true, "create" : true, "edit" : true, "delete" : true}},
// 	{"roles" : {"view" : true, "create" : true, "edit" : true, "delete" : true}},
// ]

//defualtmanager when Role was created
