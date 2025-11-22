const express = require('express')
const router = express.Router()
const fs = require('fs')
const FormData = require('form-data')
const Project = require('../../Models/Project')
const Job = require('../../Models/Job')
const { Module } = require('../../Models/Module')
const logger = require('../../utils/logger')
const axios = require('axios')
const responseTransformer = require('../../utils/response-transformer')
const Release = require('../../Models/Release')
const Validation = require('../../Models/Validation')
const moment = require('moment')
const AuditCreation = require('../../Models/Audits')
const Template = require('../../Models/Template')
const TestCaseSteps = require('../../Models/TestCaseSteps')
const common = require('../../utils/common')
const userAudit = require('../../Models/UserAudit')
const User = require('../../Models/User')
const { JobStatus, KEYS } = require('../../utils/Constants')
const Defect = require('../../Models/Defects')
// const ObjectID = require('mongodb').ObjectID
const { MongoClient, ObjectId } = require('mongodb')

// Project creation
router.post('/createProject', async (req, res) => {
    try {
        logger.info(`Saving project body: ${req.body}`)
        responseTransformer.projectValidation(req.body, (err, newProject) => {
            responseTransformer.findByAndUpdateCb(
                err,
                newProject,
                'project validation',
                res,
                (newProject) => {
                    new Project({
                        name: newProject.name,
                        description: newProject.description,
                        team: newProject.team,
                        company: newProject.company,
                        status: newProject.status,
                        createdBy: req?.userId,
                        templateID: req?.body?.templateID,
                        testCaseSteps:
                            Object.keys(newProject?.testCaseSteps).length !== 0
                                ? newProject?.testCaseSteps
                                : {},
                        suiteNames: req?.body?.suiteNames
                            ? req?.body?.suiteNames
                            : [],
                    }).save((err, project) => {
                        if (
                            Object.keys(newProject?.testCaseSteps).length !== 0
                        ) {
                            new TestCaseSteps({
                                companyID: project.company,
                                projectID: project._id,
                                testCaseSteps: newProject?.testCaseSteps,
                                // version: "0.1",
                            }).save()
                        }
                        AuditCreation.upsertAuditLog(
                            project.collection.collectionName,
                            'create',
                            req.body?.email,
                            newProject.company,
                            null,
                            project
                        )
                        responseTransformer.projectTransformer(
                            err,
                            [project],
                            true,
                            res
                        )
                    })
                }
            )
        })
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

const getMethodSteps = (project, version) => {
    const methods = Object.keys(project?.testCaseSteps)
        ?.filter((key) => key !== '_id')
        .map((testCaseStep) => {
            return {
                name: testCaseStep,
                testCaseSteps: project?.testCaseSteps[testCaseStep],
            }
        })

    return {
        version,
        testCaseSteps: methods,
    }
}

const getTestCaseSteps = (project) => {
    const methods = Object.keys(project?.testCaseSteps)
        ?.filter((key) => key !== '_id' && key !== 'version')
        .map((testCaseStep) => {
            return {
                name: testCaseStep,
                testCaseSteps: project?.testCaseSteps[testCaseStep],
            }
        })

    return methods
}

// Project creation
router.post('/v1/createProject', async (req, res) => {
    try {
        logger.info(`Saving project body: ${req.body}`)
        console.log(req.body)
        const newProject = req.body
        // responseTransformer.projectValidation(req.body, (err, newProject) => {
        responseTransformer.findByAndUpdateCb(
            null,
            newProject,
            'project validation',
            res,
            async (newProject) => {
                const version = 0.01

                const methodSteps = getTestCaseSteps(newProject)
                methodSteps.push({ version })

                const testCaseSteps = {
                    ...newProject?.testCaseSteps,
                    version,
                }

                const hasTestCaseSteps =
                    newProject?.testCaseSteps &&
                    Object.keys(newProject.testCaseSteps).length > 0

                const project = await new Project({
                    name: newProject.name,
                    description: newProject.description,
                    team: newProject.team,
                    emailNotifications: newProject?.emailNotifications,
                    company: newProject.company,
                    apiRequestFiles: newProject.apiRequestFiles,
                    apiCreds: newProject.apiCreds,
                    requestFiles: newProject.requestFiles,
                    status: newProject.status,
                    createdBy: req?.userId,
                    templateID: req?.body?.templateID,
                    testCaseSteps: hasTestCaseSteps ? testCaseSteps : {},
                    suiteNames: req?.body?.suiteNames || [],
                }).save()

                if (hasTestCaseSteps) {
                    try {
                        const step = await new TestCaseSteps({
                            companyId: project.company,
                            projectId: project._id,
                            methods: methodSteps,
                            jobIds: [],
                            releaseId: [],
                            version,
                        }).save()
                        // use `step` if needed
                    } catch (err) {
                        console.error('Failed to save test case step:', err)
                        // throw or handle accordingly
                    }
                }

                // await AuditCreation.upsertAuditLog(
                //     project.collection.collectionName,
                //     'create',
                //     req.body?.email,
                //     newProject.company,
                //     null,
                //     project
                // )

                responseTransformer.projectTransformer(
                    null,
                    [project],
                    true,
                    res
                )
            }
        )
    } catch (error) {
        logger.info(`Error while creating project ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.get('/findProjects/:filter', async (req, res) => {
    try {
        logger.info(`Finding projects`)
        Project.find(JSON.parse(req.params.filter), (err, projects) =>
            responseTransformer.projectTransformer(err, projects, false, res)
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.get('/findProjects/:filter/:companyId/:userId', async (req, res) => {
    try {
        logger.info(`Finding projects`)
        const filterText = JSON.parse(
            `{"$and":[${req.params.filter},{"company":"${req.params.companyId}", "team":"${req.params.userId}"}]}`
        )
        Project.find(filterText, (err, projects) =>
            responseTransformer.projectTransformer(err, projects, false, res)
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.get('/v1/findProjects/:filter/:companyId/:userId', async (req, res) => {
    try {
        const filterText = JSON.parse(
            `{"$and":[${req.params.filter},{"company":"${req.params.companyId}", "team":"${req.params.userId}"}]}`
        )
        Project.find(
            filterText,
            {
                _id: 1,
                name: 1,
                team: 1,
                status: 1,
                createdAt: 1,
                updatedAt: 1,
                templateID: 1,
                suiteNames: 1,
                testCaseSteps: 1,
                company: 1,
                apiRequestFiles: 1,
                apiCreds: 1,
                requestFiles: 1,
            },
            (err, projects) =>
                responseTransformer.projectTransformer_v1(
                    err,
                    projects,
                    false,
                    res
                )
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

// Working with Joins
router.get(
    '/v1/findProjects/:filter/:companyId/:userId/:SortBy/:order/:rowsPerPage/:pageNo',
    async (req, res) => {
        try {
            let sortquery = { updatedAt: -1 }
            switch (req.params.SortBy) {
                case 'name':
                    switch (req.params.order) {
                        case 'asc':
                            sortquery = { name: 1 }
                            break
                        case 'desc':
                            sortquery = { name: -1 }
                            break
                    }
                    break

                case 'team':
                    switch (req.params.order) {
                        case 'asc':
                            sortquery = { status: 1 }
                            break
                        case 'desc':
                            sortquery = { status: -1 }
                            break
                    }
                    break
                case 'modulesCount':
                    switch (req.params.order) {
                        case 'asc':
                            sortquery = { modulesCount: 1 }
                            sortquery = { ...sortquery, updatedAt: -1 }
                            break
                        case 'desc':
                            sortquery = { modulesCount: -1 }
                            sortquery = { ...sortquery, updatedAt: -1 }
                            break
                    }
                    break
                case 'updatedAt':
                    switch (req.params.order) {
                        case 'asc':
                            sortquery = { updatedAt: 1 }
                            break
                        case 'desc':
                            sortquery = { updatedAt: -1 }
                            break
                    }
                    break
                default:
                    sortquery = { updatedAt: -1 }
            }
            const skipno =
                parseInt(req.params.pageNo) * parseInt(req.params.rowsPerPage)
            const limitno = parseInt(req.params.rowsPerPage)
            const filterText = JSON.parse(
                `{"$and":[${req.params.filter},{"company":"${req.params.companyId}", "team":"${req.params.userId}"}]}`
            )
            // Get the total count of documents
            const totalcount = await Project.countDocuments(filterText)
            const totalpages = Math.ceil(totalcount / limitno)
            if (req.params.order === 'asc' || req.params.order === 'desc') {
                // Aggregation for sorting by number of modules
                // Retrieve sorted projects with pagination
                const projects = await Project.find(filterText)
                    .sort(sortquery)
                    .skip(skipno)
                    .limit(limitno)
                    .select(
                        '_id name team status createdAt updatedAt templateID suiteNames testCaseSteps company apiRequestFiles apiCreds requestFiles modulesCount'
                    )
                responseTransformer.projectTransformer_v1(
                    null,
                    projects,
                    false,
                    res,
                    totalcount
                )
            } else {
                // Regular find query with sorting, skipping and limiting
                const projects = await Project.find(filterText)
                    .sort(sortquery)
                    .skip(skipno)
                    .limit(limitno)
                    .select(
                        '_id name team status createdAt updatedAt templateID suiteNames testCaseSteps company apiRequestFiles apiCreds requestFiles modulesCount'
                    )
                responseTransformer.projectTransformer_v1(
                    null,
                    projects,
                    false,
                    res,
                    totalcount
                )
            }
        } catch (error) {
            res.send({ status: 400, message: 'Bad Request', data: error })
        }
    }
)

router.get('/v1/findProject/:ProjectId', async (req, res) => {
    try {
        const project = await Project.findById(req.params.ProjectId, {
            _id: 1,
            name: 1,
            description: 1,
            team: 1,
            emailNotifications: 1,
            templateID: 1,
            testCaseSteps: 1,
            suiteNames: 1,
            status: 1,
            updatedAt: 1,
            apiCreds: 1,
            apiRequestFiles: 1,
            requestFiles: 1,
            createdBy: 1,
        })

        if (project) {
            res.send({
                status: 200,
                Message: 'Project Available',
                data: project,
            })
        } else {
            res.status(404).send({
                status: 404,
                Message: 'Project not found',
            })
        }
    } catch (error) {
        logger.info(`Error while finding project ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//ALL Projects
router.get('/allProjects', async (req, res) => {
    try {
        logger.info(`Listing all projects`)
        Project.aggregate(
            responseTransformer.projectFilter(req),
            (err, projects) =>
                responseTransformer.projectTransformer(
                    err,
                    projects,
                    false,
                    res
                )
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//ALL Projects
router.get('/allProjects/:companyId', async (req, res) => {
    try {
        logger.info(`Listing all projects for a company id`)
        Project.aggregate(
            responseTransformer.projectFilter(req),
            (err, projects) =>
                responseTransformer.projectTransformer_v1(
                    err,
                    projects,
                    false,
                    res
                )
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

// Fetch All Active projects in a company

router.get('/allProjects/:companyId/:status/:rowsPerPage', async (req, res) => {
    try {
        const projects = await Project.aggregate(
            responseTransformer.projectFilter(req)
        )
        responseTransformer.projectTransformer_v1(null, projects, false, res)
        // Project.aggregate(
        //     responseTransformer.projectFilter(req),
        //     (err, projects) => {
        //         responseTransformer.projectTransformer_v1(
        //             err,
        //             projects,
        //             false,
        //             res
        //         )
        //     }
        // )
        // responseTransformer.projectTransformer_v2(req, res)
    } catch (error) {
        logger.info(`Encountered issue while fetching all projects ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//Project Details
router.get('/Project/:id', async (req, res) => {
    try {
        logger.info(`Listing project with id ${req.params.id}`)
        const project = await Project.findById(req.params.id)
        responseTransformer.projectTransformer(null, [project], true, res)
    } catch (error) {
        logger.info(`Encountered issue while fetching all projects ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//update Project
router.post('/v1/Project/update', async (req, res) => {
    try {
        let body = req.body
        if (!body.UserId) {
            res.send({ status: 204, message: 'User Id Required', data: [] })
        } else {
            projectValidation(req.body, (err, newProject) => {
                if (!err) {
                    Project.findById(req.params.id, (err1, prevProject) => {
                        if (!err1) {
                            // Project.updateOne(
                            //   {
                            //     _id: body._id,
                            //   },
                            //   { $set: {
                            //       name: body.name,
                            //       description:body.description,
                            //       team:body.team,
                            //       company:body.company,
                            //       status:body.status,
                            //       updatedBy: body.UserId
                            //     }
                            //   }
                            // ).then((doc) => {
                            //   if (doc) {
                            //     res.send({ status: 200, message: "Company Deleted", data: [] });
                            //   } else {
                            //     res.send({
                            //       status: 204,
                            //       message: "Something Went Wrong..",
                            //       data: [],
                            //     });
                            //   }
                            // });
                        } else {
                            res.send({
                                status: 400,
                                Message: 'Something Went Wrong',
                                data: '',
                            })
                        }
                    })
                } else {
                    res.send({ status: 400, message: 'Bad Request', data: err })
                }
            })
        }
    } catch (error) {
        res.send({ status: 400, Message: 'Something Went Wrong', data: '' })
    }
})
router.patch('/Project/update/:id', async (req, res) => {
    try {
        // responseTransformer.projectValidation(req.body, (err, newProject) => {
        responseTransformer.findByAndUpdateCb(
            null,
            req.body,
            'validate project',
            res,
            async (newProject) => {
                const projectId = req.params.id
                const prevProject = await Project.findById(projectId)
                if (!prevProject) {
                    return res
                        .status(404)
                        .json({ message: 'Project not found' })
                }

                const modules = await Module.find(
                    {
                        projectID: projectId,
                        'testNodes.testNode': {
                            $elemMatch: {
                                'testCaseSteps.module': {
                                    $exists: true,
                                    $ne: null,
                                    $not: { $size: 0 },
                                },
                            },
                        },
                    },
                    { _id: 1 }
                )

                let version = 0.01
                if (
                    prevProject?.testCaseSteps &&
                    prevProject.testCaseSteps.version
                ) {
                    version = parseFloat(
                        (prevProject.testCaseSteps.version + 0.01).toFixed(2)
                    )
                }

                const testCaseSteps = {
                    ...newProject.testCaseSteps,
                    version,
                }

                const updatedProject = await Project.findByIdAndUpdate(
                    projectId,
                    {
                        name: newProject.name,
                        description: newProject.description,
                        team: newProject.team,
                        emailNotifications: newProject.emailNotifications,
                        apiRequestFiles: newProject.apiRequestFiles,
                        apiCreds: newProject.apiCreds,
                        requestFiles: newProject.requestFiles,
                        company: newProject.company,
                        status: newProject.status,
                        createdBy: prevProject.createdBy,
                        updatedBy: req.userId,
                        testCaseSteps:
                            newProject.testCaseSteps &&
                            Object.keys(newProject.testCaseSteps).length > 0
                                ? testCaseSteps
                                : {},
                        suiteNames: req.body.suiteNames || [],
                        templateID: req.body.templateID,
                    },
                    { new: true }
                )

                // Save TestCaseSteps if needed
                if (
                    newProject.testCaseSteps &&
                    Object.keys(newProject.testCaseSteps).length > 0
                ) {
                    const methodSteps = getTestCaseSteps(newProject)
                    if (methodSteps.length > 1) {
                        const newStep = new TestCaseSteps({
                            companyId: newProject.company._id,
                            projectId: projectId,
                            methods: methodSteps,
                            jobIds: [],
                            releaseId: [],
                            version,
                        })
                        await newStep.save() // Note: save() no longer takes a callback
                    }
                }

                // Build audit changes
                const chdataObj = {}
                if (req.body.name !== prevProject.name)
                    chdataObj.name = prevProject.name
                if (req.body.description !== prevProject.description)
                    chdataObj.description = prevProject.description
                if (!equalsCheck(req.body.team, prevProject.team))
                    chdataObj.team = prevProject.team
                if (!equalsCheck(req.body.suiteNames, prevProject.suiteNames))
                    chdataObj.suiteNames = prevProject.suiteNames
                if (req.body.company._id !== String(prevProject.company))
                    chdataObj.company = prevProject.company
                if (req.body.status !== prevProject.status)
                    chdataObj.status = prevProject.status
                if (req.body.templateID !== prevProject.templateID)
                    chdataObj.templateID = prevProject.templateID
                if (
                    !equalsCheck(
                        req.body.testCaseSteps,
                        prevProject.testCaseSteps
                    )
                )
                    chdataObj.testCaseSteps = prevProject.testCaseSteps

                // Save audit log
                // await common.UserAudit(
                //     '64a7b2ea81b8b505b1ddddc9',
                //     'PROJECT',
                //     '/Project/update/' + projectId,
                //     'UPDATE',
                //     'SUCCESS',
                //     'Updated Successfully',
                //     projectId,
                //     chdataObj,
                //     prevProject.company
                // )

                const projAfterUpdate = await Project.findById(projectId)

                // await AuditCreation.upsertAuditLog(
                //     Project.collection.collectionName,
                //     'update',
                //     req.body?.email,
                //     newProject.company,
                //     prevProject,
                //     projAfterUpdate
                // )

                responseTransformer.projectTransformer(
                    null,
                    [updatedProject],
                    true,
                    res
                )
            }
        )
        // })
    } catch (error) {
        logger.info(`Error while updating project ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

const equalsCheck = (a, b) => {
    return JSON.stringify(a) === JSON.stringify(b)
}
//Delete Project
router.delete('/Project/delete/:id', async (req, res) => {
    try {
        logger.info(`Delete project with user id: ${req.params.id}`)
        Project.remove({ _id: req.params.id }, (err, project) =>
            responseTransformer.dbResponseTransformer(
                err,
                project,
                'delete project',
                res
            )
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.post('/Project/checkProjectNameExists', async (req, res) => {
    try {
        let projectFound = false
        const projects = await Project.find({ company: req?.body?.company })
            .select('name')
            .lean()
        const project = projects?.find(
            (project) =>
                project.name.toLowerCase() ===
                req.body.projectName.toLowerCase()
        )
        if (project) projectFound = true
        res.send(projectFound)
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

// ALL jobs for a release
router.get('/AllJobs/:projectID', async (req, res) => {
    const warnings = []
    try {
        Module.aggregate(
            [{ $match: { projectID: req.params.projectID } }],
            (err, modules) => {
                if (modules?.length === 0)
                    responseTransformer.dbResponseTransformer(
                        err,
                        [],
                        'list jobs',
                        res
                    )
                else {
                    responseTransformer.passthroughError(
                        err,
                        modules,
                        'list modules',
                        res,
                        (modules) => {
                            const moduleIds = modules.map((m) => m._id)
                            Release.find(
                                { 'modules.moduleID': { $in: moduleIds } },
                                (err, releases) => {
                                    if (releases?.length === 0)
                                        responseTransformer.dbResponseTransformer(
                                            err,
                                            [],
                                            'list jobs',
                                            res
                                        )
                                    else {
                                        responseTransformer.passthroughError(
                                            err,
                                            releases,
                                            'list releases',
                                            res,
                                            (releases) => {
                                                const releaseIds = releases.map(
                                                    (r) => r._id
                                                )
                                                Job.find(
                                                    {
                                                        releaseID: {
                                                            $in: releaseIds,
                                                        },
                                                    },
                                                    async (err, jobs) => {
                                                        const newJobs = []
                                                        let responseSent = false
                                                        if (jobs?.length === 0)
                                                            responseTransformer.dbResponseTransformer(
                                                                err,
                                                                [],
                                                                'list jobs',
                                                                res
                                                            )
                                                        else {
                                                            jobs.forEach(
                                                                async (job) => {
                                                                    const releaseID =
                                                                        job.releaseID
                                                                    const release =
                                                                        await Release.findById(
                                                                            releaseID
                                                                        )
                                                                    const releaseName =
                                                                        release.releaseName
                                                                    const {
                                                                        _id,
                                                                        jenkinsJobID,
                                                                        jenkinsPath,
                                                                        createdBy,
                                                                        createdAt,
                                                                        updatedAt,
                                                                        __v,
                                                                        testRun,
                                                                        executionStart,
                                                                        executionEnd,
                                                                        executionDuration,
                                                                        lambdatest,
                                                                        runningStatus,
                                                                    } = job

                                                                    let percentage = 0
                                                                    let total = 0
                                                                    let untested = 0
                                                                    let passed = 0
                                                                    let failed = 0
                                                                    let skipped = 0
                                                                    let modules =
                                                                        []
                                                                    const statusCounts =
                                                                        responseTransformer.getStatusCounts(
                                                                            testRun
                                                                        )
                                                                    total =
                                                                        statusCounts?.total
                                                                    untested =
                                                                        statusCounts?.untested
                                                                    passed =
                                                                        statusCounts?.passed
                                                                    skipped =
                                                                        statusCounts?.skipped
                                                                    failed =
                                                                        statusCounts?.failed
                                                                    percentage =
                                                                        statusCounts?.percentage

                                                                    testRun?.forEach(
                                                                        (
                                                                            run
                                                                        ) => {
                                                                            const {
                                                                                testNodes,
                                                                                moduleID,
                                                                            } =
                                                                                run ||
                                                                                []
                                                                            modules.push(
                                                                                {
                                                                                    moduleID,
                                                                                    testNodes,
                                                                                }
                                                                            )
                                                                        }
                                                                    )

                                                                    const formattedDuration =
                                                                        moment(
                                                                            new Date(
                                                                                parseInt(
                                                                                    executionDuration,
                                                                                    10
                                                                                )
                                                                            )
                                                                        ).format(
                                                                            'm[m] s[s]'
                                                                        )
                                                                    const moduleId =
                                                                        modules[0]
                                                                            ?.moduleID
                                                                    const module =
                                                                        await Module.findById(
                                                                            moduleId
                                                                        )

                                                                    const moduleName =
                                                                        module?.suiteName

                                                                    newJobs.push(
                                                                        {
                                                                            _id,
                                                                            testRun: `${moduleName}_${job.jenkinsJobID}`,
                                                                            jenkinsJobID,
                                                                            jenkinsPath,
                                                                            jenkinsJobName:
                                                                                job?.jenkinsJobName,
                                                                            createdBy,
                                                                            createdAt,
                                                                            updatedAt,
                                                                            __v,
                                                                            releaseID,
                                                                            releaseName,
                                                                            total,
                                                                            untested,
                                                                            passed,
                                                                            failed,
                                                                            skipped,
                                                                            percentage,
                                                                            modules,
                                                                            executionStart,
                                                                            executionEnd,
                                                                            executionDuration:
                                                                                executionDuration
                                                                                    ? formattedDuration
                                                                                    : '',
                                                                            lambdatest,
                                                                            runningStatus,
                                                                        }
                                                                    )
                                                                    if (
                                                                        jobs.length ===
                                                                        newJobs.length
                                                                    ) {
                                                                        try {
                                                                            responseTransformer.dbResponseTransformer(
                                                                                err,
                                                                                newJobs,
                                                                                'list jobs',
                                                                                res
                                                                            )
                                                                        } catch (e) {
                                                                            warnings.push(
                                                                                e
                                                                            )
                                                                        }

                                                                        responseSent = true
                                                                    }
                                                                }
                                                            )
                                                        }
                                                    }
                                                )
                                            }
                                        )
                                    }
                                }
                            )
                        }
                    )
                }
            }
        )
    } catch (error) {
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

// Fetching Jobs on the basis of Projectid

router.get('/v1/AllJobs/:projectID', async (req, res) => {
    const warnings = []
    try {
        // const releases = await Release.aggregate([
        //     { $match: { projectID: req.params.projectID } },
        //     { $project: { _id: 1, releaseName: 1 } },
        // ])
        const allModules = await Module.find(
            { projectID: req.params.projectID },
            { _id: 1, suiteName: 1 }
        )
        const releases = await Release.find(
            { projectID: req.params.projectID },
            { _id: 1, releaseName: 1 }
        )
        if (releases?.length === 0)
            res.send({
                status: 204,
                message: 'There are no Releases against the project',
                data: [],
            })
        else {
            Job.find({ projectID: req.params.projectID }, async (err, jobs) => {
                const newJobs = []
                let responseSent = false
                if (jobs?.length === 0)
                    responseTransformer.dbResponseTransformer(
                        err,
                        [],
                        'list jobs',
                        res
                    )
                else {
                    let releasesSkipped = 0
                    jobs.forEach((job) => {
                        const releaseID = job.releaseID
                        const release = releases.find(
                            (release) => release._id == job.releaseID
                        )
                        if (release) {
                            const releaseName = release.releaseName
                            const {
                                _id,
                                jenkinsJobID,
                                jenkinsPath,
                                createdBy,
                                createdAt,
                                updatedAt,
                                __v,
                                testRun,
                                executionStart,
                                executionEnd,
                                executionDuration,
                                lambdatest,
                                linuxScreenRecord,
                                runningStatus,
                            } = job

                            let percentage = 0
                            let total = 0
                            let untested = 0
                            let passed = 0
                            let failed = 0
                            let skipped = 0
                            let modules = []
                            const statusCounts =
                                responseTransformer.getStatusCounts(testRun)
                            total = statusCounts?.total
                            untested = statusCounts?.untested
                            passed = statusCounts?.passed
                            skipped = statusCounts?.skipped
                            failed = statusCounts?.failed
                            percentage = statusCounts?.percentage

                            testRun?.forEach((run) => {
                                const { testNodes, moduleID } = run || []
                                modules.push({
                                    moduleID,
                                    // testNodes,
                                })
                            })

                            const formattedDuration = moment(
                                new Date(parseInt(executionDuration, 10))
                            ).format('m[m] s[s]')
                            const moduleId = modules[0]?.moduleID
                            // const module = await Module.findById(moduleId)
                            // const moduleName = module?.suiteName
                            const module = allModules.find(
                                (module) => module._id == moduleId
                            )
                            const moduleName = module?.suiteName

                            newJobs.push({
                                _id,
                                testRun: `${moduleName}_${job.jenkinsJobID}`,
                                jenkinsJobID,
                                jenkinsPath,
                                jenkinsJobName: job?.jenkinsJobName,
                                createdBy,
                                createdAt,
                                updatedAt,
                                __v,
                                releaseID,
                                releaseName,
                                total,
                                untested,
                                passed,
                                failed,
                                skipped,
                                percentage,
                                // modules,
                                executionStart,
                                executionEnd,
                                executionDuration: executionDuration
                                    ? formattedDuration
                                    : '',
                                lambdatest,
                                linuxScreenRecord,
                                runningStatus,
                            })
                        } else {
                            releasesSkipped += 1
                        }
                        if (jobs.length === newJobs.length + releasesSkipped) {
                            try {
                                responseTransformer.dbResponseTransformer(
                                    err,
                                    newJobs,
                                    'list jobs',
                                    res
                                )
                            } catch (e) {
                                warnings.push(e)
                            }
                            responseSent = true
                        }
                    })
                }
            })
        }
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//Enhanced Pagination

router.get(
    '/v1/AllJobs/:projectID/:SortBy/:order/:pagesize/:pageno',
    async (req, res) => {
        const warnings = []
        try {
            const { projectID, SortBy, order, pagesize, pageno } = req.params
            const sortOrder = order === 'asc' ? 1 : -1
            let sortquery = { createdAt: -1 }
            const skip = parseInt(pageno) * parseInt(pagesize)
            const limit = parseInt(pagesize)
            const allModules = await Module.find(
                { projectID: projectID },
                { _id: 1, suiteName: 1 }
            )
            const releases = await Release.find(
                { projectID: req.params.projectID },
                { _id: 1, releaseName: 1 }
            )
            if (releases?.length === 0)
                res.send({
                    status: 204,
                    message: 'There are no Releases against the project',
                    data: [],
                })
            else {
                const jobs = await Job.find({
                    projectID: req.params.projectID,
                }).sort(sortquery)
                console.log('jobs', jobs)
                // async (err, jobs) => {
                const newJobs = []
                let responseSent = false
                if (jobs?.length === 0)
                    responseTransformer.dbResponseTransformer(
                        null,
                        [],
                        'list jobs',
                        res
                    )
                else {
                    let releasesSkipped = 0
                    jobs.forEach((job) => {
                        const releaseID = job.releaseID
                        const release = releases.find(
                            (release) => release._id == job.releaseID
                        )
                        if (release) {
                            const releaseName = release.releaseName
                            const {
                                _id,
                                jenkinsJobID,
                                jenkinsPath,
                                createdBy,
                                createdAt,
                                updatedAt,
                                __v,
                                testRun,
                                executionStart,
                                executionEnd,
                                executionDuration,
                                lambdatest,
                                linuxScreenRecord,
                                runningStatus,
                            } = job

                            let percentage = 0
                            let total = 0
                            let untested = 0
                            let passed = 0
                            let failed = 0
                            let skipped = 0
                            let modules = []
                            const statusCounts =
                                responseTransformer.getStatusCounts(testRun)
                            total = statusCounts?.total
                            untested = statusCounts?.untested
                            passed = statusCounts?.passed
                            skipped = statusCounts?.skipped
                            failed = statusCounts?.failed
                            percentage = statusCounts?.percentage

                            testRun?.forEach((run) => {
                                const { testNodes, moduleID } = run || []
                                modules.push({
                                    moduleID,
                                    // testNodes,
                                })
                            })

                            const formattedDuration = moment(
                                new Date(parseInt(executionDuration, 10))
                            ).format('m[m] s[s]')
                            console.log('modules', modules)
                            const moduleId = modules[0]?.moduleID
                            // const module = await Module.findById(moduleId)
                            // const moduleName = module?.suiteName
                            console.log('allModules', allModules)
                            const module = allModules.find(
                                (module) => module._id == moduleId
                            )
                            console.log('module', moduleId, module)
                            const moduleName = module?.suiteName

                            newJobs.push({
                                _id,
                                testRun: `${moduleName}_${job.jenkinsJobID}`,
                                jenkinsJobID,
                                jenkinsPath,
                                jenkinsJobName: job?.jenkinsJobName,
                                createdBy,
                                createdAt,
                                updatedAt,
                                __v,
                                releaseID,
                                releaseName,
                                total,
                                untested,
                                passed,
                                failed,
                                skipped,
                                percentage,
                                // modules,
                                executionStart,
                                executionEnd,
                                executionDuration: executionDuration
                                    ? formattedDuration
                                    : '',
                                lambdatest,
                                linuxScreenRecord,
                                runningStatus,
                            })
                        } else {
                            releasesSkipped += 1
                        }

                        if (jobs.length === newJobs.length + releasesSkipped) {
                            try {
                                const totalCount = newJobs.length || 0
                                const paginatedTestRuns = newJobs?.slice(
                                    skip,
                                    skip + limit
                                )
                                responseTransformer.dbResponseTransformer(
                                    null,
                                    paginatedTestRuns,
                                    'list jobs',
                                    res,
                                    totalCount
                                )
                            } catch (e) {
                                warnings.push(e)
                            }
                            responseSent = true
                        }
                    })
                }
                // }
                // ).sort(sortquery)
            }
        } catch (error) {
            logger.info(`Error encountered while fetching all jobs ${error}`)
            res.send({ status: 400, message: 'Bad Request', data: error })
        }
    }
)

// Updating projectID value for the older records of resepctive project
// which doesn't have projectID attribute

router.post('/updateProjectIDforJobs/:projectID', async (req, res) => {
    //Fetching all the projects on logged in user company basis
    // const projects = await Project.find(
    //     { company: req?.params?.company },
    //     { _id: 1 }
    // )
    try {
        // projects.forEach((project) => {
        Module.aggregate(
            [{ $match: { projectID: req.params.projectID } }],
            (err, modules) => {
                if (modules?.length === 0)
                    responseTransformer.dbResponseTransformer(
                        err,
                        [],
                        'list jobs',
                        res
                    )
                else {
                    responseTransformer.passthroughError(
                        err,
                        modules,
                        'list modules',
                        res,
                        (modules) => {
                            const moduleIds = modules.map((m) => m._id)
                            Release.find(
                                { 'modules.moduleID': { $in: moduleIds } },
                                (err, releases) => {
                                    if (releases?.length === 0)
                                        responseTransformer.dbResponseTransformer(
                                            err,
                                            [],
                                            'list jobs',
                                            res
                                        )
                                    else {
                                        responseTransformer.passthroughError(
                                            err,
                                            releases,
                                            'list releases',
                                            res,
                                            (releases) => {
                                                const releaseIds = releases.map(
                                                    (r) => r._id
                                                )
                                                Job.find(
                                                    {
                                                        releaseID: {
                                                            $in: releaseIds,
                                                        },
                                                    },
                                                    async (err, jobs) => {
                                                        if (jobs?.length === 0)
                                                            responseTransformer.dbResponseTransformer(
                                                                err,
                                                                [],
                                                                'list jobs',
                                                                res
                                                            )
                                                        else {
                                                            jobs.forEach(
                                                                async (job) => {
                                                                    await Job.updateOne(
                                                                        {
                                                                            _id: job._id,
                                                                        },
                                                                        {
                                                                            $set: {
                                                                                projectID:
                                                                                    req
                                                                                        .params
                                                                                        .projectID,
                                                                            },
                                                                        },
                                                                        // will not update 'updatedAt' property
                                                                        {
                                                                            timestamps: false,
                                                                        }
                                                                    )
                                                                }
                                                            )
                                                            res.send({
                                                                status: 200,
                                                                message:
                                                                    'ProjectID has been updated against jobs',
                                                            })
                                                        }
                                                    }
                                                )
                                            }
                                        )
                                    }
                                }
                            )
                        }
                    )
                }
            }
        )
        // })
    } catch (error) {
        logger.warn(
            `Encountered warnings while upadting projectID against jobs`
        )
        res.send({ status: 400, message: 'Bad Request', error })
    }
})

router.post('/createModule', async (req, res) => {
    const warnings = []
    try {
        Project.findById(req.body.projectID, (err, project) => {
            responseTransformer.moduleValidation(req.body, (err) => {
                responseTransformer.findByAndUpdateCb(
                    err,
                    req.body,
                    'module validation',
                    res,
                    async (newModule) => {
                        const module = await Module.aggregate([
                            {
                                $match: {
                                    projectID: req.body.projectID,
                                    suiteName: newModule.suiteName,
                                },
                            },
                            { $sort: { createdAt: -1 } },
                        ])
                        let version = '0.01'
                        let version_b
                        let isAuditSave = false
                        let bddata
                        if (module.length != 0) {
                            bddata = module[0]
                            const prevModule = module[0]
                            if (prevModule?.version) {
                                version = parseFloat(prevModule?.version) + 0.01
                                version_b = prevModule?.version
                                isAuditSave = true
                            }
                        }
                        version = parseFloat(version).toFixed(2)

                        const moduleTestSteps = project?.testCaseSteps?.toJSON()

                        const { testNodes } = newModule
                        let methodExists = false
                        const newTestNodes = testNodes?.map((testNode) => {
                            const { testCaseSteps } = testNode.testNode
                            const newTestCaseSteps = []
                            testCaseSteps?.forEach((testCaseStep) => {
                                if (testCaseStep?.module) {
                                    const keys = Object.keys(
                                        testCaseStep?.module
                                    )
                                    const methodName =
                                        testCaseStep?.module[keys[0]].methodName

                                    moduleTestSteps[methodName]?.forEach(
                                        (moduleTestStep) => {
                                            newTestCaseSteps.push(
                                                moduleTestStep
                                            )
                                        }
                                    )
                                    methodExists = true
                                } else {
                                    newTestCaseSteps.push(testCaseStep)
                                }
                            })

                            return {
                                testNode: {
                                    ...testNode.testNode,
                                    testCaseSteps: newTestCaseSteps,
                                },
                            }
                        })
                        new Module({
                            automationStatus: newModule.automationStatus,
                            projectID: newModule.projectID,
                            // company: req.body.company._id,
                            suiteName: newModule.suiteName,
                            businessProcess: newModule.businessProcess || null,
                            suiteDescription: newModule.suiteDescription,
                            initialTestNodes: methodExists
                                ? newModule.testNodes
                                : null,
                            testNodes: methodExists
                                ? newTestNodes
                                : newModule.testNodes,
                            testPlaceholders: newModule.testPlaceholders,
                            createdBy: req?.userId,
                            version,
                        }).save(async (err, newModule) => {
                            if (err) {
                            } else {
                                if (isAuditSave) {
                                    var chdataObj = {}
                                    if (
                                        req.body.automationStatus !=
                                        bddata.automationStatus
                                    ) {
                                        chdataObj.automationStatus =
                                            bddata.automationStatus
                                    }
                                    if (
                                        req.body.suiteName != bddata.suiteName
                                    ) {
                                        chdataObj.suiteName = bddata.suiteName
                                    }
                                    if (
                                        req.body.suiteDescription !=
                                        bddata.suiteDescription
                                    ) {
                                        chdataObj.suiteDescription =
                                            bddata.suiteDescription
                                    }
                                    if (
                                        req.body.suiteDescription !=
                                        bddata.suiteDescription
                                    ) {
                                        chdataObj.suiteDescription =
                                            bddata.suiteDescription
                                    }
                                    if (
                                        !equalsCheck(
                                            req.body.testNodes,
                                            bddata.testNodes
                                        )
                                    ) {
                                        chdataObj.testNodes = bddata.testNodes
                                    }
                                    chdataObj.version = version_b
                                    let auditsave = common.UserAudit(
                                        '64a7b2ea81b8b505b1ddddc9',
                                        'MODULE',
                                        '/createModule',
                                        'UPDATE',
                                        'SUCCESS',
                                        'Updated Successfully',
                                        '65e96b82c8e2b5059cf4512b',
                                        chdataObj
                                    )
                                }
                            }
                            responseTransformer.dbResponseTransformer(
                                err,
                                module,
                                'create module',
                                res
                            )
                        })
                    }
                )
            })
        })
    } catch (error) {
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

router.post('/v1/createModule', async (req, res) => {
    const warnings = []
    try {
        const project = await Project.findById(req.body.projectID)
        if (!project) {
            return res.status(404).json({ message: 'Project not found' })
        }

        responseTransformer.moduleValidation(req.body, async (err) => {
            responseTransformer.findByAndUpdateCb(
                err,
                req.body,
                'module validation',
                res,
                async (newModule) => {
                    const module = await Module.aggregate([
                        {
                            $match: {
                                projectID: req.body.projectID,
                                suiteName: newModule.suiteName,
                            },
                        },
                        { $sort: { createdAt: -1 } },
                    ])
                    let version = '0.01'
                    let version_b
                    let isAuditSave = false
                    let bddata
                    if (module.length != 0) {
                        bddata = module[0]
                        const prevModule = module[0]
                        if (prevModule?.version) {
                            version = parseFloat(prevModule?.version) + 0.01
                            version_b = prevModule?.version
                            isAuditSave = true
                        }
                    }
                    version = parseFloat(version).toFixed(2)

                    const outputVariables = []
                    const moduleTestSteps = project?.testCaseSteps?.toJSON()
                    const { testNodes } = newModule
                    let methodExists = false
                    const newTestNodes = testNodes?.map((testNode) => {
                        const { testCaseSteps } = testNode.testNode
                        const newTestCaseSteps = []
                        testCaseSteps?.forEach((testCaseStep) => {
                            newTestCaseSteps.push(testCaseStep)
                            if (testCaseStep?.module) {
                                const keys = Object.keys(testCaseStep?.module)
                                const methodName =
                                    testCaseStep?.module[keys[0]].methodName

                                moduleTestSteps[methodName]?.forEach(
                                    (moduleTestStep) => {
                                        const keys = Object.keys(moduleTestStep)
                                        if (keys.includes(KEYS.GETTEXT)) {
                                            const outputVariable =
                                                responseTransformer.findVal(
                                                    moduleTestStep,
                                                    KEYS.VARIABLENAME
                                                )
                                            outputVariables.push(outputVariable)
                                        }
                                    }
                                )
                                methodExists = true
                            } else {
                                newModule.testNodes.map((testNode) => {
                                    const { testCaseSteps } = testNode.testNode

                                    testCaseSteps.map((testCaseStep) => {
                                        newTestCaseSteps.push(testCaseStep)
                                        const keys = Object.keys(testCaseStep)

                                        if (keys.includes(KEYS.GETTEXT)) {
                                            const outputVariable =
                                                responseTransformer.findVal(
                                                    testCaseStep,
                                                    KEYS.VARIABLENAME
                                                )
                                            outputVariables.push(outputVariable)
                                        }
                                    })
                                })
                            }
                        })

                        return {
                            testNode: {
                                ...testNode.testNode,
                                testCaseSteps: newTestCaseSteps,
                            },
                        }
                    })

                    const moduleDoc = new Module({
                        automationStatus: newModule.automationStatus,
                        projectID: newModule.projectID,
                        company: req.body.company,
                        suiteName: newModule.suiteName,
                        businessProcess: newModule.businessProcess || null,
                        suiteDescription: newModule.suiteDescription,
                        initialTestNodes: null,
                        testNodes: newModule.testNodes,
                        testPlaceholders: newModule.testPlaceholders,
                        locatorProperties: newModule.locatorProperties,
                        outputVariables: [...new Set(outputVariables)],
                        createdBy: req?.userId,
                        version,
                    })

                    const savedModule = await moduleDoc.save()

                    // if (isAuditSave) {
                    //     try {
                    //         const chdataObj = {}

                    //         if (
                    //             req.body.automationStatus !==
                    //             bddata.automationStatus
                    //         )
                    //             chdataObj.automationStatus =
                    //                 bddata.automationStatus
                    //         if (req.body.suiteName !== bddata.suiteName)
                    //             chdataObj.suiteName = bddata.suiteName
                    //         if (
                    //             req.body.suiteDescription !==
                    //             bddata.suiteDescription
                    //         )
                    //             chdataObj.suiteDescription =
                    //                 bddata.suiteDescription
                    //         if (
                    //             !equalsCheck(
                    //                 req.body.testNodes,
                    //                 bddata.testNodes
                    //             )
                    //         )
                    //             chdataObj.testNodes = bddata.testNodes

                    //         chdataObj.version = version_b

                    //         await common.UserAudit(
                    //             '64a7b2ea81b8b505b1ddddc9',
                    //             'MODULE',
                    //             '/createModule',
                    //             'UPDATE',
                    //             'SUCCESS',
                    //             'Updated Successfully',
                    //             savedModule._id,
                    //             chdataObj
                    //         )
                    //     } catch (auditErr) {
                    //         warnings.push(auditErr)
                    //     }
                    // }

                    responseTransformer.dbResponseTransformer(
                        null,
                        savedModule,
                        'create module',
                        res
                    )
                }
            )
        })
    } catch (error) {
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

router.post('/parseTestCases', async (req, res) => {
    try {
        let formData = new FormData()
        const tempFilePath = 'tmp/temp-1-' + req.files.file.data.length

        if (
            req.files.file.tempFilePath !== undefined &&
            req.files.file.tempFilePath !== ''
        ) {
            formData.append(
                'file',
                fs.createReadStream(req.files.file.tempFilePath)
            )
        } else {
            var dir = './tmp'
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir)
            }
            fs.writeFileSync(tempFilePath, req.files.file.data, function (err) {
                if (err) throw err
            })

            formData.append('file', fs.createReadStream(tempFilePath))
        }

        await axios
            .post('http://localhost:8081/process', formData, {
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${formData.getBoundary()}`,
                },
            })
            .then((resp) => {
                res.send(resp.data)
                fs.unlink(tempFilePath, function (err) {
                    if (err) throw err
                })
            })
            .catch((err) => {
                res.status(400).json({ message: err?.message })
            })
    } catch (error) {
        logger.info(`Encountered issue while parsing test cases ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.post('/createTestCaseSteps', async (req, res) => {
    try {
        const newTestCaseSteps = req.body
        logger.info(`Saving test case steps body: ${req.body}`)
        new TestCaseSteps({
            companyID: newTestCaseSteps.companyID,
            projectID: newTestCaseSteps.projectID,
            testCaseSteps: newTestCaseSteps.testCaseSteps,
        }).save()
        res.json({})
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.get('/getTestCaseSteps/:companyId/:projectId', async (req, res) => {
    try {
        logger.info(`Fetching test case steps body: ${req.body}`)
        const testCaseSteps = await TestCaseSteps.find({
            companyId: req.params.companyId,
            projectId: req.params.projectId,
        })
        res.json(testCaseSteps ? testCaseSteps[0]?.methods : null)
    } catch (error) {
        logger.info(`Encountered issue while fetching ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//ALL Modules
router.get('/allModules', async (req, res) => {
    try {
        Module.aggregate(
            [
                {
                    $sort: {
                        updatedAt: -1,
                    },
                },
            ],
            (err, modules) =>
                responseTransformer.dbResponseTransformer(
                    err,
                    modules,
                    'list modules',
                    res
                )
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//ALL Modules
router.get('/allModules/:pid', async (req, res) => {
    try {
        Module.aggregate(
            [
                {
                    $sort: {
                        updatedAt: -1,
                    },
                },
                { $match: { projectID: req.params.pid } },
            ],
            (err, modules) =>
                responseTransformer.dbResponseTransformer(
                    err,
                    modules,
                    'list modules',
                    res
                )
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//Module Details
router.get('/Module/:id', async (req, res) => {
    try {
        Module.findById(req.params.id, (err, module) =>
            responseTransformer.dbResponseTransformer(
                err,
                module,
                'find module',
                res
            )
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//Modules by project ID
router.get('/ModulesByPID/:projectID', async (req, res) => {
    try {
        Module.aggregate(
            [
                { $match: { projectID: req.params.projectID } },
                { $sort: { createdAt: -1 } },
            ],
            (err, modules) => {
                let uniqueModules = []
                modules?.map((module) => {
                    const prevModule = uniqueModules?.find(
                        (uniqueModule) =>
                            uniqueModule.suiteName == module.suiteName
                    )
                    if (!prevModule) uniqueModules.push(module)
                })
                modules = uniqueModules.map((module) => {
                    const testCaseCount = module.testNodes.length
                    let testStepCount = 0
                    module.testNodes.map((testNode) => {
                        testStepCount +=
                            testNode.testNode[0].testCaseSteps.length
                    })
                    const newModule = {
                        ...module,
                        testCaseCount,
                        testStepCount,
                    }
                    return newModule
                })
                responseTransformer.dbResponseTransformer(
                    err,
                    modules,
                    'list modules by project id',
                    res
                )
            }
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//Modules with specific fields
router.get('/ModuleByPID/:projectID', async (req, res) => {
    try {
        Module.aggregate(
            [
                { $match: { projectID: req.params.projectID } },
                { $sort: { createdAt: -1 } },
            ],
            (err, modules) => {
                let uniqueModules = []
                modules?.map((module) => {
                    const prevModule = uniqueModules?.find(
                        (uniqueModule) =>
                            uniqueModule.suiteName == module.suiteName
                    )
                    if (!prevModule) uniqueModules.push(module)
                })
                modules = uniqueModules.map((module) => {
                    const testCaseCount = module.testNodes.length
                    let testStepCount = 0
                    module.testNodes.map((testNode) => {
                        testStepCount +=
                            testNode.testNode[0].testCaseSteps.length
                    })
                    const newModule = {
                        ...module,
                        testCaseCount,
                        testStepCount,
                    }
                    return newModule
                })
                responseTransformer.dbResponseTransformer(
                    err,
                    modules,
                    'list modules by project id',
                    res
                )
            }
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.get('/v1/ModuleByPID/:projectID', async (req, res) => {
    try {
        Module.aggregate(
            [
                { $match: { projectID: req.params.projectID } },
                { $sort: { createdAt: -1 } },
                {
                    $project: {
                        _id: 1,
                        projectID: 1,
                        suiteName: 1,
                        testNodes: 1,
                        updatedAt: 1,
                        createdAt: 1,
                    },
                },
            ],
            (err, modules) => {
                let uniqueModules = []
                modules?.map((module) => {
                    const prevModule = uniqueModules?.find(
                        (uniqueModule) =>
                            uniqueModule.suiteName == module.suiteName
                    )
                    if (!prevModule) uniqueModules.push(module)
                })
                modules = uniqueModules.map((module) => {
                    const testCaseCount = module.testNodes.length
                    let testStepCount = 0
                    module.testNodes.map((testNode) => {
                        testStepCount +=
                            testNode.testNode[0].testCaseSteps.length
                    })
                    const suiteName = module.suiteName
                    const _id = module._id
                    const projectid = module.projectID
                    const updatedAt = module.updatedAt
                    const createdAt = module.createdAt
                    const newModule = {
                        createdAt,
                        updatedAt,
                        _id,
                        projectid,
                        suiteName,
                        testCaseCount,
                        testStepCount,
                    }
                    return newModule
                })

                responseTransformer.dbResponseTransformer(
                    err,
                    modules,
                    'list modules by project id',
                    res
                )
            }
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//Modules filter with specific fields
// router.get(
//     '/v2/ModuleByPID/:projectID/:userId/:SortBy/:rowsPerPage/:pageNo',
//     async (req, res) => {
//         try {
//             let sortquery = { updatedAt: -1 }
//             switch (req.params.SortBy) {
//                 case 'Name_ASC':
//                     sortquery = { Name: 1 }
//                     break
//                 case 'Name_DSC':
//                     sortquery = { Name: -1 }
//                     break
//                 case 'Status_ASC':
//                     sortquery = { status: 1 }
//                     break
//                 case 'Status_DSC':
//                     sortquery = { status: -1 }
//                     break
//                 case 'LastActivity_ASC':
//                     sortquery = { updatedAt: 1 }
//                     break
//                 case 'LastActivity_DSC':
//                     sortquery = { updatedAt: -1 }
//                     break
//                 default:
//                     sortquery = { updatedAt: -1 }
//             }
//             console.log(
//                 ' req.params.pageNo',
//                 req.params.pageNo,
//                 typeof req.params.pageNo
//             )
//             const skipno =
//                 parseInt(req.params.pageNo) * parseInt(req.params.rowsPerPage)
//             console.log('skipno', skipno)
//             const limitno = parseInt(req.params.rowsPerPage)
//             console.log('limitno', limitno)
//             const filterText = JSON.parse(
//                 `{"$and":[{"projectID":"${req.params.projectID}, "createdBy":"${req.params.userId}""}]}`
//             )
//             console.log('filterText', filterText)
//             const totalcount = await Module.countDocuments(filterText)
//             console.log('totalcount', totalcount)
//             Module.aggregate(
//                 [
//                     { $match: { projectID: req.params.projectID } },
//                     { $sort: { createdAt: -1 } },
//                     // { $skip: parseInt(0, req.params.rowsPerPage) },
//                     // {
//                     //     $limit: parseInt(
//                     //         req.params.rowsPerPage,
//                     //         req.params.rowsPerPage
//                     //     ),
//                     // },
//                 ],
//                 async (err, modules) => {
//                     let uniqueModules = []

//                     modules?.map((module) => {
//                         const prevModule = uniqueModules?.find(
//                             (uniqueModule) =>
//                                 uniqueModule.suiteName == module.suiteName
//                         )
//                         if (!prevModule) uniqueModules.push(module)
//                     })
//                     modules = await responseTransformer.getModulesDataWithSteps(
//                         uniqueModules,
//                         req.params.projectID,
//                         null,
//                         null
//                     )

//                     responseTransformer.dbResponseTransformer(
//                         err,
//                         modules,
//                         'list modules by project id',
//                         res
//                     )
//                 }
//             )
//         } catch (error) {
//             res.send({ status: 400, message: 'Bad Request', data: error })
//         }
//     }
// )

//Modules with specific fields
router.get('/v2/ModuleByPID/:projectID', async (req, res) => {
    try {
        let uniqueModules = await Module.aggregate([
            { $match: { projectID: req.params.projectID } },
            {
                $group: {
                    _id: '$suiteName',
                    doc: { $last: '$$ROOT' }, // After sorting, the last one is the latest version
                },
            },
            {
                $replaceRoot: { newRoot: '$doc' },
            },
            { $sort: { createdAt: -1 } },
        ])

        // async (err, modules) => {
        //     let uniqueModules = []

        //     modules?.map((module) => {
        //         const prevModule = uniqueModules?.find(
        //             (uniqueModule) =>
        //                 uniqueModule.suiteName == module.suiteName
        //         )
        //         if (!prevModule) uniqueModules.push(module)
        //     })
        const modulesWithCounts =
            await responseTransformer.getModulesDataWithSteps(
                uniqueModules,
                req.params.projectID,
                null,
                null
            )
        responseTransformer.dbResponseTransformer(
            null,
            modulesWithCounts,
            'list modules by project id',
            res
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//Modules with enhanced Pagination
router.get(
    '/v2/ModuleByPID/:projectID/:SortBy/:order/:pagesize/:pageno',
    async (req, res) => {
        try {
            const { projectID, SortBy, order, pagesize, pageno } = req.params
            const sortOrder = order === 'asc' ? 1 : -1
            const skip = parseInt(pageno) * parseInt(pagesize)
            const limit = parseInt(pagesize)
            const sortMap = {
                suiteName: { suiteName: sortOrder },
                businessProcess: { businessProcess: sortOrder },
            }
            const sortquery = sortMap[SortBy] || { createdAt: -1 }
            let uniqueModules = await Module.aggregate([
                { $match: { projectID } },
                {
                    $group: {
                        _id: '$suiteName',
                        doc: { $last: '$$ROOT' },
                    },
                },
                { $replaceRoot: { newRoot: '$doc' } },
                { $sort: sortquery },
            ])
            const totalCountRes = await Module.aggregate([
                { $match: { projectID } },
                {
                    $group: {
                        _id: '$suiteName',
                    },
                },
                { $count: 'total' },
            ])
            const totalCount = totalCountRes[0]?.total || 0
            const modulesWithCounts =
                await responseTransformer.getModulesDataWithSteps(
                    uniqueModules,
                    projectID,
                    null,
                    null
                )
            // Optional: sort by test counts in memory
            if (SortBy === 'testCaseCount') {
                modulesWithCounts.sort(
                    (a, b) => sortOrder * (a.testCaseCount - b.testCaseCount)
                )
            } else if (SortBy === 'testStepCount') {
                modulesWithCounts.sort(
                    (a, b) => sortOrder * (a.testStepCount - b.testStepCount)
                )
            }
            const paginatedModules = modulesWithCounts?.slice(
                skip,
                skip + limit
            )
            // const totalPages = Math.ceil(totalcount / limit)
            responseTransformer.dbResponseTransformer(
                null,
                paginatedModules,
                'list modules by project id',
                res,
                totalCount
            )
        } catch (error) {
            logger.info(
                `Encountered issue while fetching module by pid with pagination ${error}`
            )
            res.send({ status: 400, message: 'Bad Request', data: error })
        }
    }
)
// TestCases Pagination
router.get(
    '/v2/ModuleByPID/:projectID/:moduleID/:SortBy/:order/:pagesize/:pageno',
    async (req, res) => {
        try {
            const { projectID, moduleID, SortBy, order, pagesize, pageno } =
                req.params
            const sortOrder = order === 'asc' ? 1 : -1
            const limit = parseInt(pagesize)
            const skip = parseInt((pageno - 1) * limit)
            const sortMap = {
                suiteName: { suiteName: sortOrder },
            }
            const sortquery = sortMap[SortBy] || { createdAt: -1 }
            let uniqueModules = await Module.aggregate([
                {
                    $match: {
                        projectID,
                        _id: new ObjectId(moduleID.toString()),
                    },
                },
                {
                    $group: {
                        _id: '$suiteName',
                        doc: { $last: '$$ROOT' },
                    },
                },
                { $replaceRoot: { newRoot: '$doc' } },
                { $sort: sortquery },
            ])
            const modulesWithCounts =
                await responseTransformer.getModulesDataWithSteps(
                    uniqueModules,
                    projectID,
                    null,
                    null
                )
            let module = await Module.findById(moduleID, {
                testNodes: { $slice: [skip, limit] },
            })
            const data = JSON.parse(JSON.stringify(modulesWithCounts[0]))
            ;[module] = await responseTransformer.getModulesDataWithSteps(
                [module],
                projectID,
                null,
                null
            )
            module = {
                ...JSON.parse(JSON.stringify(module)),
                totalpages: data.totalpages,
                testCaseCount: data.testCaseCount,
                testStepCount: data.testStepCount,
            }

            res.send({
                status: 200,
                message: 'Success',
                response: module,
            })
        } catch (error) {
            logger.info(
                `Encountered issue while fetching module by pid and mid ${error}`
            )
            res.send({ status: 400, message: 'Bad Request', data: error })
        }
    }
)

//Modules by required feilds project ID
router.get('/v1/ModuleDetails/:id/:limit', async (req, res) => {
    try {
        if (req.params.limit == 'All') {
            Module.aggregate(
                [
                    { $match: { projectID: req.params.id } },
                    { $sort: { createdAt: -1 } },
                    // { $project: { _id:1,projectID:1,suiteName:1,suiteDescription:1,testNodes:1,updatedAt:1,updatedBy:1 } },
                ],
                (err, modules) => {
                    let uniqueModules = []
                    modules?.map((module) => {
                        const prevModule = uniqueModules?.find(
                            (uniqueModule) =>
                                uniqueModule.suiteName == module.suiteName
                        )
                        if (!prevModule) uniqueModules.push(module)
                    })
                    modules = uniqueModules.map((module) => {
                        const testCaseCount = module.testNodes.length
                        let testStepCount = 0
                        module.testNodes.map((testNode) => {
                            testStepCount +=
                                testNode.testNode[0].testCaseSteps.length
                        })

                        const newModule = {
                            ...module,
                            testCaseCount,
                            testStepCount,
                        }
                        return newModule
                    })

                    responseTransformer.dbResponseTransformer(
                        err,
                        modules,
                        'list modules by project id',
                        res
                    )
                }
            )
        } else {
            Module.findById(
                req.params.id,
                {
                    _id: 1,
                    projectID: 1,
                    suiteName: 1,
                    suiteDescription: 1,
                    testNodes: 1,
                    updatedAt: 1,
                    updatedBy: 1,
                },
                async (err, module) => {
                    if (module) {
                        const testCaseCount = module.testNodes.length
                        let testStepCount = 0
                        module.testNodes.map((testNode) => {
                            testStepCount +=
                                testNode.testNode[0].testCaseSteps.length
                        })
                        const resp = {
                            module,
                            testCaseCount,
                            testStepCount,
                        }
                        responseTransformer.dbResponseTransformer(
                            err,
                            resp,
                            'get module',
                            res
                        )
                        // res.send({ status: 400, message: 'No Module not found', data: resp })
                    } else {
                        res.send({
                            status: 400,
                            message: 'No Module not found',
                            data: '',
                        })
                    }
                }
            )
        }
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.patch('/Module/update/:id', async (req, res) => {
    try {
        Project.findById(req.body.projectID, (err, project) => {
            responseTransformer.moduleValidation(req.body, (err) => {
                responseTransformer.findByAndUpdateCb(
                    err,
                    project,
                    'validate module',
                    res,
                    (prevProject) => {
                        Module.findById(req.params.id, (err, module) => {
                            responseTransformer.findByAndUpdateCb(
                                err,
                                module,
                                'update module',
                                res,
                                (prevModule) => {
                                    Module.findByIdAndUpdate(
                                        req.params.id,
                                        {
                                            projectID: req.body.projectID,
                                            suiteName: req.body.suiteName,
                                            suiteDescription:
                                                req.body.suiteDescription,
                                            testNodes: req.body.testNodes,
                                            testPlaceholders:
                                                req.body.testPlaceholders,
                                            createdBy: prevModule?.createdBy,
                                            updatedBy: req.userId,
                                        },
                                        (err, module) =>
                                            responseTransformer.dbResponseTransformer(
                                                err,
                                                module,
                                                'create module',
                                                res
                                            )
                                    )
                                    var chdataObj = {}
                                    if (
                                        req.body.automationStatus !=
                                        prevModule.automationStatus
                                    ) {
                                        chdataObj.automationStatus =
                                            prevModule.automationStatus
                                    }
                                    if (
                                        req.body.suiteName !=
                                        prevModule.suiteName
                                    ) {
                                        chdataObj.suiteName =
                                            prevModule.suiteName
                                    }
                                    if (
                                        req.body.suiteDescription !=
                                        prevModule.suiteDescription
                                    ) {
                                        chdataObj.suiteDescription =
                                            prevModule.suiteDescription
                                    }
                                    if (
                                        req.body.suiteDescription !=
                                        prevModule.suiteDescription
                                    ) {
                                        chdataObj.suiteDescription =
                                            prevModule.suiteDescription
                                    }
                                    if (
                                        !equalsCheck(
                                            req.body.testNodes,
                                            prevModule.testNodes
                                        )
                                    ) {
                                        chdataObj.testNodes =
                                            prevProject.testNodes
                                    }
                                    if (
                                        !equalsCheck(
                                            req.body.testPlaceholders,
                                            prevModule.testPlaceholders
                                        )
                                    ) {
                                        chdataObj.testPlaceholders =
                                            prevProject.testPlaceholders
                                    }
                                    let auditsave = common.UserAudit(
                                        '64a7b2ea81b8b505b1ddddc9',
                                        'MODULE',
                                        '/Module/update/' + req.params.id,
                                        'UPDATE',
                                        'SUCCESS',
                                        'Updated Successfully',
                                        req.params.id,
                                        chdataObj,
                                        prevModule.company
                                    )
                                }
                            )
                        })
                    }
                )
            })
        })
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//Delete Module
router.delete('/Module/delete/:id', async (req, res) => {
    try {
        const release = await Release.find({
            'modules.moduleID': req.params.id,
        })
        // , (err, release) => {
        if (release != null && release?.length !== 0) {
            const response = {
                status: 201,
                message: "Release exists for this module. Can't delete.",
            }
            responseTransformer.dbResponseTransformer(
                null,
                response,
                'deleting module',
                res
            )
        } else {
            // const deletedModule = await Module.findById(req.params.id)
            // , (err, deletedModule) => {
            const deletedModule = await Module.findByIdAndDelete(req.params.id)
            if (!deletedModule) {
                return res.status(404).json({ message: 'Module not found' })
            }
            res.status(200).json({ message: 'Module deleted successfully' })
            // Module.remove({ _id: req.params.id }, (err, module) => {
            //     AuditCreation.upsertAuditLog(
            //         deletedModule.collection.collectionName,
            //         'delete',
            //         req.body?.email,
            //         req.body?.company,
            //         deletedModule,
            //         null
            //     )
            //     const response = {
            //         status: 200,
            //         message: 'Module deleted successfully.',
            //     }
            //     responseTransformer.dbResponseTransformer(
            //         null,
            //         response,
            //         'deleting module',
            //         res
            //     )
            // })
            // })
        }
        // })
        // Module.findById(req.params.id, (err, deletedModule) => {
        //     // Module.remove({ _id: req.params.id }, (err, module) => {
        //     //   AuditCreation.upsertAuditLog(
        //     //     deletedModule.collection.collectionName,
        //     //     "delete",
        //     //     req.body?.email,
        //     //     req.body?.company,
        //     //     deletedModule,
        //     //     null
        //     //   );
        //     //   responseTransformer.dbResponseTransformer(
        //     //     err,
        //     //     module,
        //     //     "deleting module",
        //     //     res
        //     //   );
        //     // });
        // })
    } catch (error) {
        logger.info(`Encountered issue while deleting module ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//Get Modules By Project ID
router.get('/Project/:id/Modules', async (req, res) => {
    try {
        Module.find({ projectID: req.params.id }, (err, module) =>
            responseTransformer.dbResponseTransformer(
                err,
                module,
                'get module',
                res
            )
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.get('/getModuleJson/:id', async (req, res) => {
    try {
        const moduleId = req.params.id
        const module = await Module.findById(moduleId)
        if (module) {
            const newModule = {}
            const { testNodes } = module
            const tNodes = testNodes?.map((testNode, index) => {
                const tNode = {}

                const testCaseSteps = testNode.testNode[0].testCaseSteps.map(
                    (testCaseStep) => {
                        const { _id, ...rest } = testCaseStep.toObject
                            ? testCaseStep.toObject()
                            : testCaseStep
                        return rest
                    }
                )

                tNode.testCaseID = testNode.testNode[0].testCaseID
                tNode.testCaseTitle = testNode.testNode[0].testCaseTitle
                tNode.testCaseDescription =
                    testNode.testNode[0].testCaseDescription
                tNode.dependsOn = testNode.testNode[0].dependsOn
                tNode.tags = testNode.testNode[0].tags
                tNode.priority = testNode.testNode[0].priority
                tNode.testCaseSteps = testCaseSteps

                return { testNode: tNode }
            })

            newModule.suiteName = module?.suiteName
            newModule.suiteDescription = module?.suiteDescription
            newModule.testCases = tNodes
            res.json(newModule)
        } else res.json({ message: 'Module not found' })
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

/**JSON validations */
router.get('/getValidations', async (req, res) => {
    try {
        logger.info(`Finding validations`)

        const validations = await Validation.find({})
        responseTransformer.projectTransformer(null, validations, false, res)
    } catch (error) {
        logger.info(`Error while fetching validations ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.post('/createTemplate', async (req, res) => {
    try {
        logger.info(`Creating a Template: ${req}`)
        Template.findOne({ name: req.body.name }, (err, dbTemplate) => {
            responseTransformer.passthroughError(
                err,
                dbTemplate,
                'existing template check',
                res,
                (dbTemplate) => {
                    if (dbTemplate) {
                        logger.info(`Template already exists`)
                        res.status(400).send({
                            status: 'error',
                            result: 'Template already exists',
                        })
                    } else {
                        new Template({
                            name: req.body.name,
                            endpoint: req.body.endpoint,
                            username: req.body.username,
                            password: req.body.password,
                            auth: req.body.auth,
                            companyID: req.body.companyID,
                            createdBy: req.body.createdBy,
                            updatedBy: req.body.updatedBy,
                        }).save((err, template) =>
                            responseTransformer.dbResponseTransformer(
                                err,
                                template,
                                'saving template',
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

router.get('/getTemplates', async (req, res) => {
    try {
        logger.info(`Finding Template`)
        Template.find({}, (err, templates) => {
            res.json(templates)
        })
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.get('/getTemplates/:companyId', async (req, res) => {
    try {
        logger.info(`Finding Template`)
        const templates = await Template.find({
            companyID: req.params.companyId,
        })
        res.json(templates)
    } catch (error) {
        logger.info(`Error while fetching all templates ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.post('/v1/getProjectAudits', async (req, res) => {
    try {
        let body = req.body
        if (!body.UserId) {
            res.send({ status: 204, message: 'User Id Required', data: '' })
        } else {
            userAudit.find({ action: 'PROJECT' }, (err, audits) => {
                if (err) {
                    res.send({
                        status: 400,
                        message: 'Some thing went wrong',
                        data: err,
                    })
                } else {
                    if (audits.length > 0) {
                        res.send({
                            status: 200,
                            message: 'Data Available',
                            data: audits,
                        })
                    } else {
                        res.send({
                            status: 204,
                            message: 'Data Not Available',
                            data: '',
                        })
                    }
                }
            })
        }
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

module.exports = router
