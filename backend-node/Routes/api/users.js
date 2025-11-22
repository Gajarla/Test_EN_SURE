const express = require('express')
const router = express.Router()
const User = require('../../Models/User')
const Project = require('../../Models/Project')
const Company = require('../../Models/Company')
const Role = require('../../Models/Role')
const Defect = require('../../Models/Defects')
const UserAudit = require('../../Models/UserAudit')
const UserLoginActivity = require('../../Models/UserLoginActivity')
const logger = require('../../utils/logger')
const responseTransformer = require('../../utils/response-transformer')
const common = require('../../utils/common')
const crypto = require('crypto')
const Job = require('../../Models/Job')
const Release = require('../../Models/Release')

// Define a fixed IV (16 bytes for AES-256-CBC)
const FIXED_IV = Buffer.from('00000000000000000000000000000000', 'hex')

// Define a fixed secret key (32 bytes for AES-256)
const FIXED_SECRET_KEY = Buffer.from(
    'a3338ed32037f92099b6819f4295540e7c638b3d1a551fdd1abd00aca199f81f',
    'hex'
)

function encryptString(text) {
    const cipher = crypto.createCipheriv(
        'aes-256-cbc',
        FIXED_SECRET_KEY,
        FIXED_IV
    )
    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    return encrypted
}

// User creation
router.post('/createUser', async (req, res) => {
    try {
        logger.info(`Creating a user: ${req}`)
        User.findOne(
            { email: req.body.email, company: req.body.company },
            (err, dbUser) => {
                responseTransformer.passthroughError(
                    err,
                    dbUser,
                    'existing user check',
                    res,
                    (dbUser) => {
                        if (dbUser) {
                            logger.info(`User already exists`)
                            res.status(400).send({
                                status: 'error',
                                result: 'Email already exists',
                            })
                        } else {
                            new User({
                                firstName: req.body.firstName,
                                lastName: req.body.lastName,
                                email: req.body.email,
                                password: process.env.DEFAULT_PASSWORD,
                                company: req.body.company,
                                status: req.body.status,
                                role: req.body.role,
                                avatarUrl: req.body?.avatarUrl?.preview,
                                createdBy: req?.userId,
                            }).save((err, user) =>
                                responseTransformer.dbResponseTransformer(
                                    err,
                                    user,
                                    'saving user',
                                    res
                                )
                            )
                        }
                    }
                )
            }
        )
    } catch (error) {
        logger.info(`Error while creating user ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})
// creating user with encrypted password - v1
router.post('/v1/createUser', async (req, res) => {
    try {
        logger.info(`Creating a user: ${req}`)
        const dbUser = await User.findOne({
            email: req.body.email,
            company: req.body.company,
        })
        if (dbUser) {
            logger.info(`User already exists`)
            res.status(400).send({
                status: 'error',
                result: 'Email already exists',
            })
        } else {
            const encryptedText = encryptString(process.env.DEFAULT_PASSWORD)
            const user = new User({
                firstName: req.body.firstName,
                lastName: req.body.lastName,
                email: req.body.email,
                password: encryptedText,
                company: req.body.company,
                status: req.body.status,
                role: req.body.role,
                avatarUrl: req.body?.avatarUrl?.preview,
                createdBy: req?.userId,
            })
            const savedUser = await user.save()

            responseTransformer.dbResponseTransformer(
                null,
                savedUser,
                'saving user',
                res
            )
        }
    } catch (error) {
        logger.info(`Error creating user ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})
//ALL Users
router.get('/allUsers', async (req, res) => {
    try {
        logger.info(`Listing all users`)
        const users = await User.find(
            {},
            {
                firstName: 1,
                lastName: 1,
                email: 1,
                mobileNumber: 1,
                address: 1,
                role: 1,
                status: 1,
                avatarUrl: 1,
            }
        )
        // (err, users) =>
        // responseTransformer.userTransformer(null, users, 'listing users', res)
        res.send({
            status: 200,
            message: 'Users fetched successfully',
            data: users,
        })
        // )
    } catch (error) {
        logger.info(`Error while fetching user list ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//ALL Company Users
router.post('/allUsers/:companyId', async (req, res) => {
    try {
        logger.info(`Listing all users`)
        const body = req.body
        const queryParams = { company: req.params.companyId }

        const userrole = await common.CheckUserRole(req.body.UserId)

        if (userrole === 'R0001') {
            const roles = await Role.find({
                roleID: { $in: ['R0001', 'R0002'] },
            })
            const roleIds = roles.map((r) => r._id)
            queryParams['role'] = { $in: roleIds }
            delete queryParams['company'] // R0001 can view across companies?
        } else if (userrole === 'R0002') {
            const roles = await Role.find({ roleID: { $nin: ['R0001'] } })
            const roleIds = roles.map((r) => r._id)
            queryParams['role'] = { $in: roleIds }
        }

        const users = await User.find(queryParams, {
            firstName: 1,
            lastName: 1,
            email: 1,
            mobileNumber: 1,
            Address: 1,
            role: 1,
            avatarUrl: 1,
            status: 1,
            defectTrack: 1,
            company: 1,
        })

        responseTransformer.userTransformer(null, users, 'listing users', res)
    } catch (error) {
        logger.info(`Error while fteching company user list ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//User Details
router.get('/User/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id, {
            firstName: 1,
            lastName: 1,
            email: 1,
            mobileNumber: 1,
            Address: 1,
            role: 1,
            avatarUrl: 1,
            defectTrack: 1,
        })
            .populate({ path: 'company', model: 'Company' })
            .populate({ path: 'role', model: 'Role' })

        responseTransformer.dbResponseTransformer(null, user, 'get user', res)
    } catch (error) {
        logger.info(`Error while fetching user ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//Delete User
router.delete('/User/delete/:id', async (req, res) => {
    try {
        logger.info(`Delete user with user id: ${req.params.id}`)
        const deletedUser = await User.findByIdAndDelete(req.params.id)
        responseTransformer.dbResponseTransformer(
            null,
            deletedUser,
            'deleting user',
            res
        )
    } catch (error) {
        logger.info(`Error while deleting user ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//update User
router.patch('/User/update/:id', async (req, res) => {
    try {
        logger.info(`Update user with user id: ${req.params.id}`)
        const user = await User.findById(req.params.id)
        if (user) {
            const updatedUser = await User.findByIdAndUpdate(
                req.params.id,
                {
                    firstName: req.body.firstName,
                    lastName: req.body.lastName,
                    email: req.body.email,
                    company: req.body.company,
                    status: req.body.status,
                    role: req.body.role,
                    avatarUrl: req.body?.avatarUrl?.preview,
                    updatedBy: req.userId,
                },
                { new: true } // Return the updated document
            )

            responseTransformer.dbResponseTransformer(
                null,
                updatedUser,
                'updating user',
                res
            )
        }
    } catch (error) {
        logger.info(`Error while updating user ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

// ------------ Company APIs ---------------------- //

// Company creation
// router.post("/createCompany", async (req, res) => {
//   logger.info(`Creating a company: ${req}`);
//   Company.findOne({ company: req.body.company }, async (err, dbCompany) => {
//     responseTransformer.passthroughError(
//       err,
//       dbCompany,
//       "existing company check",
//       res,
//       (dbCompany) => {
//         if (dbCompany) {
//           logger.info(`Company already exists`);
//           res
//             .status(400)
//             .send({ status: "error", result: "Company already exists" });
//         } else {
//           new Company({
//             company: req.body.company,
//             createdBy: req.body.createdBy,
//             updatedBy: req.body.updatedBy,
//           }).save((err, company) =>
//             responseTransformer.dbResponseTransformer(
//               err,
//               company,
//               "saving company",
//               res
//             )
//           );
//         }
//       }
//     );
//   });
// });
router.post('/v1/createCompany', async (req, res) => {
    try {
        logger.info(`Creating a company: ${req}`)
        let body = req.body
        if (!body.company) {
            res.send({ status: 204, message: 'Company Name', data: [] })
        } else if (!body.UserId) {
            res.send({ status: 204, message: 'User Id Required', data: [] })
        } else {
            const dbCompany = await Company.findOne({
                company: body.company,
                code: body.code,
                Status: 1,
            })
            if (dbCompany) {
                res.send({
                    status: 204,
                    message: 'Company Exist',
                    data: [],
                })
            } else {
                let userrole = await common.CheckUserRole(req.body.UserId)
                if (userrole == 'R0001') {
                    let _newcompany = new Company({
                        company: body.company,
                        code: body.code,
                        description: body.description,
                        createdBy: body.UserId,
                        updatedBy: req.body.UserId,
                    })
                    const doc = await _newcompany.save()

                    if (doc) {
                        res.send({
                            status: 200,
                            message: 'Company Saved',
                            data: [], // You can also return the `doc` if needed
                        })
                    } else {
                        res.send({
                            status: 400,
                            message: 'Something went wrong',
                            data: [],
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
        }
    } catch (error) {
        logger.info(`Error while creating company ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.post('/v1/updateCompany', async (req, res) => {
    try {
        logger.info(`Updating a company: ${req}`)
        let body = req.body
        if (!body.updatedBy) {
            res.send({ status: 204, message: 'User Id Required', data: [] })
        } else if (!body.company) {
            res.send({ status: 204, message: 'Company Name', data: [] })
        } else if (!body.UserId) {
            res.send({ status: 204, message: 'User Id Required', data: [] })
        } else if (!body.CompanyId) {
            res.send({ status: 204, message: 'Company Id Required', data: [] })
        } else {
            let userrole = await common.CheckUserRole(req.body.UserId)
            if (userrole == 'R0001') {
                // Company.updateOne(
                //     {
                //         _id: req.body.CompanyId,
                //         Status: 1,
                //     },
                //     {
                //         $set: {
                //             company: body.companyname,
                //             code: body.code,
                //             description: body.description,
                //             updatedBy: body.UserId,
                //         },
                //     }
                // ).then((doc) => {
                //     if (doc) {
                //         res.send({
                //             status: 200,
                //             message: 'Company Updated',
                //             data: [],
                //         })
                //     } else {
                //         res.send({
                //             status: 204,
                //             message: 'Something Went Wrong..',
                //             data: [],
                //         })
                //     }
                // })

                const result = await Company.updateOne(
                    { _id: req.body.CompanyId, Status: 1 },
                    {
                        $set: {
                            company: body.companyname,
                            code: body.code,
                            description: body.description,
                            updatedBy: body.UserId,
                        },
                    }
                )

                if (result.modifiedCount > 0) {
                    return res.status(200).send({
                        status: 200,
                        message: 'Company Updated Successfully',
                        data: [],
                    })
                }

                if (result.matchedCount === 0) {
                    return res.status(404).send({
                        status: 404,
                        message: 'Company not found or already inactive',
                        data: [],
                    })
                }

                return res.status(204).send({
                    status: 204,
                    message: 'No changes were made',
                    data: [],
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
        logger.info(`Error while updating company ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.post('/v1/deleteCompany', async (req, res) => {
    try {
        logger.info(`Updating a company: ${req}`)
        let body = req.body
        if (!body.CompanyId) {
            res.send({ status: 204, message: 'Company Id Required', data: [] })
        } else if (!body.UserId) {
            res.send({ status: 204, message: 'User Id Required', data: [] })
        } else {
            let userrole = await common.CheckUserRole(req.body.UserId)
            if (userrole == 'R0001') {
                // Company.updateOne(
                //     {
                //         _id: req.body.CompanyId,
                //         Status: 1,
                //     },
                //     { $set: { Status: 0, updatedBy: body.UserId } }
                // ).then((doc) => {
                //     if (doc) {
                //         res.send({
                //             status: 200,
                //             message: 'Company Deleted',
                //             data: [],
                //         })
                //     } else {
                //         res.send({
                //             status: 204,
                //             message: 'Something Went Wrong..',
                //             data: [],
                //         })
                //     }
                // })

                const result = await Company.updateOne(
                    { _id: req.body.CompanyId, Status: 1 },
                    {
                        $set: {
                            Status: 0,
                            updatedBy: body.UserId,
                        },
                    }
                )

                if (result.modifiedCount > 0) {
                    return res.status(200).send({
                        status: 200,
                        message: 'Company Deleted Successfully',
                        data: [],
                    })
                }

                if (result.matchedCount === 0) {
                    return res.status(404).send({
                        status: 404,
                        message: 'Company not found or already inactive',
                        data: [],
                    })
                }

                return res.status(204).send({
                    status: 204,
                    message: 'No changes were made',
                    data: [],
                })
            } else {
                res.send({
                    status: 400,
                    message: 'No Access to Delete Company',
                    data: [],
                })
            }
        }
    } catch (error) {
        logger.info(`Error while deleting company ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.post('/v1/getAllCompanies', async (req, res) => {
    try {
        logger.info(`get all company: ${req}`)
        let body = req.body
        if (!body.UserId) {
            res.send({ status: 204, message: 'User Id Required', data: [] })
        } else {
            let userrole = await common.CheckUserRole(req.body.UserId)
            if (userrole == 'R0001') {
                let companies = await Company.find({ status: 1 })
                res.send({
                    status: 200,
                    message: 'Data Available',
                    data: companies,
                })
            } else if (userrole == 'R0002') {
                let companies = await Company.findById(body.companyId)
                res.send({
                    status: 200,
                    message: 'Data Available',
                    data: [companies],
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
        logger.info(`Error while fetcing all companies ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.get('/allCompanies', async (req, res) => {
    try {
        logger.info(`Listing all Companies`)
        Company.find({}, (err, companies) =>
            responseTransformer.dbResponseTransformer(
                err,
                companies,
                'listing companies',
                res
            )
        )
    } catch (error) {
        logger.info(`Error while fetching company list ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

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
        logger.info(`Error while creating role ${error}`)
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
        logger.info(`Error while creating role ${error}`)
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
        logger.info(`Error while updating role ${error}`)
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
        logger.info(`Error while deleting role ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})
router.get('/v1/getRoles', async (req, res) => {
    try {
        logger.info(`Updating a role: ${req}`)
        let body = req.body
        if (!body.UserId) {
            res.send({ status: 204, message: 'User Id Required', data: [] })
        } else {
            let userrole = await common.CheckUserRole(req.body.UserId)
            if (userrole == 'R0001' || userrole == 'R0002') {
                let roles = await Role.find({ status: 1 })
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
        logger.info(`Error while fetching role list ${error}`)
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
        logger.info(`Error while fetching role list ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

const axios = require('axios')

router.post('/v1/createUserinDefectTracker', async (req, res) => {
    try {
        let body = req.body
        const headers = {
            'Content-Type': 'application/json',
            Authorization: req.headers.authorization,
        }
        const requestBody = {
            userId: body.userId,
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email,
        }
        axios
            .post(
                `${process.env.DEFECT_TRACKING_HOST}/api/jira/login/v1/createUser`,
                requestBody,
                { headers }
            )
            .then(async (response) => {
                if (response.data.status == 200) {
                    // User.findByIdAndUpdate(
                    //     body.UserId,
                    //     {
                    //         defectTrack: response.data.message,
                    //     },
                    //     (err, dt) => {
                    //         if (dt) {
                    //             res.status(200).send({
                    //                 status: 200,
                    //                 message: 'User created successfully',
                    //                 data: response.data,
                    //             })
                    //         } else {
                    //             res.status(400).send({
                    //                 status: 200,
                    //                 message: 'User created But not saved in db',
                    //                 data: response.data,
                    //             })
                    //         }
                    //     }
                    // )
                    const updatedUser = await User.findByIdAndUpdate(
                        body.userId,
                        { defectTrack: message },
                        { new: true } // return the updated document
                    )

                    if (updatedUser) {
                        return res.status(200).send({
                            status: 200,
                            message: 'User updated successfully',
                            data: response.data,
                        })
                    } else {
                        return res.status(404).send({
                            status: 404,
                            message: 'User not found',
                            data: response.data,
                        })
                    }
                } else {
                    res.send({
                        status: 400,
                        message: 'User Not Created',
                        data: response.data,
                    })
                    // res.status(400).send({ status: 400, message: "User Not Created", data: response.data });
                }
            })
            .catch((error) => {
                console.error('Error:', error.message)
                res.status(500).send({
                    status: 500,
                    message: 'Internal Server Error',
                    error: error.message,
                }) // Sending error response
            })
    } catch (error) {
        logger.info(`Error while creating user in defect tracker ${error}`)
        res.status(400).send({
            status: 400,
            message: 'Bad Request',
            error: error.message,
        }) // Sending error response
    }
})

router.post('/v1/createProjectinDefectTracker', async (req, res) => {
    try {
        let body = flattenSingleValueFields(req.body)
        const headers = {
            'Content-Type': 'application/json',
            Authorization: req.headers.authorization,
        }
        const requestBody = {
            projectId: body.projectId,
            userId: body.userId,
            description: body.description,
            key: body.key,
            leadAccountId: body.leadAccountId,
            name: body.name,
            url: '',
        }
        axios
            .post(
                `${process.env.DEFECT_TRACKING_HOST}/api/project/v1/createProject`,
                requestBody,
                { headers }
            )
            .then(async (response) => {
                if (response.data.status == 200) {
                    // Project.findByIdAndUpdate(
                    //     body.ProjectId,
                    //     {
                    //         defectTrack: response.data.message,
                    //     },
                    //     (err, dt) => {
                    //         if (dt) {
                    //             res.status(200).send({
                    //                 status: 200,
                    //                 message: 'Project created successfully',
                    //                 data: response.data,
                    //             })
                    //         } else {
                    //             res.status(400).send({
                    //                 status: 200,
                    //                 message:
                    //                     'Project created But not saved in db',
                    //                 data: response.data,
                    //             })
                    //         }
                    //     }
                    // )
                    const updatedProject = await Project.findByIdAndUpdate(
                        body.projectId,
                        { defectTrack: response.data.message },
                        { new: true } // return updated doc
                    )

                    if (updatedProject) {
                        return res.status(200).send({
                            status: 200,
                            message: 'Project updated successfully',
                            data: response.data,
                        })
                    } else {
                        return res.status(404).send({
                            status: 404,
                            message: 'Project not found',
                            data: response.data,
                        })
                    }
                } else {
                    res.send({
                        status: 400,
                        message: 'Project Not Created',
                        data: response.data,
                    })
                    // res.status(400).send({ status: 400, message: "User Not Created", data: response.data });
                }
            })
            .catch((error) => {
                console.error('Error:', error.message)
                res.status(500).send({
                    status: 500,
                    message: 'Internal Server Error',
                    error: error.message,
                }) // Sending error response
            })
    } catch (error) {
        logger.info(`Error while creating project in defect tracker ${error}`)
        res.status(400).send({
            status: 400,
            message: 'Bad Request',
            error: error.message,
        }) // Sending error response
    }
})

function flattenSingleValueFields(body) {
    for (const key in body) {
        if (Array.isArray(body[key]) && body[key].length === 1) {
            const value = body[key]
            body[key] = Array.isArray(value) ? value[0] : value
        }
    }
    return body
}

router.post('/v1/createIssueinDefectTracker', async (req, res) => {
    try {
        let body = flattenSingleValueFields(req.body)
        logger.info(`Create Issue in Defect Tracker ${body}`)
        const headers = {
            'Content-Type': 'application/json',
            Authorization: req.headers.authorization,
        }
        emailNotifications = JSON.parse(body?.emailNotifications)

        const ids = emailNotifications?.map((id) => id)
        const emailUsers = await User.find(
            { _id: { $in: ids } },
            { email: 1 } // Only return the email field
        )

        const emails = emailUsers.map((u) => u.email)

        const requestBody = {
            pId: body.pid,
            testCaseId: body.testCaseId,
            testCaseStepId: body.testCaseStepId,
            userId: body.userId,
            projectId: body.projectId,
            projectKey: body.projectKey,
            summary: body.summary,
            description: body.description,
        }
        axios
            .post(
                `${process.env.DEFECT_TRACKING_HOST}/api/issue/v1/createIssue`,
                requestBody,
                { headers }
            )
            .then(async (response) => {
                const url = 'https://sailotech-team.atlassian.net/browse/'
                if (response.data.status == 200) {
                    const newIssue = new Defect({
                        userId: body.userId,
                        jobId: body.jobId,
                        releaseId: body.releaseId,
                        moduleId: body.moduleId,
                        testCaseId: body.testCaseId,
                        testNodeId: body.testNodeId,
                        testStepId: body.testCaseStepId,
                        createdBy: body.userId,
                        status: '1',
                        defectTrack: response.data.message,
                        defectUrl: `${url}${response.data.message.key}`,
                        summary: body.summary,
                        description: body.description,
                        projectId: body.projectId,
                        company: body.company,
                    })
                    const savedIssue = await newIssue.save()

                    if (savedIssue) {
                        if (body?.emailNotifications?.length > 0) {
                            const job = await Job.findById(body.jobId)
                            const user = await User.findById(job?.createdBy)
                            const release = await Release.findById(
                                job?.releaseID
                            )
                            const testRunUrl =
                                `${process.env.APP_URL}/#/dashboard/testRuns/testRuns/` +
                                body.jobId +
                                `/testCases`

                            const testRunUrlNode = `<a href="${testRunUrl}">Click here to view more details</a>`
                            const uploadedFile = req?.files?.file
                            let attachments = []
                            if (uploadedFile) {
                                attachments = [
                                    {
                                        filename: uploadedFile.name, // Name for the file in the email
                                        content: uploadedFile.data, // The buffer with file data
                                        contentType: uploadedFile.mimetype,
                                    },
                                ]
                            }

                            await common
                                .SendDefectReportEmail(
                                    `${emails?.join(',')},${user?.email}`,
                                    release?.releaseName +
                                        ' - Issue Summary Report',
                                    body.description,
                                    `${user?.firstName} ${user?.lastName}`,
                                    testRunUrlNode,
                                    `${url}${response.data.message.key}`,
                                    `${response.data.message.key}`,
                                    attachments
                                )
                                .catch(console.error)
                        }
                        res.status(200).send({
                            status: 200,
                            message: 'Issue created successfully',
                            data: response.data,
                        })
                        // res.send(new APIResponse(200, data));
                    } else {
                        res.status(200).send({
                            status: 200,
                            message:
                                'Issue created successfully but not saved in db',
                            data: response.data,
                        })
                        res.send(new APIResponse(200, data))
                    }
                    // save in defectSchema
                } else {
                    res.send({
                        status: 400,
                        message: 'Issue Not Created',
                        data: response.data,
                    })
                    // res.status(400).send({ status: 400, message: "User Not Created", data: response.data });
                }
            })
            .catch((error) => {
                console.error('Error:', error)
                res.status(500).send({
                    status: 500,
                    message: 'Internal Server Error',
                    error: error.message,
                }) // Sending error response
            })
    } catch (error) {
        console.log('Error:', error)
        res.status(400).send({
            status: 400,
            message: 'Bad Request',
            error: error.message,
        }) // Sending error response
    }
})

router.post('/v2/createIssueinDefectTracker', async (req, res) => {
    try {
        let body = req.body
        const headers = {
            'Content-Type': 'application/json',
            Authorization: req.headers.authorization,
        }
        const requestBody = {
            pId: body.pId,
            testCaseId: body.testCaseId,
            testCaseStepId: body.testCaseStepId,
            userId: body.userId,
            projectId: body.projectID,
            projectKey: body.projectKey,
            summary: body.summary,
            description: body.description,
        }
        axios
            .post(
                `${process.env.DEFECT_TRACKING_HOST}/api/issue/v1/createIssue`,
                requestBody,
                { headers }
            )
            .then(async (response) => {
                const url = 'https://sailotech-team.atlassian.net/browse/'
                if (response.data.status == 200) {
                    const newIssue = new Defect({
                        userId: body.userId,
                        jobId: body.jobId,
                        releaseId: body.releaseId,
                        moduleId: body.moduleId,
                        testCaseId: body.testCaseId,
                        testNodeId: body.testNodeId,
                        testStepId: body.testCaseStepId,
                        createdBy: body.userId,
                        status: '1',
                        defectTrack: response.data.message,
                        defectUrl: `${url}${response.data.message.key}`,
                        summary: body.summary,
                        description: body.description,
                        projectId: body.projectId,
                        company: body.company,
                    })
                    const savedIssue = await newIssue.save()
                    if (savedIssue) {
                        res.status(200).send({
                            status: 200,
                            message: 'Issue created successfully',
                            data: response.data,
                        })
                        // res.send(new APIResponse(200, data));
                    } else {
                        res.status(200).send({
                            status: 200,
                            message:
                                'Issue created successfully but not saved in db',
                            data: response.data,
                        })
                        res.send(new APIResponse(200, data))
                    }
                    // save in defectSchema
                } else {
                    res.send({
                        status: 400,
                        message: 'Issue Not Created',
                        data: response.data,
                    })
                    // res.status(400).send({ status: 400, message: "User Not Created", data: response.data });
                }
            })
            .catch((error) => {
                console.error('Error:', error.message)
                res.status(500).send({
                    status: 500,
                    message: 'Internal Server Error',
                    error: error.message,
                }) // Sending error response
            })
    } catch (error) {
        logger.info(`Error while creating issue in defect tracker ${error}`)
        res.status(400).send({
            status: 400,
            message: 'Bad Request',
            error: error.message,
        }) // Sending error response
    }
})

//User Details
router.post('/v1/Issues/list', async (req, res) => {
    try {
        let queryParams = { ReleaseId: req.body.releaseId }
        if (req.body.jobId) {
            queryParams = {
                jobId: req.body.jobId,
            }
        } else if (req.body.releaseId) {
            queryParams = {
                releaseId: req.body.releaseId,
            }
        }
        const defects = await Defect.find(queryParams)
        // async (err, defects) => {
        const headers = {
            'Content-Type': 'application/json',
            Authorization: req.headers.authorization,
        }
        let newDefects = []
        defects?.forEach(async (defect) => {
            const { defectTrack } = defect
            const id = defectTrack?.id

            const requestBody = {
                issueId: id,
            }

            let defectStatus = null
            let newDefect = {}

            try {
                await axios
                    .post(
                        `${process.env.DEFECT_TRACKING_HOST}/api/issue/v1/getIssue`,
                        requestBody,
                        { headers }
                    )
                    .then(async (response) => {
                        defectStatus =
                            response?.data?.message?.fields?.status?.name
                    })
            } catch (error) {
                logger.info(`Error in fetching issue list ${error}`)
            }
            newDefect._id = defect._id
            newDefect.jobId = defect.jobId
            newDefect.releaseId = defect.releaseId
            newDefect.moduleId = defect.moduleId
            newDefect.testCaseId = defect.testCaseId
            newDefect.testNodeId = defect.testNodeId
            newDefect.testStepId = defect.testStepId
            newDefect.createdBy = defect.createdBy
            newDefect.status = defect.status
            newDefect.defectTrack = defect.defectTrack
            newDefect.defectUrl = defect.defectUrl
            newDefect.summary = defect.summary
            newDefect.description = defect.description
            newDefect.createdAt = defect.createdAt
            newDefect.updatedAt = defect.updatedAt
            newDefect.__v = defect.__v
            newDefect.defectStatus = defectStatus
            newDefects.push(newDefect)
            if (newDefects?.length === defects.length) {
                responseTransformer.dbResponseTransformer(
                    null,
                    newDefects,
                    'get defects',
                    res
                )
            }
        })

        if (defects?.length === 0)
            responseTransformer.dbResponseTransformer(
                null,
                defects,
                'get defects',
                res
            )
        // }).populate({ path: 'createdBy', model: 'User' })
    } catch (error) {
        logger.info(`Error while fetching issues list ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//User Details
router.post('/v1/Issues/getAuthDetails', async (req, res) => {
    try {
        const body = req.body
        const requestBody = {
            userId: body.userId,
            email: body.email,
        }
        const headers = {
            'Content-Type': 'application/json',
            Authorization: req.headers.authorization,
        }
        await axios
            .post(
                `${process.env.DEFECT_TRACKING_HOST}/v1/auth/getAuthDetails`,
                requestBody,
                {
                    headers,
                }
            )
            .then((response) => {
                res.send({ status: 200, data: response.data })
            })
    } catch (error) {
        logger.info(`Error while fetching issues auth details ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

module.exports = router
