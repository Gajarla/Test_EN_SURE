// The function in the file are used to update company and project attributes
// against different tables

// The functions are executed through a script in line command
// 'npm run updateCompanyOrProject' mentioned in package.json with the
// help of a job 'updateCompanyOrProjectJob' present in utils folder

const Release = require('../Models/Release')
const Project = require('../Models/Project')
const User = require('../Models/User')
const UserAudit = require('../Models/UserAudit')
const Defect = require('../Models/Defects')
const { Module } = require('../Models/Module')
const Job = require('../Models/Job')
const UserLoginActivity = require('../Models/UserLoginActivity')

async function updateCompanyForModules() {
    try {
        const activeProjects = await Project.find({ status: 'ACTIVE' })
            .select('_id company')
            .lean()
        for (const project of activeProjects) {
            const modules = await Module.find(
                { projectID: project._id },
                { _id: 1 }
            )
            if (modules.length !== 0) {
                const modulesList = modules.map((m) => m._id)
                modulesList.forEach(async (module) => {
                    await Module.updateOne(
                        {
                            _id: module._id,
                        },
                        {
                            $set: {
                                company: project.company,
                            },
                        },
                        // will not update 'updatedAt' property
                        {
                            timestamps: false,
                        }
                    )
                })
            }
        }
        return {
            status: 200,
            message:
                'Company has been updated against respective project modules',
        }
    } catch (error) {
        console.log('Error updating company against Modules ', error)
        throw error
    }
}

async function updateCompanyAndProjectForReleases() {
    try {
        const activeProjects = await Project.find({ status: 'ACTIVE' })
            .select('_id company')
            .lean()
        for (const project of activeProjects) {
            const modules = await Module.find(
                { projectID: project._id },
                { _id: 1 }
            )
            if (modules.length > 0) {
                const modulesList = modules.map((m) => m._id)
                Release.find(
                    {
                        'modules.moduleID': {
                            $in: modulesList,
                        },
                    },
                    async (err, releases) => {
                        if (releases) {
                            releases.forEach(async (release) => {
                                await Release.updateOne(
                                    { _id: release._id },
                                    {
                                        $set: {
                                            company: project.company,
                                            projectID: project._id,
                                        },
                                    },
                                    // will not update 'updatedAt' property
                                    { timestamps: false }
                                )
                            })
                        }
                    }
                )
            }
        }
        return {
            status: 200,
            message: 'Company and ProjectID has been updated against releases',
        }
    } catch (error) {
        console.log(
            'Error updating company and project against Releases',
            error
        )
        throw error
    }
}

async function updateCompanyAndProjectForJobs() {
    try {
        const activeProjects = await Project.find({ status: 'ACTIVE' })
            .select('_id company')
            .lean()
        for (const project of activeProjects) {
            const modules = await Module.find(
                { projectID: project._id },
                { _id: 1 }
            )
            if (modules?.length !== 0) {
                const moduleIds = modules.map((m) => m._id)
                Release.find(
                    { 'modules.moduleID': { $in: moduleIds } },
                    async (err, releases) => {
                        if (releases?.length !== 0) {
                            {
                                const releaseIds = releases.map((r) => r._id)
                                Job.find(
                                    {
                                        releaseID: {
                                            $in: releaseIds,
                                        },
                                    },
                                    async (err, jobs) => {
                                        if (jobs?.length !== 0) {
                                            jobs.forEach(async (job) => {
                                                await Job.updateOne(
                                                    {
                                                        _id: job._id,
                                                    },
                                                    {
                                                        $set: {
                                                            company:
                                                                project.company,
                                                            projectID:
                                                                project._id,
                                                        },
                                                    },
                                                    // will not update 'updatedAt' property
                                                    {
                                                        timestamps: false,
                                                    }
                                                )
                                            })
                                        }
                                    }
                                )
                            }
                        }
                    }
                )
            }
        }
        return {
            status: 200,
            message: 'Company and ProjectID has been updated against jobs',
        }
    } catch (error) {
        console.log('Error updating company and project against Jobs', error)
        throw error
    }
}

async function updateCompanyAndProjectForDefects() {
    try {
        const [defects, modules, projects] = await Promise.all([
            Defect.find({}, { _id: 1, moduleId: 1 }),
            Module.find({}, { _id: 1, projectID: 1 }),
            Project.find({}, { _id: 1, company: 1 }),
        ])
        defects.forEach(async (defect) => {
            const defectModuleId = defect.moduleId
            const module = modules.find(
                (module) => module._id == defectModuleId
            )
            const project = projects.find(
                (project) => project._id == module?.projectID
            )
            await Defect.updateOne(
                {
                    _id: defect._id,
                },
                {
                    $set: {
                        company: project?.company,
                        projectID: project?._id,
                    },
                },
                // will not update 'updatedAt' property
                {
                    timestamps: false,
                }
            )
        })
        return {
            status: 200,
            message: 'Company and Project has been updated against defects',
        }
    } catch (error) {
        console.log('Error updating company against Defects ', error)
        throw error
    }
}

async function updateCompanyForLoginActivities() {
    try {
        const loginActivities = await UserLoginActivity.find({}, { userId: 1 })
        const allUsers = await User.find({}, { _id: 1, company: 1 })
        loginActivities.forEach(async (login) => {
            const loginUserId = login.userId
            const userId = allUsers.find((user) => user._id == loginUserId)
            await UserLoginActivity.updateOne(
                {
                    _id: login._id,
                },
                {
                    $set: {
                        company: userId?.company,
                    },
                },
                // will not update 'updatedAt' property
                {
                    timestamps: false,
                }
            )
        })
        return {
            status: 200,
            message:
                'Company has been updated against all the login activities',
        }
    } catch (error) {
        console.log(
            'Error updating company against UserLoginActivities ',
            error
        )
        throw error
    }
}

async function updateCompanyForUserAudits() {
    try {
        const userAudits = await UserAudit.find({}, { _id: 1, backUp: 1 })
        const allUsers = await User.find({}, { _id: 1, company: 1 })
        userAudits.forEach(async (userAudit) => {
            const userAuditId = userAudit._id
            const userAuditUserId = userAudit?.backUp[0]?.UserId
            const userId = allUsers.find((user) => user._id == userAuditUserId)
            await UserAudit.updateOne(
                {
                    _id: userAuditId,
                },
                {
                    $set: {
                        company: userId?.company,
                    },
                },
                // will not update 'updatedAt' property
                {
                    timestamps: false,
                }
            )
        })
        return {
            status: 200,
            message: 'Company has been updated against all the User Audits',
        }
    } catch (error) {
        console.log('Error updating company against UserAudits ', error)
        throw error
    }
}

module.exports = {
    updateCompanyAndProjectForJobs,
    updateCompanyForModules,
    updateCompanyAndProjectForDefects,
    updateCompanyAndProjectForReleases,
    updateCompanyForLoginActivities,
    updateCompanyForUserAudits,
}
