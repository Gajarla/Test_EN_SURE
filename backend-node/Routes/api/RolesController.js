const express = require('express')
const router = express.Router()
const User = require('../../Models/User')
const Company = require('../../Models/Company')
const Role = require('../../Models/Role')
const roleManager = require('../../Models/RoleManager')
const logger = require('../../utils/logger')
const responseTransformer = require('../../utils/response-transformer')
const common = require('../../utils/common')

// ------------ Role APIs ---------------------- //

// Role creation
router.post('/createRole', async (req, res) => {
    try {
        logger.info(`Creating a role: ${req}`)
        const query = {
            $or: [{ roleID: req.body.roleID }, { roleName: req.body.roleName }],
        }
        Role.findOne(query, (err, dbRole) => {
            responseTransformer.passthroughError(
                err,
                dbRole,
                'existing role check',
                res,
                (dbRole) => {
                    if (dbRole) {
                        logger.info(`Role already exists`)
                        res.status(400).send({
                            status: 'error',
                            result: 'Role already exists',
                        })
                    } else {
                        new Role({
                            roleID: req.body.roleID,
                            roleName: req.body.roleName,
                            createdBy: req.body.createdBy,
                            updatedBy: req.body.updatedBy,
                        }).save((err, role) =>
                            responseTransformer.dbResponseTransformer(
                                err,
                                role,
                                'saving role',
                                res
                            )
                        )
                    }
                }
            )
        })
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.post('/v1/createRole', async (req, res) => {
    try {
        logger.info(`Creating a role: ${req}`)
        let body = req.body
        if (!body.roleID) {
            res.send({ status: 204, message: 'Role ID Required', data: [] })
        } else if (!body.roleName) {
            res.send({ status: 204, message: 'Role Name Required', data: [] })
        } else if (!body.UserId) {
            res.send({ status: 204, message: 'User Id Required', data: [] })
        } else {
            Role.findOne({
                status: 1,
                $or: [
                    { roleID: req.body.roleID },
                    { roleName: req.body.roleName },
                ],
            }).then(async (dbRole) => {
                if (dbRole) {
                    res.send({
                        status: 204,
                        message: 'Role ID or Role Name Already Exist',
                        data: [],
                    })
                } else {
                    let userrole = await common.CheckUserRole(req.body.UserId)
                    // if(userrole == "R0001"){
                    let _newrole = new Role({
                        roleID: req.body.roleID,
                        roleName: req.body.roleName,
                        createdBy: req.body.UserId,
                        updatedBy: req.body.UserId,
                    })
                    await _newrole.save().then(async (doc) => {
                        if (doc) {
                            res.send({
                                status: 200,
                                message: 'Role Saved',
                                data: [],
                            })
                            // let _newmanage = new roleManager({
                            //   rid:doc._id,
                            //   roleId: doc.roleID,
                            //   clientId: "DEFUALT_ROLE_CONFIG",
                            //   companyId:"DEFUALT_ROLE_CONFIG",
                            //   components:body.components,
                            //   createdBy: body.UserId,
                            //   updatedBy: body.UserId
                            // });
                            // await _newmanage.save().then(async (doc) => {
                            //   if (doc) {
                            //     res.send({ status: 200, message: "Role Settings Created", data: [] });
                            //   } else {
                            //     res.send({
                            //       status: 400,
                            //       message: "Something went wrong",
                            //       data: [],
                            //     });
                            //   }
                            // });
                        } else {
                            res.send({
                                status: 400,
                                message: 'Something went wrong',
                                data: [],
                            })
                        }
                    })
                    // }else{
                    //   res.send({status:400,message:"No Access to Create Company",data:[]})
                    // }
                }
            })
        }
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})
router.post('/v1/updateRole', async (req, res) => {
    try {
        logger.info(`Updating a role: ${req}`)
        let body = req.body
        if (!body.rid) {
            res.send({
                status: 204,
                message: 'Role Object ID Required',
                data: [],
            })
        } else if (!body.roleID) {
            res.send({ status: 204, message: 'Role Id Required', data: [] })
        } else if (!body.roleName) {
            res.send({ status: 204, message: 'Role Name Required', data: [] })
        } else if (!body.UserId) {
            res.send({ status: 204, message: 'User Id Required', data: [] })
        } else {
            let userrole = await common.CheckUserRole(req.body.UserId)
            if (userrole == 'R0001') {
                Role.updateOne(
                    {
                        _id: req.body.rid,
                        status: 1,
                    },
                    {
                        $set: {
                            roleID: body.roleID,
                            roleName: body.roleName,
                            updatedBy: body.UserId,
                        },
                    }
                ).then((doc) => {
                    if (doc) {
                        res.send({
                            status: 200,
                            message: 'Role Updated',
                            data: [],
                        })
                    } else {
                        res.send({
                            status: 204,
                            message: 'Something Went Wrong..',
                            data: [],
                        })
                    }
                })
            } else {
                res.send({
                    status: 400,
                    message: 'No Access to Create Company',
                    data: [],
                })
            }
        }
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})
router.post('/v1/deleteRole', async (req, res) => {
    try {
        logger.info(`Updating a role: ${req}`)
        let body = req.body
        if (!body.rid) {
            res.send({
                status: 204,
                message: 'Role Object ID Required',
                data: [],
            })
        } else if (!body.roleID) {
            res.send({ status: 204, message: 'Role Id Required', data: [] })
        } else if (!body.UserId) {
            res.send({ status: 204, message: 'User Id Required', data: [] })
        } else {
            let userrole = await common.CheckUserRole(req.body.UserId)
            if (userrole == 'R0001') {
                Role.updateOne(
                    {
                        _id: req.body.rid,
                        status: 1,
                    },
                    { $set: { status: 0, updatedBy: body.UserId } }
                ).then((doc) => {
                    if (doc) {
                        res.send({
                            status: 200,
                            message: 'Role Deleted',
                            data: [],
                        })
                    } else {
                        res.send({
                            status: 204,
                            message: 'Something Went Wrong..',
                            data: [],
                        })
                    }
                })
            } else {
                res.send({
                    status: 400,
                    message: 'No Access to Create Company',
                    data: [],
                })
            }
        }
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})
router.post('/v1/getRoles', async (req, res) => {
    try {
        logger.info(`Updating a role: ${req}`)
        let body = req.body
        if (!body.UserId) {
            res.send({ status: 204, message: 'User Id Required', data: [] })
        } else {
            let userrole = await common.CheckUserRole(req.body.UserId)
            if (userrole == 'R0001' || userrole == 'R0002') {
                let roles = await Role.find()
                res.send({
                    status: 200,
                    message: 'Data Available',
                    data: roles,
                })
            } else {
                res.send({
                    status: 400,
                    message: 'No Access to Create Company',
                    data: [],
                })
            }
        }
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})
router.get('/allRoles', async (req, res) => {
    try {
        logger.info(`Listing all Roles`)
        Role.find({}, (err, roles) =>
            responseTransformer.dbResponseTransformer(
                err,
                roles,
                'listing roles',
                res
            )
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})
router.post('/v1/RoleManage', async (req, res) => {
    try {
        logger.info(`Updating a role: ${req}`)
        let body = req.body
        if (!body.rid) {
            res.send({
                status: 204,
                message: 'Role Object ID Required',
                data: [],
            })
        } else if (!body.roleID) {
            res.send({ status: 204, message: 'Role Id Required', data: [] })
        } else if (!body.components) {
            res.send({ status: 204, message: 'Components Required', data: [] })
        } else if (!body.UserId) {
            res.send({ status: 204, message: 'User Id Required', data: [] })
        } else {
            let userrole = await common.CheckUserRole(body.UserId)
            if (userrole == 'R0002') {
                let rolemanage = await roleManager.find({
                    status: 1,
                    rid: body.rid,
                })
                if (rolemanage.length > 0) {
                    roleManager
                        .updateOne(
                            {
                                _id: rolemanage[0]._id,
                                rid: body.rid,
                                // clientId: body.UserId,
                                status: 1,
                            },
                            {
                                $set: {
                                    components: body.components,
                                    updatedBy: body.UserId,
                                },
                            }
                        )
                        .then((doc) => {
                            if (doc) {
                                res.send({
                                    status: 200,
                                    message: 'Role Settings Updated',
                                    data: [],
                                })
                            } else {
                                res.send({
                                    status: 204,
                                    message: 'Something Went Wrong..',
                                    data: [],
                                })
                            }
                        })
                } else {
                    let _newmanage = new roleManager({
                        rid: body.rid,
                        roleId: body.roleID,
                        clientId: body.UserId,
                        components: body.components,
                        createdBy: body.UserId,
                        updatedBy: body.UserId,
                    })
                    await _newmanage.save().then(async (doc) => {
                        if (doc) {
                            res.send({
                                status: 200,
                                message: 'Role Settings Created',
                                data: [],
                            })
                        } else {
                            res.send({
                                status: 400,
                                message: 'Something went wrong',
                                data: [],
                            })
                        }
                    })
                }
            } else {
                res.send({
                    status: 400,
                    message: 'No Access to Create Company',
                    data: [],
                })
            }
        }
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})
router.post('/v1/getRoleManage', async (req, res) => {
    try {
        logger.info(`Updating a role: ${req}`)
        let body = req.body
        if (!body.UserId) {
            res.send({ status: 204, message: 'User Id Required', data: [] })
        } else if (!body.companyId) {
            res.send({ status: 204, message: 'Company Id Required', data: [] })
        } else if (!body.rid) {
            res.send({ status: 204, message: 'Role Id Required', data: [] })
        } else {
            // let userrole = await common.CheckUserRole(body.UserId);
            // if (userrole == "R0002") {
            let rolemanage = await roleManager.find(
                {
                    status: 1,
                    rid: body.rid,
                },
                { createdBy: 0, updatedBy: 0, createdAt: 0, updatedAt: 0 }
            )
            if (rolemanage.length > 0) {
                res.send({
                    status: 200,
                    message: 'Data Available',
                    data: rolemanage,
                })
            } else {
                let defaultrolemanage = await roleManager.find(
                    {
                        status: 1,
                        rid: 'DEFAULT',
                    },
                    { createdBy: 0, updatedBy: 0, createdAt: 0, updatedAt: 0 }
                )
                if (defaultrolemanage.length > 0) {
                    res.send({
                        status: 200,
                        message: 'Data Available',
                        data: defaultrolemanage,
                        // roleConfigList: rolemanage,
                    })
                } else {
                    res.send({
                        status: 204,
                        message: 'No Data Found',
                        data: [],
                    })
                }
            }
            // }
            // else {
            // res.send({
            //     status: 400,
            //     message: "No Access to get data",
            //     data: [],
            // });
            // }
        }
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.post('/v1/getRoleManage/client', async (req, res) => {
    try {
        logger.info(`Updating a role: ${req}`)
        let body = req.body
        if (!body.UserId) {
            res.send({ status: 204, message: 'User Id Required', data: [] })
        } else {
            let userrole = await common.CheckUserRole(body.UserId)
            // if (userrole == "R0002") {
            let rolemanage = await roleManager.find(
                {
                    status: 1,
                    rid: body.rid,
                },
                { createdBy: 0, updatedBy: 0, createdAt: 0, updatedAt: 0 }
            )
            if (rolemanage.length > 0) {
                res.send({
                    status: 200,
                    message: 'Data Available',
                    data: rolemanage,
                })
            } else {
                let defaultrolemanage = await roleManager.find(
                    {
                        status: 1,
                        rid: 'CLIENT_ADMIN',
                    },
                    { createdBy: 0, updatedBy: 0, createdAt: 0, updatedAt: 0 }
                )
                if (defaultrolemanage.length > 0) {
                    res.send({
                        status: 200,
                        message: 'Data Available',
                        data: defaultrolemanage,
                        // roleConfigList: rolemanage,
                    })
                } else {
                    res.send({
                        status: 204,
                        message: 'No Data Found',
                        data: [],
                    })
                }
            }
            // }
            // else {
            // res.send({
            //     status: 400,
            //     message: "No Access to get data",
            //     data: [],
            // });
            // }
        }
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.post('/v1/getRoleManage/list', async (req, res) => {
    try {
        logger.info(`Updating a role: ${req}`)
        let body = req.body
        if (!body.UserId) {
            res.send({ status: 204, message: 'User Id Required', data: [] })
        } else {
            let userrole = await common.CheckUserRole(body.UserId)
            // if (userrole == "R0002") {
            let rolemanage = await roleManager.find(
                {
                    status: 1,
                    // rid: body.rid,
                },
                { createdBy: 0, updatedBy: 0, createdAt: 0, updatedAt: 0 }
            )
            if (rolemanage.length > 0) {
                res.send({
                    status: 200,
                    message: 'Data Available',
                    data: rolemanage,
                })
            } else {
                let rolemanage = []
                if (userrole == 'R0002') {
                    rolemanage = await roleManager.find(
                        {
                            status: 1,
                        },
                        {
                            createdBy: 0,
                            updatedBy: 0,
                            createdAt: 0,
                            updatedAt: 0,
                        }
                    )
                }
                if (rolemanage.length > 0) {
                    res.send({
                        status: 200,
                        message: 'Data Available',
                        data: rolemanage,
                    })
                } else {
                    res.send({
                        status: 204,
                        message: 'No Data Found',
                        data: [],
                    })
                }
            }
            // }
            // else {
            // res.send({
            //     status: 400,
            //     message: "No Access to get data",
            //     data: [],
            // });
            // }
        }
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.post('/v1/getRoleConfig', async (req, res) => {
    try {
        logger.info(`Updating a role: ${req}`)
        let body = req.body
        if (!body.UserId) {
            res.send({ status: 204, message: 'User Id Required', data: [] })
        } else if (!body.rid) {
            res.send({
                status: 204,
                message: 'Role Object Id Required',
                data: [],
            })
        } else if (!body.companyId) {
            res.send({ status: 204, message: 'Company Id Required', data: [] })
        } else {
            let rolemanage = await roleManager.find(
                {
                    status: 1,
                    rid: body.rid,
                },
                { createdBy: 0, updatedBy: 0, createdAt: 0, updatedAt: 0 }
            )
            if (roleconfig.length > 0) {
                res.send({
                    status: 200,
                    message: 'Data Available',
                    data: rolemanage,
                })
            } else {
                res.send({ status: 204, message: 'No Data Found', data: [] })
            }
        }
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})
module.exports = router
