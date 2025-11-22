const User = require('../Models/User')
const logger = require('../utils/logger')
const { Module } = require('../Models/Module')
const mongoose = require('mongoose')
const Project = require('../Models/Project')
const Company = require('../Models/Company')
const Role = require('../Models/Role')
const { JobStatus, ExcludeKeys } = require('./Constants')
const moment = require('moment')
const TestCaseSteps = require('../Models/TestCaseSteps')
const SMB2 = require('@marsaud/smb2')
const path = require('path')
const { promisify } = require('util')

const dbResponseTransformer = (
    err,
    response,
    action,
    httpResponse,
    totalCount
) => {
    if (err) {
        logger.error(`Error while performing action: ${action}`, {
            stack: err.stack,
        })
        httpResponse
            .status(201)
            .json({ message: err.message, errors: Object.keys(err.errors) })
    } else if (!response) {
        logger.warn(
            `Unable to locate the details in database for action: ${action}`
        )
        httpResponse.status(404).json({ message: 'Not found' })
    } else {
        logger.info(
            `Successfully completed action: ${action}, response: ${response}`
        )
        const data = {
            response,
            totalCount,
        }
        httpResponse.json(data)
    }
}

const projectFilter = (req) => {
    const filter = [{ $sort: { updatedAt: -1 } }]
    if (!!req?.userId && !req?.params?.companyId) {
        logger.info('Applying filter for curent user')
        filter.push({ $match: { team: req.userId } })
    } else if (!req?.userId && !!req?.params?.companyId) {
        logger.info('Applying filter for current company')
        filter.push({ $match: { company: req.params.companyId } })
    } else if (
        !!req?.userId &&
        !!req?.params?.companyId &&
        req?.params.status
    ) {
        logger.info('Applying filter for current user & company')
        filter.push({
            $match: {
                team: req.userId,
                company: req.params.companyId,
                status: req.params.status,
                // rowsPerPage: req.params.rowsPerPage,
            },
        })
        filter.push({ $skip: parseInt(0, req.params.rowsPerPage) })
        filter.push({
            $limit: parseInt(req.params.rowsPerPage, req.params.rowsPerPage),
        })
    }
    return filter
}

const projectTransformer = async (err, projects, findOne, res) => {
    if (err) {
        logger.error(`Error while listing projects`, { stack: err.stack })
        res.status(400).json({ message: err.message })
    } else if (!projects) {
        logger.warn('Project not found')
        res.status(404).json({ message: 'Project not found' })
    } else {
        const userIds = projects.flatMap((p) => p.team)
        const users = await User.find({ _id: { $in: userIds } })

        // if (!users || users.length === 0) {
        //     return res.status(404).json({ message: `User(s) not found` })
        // }

        const projectIds = projects.map((p) => p._id)
        const modules = await Module.find({ projectID: { $in: projectIds } })

        // if (!modules || modules.length === 0) {
        //     return res.status(404).json({ message: `Module(s) not found` })
        // }

        const modulesMap = new Map(
            modules.map((m) => [m.projectID.toString(), m])
        )

        const usersMap = new Map(users.map((u) => [u._id.toString(), u]))

        const enrichedProjects = projects.map((p) => {
            const pc = JSON.parse(JSON.stringify(p))

            // Count unique suiteNames per project
            const projectModules = modules.filter(
                (module) => module.projectID.toString() === p._id.toString()
            )

            const uniqueSuiteNames = [
                ...new Set(projectModules.map((item) => item.suiteName)),
            ]

            pc.modulesCount = uniqueSuiteNames.length

            // Populate team with full user objects
            if (pc.team) {
                pc.team = p.team.map((uid) => usersMap.get(uid))
            }

            // Set archived flag from status
            if (pc.status) {
                pc.archived = p.status === 'ARCHIVED'
            }

            // Re-assign templateID if present
            if (pc.templateID) {
                p.templateID = pc.templateID
            }

            // Generate suite name variants
            if (pc.suiteNames) {
                pc.generatedSuiteNames = []
                pc.suiteNames.forEach((suiteName) => {
                    pc.generatedSuiteNames.push(suiteName.replaceAll(' ', ''))
                    pc.generatedSuiteNames.push(suiteName.replaceAll(' ', '_'))
                    pc.generatedSuiteNames.push(
                        suiteName.replaceAll(/[^A-Z]+/g, '')
                    )
                })
            }

            return pc
        })

        res.json(findOne ? enrichedProjects[0] : enrichedProjects)
    }
}
const projectTransformer_v1 = async (
    err,
    projects,
    findOne,
    res,
    totalCount
) => {
    if (err) {
        logger.error(`Error while listing projects`, { stack: err.stack })
        res.status(400).json({ message: err.message })
    } else if (!projects) {
        logger.warn('Project not found')
        res.status(404).json({ message: 'Project not found' })
    } else {
        const users = await User.find(
            { _id: { $in: projects.flatMap((p) => p.team) } },
            { _id: 1, firstName: 1, lastName: 1, status: 1 }
        )

        // if (!users || users.length === 0) {
        //     return res.status(404).json({ message: `User(s) not found` })
        // }

        const modules = await Module.find(
            { projectID: { $in: projects.flatMap((p) => p._id) } },
            { _id: 1, projectID: 1, suiteName: 1 }
        )

        // if (!modules || modules.length === 0) {
        //     return res.status(404).json({ message: `Module(s) not found` })
        // }

        const companies = await Company.find({})

        const modulesMap = new Map(
            modules.map((m) => [m.projectID.toString(), m])
        )
        const usersMap = new Map(users.map((u) => [u._id.toString(), u]))
        const companiesMap = new Map(
            companies.map((c) => [c._id.toString(), c])
        )

        const enrichedProjects = projects.map((p) => {
            const pc = JSON.parse(JSON.stringify(p))

            // Handle modules
            const modulesCount = modules.filter(
                (module) => module.projectID.toString() === p._id.toString()
            )

            const unique = [
                ...new Set(modulesCount.map((item) => item.suiteName)),
            ]
            pc.modulesCount = unique.length

            // Handle team
            if (pc.team) {
                pc.team = p.team.map((uid) => usersMap.get(uid))
            }

            // Handle company
            if (pc.company) {
                pc.company = companiesMap.get(p.company)
            }

            // Handle status
            if (pc.status) {
                pc.archived = p.status === 'ARCHIVED'
            }

            // Handle templateID
            if (pc.templateID) {
                p.templateID = pc.templateID
            }

            // Generate suite names
            if (pc.suiteNames) {
                pc.generatedSuiteNames = []
                pc.suiteNames.forEach((suiteName) => {
                    pc.generatedSuiteNames.push(suiteName.replaceAll(' ', ''))
                    pc.generatedSuiteNames.push(suiteName.replaceAll(' ', '_'))
                    pc.generatedSuiteNames.push(
                        suiteName.replaceAll(/[^A-Z]+/g, '')
                    )
                })
            }

            return pc
        })

        const data = {
            data: findOne ? enrichedProjects[0] : enrichedProjects,
            totalCount,
        }
        res.json(data)
        // res.json(findOne ? enrichedProjects[0] : enrichedProjects)
    }
}

// Fetch All Active projects in a company

const projectTransformer_v2 = async (req, res) => {
    const projects = await Project.find({
        company: { $eq: req.params.companyId + '' },
        status: { $eq: req.params.status + '' },
    })
    res.json(projects)
}

const userTransformer = async (err, users, findOne, res) => {
    if (err) {
        logger.error(`Error while listing users`, { stack: err.stack })
        res.status(400).json({ message: err.message })
    } else if (!users) {
        logger.warn('User not found')
        res.status(404).json({ message: 'users not found' })
    } else {
        const companyIds = users.flatMap((u) => u.company)
        const companies = await Company.find({ _id: { $in: companyIds } })

        if (!companies || companies.length === 0) {
            return res.status(404).json({ message: 'Companies not found' })
        }

        const companiesMap = new Map(
            companies.map((c) => [c._id.toString(), c])
        )

        const roleIds = users.flatMap((u) => u.role)
        const roles = await Role.find({ _id: { $in: roleIds } })

        const rolesMap = new Map(roles.map((r) => [r._id.toString(), r]))

        const enrichedUsers = users.map((u) => {
            const user = JSON.parse(JSON.stringify(u))

            if (user.company) {
                user.company = companiesMap.get(u.company?.toString())
            }

            if (user.role) {
                user.role = rolesMap.get(u.role?.toString())
            }

            return user
        })

        res.json(enrichedUsers)
    }
}

const findByAndUpdateCb = (err, response, action, httpResponse, callback) => {
    if (err) {
        logger.error(`Error while performing action: ${action}`, {
            stack: err.stack,
        })
        httpResponse.status(201).json({ message: err.message })
    } else if (!response) {
        logger.warn(
            `Unable to locate the details in database for action: ${action}`
        )
        httpResponse.status(404).json({ message: 'Not found' })
    } else {
        callback(response)
    }
}

const passthroughError = (err, response, action, httpResponse, callback) => {
    if (err) {
        logger.error(`Error while performing action: ${action}`, {
            stack: err.stack,
        })
        httpResponse.status(400).json({ message: err.message })
    } else {
        callback(response)
    }
}

const projectValidation = async function (project) {
    logger.info(`Pre save project hook: ${JSON.stringify(project)}`)

    const invalidUIDs = []

    for (const uid of project.team || []) {
        logger.info(`Validating UID: ${uid}`)

        if (!mongoose.Types.ObjectId.isValid(uid)) {
            invalidUIDs.push(uid)
            continue
        }

        try {
            const user = await User.findById(uid)
            if (!user) {
                invalidUIDs.push(uid)
            }
        } catch (err) {
            logger.warn(`Error while fetching user ${uid}:`, err)
            invalidUIDs.push(uid)
        }
    }

    if (invalidUIDs.length > 0) {
        throw {
            message: `Invalid user IDs: ${invalidUIDs.join(', ')}`,
        }
    }

    return project
}

const moduleValidation = async function (module, callback) {
    try {
        const project = await Project.findById(module.projectID)

        if (!project) {
            return callback({
                message: `Project ID ${module.projectID} not found`,
            })
        }

        callback() // success
    } catch (err) {
        callback({
            message: `Error fetching project ID ${module.projectID}`,
            error: err.message,
        })
    }
}

const releaseValidation = function (release, callback) {
    const errors = []
    const invalid = new Map()
    const addToInvalid = function (moduleID, tid) {
        if (invalid.has(moduleID)) invalid.get(moduleID).push(tid)
        else invalid.set(moduleID, [tid])
    }

    const checkModules = function (index) {
        logger.info(`Checking module with index ${index}`)
        if (index < release.modules.length) {
            const module = release.modules[index]
            const mid = module.moduleID
            if (!mongoose.Types.ObjectId.isValid(mid)) {
                logger.info(
                    `Invalid module id ${mid}, adding all test nodes to invalid`
                )
                errors.push(`invalid module id '${mid}'`)
                checkModules(index + 1)
            } else {
                Module.findById(mid, (err, m) => {
                    if (err || m === null) {
                        logger.warn(
                            `Invalid module id ${mid}, adding all test nodes to invalid`
                        )
                        errors.push(`module id not found '${mid}'`)
                    } else {
                        logger.info(`Valid ${mid}, checking test cases`)
                        const validTID = m.testNodes.map((tc) => tc._id)
                        module.testNodes.forEach((tid) => {
                            if (!validTID.includes(tid)) {
                                errors.push(
                                    `test node id '${tid}' does not belong to module id '${mid}'`
                                )
                            }
                        })
                    }
                    checkModules(index + 1)
                })
            }
        } else {
            if (errors.length > 0) {
                logger.warn(`All modules check completed, error callback`)
                callback({
                    message: `Release fails validation constraints: ${errors.join(', ')}`,
                })
            } else {
                logger.info(`All modules check completed, success callback`)
                callback(null, release)
            }
        }
    }
    checkModules(0)
}

const testCaseStepsValidation = function (module, callback) {
    Project.findById(module.projectID, (err, project) => {
        if (err || !project) {
            callback({
                message: `Project ID ${module.projectID} not found`,
            })
        }
        callback()
    })
}

const getCircularReplacer = () => {
    const seen = new WeakSet()
    return (key, value) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return
            }
            seen.add(value)
        }
        return value
    }
}

const getStatusCounts = (testRun) => {
    let percentage = 0
    let total = 0
    let untested = 0
    let passed = 0
    let failed = 0
    let skipped = 0
    testRun?.map((module) => {
        const { testNodes } = module
        if (testNodes) {
            total += parseInt(testNodes?.length, 10)
            untested += testNodes?.filter(
                (testNode) => testNode.status === 'UNTESTED'
            ).length
            passed += testNodes?.filter(
                (testNode) => testNode.status === 'PASSED'
            ).length
            skipped += testNodes?.filter(
                (testNode) => testNode.status === 'SKIPPED'
            ).length
            failed += testNodes?.filter(
                (testNode) => testNode.status === 'FAILED'
            ).length
        } else {
            logger.warn('testRun object is undefined')
        }
    })
    percentage = parseInt((passed / total) * 100, 10)
    return { total, untested, passed, skipped, failed, percentage }
}

const getReleaseStatusCounts = (statusCounts) => {
    let percentage = 0
    let total = 0
    let untested = 0
    let passed = 0
    let failed = 0
    let skipped = 0
    statusCounts?.forEach((statusCount) => {
        untested += statusCount?.untested
        passed += statusCount?.passed
        failed += statusCount?.failed
        skipped += statusCount?.skipped
        total += statusCount?.total
    })
    percentage = parseInt((passed / total) * 100, 10)
    return { total, untested, passed, skipped, failed, percentage }
}

const getTestRunModule = (module, ids) => {
    let newModule = {}
    newModule.moduleID = module._id.toString()
    newModule.status = JobStatus.UNTESTED
    const { testNodes } = module
    const newTestNodes = testNodes?.map((testNode) => {
        const _id = testNode._id
        const tNode = testNode.testNode[0]
        const newTestNode = {}
        const tSteps = tNode?.testCaseSteps?.map((testCaseStep) => {
            let newTestStep = {}
            newTestStep._id = testCaseStep?._id
            newTestStep.status = JobStatus.UNTESTED
            return newTestStep
        })
        newTestNode.testNodeID = _id
        newTestNode.status = JobStatus.UNTESTED
        newTestNode.testCaseSteps = tSteps
        return newTestNode
    })
    newModule.testNodes = newTestNodes?.filter((newTestNode) =>
        ids.includes(newTestNode.testNodeID.toString())
    )
    return newModule
}

const getTestRunModuleWithSteps = async (module, ids, tags, dependsOn) => {
    const project = await Project.findById(module.projectID)
    let methods
    let methodSteps
    if (project?.methods && project?.methods?.length !== 0) {
        methods = project?.methods.sort((a, b) => b.version - a.version)[0]
        methodSteps = methods?.testCaseSteps
    }
    let newModule = {}
    newModule.moduleID = module._id.toString()
    newModule.status = JobStatus.UNTESTED
    const { testNodes } = module
    const newTestNodes = testNodes?.map((testNode) => {
        const _id = testNode._id
        const tNode = testNode.testNode[0]
        const newTestNode = {}
        const tSteps = tNode?.testCaseSteps?.map((testCaseStep) => {
            const newTestCaseSteps = []

            testCaseStep = JSON.parse(JSON.stringify(testCaseStep))

            if (Object.keys(testCaseStep).includes('module') && methodSteps) {
                const methodName = testCaseStep?.module['call'].methodName

                const testCaseSteps = methodSteps.find(
                    (step) => step.name === methodName
                )

                testCaseSteps?.testCaseSteps?.forEach((moduleTestStep) => {
                    let newTestStep = {}
                    newTestStep._id = moduleTestStep?._id
                    newTestStep.status = JobStatus.UNTESTED
                    newTestCaseSteps.push(newTestStep)
                })
            } else {
                let newTestStep = {}
                newTestStep._id = testCaseStep?._id.toString()
                newTestStep.status = JobStatus.UNTESTED
                newTestCaseSteps.push(newTestStep)
            }

            return newTestCaseSteps
        })
        newTestNode.testNodeID = _id
        newTestNode.status = JobStatus.UNTESTED
        newTestNode.testCaseSteps = tSteps.flat()
        return newTestNode
    })
    newModule.tags = tags
    newModule.dependsOn = dependsOn
    newModule.testNodes = newTestNodes?.filter((newTestNode) =>
        ids.includes(newTestNode.testNodeID.toString())
    )
    return newModule
}

const getModuleStatusCounts = (modules, releasetestnodes, job) => {
    let formattedDuration = ''
    let testNodes = []
    let statusCounts
    let counts = []
    for (let mt = 0; mt < modules[0].testNodes.length; mt++) {
        for (let rtn = 0; rtn < releasetestnodes.length; rtn++) {
            if (releasetestnodes[rtn] == modules[0].testNodes[mt]._id) {
                let formattedDuration = ''
                if (job?.testRun[0]?.testNodes[rtn]?.executionDuration) {
                    const exeduration = new Date(
                        job.testRun[0].testNodes[rtn].executionDuration
                    )
                    formattedDuration =
                        parseInt(exeduration.getMinutes(), 10) !== 0
                            ? moment(exeduration).format('m[m] s[s]')
                            : moment(exeduration).format('s[s]')
                }
                let testStepStatuses = []
                if (job) {
                    testStepStatuses =
                        job.testRun[0].testNodes[rtn]?.testCaseSteps
                } else {
                    testStepStatuses =
                        modules[0].testNodes[mt].testNode[0].testCaseSteps
                }
                testNodes.push({
                    _id: modules[0].testNodes[mt].testNode[0]._id,
                    id: `${modules[0].testNodes[mt].testNode[0]._id}`,
                    suiteName: modules[0].suiteName,
                    testCaseTitle:
                        modules[0].testNodes[mt].testNode[0].testCaseTitle,
                    testCaseDescription:
                        modules[0].testNodes[mt].testNode[0]
                            .testCaseDescription,
                    testCaseID: modules[0].testNodes[mt].testNode[0].testCaseID,
                    tags: modules[0].testNodes[mt].testNode[0].tags,
                    automationStatus:
                        modules[0].testNodes[mt].testNode[0].automationStatus,
                    testCaseSteps:
                        modules[0].testNodes[mt].testNode[0].testCaseSteps,
                    testStepStatuses,
                    status: job
                        ? job.testRun[0].testNodes[rtn]?.status
                        : JobStatus.UNTESTED,
                    executionStart: job
                        ? job.testRun[0].testNodes[rtn]?.executionStart
                        : '',
                    executionEnd: job
                        ? job.testRun[0].testNodes[rtn]?.executionEnd
                        : '',
                    executionDuration: formattedDuration,
                })
            }
        }
    }
    if (job?.testRun[0]?.executionStart) {
        statusCounts = getStatusCounts(job?.testRun)
        counts.push(statusCounts)

        if (job?.testRun[0]?.executionDuration) {
            const exeduration = new Date(job.testRun[0].executionDuration)
            formattedDuration =
                parseInt(exeduration.getMinutes(), 10) !== 0
                    ? moment(exeduration).format('m[m] s[s]')
                    : moment(exeduration).format('s[s]')
        }
    } else {
        statusCounts = {
            total: testNodes?.length,

            untested: testNodes?.length,
            passed: 0,
            skipped: 0,
            failed: 0,
            percentage: 0,
        }
        counts.push(statusCounts)
    }
    return { formattedDuration, testNodes, counts: statusCounts }
}

const getModulesDataWithSteps = async (
    uniqueModules,
    projectId,
    releaseId,
    jobId
) => {
    try {
        let project = null

        if (releaseId !== null) {
            project = await TestCaseSteps.findOne({
                projectId,
                releaseIds: { $in: [releaseId] },
            }).sort({ createdAt: -1 })
        } else if (jobId !== null) {
            project = await TestCaseSteps.findOne({
                projectId,
                jobIds: { $in: [jobId] },
            })
        }
        if (project === null) {
            project = await TestCaseSteps.aggregate([
                { $match: { projectId } },
                { $sort: { createdAt: -1 } },
            ])
            project = project[0]
        }

        let methods
        let methodSteps
        if (project?.methods && project?.methods?.length !== 0) {
            methods = project?.methods.sort((a, b) => b.version - a.version)[0]
            methodSteps = methods?.testCaseSteps
        }

        const modules = uniqueModules.map((module) => {
            const testCaseCount = module.testNodes.length
            let testStepCount = 0

            const testNodes = module.testNodes.map((testNode) => {
                let newTestCaseSteps = []

                let mName = null

                let testCaseSteps = testNode.testNode[0]?.testCaseSteps?.map(
                    (testCaseStep) => {
                        const newTestCaseSteps = []

                        testCaseStep = JSON.parse(JSON.stringify(testCaseStep))

                        if (
                            Object.keys(testCaseStep).includes('module') &&
                            methodSteps
                        ) {
                            const methodName =
                                testCaseStep?.module['call'].methodName

                            mName = methodName

                            const testCaseSteps = project?.methods.find(
                                (step) => step.name === methodName
                            )

                            testCaseSteps?.testCaseSteps?.forEach(
                                (moduleTestStep) => {
                                    newTestCaseSteps.push(moduleTestStep)
                                }
                            )
                        } else {
                            newTestCaseSteps.push(testCaseStep)
                        }

                        return newTestCaseSteps
                    }
                )
                testCaseSteps = testCaseSteps.flat()

                newTestCaseSteps = [...newTestCaseSteps, ...testCaseSteps]

                testNode = JSON.parse(JSON.stringify(testNode))

                const newTestNode = {
                    ...testNode?.testNode[0],
                    testCaseSteps: newTestCaseSteps,
                }

                testStepCount += newTestCaseSteps.length

                return { _id: testNode._id, testNode: [newTestNode] }
            })

            module = JSON.parse(JSON.stringify(module))
            const totalcount = module?.testNodes?.length
            const totalpages = Math.ceil(parseInt(totalcount) / parseInt('10'))
            const newModule = {
                ...module,
                testNodes,
                testCaseCount,
                testStepCount,
                totalpages,
            }
            return newModule
        })
        return modules
    } catch (err) {
        console.log('err', err)
    }
}

const findVal = (object, key) => {
    let value
    Object.keys(object).some((k) => {
        if (ExcludeKeys?.includes(k.toString())) {
            return false
        }
        if (k.toString() == key.toString()) {
            value = object[k]
            return true
        }
        if (object[k] && typeof object[k] === 'object') {
            value = findVal(object[k], key)
            return value !== undefined
        }
        return value
    })
    return value
}

let smbClient = null

// console.log(' ******************** ')
// console.log(
//     '[share = ',
//     process.env.SMB_SHARE,
//     ']',
//     typeof process.env.SMB_SHARE
// )
// console.log('[domain = ', process.env.SMB_DOMAIN, ']')
// console.log('[username = ', process.env.SMB_USERNAME, ']')
// console.log('[password = ', process.env.SMB_PASSWORD, ']')
// console.log(' ******************** ')

// async function ensureSmbFolderExists(smbClient, targetPath) {
//     const folders = targetPath.split(/\\|\//)
//     let currentPath = ''

//     for (const folder of folders) {
//         currentPath = currentPath ? `${currentPath}\\${folder}` : folder

//         try {
//             await smbClient.readdir(currentPath)
//         } catch (err) {
//             // Folder doesn't exist, try the dummy file trick
//             try {
//                 const dummyPath = `${currentPath}\\__dummy__.txt`
//                 await smbClient.writeFile(dummyPath, 'init')
//                 await smbClient.unlink(dummyPath)
//                 console.log('📁 Created:', currentPath)
//             } catch (createErr) {
//                 console.error(
//                     `❌ Failed to create ${currentPath}:`,
//                     createErr.message
//                 )
//                 throw createErr
//             }
//         }
//     }
// }

function createSmbClient() {
    return new SMB2({
        share: process.env.SMB_SHARE,
        domain: process.env.SMB_DOMAIN,
        username: process.env.SMB_USERNAME,
        password: process.env.SMB_PASSWORD,
        autoCloseTimeout: 0,
    })
}

const getSMBClient = async () => {
    smbClient = new SMB2({
        share: process.env.SMB_SHARE,
        domain: process.env.SMB_DOMAIN,
        username: process.env.SMB_USERNAME,
        password: process.env.SMB_PASSWORD,
        autoCloseTimeout: 0,
    })

    smbClient.readdir('', async (err, files) => {})

    return smbClient
}

async function ensureSmbFolderExists(smbClient, folderPath) {
    const parts = folderPath.split(/[\\/]/)
    let currentPath = ''

    for (const part of parts) {
        currentPath = currentPath ? `${currentPath}\\${part}` : part

        try {
            await smbClient.readdir(currentPath)
        } catch (err) {
            if (
                err.code === 'STATUS_OBJECT_NAME_NOT_FOUND' ||
                err.code === 'STATUS_OBJECT_PATH_NOT_FOUND'
            ) {
                try {
                    await smbClient.mkdir(currentPath)
                    console.log('📁 Created:', currentPath)
                } catch (mkdirErr) {
                    console.error(
                        '❌ Failed to create:',
                        currentPath,
                        mkdirErr.message
                    )
                    throw mkdirErr
                }
            } else {
                throw err
            }
        }
    }
}

// Utility: safely create folders one by one
const mkdirSafeSMB = (smbClient, path) => {
    new Promise((resolve, reject) => {
        smbClient.mkdir(path, (err) => {
            if (err && err.code !== 'STATUS_OBJECT_NAME_COLLISION') {
                // return reject(err)
                console.log('Error creating folder ', err)
            }
            return resolve()
        })
    })
}

const createSMBNestedFolders = async (smbClient, folderArray) => {
    let current = ''

    try {
        const pathSegments = folderArray.split(path.sep)

        const filteredSegments = pathSegments.filter(Boolean)

        smbClient.readdir('', (err, files) => {
            if (err) console.error(err)
            else console.log(files)
        })

        for (const part of filteredSegments) {
            if (!part) continue
            current = current ? `${current}\\${part}` : part

            try {
                await mkdirSafeSMB(smbClient, current)
                console.log(`📁 Created: ${current}`)
            } catch (err) {
                console.error(
                    `❌ Failed to create '${current}': ${err.message}`
                )
            }
        }

        // smbClient.close()
    } catch (error) {
        console.log('error creating nested folders in smb path')
    }
}

const writeFileToSMBPath = async (
    smbClient,
    filePath,
    remotePath,
    fileContent
) => {
    try {
        // const smbClient = getSMBClient()

        const smbClient = createSmbClient()

        await ensureSmbFolderExists(smbClient, filePath)

        smbClient.unlink(remotePath, (unlinkErr) => {
            // Ignore "file not found" error
            if (
                unlinkErr &&
                unlinkErr.code !== 'STATUS_OBJECT_NAME_NOT_FOUND'
            ) {
                return console.error('Delete failed:', unlinkErr)
            }

            smbClient.writeFile(
                remotePath,
                Buffer.from(fileContent, 'utf8'),
                { createDisposition: 5 },
                (err) => {
                    if (err) {
                        console.error('❌ Write failed:', err)
                    } else {
                        console.log(
                            '✅ File written successfully after delete!'
                        )
                    }
                }
            )
        })
    } catch (error) {
        console.log('error while creaing image file in smb path', error)
    }
}

const readFileFromSMBPath = async (smbClient, remotePath) => {
    let fileData = null
    try {
        // const smbClient = getSMBClient()
        const smbClient = createSmbClient()

        return new Promise((resolve, reject) => {
            smbClient.readFile(remotePath, (err, data) => {
                if (err) {
                    console.error('❌ Error reading file:', err)
                    reject(err)
                } else {
                    console.log('✅ File contents:')
                    resolve(data.toString('utf8'))
                }
            })
        })
    } catch (error) {
        console.log('error while creaing image file in smb path', error)
    }
    return fileData
}

module.exports = {
    dbResponseTransformer,
    projectTransformer,
    projectTransformer_v1,
    projectTransformer_v2,
    userTransformer,
    findByAndUpdateCb,
    projectValidation,
    projectFilter,
    moduleValidation,
    releaseValidation,
    testCaseStepsValidation,
    passthroughError,
    getCircularReplacer,
    getStatusCounts,
    getReleaseStatusCounts,
    getTestRunModule,
    getTestRunModuleWithSteps,
    getModuleStatusCounts,
    getModulesDataWithSteps,
    findVal,
    getSMBClient,
    createSMBNestedFolders,
    writeFileToSMBPath,
    readFileFromSMBPath,
}
