const express = require('express')
// const SMB2 = require('smb2')
const axios = require('axios')
var http = require('http')
var request = require('request')
const router = express.Router()
const responseTransformer = require('../../utils/response-transformer')
const Release = require('../../Models/Release')
const Project = require('../../Models/Project')
const User = require('../../Models/User')
const logger = require('../../utils/logger')
const fs = require('fs')
const fileUtils = require('../../utils/file-utils')
const imageUpload = require('express-fileupload')
const app = express()
const { Module, TestNode, TestCase } = require('../../Models/Module')
const Job = require('../../Models/Job')
const { dbResponseTransformer } = require('../../utils/response-transformer')
const { mongo, Types } = require('mongoose')
let IMAGES_ROOT_FOLDER = './public/images/'
let LOGS_ROOT_FOLDER = './public/logs/'
// const ObjectID = require('mongodb').ObjectID
const moment = require('moment')
const momentTZ = require('moment-timezone')
const AuditCreation = require('../../Models/Audits')
const Template = require('../../Models/Template')
const TempVars = require('../../Models/TempKeysStore')
const xml2js = require('xml2js')
const { create } = require('xmlbuilder2')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const path = require('path')
// const smb = require('../../utils/SmbClient')

const {
    S3Client,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectsCommand,
    ListObjectsV2Command,
} = require('@aws-sdk/client-s3')

const {
    JobStatus,
    JobRunningStatus,
    ReleaseSchedule,
    GEN_AI_INPUT,
    ExcludeKeys,
    KEYS,
} = require('../../utils/Constants')
const common = require('../../utils/common')
const { MongoClient, ObjectId } = require('mongodb')
const TestCaseSteps = require('../../Models/TestCaseSteps')

// Release creation
router.post('/createRelease', async (req, res) => {
    try {
        // responseTransformer.releaseValidation(req.body, (err, newRelease) =>
        responseTransformer.passthroughError(
            null,
            req.body,
            'release validation',
            res,
            async (newRelease) => {
                const newModules = [...newRelease.modules]

                newModules.forEach((module, index) => {
                    if (module?.testPlaceholders) {
                        const testPlaceholders = []
                        module?.testPlaceholders.forEach((testData) => {
                            testPlaceholders.push({
                                ...testData,
                                jobId: null,
                                tpId: new ObjectId().toString(),
                                testRunProcessed: 'N',
                            })
                        })
                        newModules[index].testPlaceholders = testPlaceholders
                    }
                })

                const release = await new Release({
                    releaseName: newRelease.releaseName,
                    description: newRelease.description,
                    version: '0.1',
                    releaseVersion: newRelease.version,
                    releaseDate: newRelease.releaseDate,
                    projectID: req?.body?.projectID,
                    company: req?.body?.company?._id,
                    schedule: newRelease.schedule,
                    scheduledOn: newRelease.scheduledOn,
                    modules: newModules,
                    templateID: req?.body?.templateID,
                    createdBy: req.userId,
                }).save()

                const moduleIds = newModules?.map((m) => m.moduleID)
                const modules = await Module.find({ _id: { $in: moduleIds } })

                let data = {}
                const hasAutomation = modules?.some((m) => m.automationStatus)

                if (hasAutomation) {
                    data = await createScheduleRun(
                        newRelease.schedule,
                        newRelease.scheduledOn,
                        release?._id,
                        req?.body?.templateID,
                        newRelease?.releaseName
                    )
                }

                const { errors = '', configResponse = '' } = data

                // AuditCreation.upsertAuditLog(
                //     release?.collection?.collectionName,
                //     'create',
                //     req.body?.email,
                //     req.body?.company,
                //     null,
                //     release
                // )

                responseTransformer.dbResponseTransformer(
                    null,
                    { release, info: { errors, configResponse } },
                    'create release',
                    res,
                    null
                )
            }
        )
        // )
    } catch (error) {
        logger.info(`Error while creating release ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

const createScheduleRun = async (
    schedule,
    scheduledOn,
    releaseId,
    templateID,
    jobName
) => {
    let configResponse = null
    let errors = []
    if (templateID) {
        const template = await Template.findById(templateID)
        if (template) {
            jenkinsConfig.parentProject = getJobName(template.name)
            jenkinsConfig.endpoint = template.endpoint
            jenkinsConfig.headers.Authorization = `Basic ${Buffer.from(
                `${template.username}:${template.password}`
            ).toString('base64')}`
            jenkinsConfig.xmlHeaders.Authorization = `Basic ${Buffer.from(
                `${template.username}:${template.password}`
            ).toString('base64')}`
        }
    }

    const crumbResponse = await axios.get(jenkinsConfig.getCrumb(), {
        headers: {
            Authorization: jenkinsConfig.headers.Authorization,
        },
    })

    jenkinsConfig.headers['Jenkins-Crumb'] = crumbResponse.data.crumb
    jenkinsConfig.xmlHeaders['Jenkins-Crumb'] = crumbResponse.data.crumb

    try {
        await axios.post(
            jenkinsConfig.deleteJob(jobName),
            {},
            { headers: jenkinsConfig.headers }
        )
        console.log('Delete Job is success')
    } catch (err) {
        logger.info(err)
    }

    if (schedule !== ReleaseSchedule.NO_REPEAT) {
        try {
            await axios.post(
                jenkinsConfig.createItem(jobName),
                {},
                { headers: jenkinsConfig.headers }
            )
        } catch (err) {
            logger.info(err)
        }

        try {
            await axios.post(
                jenkinsConfig.disableJob(jobName),
                {},
                { headers: jenkinsConfig.headers }
            )
        } catch (err) {
            logger.info(err)
        }

        try {
            await axios.post(
                jenkinsConfig.enableJob(jobName),
                {},
                { headers: jenkinsConfig.headers }
            )
        } catch (err) {
            logger.info(err)
        }

        try {
            let response = ''
            try {
                response = await axios.get(jenkinsConfig.getConfig(jobName), {
                    headers: jenkinsConfig.headers,
                })
            } catch (error) {
                console.error('Error fetching job config:', error)
                throw error
            }

            configXml = response.data?.replace("version='1.1'", "version='1.0'")
            const newConfig = getJobScheduleCron(
                scheduledOn,
                configXml,
                releaseId
            )

            const parser = new xml2js.Parser()

            parser
                .parseStringPromise(newConfig)
                .then((parsedXml) => {
                    // If parse is successful, return the original XML string
                    console.log('xml praser success')
                })
                .catch((err) => {
                    console.log('xml parsing err', err)
                })

            const builder = create(newConfig)
            modifiedXml = builder.end({ prettyPrint: true })

            try {
                const response = await axios.post(
                    jenkinsConfig.getConfig(jobName),
                    modifiedXml,
                    {
                        headers: jenkinsConfig.xmlHeaders,
                    }
                )
                configResponse = response
                console.log('Job config updated successfully:', response.status)
            } catch (error) {
                console.error('Error updating job config:', error)
                errors.push('Error updating job config:', error)
            }
        } catch (err) {
            logger.info(err)
        }
    }

    return {
        errors,
        configResponse: {
            status: configResponse?.status,
            data: configResponse?.data,
        },
    }
}

const getJobScheduleCron = (scheduledOn, data, releaseId) => {
    const startDate = scheduledOn.scheduleStart
    const endDate = scheduledOn.scheduleEnd
    const time = scheduledOn.time
    const monthDay = scheduledOn.monthDay
    const weekDay = scheduledOn.weekDay

    const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const serverTime = new Date(momentTZ.tz(time, serverTimezone).format())

    const defaultCron = '<spec>H H H H H</spec>'

    let cron = serverTime.getMinutes() + ' ' + serverTime.getHours()

    if (!monthDay && !weekDay) cron = cron + ' date *'
    else if (!monthDay && weekDay) cron = cron + ' date ' + weekDay
    else if (monthDay && !weekDay) cron = cron + ' date'

    let date = null

    if (startDate.split('/')[0] === endDate.split('/')[0]) {
        if (weekDay)
            date =
                startDate.split('/')[1] +
                '-' +
                endDate.split('/')[1] +
                ' ' +
                startDate.split('/')[0]
        else if (monthDay)
            date = monthDay + ' ' + startDate.split('/')[0] + ' *'
        else
            date =
                startDate.split('/')[1] +
                '-' +
                endDate.split('/')[1] +
                ' ' +
                startDate.split('/')[0]
        cron = cron.replace('date', date)
    } else {
        let dates
        let months
        if (endDate.split('/')[0] - startDate.split('/')[0] === 1) {
            dates = [
                startDate.split('/')[1] + '-31',
                '1-' + endDate.split('/')[1],
            ]
            months = [startDate.split('/')[0], endDate.split('/')[0]]
        } else if (endDate.split('/')[0] - startDate.split('/')[0] === 2) {
            dates = [
                startDate.split('/')[1] + '-31',
                ' * ',
                '1-' + endDate.split('/')[1],
            ]
            months = [
                startDate.split('/')[0],
                parseInt(startDate.split('/')[0], 10) + 1,
                endDate.split('/')[0],
            ]
        } else {
            dates = [
                startDate.split('/')[1] + '-31',
                ' * ',
                '1-' + endDate.split('/')[1],
            ]
            months = [
                startDate.split('/')[0],
                parseInt(startDate.split('/')[0], 10) +
                    1 +
                    '-' +
                    (parseInt(endDate.split('/')[0], 10) - 1),
                endDate.split('/')[0],
            ]
        }

        const month = months[0] + '-' + months[months.length - 1]

        if (!monthDay && !weekDay) {
            for (let i = 0; i < dates.length; i++) {
                if (date)
                    date =
                        date +
                        '\n' +
                        cron.replace('date', dates[i] + ' ' + months[i])
                else date = cron.replace('date', dates[i] + ' ' + months[i])
            }
        } else if (monthDay && !weekDay) {
            if (date)
                date =
                    date +
                    '\n' +
                    cron.replace('date', monthDay + ' ' + month + ' *')
            else date = cron.replace('date', monthDay + ' ' + month + ' *')
        } else if (!monthDay && weekDay) {
            for (let i = 0; i < dates.length; i++) {
                if (date)
                    date =
                        date +
                        '\n' +
                        cron.replace('date', dates[i] + ' ' + months[i])
                else date = cron.replace('date', dates[i] + ' ' + months[i])
            }
        }
        cron = date
    }

    const releaseCron = '<spec>' + cron + '</spec>'

    newConfig = data
        .replace(defaultCron, releaseCron)
        .replace('UPDATE_RELEASE_ID', releaseId)
        .toString()
        .replace(/^\uFEFF/, '')
        .trim()

    return newConfig
}

//ALL Releases
router.get('/allReleases', async (req, res) => {
    try {
        Release.aggregate(
            [
                {
                    $sort: {
                        updatedAt: -1,
                    },
                },
            ],
            (err, releases) =>
                responseTransformer.dbResponseTransformer(
                    err,
                    releases,
                    'list all releases',
                    res
                )
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//Release Details
router.get('/Release/:id', async (req, res) => {
    try {
        const release = await Release.findById(req.params.id)
        //, (err, release) =>
        responseTransformer.dbResponseTransformer(
            null,
            release,
            'get release',
            res
        )
        // )
    } catch (error) {
        logger.info(
            `Encountered issues while fetching release details ${error}`
        )
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.get('/ReleaseByPID/:projectID', async (req, res) => {
    const warnings = []
    try {
        Module.aggregate(
            [{ $match: { projectID: req.params.projectID } }],
            (err, modules) => {
                responseTransformer.passthroughError(
                    err,
                    modules,
                    'list modules',
                    res,
                    (modules) => {
                        const modulesList = modules.map((m) => m._id)
                        logger.info('Looking in modules ' + modulesList)
                        Release.find(
                            { 'modules.moduleID': { $in: modulesList } },
                            async (err, releases) => {
                                let newReleases = []
                                let responseSent = false

                                const newj = await Promise.all(
                                    releases.map(
                                        async (curRelease) => {
                                            let total = 0
                                            let untested = 0
                                            let passed = 0
                                            let failed = 0
                                            let skipped = 0
                                            let percentage = 0
                                            let executionStart = 0
                                            let executionEnd = 0
                                            let executionDuration = 0
                                            const release =
                                                curRelease.toObject()

                                            const releaseJobsModal =
                                                await Job.find({
                                                    releaseID: release._id,
                                                })
                                            const jobModulesModal =
                                                await Job.find({
                                                    releaseID: release._id,
                                                }).sort({
                                                    updatedAt: -1,
                                                })
                                            const releaseJobs =
                                                releaseJobsModal.map((job) =>
                                                    job.toObject()
                                                )
                                            const jobModules =
                                                jobModulesModal.map((job) =>
                                                    job.toObject()
                                                )
                                            const modules = release?.modules
                                            let releaseDate = null
                                            const dates = []
                                            modules.map((module) => {
                                                if (
                                                    module?.testPlaceholders
                                                        ?.length > 0
                                                ) {
                                                    module?.testPlaceholders.map(
                                                        (tp) => {
                                                            if (
                                                                tp?.jobId?.toString()
                                                            ) {
                                                                const job =
                                                                    releaseJobs.filter(
                                                                        (job) =>
                                                                            job?._id.toString() ===
                                                                            tp?.jobId?.toString()
                                                                    )[0]

                                                                try {
                                                                    if (
                                                                        job !==
                                                                        null
                                                                    ) {
                                                                        executionStart =
                                                                            job?.executionStart
                                                                        executionEnd =
                                                                            job?.executionEnd
                                                                        executionDuration =
                                                                            job?.executionDuration

                                                                        const date =
                                                                            new Date(
                                                                                parseInt(
                                                                                    job?.executionDuration,
                                                                                    10
                                                                                )
                                                                            )

                                                                        if (
                                                                            job?.executionDuration
                                                                        ) {
                                                                            dates.push(
                                                                                job.executionDuration
                                                                            )
                                                                            if (
                                                                                releaseDate !=
                                                                                null
                                                                            ) {
                                                                                releaseDate =
                                                                                    new Date(
                                                                                        0,
                                                                                        date.getMonth() +
                                                                                            releaseDate.getMonth(),
                                                                                        date.getDay() +
                                                                                            releaseDate.getDay(),
                                                                                        date.getHours() +
                                                                                            releaseDate.getHours(),
                                                                                        date.getMinutes() +
                                                                                            releaseDate.getMinutes(),
                                                                                        date.getSeconds() +
                                                                                            releaseDate.getSeconds()
                                                                                    )
                                                                            } else {
                                                                                releaseDate =
                                                                                    date
                                                                            }
                                                                        }

                                                                        const testRun =
                                                                            job?.testRun
                                                                        const statusCounts =
                                                                            responseTransformer.getStatusCounts(
                                                                                testRun
                                                                            )
                                                                        total +=
                                                                            statusCounts?.total
                                                                        untested +=
                                                                            statusCounts?.untested
                                                                        passed +=
                                                                            statusCounts?.passed
                                                                        skipped +=
                                                                            statusCounts?.skipped
                                                                        failed +=
                                                                            statusCounts?.failed
                                                                    } else {
                                                                        total +=
                                                                            module
                                                                                ?.testNodes
                                                                                ?.length
                                                                        untested +=
                                                                            module
                                                                                ?.testNodes
                                                                                ?.length
                                                                    }
                                                                } catch (err) {
                                                                    logger.warn(
                                                                        'err',
                                                                        err
                                                                    )
                                                                }

                                                                try {
                                                                    percentage =
                                                                        parseInt(
                                                                            (passed /
                                                                                total) *
                                                                                100,
                                                                            10
                                                                        )
                                                                } catch (err) {
                                                                    warnings.push(
                                                                        err
                                                                    )
                                                                }
                                                            } else {
                                                                total +=
                                                                    module
                                                                        ?.testNodes
                                                                        ?.length
                                                                untested +=
                                                                    module
                                                                        ?.testNodes
                                                                        ?.length
                                                            }
                                                        }
                                                    )
                                                } else {
                                                    let curRun
                                                    jobModules.every((run) => {
                                                        curRun =
                                                            run?.testRun?.find(
                                                                (curModule) =>
                                                                    curModule?.moduleID ===
                                                                    module?.moduleID
                                                            )
                                                        if (curRun) {
                                                            return false
                                                        }
                                                    })

                                                    if (curRun) {
                                                        const statusCounts =
                                                            responseTransformer.getStatusCounts(
                                                                curRun
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
                                                    } else {
                                                        const testNodes =
                                                            module?.testNodes
                                                        total += parseInt(
                                                            testNodes?.length,
                                                            10
                                                        )
                                                        untested += parseInt(
                                                            testNodes?.length,
                                                            10
                                                        )
                                                    }
                                                }
                                            })

                                            let maxDate = null
                                            let maxDuration = null
                                            if (dates.length > 0) {
                                                // dates.forEach((date) => {});
                                                maxDate = new Date(
                                                    parseInt(
                                                        Math.max(...dates),
                                                        10
                                                    )
                                                )
                                                maxDuration = moment(
                                                    new Date(maxDate)
                                                ).format('m[m] s[s]')
                                            }

                                            try {
                                                percentage = parseInt(
                                                    (passed / total) * 100,
                                                    10
                                                )
                                            } catch (err) {
                                                logger.warn('err', err)
                                            }

                                            let formattedDuration = moment(
                                                new Date(
                                                    parseInt(
                                                        releaseDate
                                                            ? releaseDate.getTime()
                                                            : executionDuration,
                                                        10
                                                    )
                                                )
                                            ).format('m[m] s[s]')

                                            const newRelease = {
                                                _id: release?._id,
                                                releaseName:
                                                    release?.releaseName,
                                                description:
                                                    release?.description,
                                                version: release?.version,
                                                releaseVersion:
                                                    release?.releaseVersion,
                                                releaseDate:
                                                    release?.releaseDate,
                                                schedule: release?.schedule,
                                                modules: release?.modules,
                                                createdBy: release?.createdBy,
                                                createdAt: release?.createdAt,
                                                updatedAt: release?.updatedAt,
                                                __v: release?.__v,
                                                total,
                                                untested,
                                                passed,
                                                skipped,
                                                failed,
                                                percentage,
                                                executionStart,
                                                executionEnd,
                                                executionDuration: releaseDate
                                                    ? formattedDuration
                                                    : null,
                                                maxDuration,
                                            }

                                            newReleases.push(newRelease)
                                            return newRelease
                                        }
                                        // );
                                        // }
                                    )
                                )

                                if (newReleases.length === releases.length) {
                                    releases = newReleases
                                    try {
                                        responseTransformer.dbResponseTransformer(
                                            err,
                                            newReleases,
                                            'list releases',
                                            res
                                        )
                                    } catch (e) {
                                        warnings.push(e)
                                    }
                                }
                            }
                        ).sort({ updatedAt: -1 })
                    }
                )
            }
        )
    } catch (error) {
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

const getReleaseExecutionDuration = async (release, version) => {
    let formattedTimeDifference = null
    try {
        const jobs = await Job.find({
            releaseID: release?._id,
            version: version,
        })
        let obj = getMultiJobsExecDuration(jobs)
        formattedTimeDifference = obj.formattedTimeDifference
    } catch (err) {
        logger.info('err in getReleaseExecutionDuration', err)
    }
    return formattedTimeDifference
}

const getReleaseModuleExecutionDuration = async (
    release,
    version,
    moduleId
) => {
    let formattedTimeDifference = null
    try {
        const jobs = await Job.find({
            releaseID: release?._id,
            version: version,
            'testRun.moduleID': moduleId?.toString(),
        })
        let obj = getMultiJobsExecDuration(jobs)
        formattedTimeDifference = obj.formattedTimeDifference
    } catch (err) {
        logger.info('err in getReleaseExecutionDuration', err)
    }
    return formattedTimeDifference
}

const getVersionExecutionDuration = async (times) => {
    let formattedDuration = ''
    try {
        const date = new Date()
        date.setMinutes(0)
        date.setSeconds(0)
        let minutes = 0
        let seconds = 0
        if (times && times?.length > 1) {
            formattedDuration = times[0]
            times?.forEach((time) => {
                if (time) {
                    const values = time.split(' ')
                    if (values.length === 2) {
                        minutes = parseInt(values[0].replace('m', ''), 10)
                        seconds = parseInt(values[1].replace('s', ''), 10)
                        date.setMinutes(date.getMinutes() + minutes)
                        date.setSeconds(date.getSeconds() + seconds)
                    } else if (values.length === 1 && time.includes('s')) {
                        seconds = parseInt(values[0].replace('s', ''), 10)
                        date.setSeconds(date.getSeconds() + seconds)
                    }
                }
            })
        } else if (times?.length === 1) {
            formattedDuration = times[0]
        }
        if (date.getMinutes() !== 0) {
            formattedDuration = `${date.getMinutes()}m ${date.getSeconds()}s`
        } else if (times?.length > 1) {
            formattedDuration = `${date.getSeconds()}s`
        }
    } catch (err) {
        logger.info('err in getVersionExecutionDuration', err)
    }
    return formattedDuration
}

router.get('/v1/ReleaseByPID/:projectID', async (req, res) => {
    const warnings = []
    try {
        const modules = await Module.aggregate([
            { $match: { projectID: req.params.projectID } },
        ])
        // (err, modules) => {
        // responseTransformer.passthroughError(
        //     null,
        //     modules,
        //     'list modules',
        //     res,
        //     (modules) => {
        if (modules.length > 0) {
            const modulesList = modules.map((m) => m._id)
            // logger.info('Looking in modules ' + modulesList)
            let releases = await Release.find({
                'modules.moduleID': { $in: modulesList },
            }).sort({ updatedAt: -1 })
            // async (err, releases) => {
            if (releases) {
                let newReleases = []
                let responseSent = false
                const releaseJobsQuery = releases?.map((release) => {
                    return {
                        releaseID: release._id,
                        version: release?.testRunVersion,
                    }
                })

                let relJobs = []

                if (releaseJobsQuery.length !== 0)
                    relJobs = await Job.find({
                        $or: releaseJobsQuery,
                    })

                const jobModulesQuery = releases?.map((release) => {
                    return {
                        releaseID: release._id,
                    }
                })

                let jobMods = []

                if (jobModulesQuery.length !== 0)
                    jobMods = await Job.find({
                        $or: jobModulesQuery,
                    })

                const newj = await Promise.all(
                    releases.map(
                        async (curRelease) => {
                            let total = 0
                            let untested = 0
                            let passed = 0
                            let failed = 0
                            let skipped = 0
                            let percentage = 0
                            let executionStart = 0
                            let executionEnd = 0
                            let executionDuration = 0
                            let jobRunningStatus = ''
                            const release = curRelease.toObject()

                            // const releaseJobsModal =
                            //     await Job.find({
                            //         releaseID:
                            //             release._id,
                            //         version:
                            //             release?.testRunVersion,
                            //     })

                            const releaseJobsModal = relJobs?.filter(
                                (releaseJob) =>
                                    releaseJob.releaseID ===
                                        release._id.toString() &&
                                    releaseJob.version ===
                                        release?.testRunVersion
                            )

                            // const jobModulesModal =
                            //     await Job.find({
                            //         releaseID:
                            //             release._id,
                            //     }).sort({
                            //         updatedAt: -1,
                            //     })

                            const jobModulesModal = jobMods?.filter(
                                (releaseJob) =>
                                    releaseJob.releaseID ===
                                    release._id.toString()
                            )

                            const releaseJobs = releaseJobsModal.map((job) =>
                                job.toObject()
                            )

                            const jobModules = jobModulesModal.map((job) =>
                                job.toObject()
                            )

                            const modules = release?.modules
                            let releaseDate = null
                            const dates = []

                            modules.map((module) => {
                                if (
                                    module?.testPlaceholders?.length === 0 &&
                                    releaseJobs?.length > 0
                                ) {
                                    releaseDate = new Date(
                                        parseInt(
                                            releaseJobs[0]?.executionDuration,
                                            10
                                        )
                                    )
                                }
                                if (module?.testPlaceholders?.length > 0) {
                                    module?.testPlaceholders.map((tp) => {
                                        if (tp?.jobId?.toString()) {
                                            const job = releaseJobs.filter(
                                                (job) =>
                                                    job?._id.toString() ===
                                                    tp?.jobId?.toString()
                                            )[0]

                                            try {
                                                if (job !== null) {
                                                    executionStart =
                                                        job?.executionStart
                                                    executionEnd =
                                                        job?.executionEnd
                                                    executionDuration =
                                                        job?.executionDuration
                                                    jobRunningStatus =
                                                        job?.runningStatus
                                                    const date = new Date(
                                                        parseInt(
                                                            job?.executionDuration,
                                                            10
                                                        )
                                                    )

                                                    if (
                                                        job?.executionDuration
                                                    ) {
                                                        dates.push(
                                                            job.executionDuration
                                                        )
                                                        if (
                                                            releaseDate != null
                                                        ) {
                                                            releaseDate =
                                                                new Date(
                                                                    0,
                                                                    date.getMonth() +
                                                                        releaseDate.getMonth(),
                                                                    date.getDay() +
                                                                        releaseDate.getDay(),
                                                                    date.getHours() +
                                                                        releaseDate.getHours(),
                                                                    date.getMinutes() +
                                                                        releaseDate.getMinutes(),
                                                                    date.getSeconds() +
                                                                        releaseDate.getSeconds()
                                                                )
                                                        } else {
                                                            releaseDate = date
                                                        }
                                                    }

                                                    const testRun = job?.testRun
                                                    const statusCounts =
                                                        responseTransformer.getStatusCounts(
                                                            testRun
                                                        )
                                                    total += statusCounts?.total
                                                    untested +=
                                                        statusCounts?.untested
                                                    passed +=
                                                        statusCounts?.passed
                                                    skipped +=
                                                        statusCounts?.skipped
                                                    failed +=
                                                        statusCounts?.failed
                                                } else {
                                                    total +=
                                                        module?.testNodes
                                                            ?.length
                                                    untested +=
                                                        module?.testNodes
                                                            ?.length
                                                }
                                            } catch (err) {
                                                logger.warn('err', err)
                                            }

                                            try {
                                                percentage = parseInt(
                                                    (passed / total) * 100,
                                                    10
                                                )
                                            } catch (err) {
                                                warnings.push(err)
                                            }
                                        } else {
                                            total += module?.testNodes?.length
                                            untested +=
                                                module?.testNodes?.length
                                        }
                                    })
                                } else {
                                    let curRun
                                    jobModules.every((run) => {
                                        curRun = run?.testRun?.find(
                                            (curModule) =>
                                                curModule?.moduleID ===
                                                module?.moduleID
                                        )
                                        if (curRun) {
                                            console.log(curRun)
                                            return false
                                        }
                                    })

                                    if (curRun) {
                                        const statusCounts =
                                            responseTransformer.getStatusCounts(
                                                [curRun]
                                            )
                                        total = statusCounts?.total
                                        untested = statusCounts?.untested
                                        passed = statusCounts?.passed
                                        skipped = statusCounts?.skipped
                                        failed = statusCounts?.failed
                                    } else {
                                        const testNodes = module?.testNodes
                                        total += parseInt(testNodes?.length, 10)
                                        untested += parseInt(
                                            testNodes?.length,
                                            10
                                        )
                                    }
                                }
                            })

                            let maxDate = null
                            let maxDuration = null
                            if (dates.length > 0) {
                                // dates.forEach((date) => {});
                                maxDate = new Date(
                                    parseInt(Math.max(...dates), 10)
                                )
                                maxDuration = moment(new Date(maxDate)).format(
                                    'm[m] s[s]'
                                )
                            }

                            try {
                                percentage = parseInt(
                                    (passed / total) * 100,
                                    10
                                )
                            } catch (err) {
                                logger.warn('err', err)
                            }

                            let formattedDuration = moment(
                                new Date(
                                    parseInt(
                                        releaseDate
                                            ? releaseDate.getTime()
                                            : executionDuration,
                                        10
                                    )
                                )
                            ).format('m[m] s[s]')
                            if (release?.testRunVersion) {
                                formattedDuration =
                                    await getReleaseExecutionDuration(
                                        release,
                                        release?.testRunVersion
                                    )
                            }

                            const newRelease = {
                                _id: release?._id,
                                releaseName: release?.releaseName,
                                description: release?.description,
                                version: release?.version,
                                releaseDate: release?.releaseDate,
                                schedule: release?.schedule,
                                scheduledOn: release?.scheduledOn,
                                // modules:
                                //     release?.modules,
                                createdBy: release?.createdBy,
                                createdAt: release?.createdAt,
                                updatedAt: release?.updatedAt,
                                __v: release?.__v,
                                total,
                                untested,
                                passed,
                                skipped,
                                failed,
                                percentage,
                                executionStart,
                                executionEnd,
                                executionDuration: releaseDate
                                    ? formattedDuration
                                    : null,
                                maxDuration,
                                testRunVersion: release?.testRunVersion,
                                jobRunningStatus,
                            }
                            Object.keys(newRelease).forEach((key) => {
                                if (
                                    newRelease[key] == null ||
                                    newRelease[key].toString().trim() === ''
                                ) {
                                    delete newRelease[key]
                                }
                            })
                            newReleases.push(newRelease)
                            return newRelease
                        }
                        // );
                        // }
                    )
                )
                if (newReleases.length === releases.length) {
                    releases = newReleases
                    try {
                        responseTransformer.dbResponseTransformer(
                            null,
                            newReleases,
                            'list releases',
                            res
                        )
                    } catch (e) {
                        console.log('e', e)
                        warnings.push(e)
                    }
                }
            } else {
                res.send({
                    status: 204,
                    message: 'Error at finding releases',
                    data: [],
                })
            }
            // }
            // ).sort({ updatedAt: -1 })
        } else {
            res.send({
                status: 204,
                message: 'There is no Modules',
                data: [],
            })
        }
        // }
        // )
        // }
        // )
    } catch (error) {
        console.log('error', error)
        logger.info(`Encountered error while serving request: ${error}`)
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

function groupBy(arr, fn) {
    return arr.reduce((acc, item) => {
        const key = fn(item)
        acc[key] = acc[key] || []
        acc[key].push(item)
        return acc
    }, {})
}
// With Pagination
router.get(
    '/v1/ReleaseByPID/:projectID/:SortBy/:order/:pagesize/:pageno',
    async (req, res) => {
        const warnings = []
        try {
            const { projectID, SortBy, order, pagesize, pageno } = req.params
            const skip = parseInt(pageno) * parseInt(pagesize)
            const limit = parseInt(pagesize)
            const sortDir = order === 'asc' ? 1 : -1

            // 1️⃣ Modules lookup
            const modules = await Module.find({ projectID }, { _id: 1 }).lean()
            const moduleIDs = modules.map((m) => m._id.toString())
            if (moduleIDs.length === 0) {
                return res.json({
                    status: 200,
                    message: 'No modules found',
                    data: [],
                })
            }

            // 2️⃣ Fetch Releases
            const releases = await Release.find({
                'modules.moduleID': { $in: moduleIDs },
            })
                .sort({ [SortBy]: sortDir })
                // .skip(skip)
                // .limit(limit)
                .lean()

            const releaseIDs = releases.map((r) => r._id)

            // 3️⃣ Fetch all Jobs once
            const allJobs = await Job.find({
                releaseID: { $in: releaseIDs },
            }).lean()

            // Build lookup maps
            const jobById = {}
            const jobsByRelease = {}
            allJobs.forEach((job) => {
                const jid = job._id.toString()
                jobById[jid] = job
                const rid = job.releaseID.toString()
                jobsByRelease[rid] = jobsByRelease[rid] || []
                jobsByRelease[rid].push(job)
            })

            // 4️⃣ Compute stats per release (batched)
            let newReleases = await Promise.all(
                releases.map(async (release) => {
                    let total = 0,
                        passed = 0,
                        failed = 0,
                        skipped = 0,
                        untested = 0
                    let maxDuration = 0,
                        executionStart = null,
                        executionEnd = null,
                        jobRunningStatus = ''

                    const releaseJobs =
                        jobsByRelease[release._id.toString()] || []

                    for (const module of release.modules || []) {
                        if (module.testPlaceholders?.length === 0) {
                            const job = releaseJobs?.find(
                                (releaseJob) =>
                                    releaseJob?.testRun[0]?.moduleID ===
                                    module?.moduleID?.toString()
                            )

                            if (!job) {
                                total += module?.testNodes?.length
                                untested += module?.testNodes?.length
                            } else {
                                const stats =
                                    responseTransformer.getStatusCounts(
                                        job.testRun || []
                                    )

                                total += stats.total || 0
                                passed += stats.passed || 0
                                failed += stats.failed || 0
                                skipped += stats.skipped || 0
                                untested += stats.untested || 0
                            }
                        }
                        for (const tp of module.testPlaceholders || []) {
                            const job = jobById[tp.jobId?.toString()]
                            if (job) {
                                const stats =
                                    responseTransformer.getStatusCounts(
                                        job.testRun || []
                                    )
                                total += stats.total || 0
                                passed += stats.passed || 0
                                failed += stats.failed || 0
                                skipped += stats.skipped || 0
                                untested += stats.untested || 0

                                const dur = parseInt(
                                    job.executionDuration || 0,
                                    10
                                )
                                if (dur > maxDuration) maxDuration = dur

                                if (
                                    !executionStart ||
                                    job.executionStart < executionStart
                                )
                                    executionStart = job.executionStart
                                if (
                                    !executionEnd ||
                                    job.executionEnd > executionEnd
                                )
                                    executionEnd = job.executionEnd
                                jobRunningStatus = job.runningStatus
                            } else {
                                const fallback = module.testNodes?.length || 0
                                total += fallback
                                untested += fallback
                            }
                        }
                    }

                    const percentage = total
                        ? parseInt((passed / total) * 100, 10)
                        : 0
                    const maxDurationFormatted = moment
                        .utc(maxDuration * 1000)
                        .format('m[m] s[s]')
                    const executionDuration = release.testRunVersion
                        ? await getReleaseExecutionDuration(
                              release,
                              release.testRunVersion
                          )
                        : maxDurationFormatted

                    const obj = {
                        _id: release._id,
                        releaseName: release.releaseName,
                        releaseDate: release.releaseDate,
                        updatedAt: release.updatedAt,
                        version: release.version,
                        total,
                        passed,
                        failed,
                        skipped,
                        untested,
                        percentage,
                        executionStart,
                        executionEnd,
                        executionDuration,
                        maxDuration: maxDurationFormatted,
                        testRunVersion: release.testRunVersion,
                        jobRunningStatus,
                    }

                    // Clean up empty/null fields
                    Object.keys(obj).forEach((k) => {
                        if (obj[k] == null || obj[k]?.toString().trim() === '')
                            delete obj[k]
                    })

                    return obj
                })
            )
            if (SortBy === 'passRate') {
                if (order === 'desc')
                    newReleases = newReleases.sort(
                        (a, b) => b.percentage - a.percentage
                    )
                else {
                    newReleases = newReleases.sort(
                        (a, b) => a.percentage - b.percentage
                    )
                }
            }
            const totalCount = newReleases.length
            const paginatedReleases = newReleases.slice(skip, skip + limit)
            responseTransformer.dbResponseTransformer(
                null,
                paginatedReleases,
                'list releases',
                res,
                totalCount
            )
        } catch (error) {
            logger.warn(`Encountered warnings: ${warnings}`, error)
            res.status(500).send({
                status: 500,
                message: 'Internal Server Error',
                error,
                warnings,
            })
        }
    }
)

// router.get(
//     '/v1/ReleaseByPID/:projectID/:SortBy/:order/:pagesize/:pageno',
//     async (req, res) => {
//         const warnings = []
//         try {
//             const skipno =
//                 parseInt(req.params.pageno) * parseInt(req.params.pagesize)
//             const limitno = parseInt(req.params.pagesize)
//             Module.aggregate(
//                 [
//                     { $match: { projectID: req.params.projectID } },
//                     { $project: { _id: 1, testNodes: 1 } },
//                 ],
//                 (err, modules) => {
//                     responseTransformer.passthroughError(
//                         err,
//                         modules,
//                         'list modules',
//                         res,
//                         (modules) => {
//                             const modulesList = modules.map((m) => m._id)
//                             logger.info('Looking in modules ' + modulesList)
//                             Release.find(
//                                 { 'modules.moduleID': { $in: modulesList } },
//                                 {
//                                     _id: 1,
//                                     releaseName: 1,
//                                     description: 1,
//                                     version: 1,
//                                     releaseDate: 1,
//                                     schedule: 1,
//                                     modules: 1,
//                                     createdBy: 1,
//                                     createdAt: 1,
//                                     updatedAt: 1,
//                                     __v: 1,
//                                 },
//                                 async (err, releases) => {
//                                     let newReleases = []
//                                     let responseSent = false

//                                     const newj = await Promise.all(
//                                         releases.map(
//                                             async (curRelease) => {
//                                                 let total = 0
//                                                 let untested = 0
//                                                 let passed = 0
//                                                 let failed = 0
//                                                 let skipped = 0
//                                                 let percentage = 0
//                                                 let executionStart = 0
//                                                 let executionEnd = 0
//                                                 let executionDuration = 0
//                                                 let jobRunningStatus = ''
//                                                 const release =
//                                                     curRelease.toObject()

//                                                 const releaseJobsModal =
//                                                     await Job.find({
//                                                         releaseID: release._id,
//                                                     })
//                                                 const jobModulesModal =
//                                                     await Job.find({
//                                                         releaseID: release._id,
//                                                     }).sort({
//                                                         updatedAt: -1,
//                                                     })
//                                                 const releaseJobs =
//                                                     releaseJobsModal.map(
//                                                         (job) => job.toObject()
//                                                     )
//                                                 const jobModules =
//                                                     jobModulesModal.map((job) =>
//                                                         job.toObject()
//                                                     )
//                                                 const modules = release?.modules
//                                                 let releaseDate = null
//                                                 const dates = []
//                                                 modules.map((module) => {
//                                                     if (
//                                                         module?.testPlaceholders
//                                                             ?.length > 0
//                                                     ) {
//                                                         module?.testPlaceholders.map(
//                                                             (tp) => {
//                                                                 if (
//                                                                     tp?.jobId?.toString()
//                                                                 ) {
//                                                                     const job =
//                                                                         releaseJobs.filter(
//                                                                             (
//                                                                                 job
//                                                                             ) =>
//                                                                                 job?._id.toString() ===
//                                                                                 tp?.jobId?.toString()
//                                                                         )[0]

//                                                                     try {
//                                                                         if (
//                                                                             job !==
//                                                                             null
//                                                                         ) {
//                                                                             executionStart =
//                                                                                 job?.executionStart
//                                                                             executionEnd =
//                                                                                 job?.executionEnd
//                                                                             executionDuration =
//                                                                                 job?.executionDuration
//                                                                             jobRunningStatus =
//                                                                                 job?.runningStatus
//                                                                             const date =
//                                                                                 new Date(
//                                                                                     parseInt(
//                                                                                         job?.executionDuration,
//                                                                                         10
//                                                                                     )
//                                                                                 )

//                                                                             if (
//                                                                                 job?.executionDuration
//                                                                             ) {
//                                                                                 dates.push(
//                                                                                     job.executionDuration
//                                                                                 )
//                                                                                 if (
//                                                                                     releaseDate !=
//                                                                                     null
//                                                                                 ) {
//                                                                                     releaseDate =
//                                                                                         new Date(
//                                                                                             0,
//                                                                                             date.getMonth() +
//                                                                                                 releaseDate.getMonth(),
//                                                                                             date.getDay() +
//                                                                                                 releaseDate.getDay(),
//                                                                                             date.getHours() +
//                                                                                                 releaseDate.getHours(),
//                                                                                             date.getMinutes() +
//                                                                                                 releaseDate.getMinutes(),
//                                                                                             date.getSeconds() +
//                                                                                                 releaseDate.getSeconds()
//                                                                                         )
//                                                                                 } else {
//                                                                                     releaseDate =
//                                                                                         date
//                                                                                 }
//                                                                             }

//                                                                             const testRun =
//                                                                                 job?.testRun
//                                                                             const statusCounts =
//                                                                                 responseTransformer.getStatusCounts(
//                                                                                     testRun
//                                                                                 )
//                                                                             total +=
//                                                                                 statusCounts?.total
//                                                                             untested +=
//                                                                                 statusCounts?.untested
//                                                                             passed +=
//                                                                                 statusCounts?.passed
//                                                                             skipped +=
//                                                                                 statusCounts?.skipped
//                                                                             failed +=
//                                                                                 statusCounts?.failed
//                                                                         } else {
//                                                                             total +=
//                                                                                 module
//                                                                                     ?.testNodes
//                                                                                     ?.length
//                                                                             untested +=
//                                                                                 module
//                                                                                     ?.testNodes
//                                                                                     ?.length
//                                                                         }
//                                                                     } catch (err) {
//                                                                         logger.warn(
//                                                                             'err',
//                                                                             err
//                                                                         )
//                                                                     }

//                                                                     try {
//                                                                         percentage =
//                                                                             parseInt(
//                                                                                 (passed /
//                                                                                     total) *
//                                                                                     100,
//                                                                                 10
//                                                                             )
//                                                                     } catch (err) {
//                                                                         warnings.push(
//                                                                             err
//                                                                         )
//                                                                     }
//                                                                 } else {
//                                                                     total +=
//                                                                         module
//                                                                             ?.testNodes
//                                                                             ?.length
//                                                                     untested +=
//                                                                         module
//                                                                             ?.testNodes
//                                                                             ?.length
//                                                                 }
//                                                             }
//                                                         )
//                                                     } else {
//                                                         let curRun
//                                                         jobModules.every(
//                                                             (run) => {
//                                                                 curRun =
//                                                                     run?.testRun?.find(
//                                                                         (
//                                                                             curModule
//                                                                         ) =>
//                                                                             curModule?.moduleID ===
//                                                                             module?.moduleID
//                                                                     )
//                                                                 if (curRun) {
//                                                                     return false
//                                                                 }
//                                                             }
//                                                         )

//                                                         if (curRun) {
//                                                             const statusCounts =
//                                                                 responseTransformer.getStatusCounts(
//                                                                     curRun
//                                                                 )
//                                                             total =
//                                                                 statusCounts?.total
//                                                             untested =
//                                                                 statusCounts?.untested
//                                                             passed =
//                                                                 statusCounts?.passed
//                                                             skipped =
//                                                                 statusCounts?.skipped
//                                                             failed =
//                                                                 statusCounts?.failed
//                                                         } else {
//                                                             const testNodes =
//                                                                 module?.testNodes
//                                                             total += parseInt(
//                                                                 testNodes?.length,
//                                                                 10
//                                                             )
//                                                             untested +=
//                                                                 parseInt(
//                                                                     testNodes?.length,
//                                                                     10
//                                                                 )
//                                                         }
//                                                     }
//                                                 })

//                                                 let maxDate = null
//                                                 let maxDuration = null
//                                                 if (dates.length > 0) {
//                                                     // dates.forEach((date) => {});
//                                                     maxDate = new Date(
//                                                         parseInt(
//                                                             Math.max(...dates),
//                                                             10
//                                                         )
//                                                     )
//                                                     maxDuration = moment(
//                                                         new Date(maxDate)
//                                                     ).format('m[m] s[s]')
//                                                 }

//                                                 try {
//                                                     percentage = parseInt(
//                                                         (passed / total) * 100,
//                                                         10
//                                                     )
//                                                 } catch (err) {
//                                                     logger.warn('err', err)
//                                                 }

//                                                 let formattedDuration = moment(
//                                                     new Date(
//                                                         parseInt(
//                                                             releaseDate
//                                                                 ? releaseDate.getTime()
//                                                                 : executionDuration,
//                                                             10
//                                                         )
//                                                     )
//                                                 ).format('m[m] s[s]')
//                                                 if (release?.testRunVersion) {
//                                                     formattedDuration =
//                                                         await getReleaseExecutionDuration(
//                                                             release,
//                                                             release?.testRunVersion
//                                                         )
//                                                 }

//                                                 const newRelease = {
//                                                     _id: release?._id,
//                                                     releaseName:
//                                                         release?.releaseName,
//                                                     releaseDate:
//                                                         release?.releaseDate,
//                                                     updatedAt:
//                                                         release?.updatedAt,
//                                                     total,
//                                                     untested,
//                                                     passed,
//                                                     skipped,
//                                                     failed,
//                                                     percentage,
//                                                     executionStart,
//                                                     executionEnd,
//                                                     executionDuration:
//                                                         releaseDate
//                                                             ? formattedDuration
//                                                             : null,
//                                                     maxDuration,
//                                                     testRunVersion:
//                                                         release?.testRunVersion,
//                                                     jobRunningStatus,
//                                                 }
//                                                 Object.keys(newRelease).forEach(
//                                                     (key) => {
//                                                         if (
//                                                             newRelease[key] ==
//                                                                 null ||
//                                                             newRelease[key]
//                                                                 .toString()
//                                                                 .trim() === ''
//                                                         ) {
//                                                             delete newRelease[
//                                                                 key
//                                                             ]
//                                                         }
//                                                     }
//                                                 )
//                                                 newReleases.push(newRelease)
//                                                 return newRelease
//                                             }
//                                             // );
//                                             // }
//                                         )
//                                     )

//                                     if (
//                                         newReleases.length === releases.length
//                                     ) {
//                                         releases = newReleases
//                                         try {
//                                             responseTransformer.dbResponseTransformer(
//                                                 err,
//                                                 newReleases,
//                                                 'list releases',
//                                                 res
//                                             )
//                                         } catch (e) {
//                                             warnings.push(e)
//                                         }
//                                     }
//                                 }
//                             )
//                                 .sort({ updatedAt: -1 })
//                                 .skip(skipno)
//                                 .limit(limitno)
//                         }
//                     )
//                 }
//             )
//         } catch (error) {
//             logger.warn(`Encountered warnings while serving request: ${warnings}`)
//             res.send({
//                 status: 400,
//                 message: 'Bad Request',
//                 data: error,
//                 warnings,
//             })
//         }
//     }
// )
router.get('/v2/ReleaseByPID/:projectID', async (req, res) => {
    const warnings = []
    try {
        Module.aggregate(
            [
                { $match: { projectID: req.params.projectID } },
                { $project: { _id: 1, testNodes: 1 } },
            ],
            (err, modules) => {
                responseTransformer.passthroughError(
                    err,
                    modules,
                    'list modules',
                    res,
                    (modules) => {
                        const modulesList = modules.map((m) => m._id)
                        logger.info('Looking in modules ' + modulesList)
                        Release.find(
                            { 'modules.moduleID': { $in: modulesList } },
                            {
                                _id: 1,
                                releaseName: 1,
                                description: 1,
                                version: 1,
                                releaseDate: 1,
                                schedule: 1,
                                modules: 1,
                                createdBy: 1,
                                createdAt: 1,
                                updatedAt: 1,
                                __v: 1,
                            },
                            async (err, releases) => {
                                let newReleases = []
                                let responseSent = false

                                const newj = await Promise.all(
                                    releases.map(
                                        async (curRelease) => {
                                            let total = 0
                                            let untested = 0
                                            let passed = 0
                                            let failed = 0
                                            let skipped = 0
                                            let percentage = 0
                                            let executionStart = 0
                                            let executionEnd = 0
                                            let executionDuration = 0
                                            let jobRunningStatus = ''
                                            const release =
                                                curRelease.toObject()

                                            const releaseJobsModal =
                                                await Job.find({
                                                    releaseID: release._id,
                                                })
                                            const jobModulesModal =
                                                await Job.find({
                                                    releaseID: release._id,
                                                }).sort({
                                                    updatedAt: -1,
                                                })
                                            const releaseJobs =
                                                releaseJobsModal.map((job) =>
                                                    job.toObject()
                                                )
                                            const jobModules =
                                                jobModulesModal.map((job) =>
                                                    job.toObject()
                                                )
                                            const modules = release?.modules
                                            let releaseDate = null
                                            const dates = []
                                            modules.map((module) => {
                                                if (
                                                    module?.testPlaceholders
                                                        ?.length > 0
                                                ) {
                                                    module?.testPlaceholders.map(
                                                        (tp) => {
                                                            if (
                                                                tp?.jobId?.toString()
                                                            ) {
                                                                const job =
                                                                    releaseJobs.filter(
                                                                        (job) =>
                                                                            job?._id.toString() ===
                                                                            tp?.jobId?.toString()
                                                                    )[0]

                                                                try {
                                                                    if (
                                                                        job !==
                                                                        null
                                                                    ) {
                                                                        executionStart =
                                                                            job?.executionStart
                                                                        executionEnd =
                                                                            job?.executionEnd
                                                                        executionDuration =
                                                                            job?.executionDuration
                                                                        jobRunningStatus =
                                                                            job?.runningStatus
                                                                        const date =
                                                                            new Date(
                                                                                parseInt(
                                                                                    job?.executionDuration,
                                                                                    10
                                                                                )
                                                                            )

                                                                        if (
                                                                            job?.executionDuration
                                                                        ) {
                                                                            dates.push(
                                                                                job.executionDuration
                                                                            )
                                                                            if (
                                                                                releaseDate !=
                                                                                null
                                                                            ) {
                                                                                releaseDate =
                                                                                    new Date(
                                                                                        0,
                                                                                        date.getMonth() +
                                                                                            releaseDate.getMonth(),
                                                                                        date.getDay() +
                                                                                            releaseDate.getDay(),
                                                                                        date.getHours() +
                                                                                            releaseDate.getHours(),
                                                                                        date.getMinutes() +
                                                                                            releaseDate.getMinutes(),
                                                                                        date.getSeconds() +
                                                                                            releaseDate.getSeconds()
                                                                                    )
                                                                            } else {
                                                                                releaseDate =
                                                                                    date
                                                                            }
                                                                        }

                                                                        const testRun =
                                                                            job?.testRun
                                                                        const statusCounts =
                                                                            responseTransformer.getStatusCounts(
                                                                                testRun
                                                                            )
                                                                        total +=
                                                                            statusCounts?.total
                                                                        untested +=
                                                                            statusCounts?.untested
                                                                        passed +=
                                                                            statusCounts?.passed
                                                                        skipped +=
                                                                            statusCounts?.skipped
                                                                        failed +=
                                                                            statusCounts?.failed
                                                                    } else {
                                                                        total +=
                                                                            module
                                                                                ?.testNodes
                                                                                ?.length
                                                                        untested +=
                                                                            module
                                                                                ?.testNodes
                                                                                ?.length
                                                                    }
                                                                } catch (err) {
                                                                    logger.warn(
                                                                        'err',
                                                                        err
                                                                    )
                                                                }

                                                                try {
                                                                    percentage =
                                                                        parseInt(
                                                                            (passed /
                                                                                total) *
                                                                                100,
                                                                            10
                                                                        )
                                                                } catch (err) {
                                                                    warnings.push(
                                                                        err
                                                                    )
                                                                }
                                                            } else {
                                                                total +=
                                                                    module
                                                                        ?.testNodes
                                                                        ?.length
                                                                untested +=
                                                                    module
                                                                        ?.testNodes
                                                                        ?.length
                                                            }
                                                        }
                                                    )
                                                } else {
                                                    let curRun
                                                    jobModules.every((run) => {
                                                        curRun =
                                                            run?.testRun?.find(
                                                                (curModule) =>
                                                                    curModule?.moduleID ===
                                                                    module?.moduleID
                                                            )
                                                        if (curRun) {
                                                            return false
                                                        }
                                                    })

                                                    if (curRun) {
                                                        const statusCounts =
                                                            responseTransformer.getStatusCounts(
                                                                curRun
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
                                                    } else {
                                                        const testNodes =
                                                            module?.testNodes
                                                        total += parseInt(
                                                            testNodes?.length,
                                                            10
                                                        )
                                                        untested += parseInt(
                                                            testNodes?.length,
                                                            10
                                                        )
                                                    }
                                                }
                                            })

                                            let maxDate = null
                                            let maxDuration = null
                                            if (dates.length > 0) {
                                                // dates.forEach((date) => {});
                                                maxDate = new Date(
                                                    parseInt(
                                                        Math.max(...dates),
                                                        10
                                                    )
                                                )
                                                maxDuration = moment(
                                                    new Date(maxDate)
                                                ).format('m[m] s[s]')
                                            }

                                            try {
                                                percentage = parseInt(
                                                    (passed / total) * 100,
                                                    10
                                                )
                                            } catch (err) {
                                                logger.warn('err', err)
                                            }

                                            let formattedDuration = moment(
                                                new Date(
                                                    parseInt(
                                                        releaseDate
                                                            ? releaseDate.getTime()
                                                            : executionDuration,
                                                        10
                                                    )
                                                )
                                            ).format('m[m] s[s]')
                                            if (release?.testRunVersion) {
                                                formattedDuration =
                                                    await getReleaseExecutionDuration(
                                                        release,
                                                        release?.testRunVersion
                                                    )
                                            }

                                            const newRelease = {
                                                _id: release?._id,
                                                releaseName:
                                                    release?.releaseName,
                                                releaseDate:
                                                    release?.releaseDate,
                                                updatedAt: release?.updatedAt,
                                                total,
                                                untested,
                                                passed,
                                                skipped,
                                                failed,
                                                percentage,
                                                executionStart,
                                                executionEnd,
                                                executionDuration: releaseDate
                                                    ? formattedDuration
                                                    : null,
                                                maxDuration,
                                                testRunVersion:
                                                    release?.testRunVersion,
                                                jobRunningStatus,
                                            }
                                            Object.keys(newRelease).forEach(
                                                (key) => {
                                                    if (
                                                        newRelease[key] ==
                                                            null ||
                                                        newRelease[key]
                                                            .toString()
                                                            .trim() === ''
                                                    ) {
                                                        delete newRelease[key]
                                                    }
                                                }
                                            )
                                            newReleases.push(newRelease)
                                            return newRelease
                                        }
                                        // );
                                        // }
                                    )
                                )

                                if (newReleases.length === releases.length) {
                                    releases = newReleases
                                    try {
                                        responseTransformer.dbResponseTransformer(
                                            err,
                                            newReleases,
                                            'list releases',
                                            res
                                        )
                                    } catch (e) {
                                        warnings.push(e)
                                    }
                                }
                            }
                        ).sort({ updatedAt: -1 })
                    }
                )
            }
        )
    } catch (error) {
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

// Optmized version of fetching releases on the basis of Project ID

router.get('/v3/ReleaseByPID/:projectID', async (req, res) => {
    let newReleases = []
    try {
        const releases = await Release.find(
            { projectID: req.params.projectID },
            {
                _id: 1,
                releaseName: 1,
                description: 1,
                version: 1,
                releaseDate: 1,
                schedule: 1,
                modules: 1,
                createdBy: 1,
                createdAt: 1,
                updatedAt: 1,
                __v: 1,
                testRunVersion: 1,
            }
        )
        if (releases.length == 0) {
            res.send({
                status: 204,
                message: 'No releases present for this project',
                data: [],
            })
        } else {
            const jobs = await Job.find({
                projectID: req.params.projectID,
            }).sort({ updatedAt: -1 })
            await Promise.all(
                releases.map(async (release) => {
                    let percentage = 0
                    let total = 0
                    let untested = 0
                    let passed = 0
                    let failed = 0
                    let skipped = 0
                    let executionStart = 0
                    let executionEnd = 0
                    let executionDuration = 0
                    let releaseDate = null
                    // let modules = []
                    const dates = []
                    let jobRunningStatus = ''
                    release?.modules.forEach((module) => {
                        const releaseJobs = jobs.filter(
                            (job) =>
                                job.releaseID.toString() ===
                                release._id.toString()
                        )
                        if (
                            module?.testPlaceholders?.length === 0 &&
                            releaseJobs?.length > 0
                        ) {
                            releaseDate = new Date(
                                parseInt(releaseJobs[0]?.executionDuration, 10)
                            )
                        }
                        if (module?.testPlaceholders?.length > 0) {
                            if (
                                module?.testPlaceholders?.[0]?.jobId?.toString()
                            ) {
                                const automatedJob = releaseJobs.find(
                                    (job) =>
                                        job._id.toString() ==
                                        module?.testPlaceholders?.[0]?.jobId?.toString()
                                )
                                // Automated Job
                                if (automatedJob !== null) {
                                    const statusCounts =
                                        responseTransformer.getStatusCounts(
                                            automatedJob.testRun
                                        )
                                    total += statusCounts?.total
                                    untested += statusCounts?.untested
                                    passed += statusCounts?.passed
                                    skipped += statusCounts?.skipped
                                    failed += statusCounts?.failed
                                    // percentage += statusCounts?.percentage
                                    executionStart =
                                        automatedJob?.executionStart
                                    executionEnd = automatedJob?.executionEnd
                                    executionDuration =
                                        automatedJob?.executionDuration
                                    jobRunningStatus =
                                        automatedJob?.runningStatus
                                    const date = new Date(
                                        parseInt(
                                            automatedJob?.executionDuration,
                                            10
                                        )
                                    )
                                    if (automatedJob?.executionDuration) {
                                        dates.push(
                                            automatedJob.executionDuration
                                        )
                                        if (releaseDate != null) {
                                            releaseDate = new Date(
                                                0,
                                                date.getMonth() +
                                                    releaseDate.getMonth(),
                                                date.getDay() +
                                                    releaseDate.getDay(),
                                                date.getHours() +
                                                    releaseDate.getHours(),
                                                date.getMinutes() +
                                                    releaseDate.getMinutes(),
                                                date.getSeconds() +
                                                    releaseDate.getSeconds()
                                            )
                                        } else {
                                            releaseDate = date
                                        }
                                    }
                                } else {
                                    total += parseInt(module?.testNodes?.length)
                                    untested = total
                                }
                            } else {
                                total += parseInt(module?.testNodes?.length)
                                untested = total
                            }
                        } else {
                            // Manual Job
                            const manualJob = releaseJobs.find(
                                (job) =>
                                    job?.testRun[0]?.moduleID ==
                                    module?.moduleID
                            )
                            if (manualJob) {
                                const statusCounts =
                                    responseTransformer.getStatusCounts(
                                        manualJob.testRun
                                    )
                                total = statusCounts?.total
                                untested = statusCounts?.untested
                                passed = statusCounts?.passed
                                skipped = statusCounts?.skipped
                                failed = statusCounts?.failed
                            } else {
                                total += parseInt(module?.testNodes?.length)
                                untested = total
                            }
                        }
                    })

                    let maxDate = null
                    let maxDuration = null
                    if (dates.length > 0) {
                        maxDate = new Date(parseInt(Math.max(...dates), 10))
                        maxDuration = moment(new Date(maxDate)).format(
                            'm[m] s[s]'
                        )
                    }

                    let formattedDuration = moment(
                        new Date(
                            parseInt(
                                releaseDate
                                    ? releaseDate.getTime()
                                    : executionDuration,
                                10
                            )
                        )
                    ).format('m[m] s[s]')

                    if (release?.testRunVersion) {
                        formattedDuration = await getReleaseExecutionDuration(
                            release,
                            release?.testRunVersion
                        )
                    }
                    percentage = parseInt((passed / total) * 100, 10)

                    const newRelease = {
                        _id: release?._id,
                        releaseName: release?.releaseName,
                        description: release?.description,
                        version: release?.version,
                        releaseDate: release?.releaseDate,
                        schedule: release?.schedule,
                        // scheduledOn: release?.scheduledOn,
                        // modules:
                        //     release?.modules,
                        createdBy: release?.createdBy,
                        createdAt: release?.createdAt,
                        updatedAt: release?.updatedAt,
                        __v: release?.__v,
                        total,
                        untested,
                        passed,
                        skipped,
                        failed,
                        percentage,
                        executionStart,
                        executionEnd,
                        executionDuration: releaseDate
                            ? formattedDuration
                            : null,
                        maxDuration,
                        testRunVersion: release?.testRunVersion,
                        jobRunningStatus,
                    }
                    Object.keys(newRelease).forEach((key) => {
                        if (
                            newRelease[key] == null ||
                            newRelease[key].toString().trim() === ''
                        ) {
                            delete newRelease[key]
                        }
                    })
                    newReleases.push(newRelease)
                })
            )
            res.send(newReleases)
        }
    } catch (error) {
        console.log('Line:1882', error)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.get('/ReleaseInfo/:releaseID', async (req, res) => {
    const warnings = []
    try {
        Release.findById(req.params.releaseID, async (err, release) => {
            let testCasesCount = 0
            let testStepsCount = 0
            let automatedTestCases = 0
            let automatedPercentage = 0
            let releaseDuration = null

            try {
                const { modules } = release

                const counts = await Promise.all(
                    modules?.map(async (module) => {
                        let curTestStepsCount = 0
                        let curAutomatedTestCases = 0
                        const moduleId = module?.moduleID
                        const moduleObj = await Module.findById(moduleId)
                        const { testNodes } = moduleObj

                        testNodes?.forEach((testNode) => {
                            if (module?.testNodes.includes(testNode?._id)) {
                                curTestStepsCount +=
                                    testNode?.testNode[0]?.testCaseSteps?.length
                            }
                        })
                        if (moduleObj?.automationStatus === true) {
                            if (module?.testPlaceholders?.length > 0) {
                                testCasesCount +=
                                    module?.testNodes?.length *
                                    module?.testPlaceholders?.length
                                testStepsCount +=
                                    curTestStepsCount *
                                    module?.testPlaceholders?.length
                                automatedTestCases +=
                                    module?.testNodes?.length *
                                    module?.testPlaceholders?.length
                            } else {
                                testCasesCount += module?.testNodes?.length
                                testStepsCount += curTestStepsCount
                                automatedTestCases += module?.testNodes?.length
                            }
                        } else {
                            testCasesCount += module?.testNodes?.length
                            testStepsCount += curTestStepsCount
                        }
                    })
                )

                automatedPercentage = parseFloat(
                    (automatedTestCases / testCasesCount) * 100
                )
                    .toFixed(2)
                    .replace('.00', '')

                const jobs = await Job.find({
                    releaseID: req.params.releaseID,
                }).sort({
                    updatedAt: -1,
                })

                const jobNames = []
                const categories = []
                const runDates = []
                const duration = []
                let untestedObj = []
                let passedObj = []
                let skippedObj = []
                let failedObj = []
                let curUntestedObj = []
                let curPassedObj = []
                let curSkippedObj = []
                let curFailedObj = []

                /** test case statuses start */

                let total = 0
                let untested = 0
                let passed = 0
                let failed = 0
                let skipped = 0
                let percentage = 0
                const curRelease = release.toObject()

                const releaseJobsModal = await Job.find({
                    releaseID: curRelease._id,
                })
                const jobModulesModal = await Job.find({
                    releaseID: curRelease._id,
                }).sort({
                    updatedAt: -1,
                })
                const releaseJobs = releaseJobsModal.map((job) =>
                    job.toObject()
                )
                const jobModules = jobModulesModal.map((job) => job.toObject())

                jobModules?.forEach((job) => {
                    const date = new Date(parseInt(job?.executionDuration, 10))

                    if (job?.executionDuration) {
                        if (releaseDuration != null) {
                            releaseDuration = new Date(
                                0,
                                date.getMonth() + releaseDuration.getMonth(),
                                date.getDay() + releaseDuration.getDay(),
                                date.getHours() + releaseDuration.getHours(),
                                date.getMinutes() +
                                    releaseDuration.getMinutes(),
                                date.getSeconds() + releaseDuration.getSeconds()
                            )
                        } else {
                            releaseDuration = date
                        }
                    }
                })

                modules.map((module) => {
                    if (module?.testPlaceholders?.length > 0) {
                        // if (module?.testPlaceholders[0]?.jobId) {
                        module?.testPlaceholders.map((tp) => {
                            if (tp?.jobId?.toString()) {
                                const job = releaseJobs.filter(
                                    (job) =>
                                        job?._id.toString() ===
                                        tp?.jobId?.toString()
                                )[0]

                                try {
                                    if (job !== null) {
                                        const testRun = job.testRun
                                        const duration = job?.executionDuration

                                        const statusCounts =
                                            responseTransformer.getStatusCounts(
                                                testRun
                                            )
                                        total = statusCounts?.total
                                        untested = statusCounts?.untested
                                        passed = statusCounts?.passed
                                        skipped = statusCounts?.skipped
                                        failed = statusCounts?.failed
                                    } else {
                                        total += module?.testNodes?.length
                                        untested += module?.testNodes?.length
                                    }
                                } catch (err) {
                                    warnings.push(err)
                                }

                                try {
                                    percentage = parseInt(
                                        (passed / total) * 100,
                                        10
                                    )
                                } catch (err) {
                                    warnings.push(err)
                                }
                            } else {
                                total += module?.testNodes?.length
                                untested += module?.testNodes?.length
                            }
                        })
                    } else {
                        let curRun
                        jobModules.every((run) => {
                            curRun = run?.testRun?.find(
                                (curModule) =>
                                    curModule?.moduleID === module?.moduleID
                            )
                            if (curRun) {
                                return false
                            }
                        })

                        if (curRun) {
                            const statusCounts =
                                responseTransformer.getStatusCounts(curRun)
                            total = statusCounts?.total
                            untested = statusCounts?.untested
                            passed = statusCounts?.passed
                            skipped = statusCounts?.skipped
                            failed = statusCounts?.failed
                        } else {
                            const testNodes = module?.testNodes
                            total += parseInt(testNodes?.length, 10)
                            untested += parseInt(testNodes?.length, 10)
                        }
                    }
                })

                curUntestedObj.push(untested)
                curPassedObj.push(passed)
                curSkippedObj.push(skipped)
                curFailedObj.push(failed)
                const releaseStatus = [
                    curPassedObj[0],
                    curUntestedObj[0],
                    curFailedObj[0],
                    curSkippedObj[0],
                ]

                /** test case statuses end */

                jobs?.map((job) => {
                    const { testRun } = job
                    let untested = 0
                    let passed = 0
                    let skipped = 0
                    let failed = 0
                    const statusCounts =
                        responseTransformer.getStatusCounts(testRun)
                    total = statusCounts?.total
                    untested = statusCounts?.untested
                    passed = statusCounts?.passed
                    skipped = statusCounts?.skipped
                    failed = statusCounts?.failed

                    untestedObj.push(untested)
                    passedObj.push(passed)
                    skippedObj.push(skipped)
                    failedObj.push(failed)

                    const dateTime = moment(
                        new Date(job.executionStart)
                    ).format("DD MMM[']YY hh:mm A")

                    if (job?.executionStart) {
                        jobNames.push(`#${job.jenkinsJobID} - ${dateTime}`)
                        categories.push(`#${job.jenkinsJobID} - ${dateTime}`)
                    } else {
                        jobNames.push(`#${job.jenkinsJobID}`)
                        categories.push(`#${job.jenkinsJobID}`)
                    }

                    runDates.push(job.updatedAt)

                    if (
                        job.executionDuration &&
                        !isNaN(job.executionDuration)
                    ) {
                        const formattedDuration = moment(
                            new Date(parseInt(job.executionDuration, 10))
                        ).format('m[m] s[s]')
                        duration.push(formattedDuration)
                    } else duration.push(0)

                    return job
                })

                let formattedDuration
                if (releaseDuration) {
                    formattedDuration = moment(
                        new Date(parseInt(releaseDuration.getTime(), 10))
                    ).format('m[m] s[s]')
                }

                const cumm_chart_data = [
                    { name: 'Untested', data: untestedObj },
                    { name: 'Passed', data: passedObj },
                    { name: 'Skipped', data: skippedObj },
                    { name: 'Failed', data: failedObj },
                ]

                const cummulativeMetrics = { categories, cumm_chart_data }

                const releaseStatusMetrics = {
                    releaseName: curRelease.releaseName,
                    releaseStatus,
                }

                const issue_chart_data = [
                    { name: 'failed', data: failedObj },
                    { name: 'skipped', data: skippedObj },
                ]

                const issuesMetrics = { categories, issue_chart_data }

                const duration_chart_data = [{ data: duration }]

                const durationMetrics = { categories, duration_chart_data }

                const newRelease = {
                    _id: release._id,
                    releaseName: release.releaseName,
                    description: release.description,
                    version: release.version,
                    releaseDate: release.releaseDate,
                    schedule: release.schedule,
                    jobNames,
                    testCasesCount,
                    testStepsCount,
                    automatedTestCases,
                    automatedPercentage,
                    testRunsCount: jobs?.length,
                    cummulativeMetrics,
                    releaseStatusMetrics,
                    issuesMetrics,
                    durationMetrics,
                    runDates,
                    createdBy: release.createdBy,
                    createdAt: release.createdAt,
                    updatedAt: release.updatedAt,
                    __v: release.__v,
                    modules: release.modules,
                    releaseDuration: formattedDuration,
                }
                responseTransformer.dbResponseTransformer(
                    err,
                    newRelease,
                    'release Info',
                    res
                )
            } catch (error) {
                warnings.push(error)
                responseTransformer.dbResponseTransformer(
                    err,
                    {},
                    'release Info',
                    res
                )
            }
        })
    } catch (error) {
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

router.get('/v1/ReleaseInfo/:releaseID', async (req, res) => {
    const warnings = []
    try {
        const release = await Release.findById(req.params.releaseID)
        // async (err, release) => {
        let testCasesCount = 0
        let testStepsCount = 0
        let automatedTestCases = 0
        let automatedPercentage = 0
        let releaseDuration = null

        try {
            const { modules } = release

            const counts = await Promise.all(
                modules?.map(async (module) => {
                    let curTestStepsCount = 0
                    let curAutomatedTestCases = 0
                    const moduleId = module?.moduleID
                    const moduleObj = await Module.findById(moduleId)
                    const { testNodes } = moduleObj

                    testNodes?.forEach((testNode) => {
                        if (module?.testNodes.includes(testNode?._id)) {
                            curTestStepsCount +=
                                testNode?.testNode[0]?.testCaseSteps?.length
                        }
                    })
                    if (moduleObj?.automationStatus === true) {
                        if (module?.testPlaceholders?.length > 0) {
                            testCasesCount +=
                                module?.testNodes?.length *
                                module?.testPlaceholders?.length
                            testStepsCount +=
                                curTestStepsCount *
                                module?.testPlaceholders?.length
                            automatedTestCases +=
                                module?.testNodes?.length *
                                module?.testPlaceholders?.length
                        } else {
                            testCasesCount += module?.testNodes?.length
                            testStepsCount += curTestStepsCount
                            automatedTestCases += module?.testNodes?.length
                        }
                    } else {
                        testCasesCount += module?.testNodes?.length
                        testStepsCount += curTestStepsCount
                    }
                })
            )

            automatedPercentage = parseFloat(
                (automatedTestCases / testCasesCount) * 100
            )
                .toFixed(2)
                .replace('.00', '')

            const jobs = await Job.find({
                releaseID: req.params.releaseID,
            }).sort({
                updatedAt: -1,
            })

            const jobNames = []
            const categories = []
            const runDates = []
            const duration = []
            let untestedObj = []
            let passedObj = []
            let skippedObj = []
            let failedObj = []
            let curUntestedObj = []
            let curPassedObj = []
            let curSkippedObj = []
            let curFailedObj = []

            /** test case statuses start */

            let total = 0
            let untested = 0
            let passed = 0
            let failed = 0
            let skipped = 0
            let percentage = 0
            const curRelease = release.toObject()

            const releaseJobsModal = await Job.find({
                releaseID: curRelease._id,
            })
            const jobModulesModal = await Job.find({
                releaseID: curRelease._id,
            }).sort({
                updatedAt: -1,
            })
            const releaseJobs = releaseJobsModal.map((job) => job.toObject())
            const jobModules = jobModulesModal.map((job) => job.toObject())

            jobModules?.forEach((job) => {
                const date = new Date(parseInt(job?.executionDuration, 10))

                if (job?.executionDuration) {
                    if (releaseDuration != null) {
                        releaseDuration = new Date(
                            0,
                            date.getMonth() + releaseDuration.getMonth(),
                            date.getDay() + releaseDuration.getDay(),
                            date.getHours() + releaseDuration.getHours(),
                            date.getMinutes() + releaseDuration.getMinutes(),
                            date.getSeconds() + releaseDuration.getSeconds()
                        )
                    } else {
                        releaseDuration = date
                    }
                }
            })

            modules.map((module) => {
                if (module?.testPlaceholders?.length > 0) {
                    // if (module?.testPlaceholders[0]?.jobId) {
                    module?.testPlaceholders.map((tp) => {
                        if (tp?.jobId?.toString()) {
                            const job = releaseJobs.filter(
                                (job) =>
                                    job?._id.toString() ===
                                    tp?.jobId?.toString()
                            )[0]

                            try {
                                if (job !== null) {
                                    const testRun = job.testRun
                                    const duration = job?.executionDuration

                                    const statusCounts =
                                        responseTransformer.getStatusCounts(
                                            testRun
                                        )
                                    total = statusCounts?.total
                                    untested = statusCounts?.untested
                                    passed = statusCounts?.passed
                                    skipped = statusCounts?.skipped
                                    failed = statusCounts?.failed
                                } else {
                                    total += module?.testNodes?.length
                                    untested += module?.testNodes?.length
                                }
                            } catch (err) {
                                warnings.push(err)
                            }

                            try {
                                percentage = parseInt(
                                    (passed / total) * 100,
                                    10
                                )
                            } catch (err) {
                                warnings.push(err)
                            }
                        } else {
                            total += module?.testNodes?.length
                            untested += module?.testNodes?.length
                        }
                    })
                } else {
                    let curRun
                    jobModules.every((run) => {
                        curRun = run?.testRun?.find(
                            (curModule) =>
                                curModule?.moduleID === module?.moduleID
                        )
                        if (curRun) {
                            return false
                        }
                    })

                    if (curRun) {
                        const statusCounts =
                            responseTransformer.getStatusCounts([curRun])
                        total = statusCounts?.total
                        untested = statusCounts?.untested
                        passed = statusCounts?.passed
                        skipped = statusCounts?.skipped
                        failed = statusCounts?.failed
                    } else {
                        const testNodes = module?.testNodes
                        total += parseInt(testNodes?.length, 10)
                        untested += parseInt(testNodes?.length, 10)
                    }
                }
            })

            curUntestedObj.push(untested)
            curPassedObj.push(passed)
            curSkippedObj.push(skipped)
            curFailedObj.push(failed)
            let releaseCounts = []
            if (release?.testRunVersion) {
                const jobs = await Job.find({
                    releaseID: release?._id,
                    version: release?.testRunVersion,
                })
                let counts = []
                jobs?.forEach((job) => {
                    const statusCounts = responseTransformer.getStatusCounts(
                        job?.testRun
                    )
                    counts.push(statusCounts)
                })
                const rCounts =
                    responseTransformer.getReleaseStatusCounts(counts)
                releaseCounts.push(rCounts.passed)
                releaseCounts.push(rCounts.untested)
                releaseCounts.push(rCounts.failed)
                releaseCounts.push(rCounts.skipped)
            }
            let releaseStatus = [
                curPassedObj[0],
                curUntestedObj[0],
                curFailedObj[0],
                curSkippedObj[0],
            ]
            if (release?.testRunVersion) {
                releaseStatus = releaseCounts
            }

            /** test case statuses end */

            await Promise.all(
                jobs?.map(async (job) => {
                    const { testRun } = job
                    let untested = 0
                    let passed = 0
                    let skipped = 0
                    let failed = 0
                    const statusCounts =
                        responseTransformer.getStatusCounts(testRun)
                    total = statusCounts?.total
                    untested = statusCounts?.untested
                    passed = statusCounts?.passed
                    skipped = statusCounts?.skipped
                    failed = statusCounts?.failed

                    untestedObj.push(untested)
                    passedObj.push(passed)
                    skippedObj.push(skipped)
                    failedObj.push(failed)

                    const dateTime = moment(
                        new Date(job.executionStart)
                    ).format("DD MMM[']YY hh:mm A")

                    const moduleId = job.testRun[0].moduleID
                    const module = await Module.findById(moduleId)

                    const moduleName = module.suiteName

                    if (job?.executionStart) {
                        jobNames.push(
                            `${moduleName}_${job.jenkinsJobID} - ${dateTime}`
                        )
                        categories.push(
                            `${moduleName}_${job.jenkinsJobID} - ${dateTime}`
                        )
                    } else {
                        jobNames.push(`${moduleName}_${job.jenkinsJobID}`)
                        categories.push(`${moduleName}_${job.jenkinsJobID}`)
                    }

                    runDates.push(job.updatedAt)

                    if (
                        job.executionDuration &&
                        !isNaN(job.executionDuration)
                    ) {
                        const formattedDuration = moment(
                            new Date(parseInt(job.executionDuration, 10))
                        ).format('m[m] s[s]')
                        duration.push(formattedDuration)
                    } else duration.push(0)

                    return job
                })
            )

            let formattedDuration
            if (releaseDuration) {
                formattedDuration = moment(
                    new Date(parseInt(releaseDuration.getTime(), 10))
                ).format('m[m] s[s]')
            }

            let cumm_categories = categories

            let verUntestedObj = []
            let verPassedObj = []
            let verSkippedObj = []
            let verFailedObj = []

            let verExecutionDurations = []
            let verExecutionDuration = []

            if (release?.testRunVersion) {
                cumm_categories = []

                const jobs = await Job.find({
                    releaseID: release?._id,
                })
                const uniqueVersions = Array.from(
                    new Set(jobs.map((u) => u.version))
                )

                for (let i = 0; i < uniqueVersions?.length; i++) {
                    const jobs = await Job.find({
                        releaseID: release?._id,
                        version: uniqueVersions[i],
                    })
                    const dateTime = moment(
                        new Date(jobs[0].executionStart)
                    ).format("DD MMM[']YY hh:mm A")
                    const moduleId = modules[0].moduleID
                    const module = await Module.findById(moduleId)

                    const moduleName = module.suiteName
                    cumm_categories.push(`${release?.releaseName}_${dateTime}`)
                    verExecutionDurations.push(
                        await getReleaseExecutionDuration(
                            release,
                            uniqueVersions[i]
                        )
                    )
                    let uniqueCounts = []
                    for (let j = 0; j < jobs?.length; j++) {
                        const statusCounts =
                            responseTransformer.getStatusCounts(
                                jobs[j]?.testRun
                            )
                        uniqueCounts.push(statusCounts)
                    }
                    const rCounts =
                        responseTransformer.getReleaseStatusCounts(uniqueCounts)

                    verUntestedObj.push(rCounts?.untested)
                    verPassedObj.push(rCounts?.passed)
                    verSkippedObj.push(rCounts?.skipped)
                    verFailedObj.push(rCounts?.failed)
                }
                verExecutionDuration = await getVersionExecutionDuration(
                    verExecutionDurations
                )
                verUntestedObj = verUntestedObj.reverse()
                verPassedObj = verPassedObj.reverse()
                verSkippedObj = verSkippedObj.reverse()
                verFailedObj = verFailedObj.reverse()
                cumm_categories = cumm_categories.reverse()
            }

            let cumm_chart_data = [
                { name: 'Untested', data: untestedObj },
                { name: 'Passed', data: passedObj },
                { name: 'Skipped', data: skippedObj },
                { name: 'Failed', data: failedObj },
            ]

            let cumm_testrun_chart_data = cumm_chart_data

            if (release?.testRunVersion) {
                cumm_chart_data = [
                    { name: 'Untested', data: verUntestedObj },
                    { name: 'Passed', data: verPassedObj },
                    { name: 'Skipped', data: verSkippedObj },
                    { name: 'Failed', data: verFailedObj },
                ]
            }

            const cummulativeMetrics = {
                categories: cumm_categories,
                cumm_chart_data,
            }

            const testRunCummulativeMetrics = {
                categories: categories,
                cumm_testrun_chart_data,
            }

            const releaseStatusMetrics = {
                releaseName: curRelease.releaseName,
                releaseStatus,
            }

            const issue_chart_data = [
                { name: 'failed', data: failedObj },
                { name: 'skipped', data: skippedObj },
            ]

            const issuesMetrics = { categories, issue_chart_data }

            const duration_chart_data = [{ data: duration }]

            const durationMetrics = { categories, duration_chart_data }

            const newRelease = {
                _id: release._id,
                releaseName: release.releaseName,
                description: release.description,
                version: release.version,
                releaseDate: release.releaseDate,
                schedule: release.schedule,
                jobNames,
                testCasesCount,
                testStepsCount,
                automatedTestCases,
                automatedPercentage,
                testRunsCount: jobs?.length,
                cummulativeMetrics,
                releaseStatusMetrics,
                issuesMetrics,
                durationMetrics,
                runDates,
                createdBy: release.createdBy,
                createdAt: release.createdAt,
                updatedAt: release.updatedAt,
                __v: release.__v,
                modules: release.modules,
                releaseDuration:
                    verExecutionDuration?.length !== 0
                        ? verExecutionDurations[
                              verExecutionDurations.length - 1
                          ]
                        : formattedDuration,
                testRunCummulativeMetrics: release?.testRunVersion
                    ? testRunCummulativeMetrics
                    : null,
            }
            responseTransformer.dbResponseTransformer(
                null,
                newRelease,
                'release Info',
                res
            )
        } catch (error) {
            warnings.push(error)
            responseTransformer.dbResponseTransformer(
                null,
                {},
                'release Info',
                res
            )
        }
        // })
    } catch (error) {
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

router.get('/v1/getRelease/:releaseID', async (req, res) => {
    let warnings = []
    try {
        const release = await Release.findById(req.params.releaseID, {
            releaseName: 1,
            description: 1,
            version: 1,
            schedule: 1,
            scheduledOn: 1,
            releaseDate: 1,
            modules: 1,
            testRunVersion: 1,
            releaseVersion: 1,
        })
        // async (err, release) => {
        try {
            if (release) {
                let respodata = {}
                respodata.releaseName = release.releaseName
                respodata.description = release.description
                respodata.version = release.version
                respodata.schedule = release.schedule
                respodata.scheduledOn = release.scheduledOn
                respodata.releaseDate = release.releaseDate
                respodata.testRunVersion = release.testRunVersion
                respodata.releaseVersion = release.releaseVersion

                respodata.modules = []
                if (release.modules.length > 0) {
                    for (let i = 0; i < release.modules.length; i++) {
                        let mddet = await Module.find(
                            { _id: release.modules[i].moduleID },
                            { suiteName: 1, testNodes: 1 }
                        )
                        let testnodesr = release.modules[i].testNodes
                        let testCaseIDs = []
                        for (let k = 0; k < testnodesr.length; k++) {
                            for (
                                let j = 0;
                                j < mddet[0].testNodes.length;
                                j++
                            ) {
                                if (
                                    testnodesr[k] == mddet[0].testNodes[j]._id
                                ) {
                                    testCaseIDs.push(
                                        mddet[0].testNodes[j].testNode[0]
                                            .testCaseID +
                                            ' - ' +
                                            mddet[0].testNodes[j].testNode[0]
                                                .testCaseTitle
                                    )
                                }
                            }
                        }
                        respodata.modules.push({
                            moduleID: mddet[0]._id,
                            name: mddet[0].suiteName,
                            testPlaceholders:
                                release.modules[i].testPlaceholders,
                            testNodes: testnodesr,
                            testCaseIDs: testCaseIDs,
                        })
                    }
                    res.send({
                        status: 200,
                        Message: 'Data Avaiable',
                        data: respodata,
                    })
                } else {
                    res.status(204).send({
                        status: 204,
                        Message: 'Modules not avaiable',
                        data: [],
                    })
                }
            } else {
                res.send({
                    status: 204,
                    message: 'Release not found',
                    data: err,
                })
            }
        } catch (error) {
            warnings.push(error)
            responseTransformer.dbResponseTransformer(
                null,
                {},
                'release Info',
                res
            )
        }
        // }
        // )
    } catch (error) {
        logger.warn(`Encountered error while serving request: ${error}`)
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

router.post('/v1/updateRelease', async (req, res) => {
    let body = req.body
    let warnings = []
    try {
        if (!body.releaseID) {
            res.send({ status: 204, message: 'release id required', data: [] })
        } else if (!body.releaseName) {
            res.send({
                status: 204,
                message: 'release name required',
                data: [],
            })
        } else {
            const newModules = [...body.modules]

            newModules.forEach((module, index) => {
                if (module?.testPlaceholders) {
                    const testPlaceholders = []
                    module?.testPlaceholders.forEach((testData) => {
                        if (!testData.tpId) {
                            testPlaceholders.push({
                                ...testData,
                                jobId: null,
                                tpId: new mongo.ObjectId().toString(),
                                testRunProcessed: 'N',
                            })
                        } else {
                            testPlaceholders.push({
                                ...testData,
                            })
                        }
                    })
                    newModules[index].testPlaceholders = testPlaceholders
                }
            })
            const updatedRelease = await Release.findByIdAndUpdate(
                body.releaseID,
                {
                    releaseName: body.releaseName,
                    description: body.description,
                    releaseVersion: body.releaseVersion,
                    schedule: body.schedule,
                    scheduledOn: body.scheduledOn,
                    modules: newModules,
                },
                { new: true } // returns the updated document
            )

            if (updatedRelease) {
                const { errors, configResponse } = await createScheduleRun(
                    body.schedule,
                    body.scheduledOn,
                    body.releaseID,
                    release.templateID,
                    body.releaseName
                )
                res.send({
                    status: 204,
                    message: 'Release Updated..',
                    data: [],
                    info: {
                        errors,
                        configResponse,
                    },
                })
            } else {
                res.status(204).send({
                    status: 204,
                    message: 'something went wrong',
                    data: err,
                })
            }

            // Release.findByIdAndUpdate(
            //     body.releaseID,
            //     {
            //         releaseName: body.releaseName,
            //         description: body.description,
            //         releaseVersion: body.releaseVersion,
            //         schedule: body.schedule,
            //         scheduledOn: body.scheduledOn,
            //         // releaseDate:body.releaseDate,
            //         modules: newModules,
            //     },
            //     async (err, release) => {
            //         const { errors, configResponse } = await createScheduleRun(
            //             body.schedule,
            //             body.scheduledOn,
            //             body.releaseID,
            //             release.templateID,
            //             body.releaseName
            //         )
            //         if (release) {
            //             res.send({
            //                 status: 204,
            //                 message: 'Release Updated..',
            //                 data: [],
            //                 info: {
            //                     errors,
            //                     configResponse,
            //                 },
            //             })
            //         } else {
            //             res.status(204).send({
            //                 status: 204,
            //                 message: 'something went wrong',
            //                 data: err,
            //             })
            //         }
            //     }getTestCaseSteps
            // )
        }
    } catch (error) {
        logger.warn(`Encountered error while serving request: ${error}`)
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

//update Release
router.patch('/Release/update/:id', async (req, res) => {
    try {
        responseTransformer.releaseValidation(req.body, (err, newRelease) =>
            responseTransformer.passthroughError(
                err,
                newRelease,
                'release validation',
                res,
                (newRelease) => {
                    Release.findById(req.params.id, (err, dbRelease) =>
                        responseTransformer.passthroughError(
                            err,
                            dbRelease,
                            'get release',
                            res,
                            (dbRelease) => {
                                Release.findByIdAndUpdate(
                                    req.params.id,
                                    {
                                        releaseName: newRelease.releaseName,
                                        testPlaceholders:
                                            newRelease.testPlaceholders,
                                        createdBy: dbRelease.userId,
                                        updatedBy: req.userId,
                                    },
                                    (err, release) =>
                                        responseTransformer.dbResponseTransformer(
                                            err,
                                            release,
                                            'update release',
                                            res
                                        )
                                )
                            }
                        )
                    )
                }
            )
        )
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//Delete Release
router.delete('/Release/delete/:id', async (req, res) => {
    try {
        const deletedRelease = await Release.findById(req.params.id)
        // , async (err, deletedRelease) => {
        if (deletedRelease) {
            let releasename = deletedRelease?.releaseName
            // try {
            //     axios.post(
            //         jenkinsConfig.deleteJob(releasename),
            //         {},
            //         { headers: jenkinsConfig.headers }
            //     )
            // } catch (err) {
            //     // logger.info(err)
            // }
            logger.info('Deleted release jenkins job')
            // for (let i = 0; i < deletedRelease.modules.length; i++) {
            //     let moduleid = deletedRelease.modules[i].moduleID
            //     let testplaceholders =
            //         deletedRelease.modules[i].testPlaceholders
            //     // Module.findById(
            //     //     moduleid,
            //     //     { suiteName: 1 },
            //     //     (err, suitnames) => {
            //     //         for (let k = 0; k < testplaceholders.length; k++) {
            //     //             const jobName = `${deletedRelease.releaseName}_${suitnames?.suiteName}_${k + 1}`
            //     //             // try {
            //     //             //     axios.post(
            //     //             //         jenkinsConfig.deleteJob(jobName),
            //     //             //         {},
            //     //             //         { headers: jenkinsConfig.headers }
            //     //             //     )
            //     //             // } catch (err) {
            //     //             //     // logger.info(err)
            //     //             // }
            //     //         }
            //     //     }
            //     // )
            // }
            const release = await Release.findById(req.params.id)
            await release.deleteOne()
            const jobs = await Job.deleteMany({ releaseID: req.params.id })
            // Release.remove({ _id: req.params.id }, async (err, release) => {
            //     await Job.deleteMany({ releaseID: req.params.id })
            //     // AuditCreation.upsertAuditLog(
            //     //     deletedRelease.collection.collectionName,
            //     //     'delete',
            //     //     req.body?.email,
            //     //     req.body?.company,
            //     //     deletedRelease
            //     // )
            //     responseTransformer.dbResponseTransformer(
            //         err,
            //         release,
            //         'deleting release',
            //         res
            //     )
            // })
            res.send({
                status: 200,
                message: 'Release and jobs deleted !!',
                data: [],
            })
        } else {
            res.send({
                status: 400,
                message: 'Release not found',
                data: [],
            })
        }
        // })
    } catch (error) {
        logger.info(`Encountered issue while deleting the release ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

let endpoint = process.env.JENKINS_HOST
let auth = process.env.JENKINS_AUTH

const getJobName = (releaseName) => {
    return releaseName.replace(/[^a-zA-Z0-9]/g, '_')
}

let jenkinsConfig = {
    endpoint,
    parentProject: process.env.JENKINS_PARENT_PROJECT || 'TestEnsure',
    createItem: (releaseName) =>
        `${jenkinsConfig.endpoint}/createItem?name=${getJobName(
            releaseName
        )}&mode=copy&from=${jenkinsConfig.parentProject}`,
    getAllJobs: () => `${jenkinsConfig.endpoint}/api/json`,
    disableJob: (releaseName) =>
        `${jenkinsConfig.endpoint}/job/${getJobName(releaseName)}/disable`,
    enableJob: (releaseName) =>
        `${jenkinsConfig.endpoint}/job/${getJobName(releaseName)}/enable`,
    deleteJob: (releaseName) =>
        `${jenkinsConfig.endpoint}/job/${getJobName(releaseName)}/doDelete`,
    runJob: (releaseName, jobID) =>
        `${jenkinsConfig.endpoint}/job/${getJobName(releaseName)}/buildWithParameters?JOB_ID=${jobID}`,
    stopJobWithBuildId: (jenkinsBuildId) =>
        `${jenkinsConfig.endpoint}/queue/cancelItem?id=${jenkinsBuildId}`,
    stopJobWithBuildNumber: (releaseName, jenkinsBuildNumber) =>
        `${jenkinsConfig.endpoint}/job/${getJobName(releaseName)}/${jenkinsBuildNumber}/stop`,
    streamUrl: (releaseName, streamPath) =>
        `${jenkinsConfig.endpoint}/job/${getJobName(releaseName)}/ws/stream/${streamPath}`,
    getConfig: (releaseName) =>
        `${jenkinsConfig.endpoint}/job/${getJobName(releaseName)}/config.xml`,
    getCrumb: () => `${jenkinsConfig.endpoint}/crumbIssuer/api/json`,
    headers: {
        Authorization: `Basic ${Buffer.from(auth).toString('base64')}`,
        // Authorization: `Basic ${Buffer.from("admin:118126dfb0e9379362cd12829d6afe5eed").toString('base64')}`,
        'Jenkins-Crumb': '',
    },
    xmlHeaders: {
        Authorization: `Basic ${Buffer.from(auth).toString('base64')}`,
        'Content-Type': 'application/xml',
        // Authorization: `Basic ${Buffer.from("admin:118126dfb0e9379362cd12829d6afe5eed").toString('base64')}`,
        'Jenkins-Crumb': '',
        // 'Transfer-Encoding': 'chunked',
    },
}

const removeCircular = (data) =>
    JSON.parse(JSON.stringify(data, responseTransformer.getCircularReplacer()))

// TestResult creation
router.post('/createJob/:releaseID', async (req, res) => {
    const warnings = []
    try {
        const version = req.body.version
        Release.findById(req.params.releaseID, (err, release) => {
            responseTransformer.passthroughError(
                err,
                release,
                'finding release',
                res,
                async (release) => {
                    const releaseName = release.releaseName
                    const releaseData = release.toObject()
                    const releaseModules = release.toObject()?.modules
                    const moduleModal = await Module.find({})
                    const automationJobs = []
                    const updatedAutomationJobs = {}
                    const moduleData = moduleModal.map((module) => {
                        const tempModule = module.toObject()
                        return {
                            ...tempModule,
                            _id: tempModule?._id.toString(),
                        }
                    })
                    const templateID = release?.templateID
                    logger.info('Getting crumb data')
                    if (templateID) {
                        const template = await Template.findById(templateID)
                        if (template) {
                            jenkinsConfig.parentProject = getJobName(
                                template.name
                            )
                            jenkinsConfig.endpoint = template.endpoint
                            jenkinsConfig.headers.Authorization = `Basic ${Buffer.from(
                                `${template.username}:${template.password}`
                            ).toString('base64')}`
                        }
                    }
                    axios
                        .get(jenkinsConfig.getCrumb(), {
                            headers: {
                                Authorization:
                                    jenkinsConfig.headers.Authorization,
                            },
                        })
                        .then((data) => {
                            jenkinsConfig.headers['Jenkins-Crumb'] =
                                data.data.crumb
                            if (releaseModules?.length > 0) {
                                releaseModules.forEach(
                                    async (releaseModule, index) => {
                                        const releaseModuleIndex = index
                                        const isAutomated = moduleData.filter(
                                            (module) =>
                                                module?._id ===
                                                releaseModule?.moduleID
                                        )[0]?.automationStatus
                                        if (isAutomated) {
                                            /** automation case **/
                                            try {
                                                releaseModule?.testPlaceholders.forEach(
                                                    async (testData, index) => {
                                                        try {
                                                            const testDataIndex =
                                                                index
                                                            const tpId =
                                                                testData?.tpId
                                                            const relModule =
                                                                await Module.findById(
                                                                    releaseModule?.moduleID,
                                                                    (
                                                                        err,
                                                                        module
                                                                    ) => {
                                                                        warnings.push(
                                                                            err
                                                                        )
                                                                    }
                                                                )

                                                            const jobName = `${releaseName}_${
                                                                relModule?.suiteName
                                                            }_${index + 1}`

                                                            new Job({
                                                                jenkinsJobID:
                                                                    'TODO',
                                                                jenkinsPath:
                                                                    'TODO',
                                                                tpId: 'TODO',
                                                                releaseID:
                                                                    req.params
                                                                        .releaseID,
                                                                createdBy:
                                                                    req.userId,
                                                            }).save(
                                                                async (
                                                                    err,
                                                                    job
                                                                ) => {
                                                                    logger.info(
                                                                        'Trying to run the job'
                                                                    )
                                                                    /** updating jobId in release test Data Ends **/
                                                                    responseTransformer.passthroughError(
                                                                        err,
                                                                        job,
                                                                        'creating job',
                                                                        res,
                                                                        (
                                                                            job
                                                                        ) => {
                                                                            logger.info(
                                                                                'Trying to create a job'
                                                                            )
                                                                            axios
                                                                                .post(
                                                                                    jenkinsConfig.createItem(
                                                                                        jobName
                                                                                    ),
                                                                                    {},
                                                                                    {
                                                                                        headers:
                                                                                            jenkinsConfig.headers,
                                                                                    }
                                                                                )
                                                                                .catch(
                                                                                    (
                                                                                        cjerr
                                                                                    ) =>
                                                                                        logger.error(
                                                                                            'Issue while posting to jenkins',
                                                                                            {
                                                                                                stack: cjerr.stack,
                                                                                            }
                                                                                        )
                                                                                )
                                                                                .finally(
                                                                                    () => {
                                                                                        logger.info(
                                                                                            'Trying to disable the job'
                                                                                        )
                                                                                        axios
                                                                                            .post(
                                                                                                jenkinsConfig.disableJob(
                                                                                                    jobName
                                                                                                ),
                                                                                                {},
                                                                                                {
                                                                                                    headers:
                                                                                                        jenkinsConfig.headers,
                                                                                                }
                                                                                            )
                                                                                            .catch(
                                                                                                (
                                                                                                    djerr
                                                                                                ) =>
                                                                                                    logger.error(
                                                                                                        'Issue while disabling the job',
                                                                                                        {
                                                                                                            stack: djerr.stack,
                                                                                                        }
                                                                                                    )
                                                                                            )
                                                                                            .finally(
                                                                                                () => {
                                                                                                    logger.info(
                                                                                                        'Trying to enable the job'
                                                                                                    )
                                                                                                    axios
                                                                                                        .post(
                                                                                                            jenkinsConfig.enableJob(
                                                                                                                jobName
                                                                                                            ),
                                                                                                            {},
                                                                                                            {
                                                                                                                headers:
                                                                                                                    jenkinsConfig.headers,
                                                                                                            }
                                                                                                        )
                                                                                                        .catch(
                                                                                                            (
                                                                                                                ejerr
                                                                                                            ) =>
                                                                                                                logger.error(
                                                                                                                    'Issue while enabling the job',
                                                                                                                    {
                                                                                                                        stack: ejerr.stack,
                                                                                                                    }
                                                                                                                )
                                                                                                        )
                                                                                                        .finally(
                                                                                                            () => {
                                                                                                                axios
                                                                                                                    .post(
                                                                                                                        jenkinsConfig.runJob(
                                                                                                                            jobName,
                                                                                                                            job._id
                                                                                                                        ),
                                                                                                                        {},
                                                                                                                        {
                                                                                                                            headers:
                                                                                                                                jenkinsConfig.headers,
                                                                                                                        }
                                                                                                                    )
                                                                                                                    .then(
                                                                                                                        async (
                                                                                                                            rjdata
                                                                                                                        ) => {
                                                                                                                            logger.info(
                                                                                                                                `Run job success, ${JSON.stringify(
                                                                                                                                    rjdata,
                                                                                                                                    responseTransformer.getCircularReplacer()
                                                                                                                                )}`
                                                                                                                            )
                                                                                                                            const locationItemRegex =
                                                                                                                                /.*?\/queue\/item\/(\d+)\//g
                                                                                                                            const itemID =
                                                                                                                                locationItemRegex.exec(
                                                                                                                                    rjdata
                                                                                                                                        .headers
                                                                                                                                        .location
                                                                                                                                )[1]
                                                                                                                            Release.findById(
                                                                                                                                req
                                                                                                                                    .params
                                                                                                                                    .releaseID,
                                                                                                                                (
                                                                                                                                    err,
                                                                                                                                    release
                                                                                                                                ) => {
                                                                                                                                    responseTransformer.passthroughError(
                                                                                                                                        err,
                                                                                                                                        release,
                                                                                                                                        'find release',
                                                                                                                                        res,
                                                                                                                                        async (
                                                                                                                                            release
                                                                                                                                        ) => {
                                                                                                                                            const mods =
                                                                                                                                                await Promise.all(
                                                                                                                                                    removeCircular(
                                                                                                                                                        release.modules
                                                                                                                                                    ).map(
                                                                                                                                                        async (
                                                                                                                                                            m
                                                                                                                                                        ) => {
                                                                                                                                                            const dbModule =
                                                                                                                                                                moduleData.filter(
                                                                                                                                                                    (
                                                                                                                                                                        module
                                                                                                                                                                    ) =>
                                                                                                                                                                        module?._id ===
                                                                                                                                                                        m.moduleID
                                                                                                                                                                )[0]
                                                                                                                                                            return {
                                                                                                                                                                moduleID:
                                                                                                                                                                    m.moduleID,
                                                                                                                                                                status: JobStatus.UNTESTED,
                                                                                                                                                                testNodes:
                                                                                                                                                                    m.testNodes.map(
                                                                                                                                                                        (
                                                                                                                                                                            tn
                                                                                                                                                                        ) => {
                                                                                                                                                                            const dbTestNode =
                                                                                                                                                                                dbModule.testNodes
                                                                                                                                                                                    .filter(
                                                                                                                                                                                        (
                                                                                                                                                                                            _tn
                                                                                                                                                                                        ) =>
                                                                                                                                                                                            _tn._id.toString() ===
                                                                                                                                                                                            tn
                                                                                                                                                                                    )
                                                                                                                                                                                    .find(
                                                                                                                                                                                        (
                                                                                                                                                                                            _
                                                                                                                                                                                        ) =>
                                                                                                                                                                                            true
                                                                                                                                                                                    )
                                                                                                                                                                                    .testNode.find(
                                                                                                                                                                                        (
                                                                                                                                                                                            _
                                                                                                                                                                                        ) =>
                                                                                                                                                                                            true
                                                                                                                                                                                    )
                                                                                                                                                                            return {
                                                                                                                                                                                testNodeID:
                                                                                                                                                                                    tn,
                                                                                                                                                                                status: JobStatus.UNTESTED,
                                                                                                                                                                                testCaseSteps:
                                                                                                                                                                                    dbTestNode.testCaseSteps.map(
                                                                                                                                                                                        (
                                                                                                                                                                                            tcs
                                                                                                                                                                                        ) => {
                                                                                                                                                                                            return {
                                                                                                                                                                                                _id: tcs._id,
                                                                                                                                                                                                status: JobStatus.UNTESTED,
                                                                                                                                                                                            }
                                                                                                                                                                                        }
                                                                                                                                                                                    ),
                                                                                                                                                                            }
                                                                                                                                                                        }
                                                                                                                                                                    ),
                                                                                                                                                            }
                                                                                                                                                        }
                                                                                                                                                    )
                                                                                                                                                )
                                                                                                                                            const currentJobModule =
                                                                                                                                                mods.filter(
                                                                                                                                                    (
                                                                                                                                                        module
                                                                                                                                                    ) =>
                                                                                                                                                        module.moduleID ===
                                                                                                                                                        releaseModules[
                                                                                                                                                            releaseModuleIndex
                                                                                                                                                        ]
                                                                                                                                                            ?.moduleID
                                                                                                                                                )

                                                                                                                                            await Job.findByIdAndUpdate(
                                                                                                                                                job._id,
                                                                                                                                                {
                                                                                                                                                    jenkinsJobID:
                                                                                                                                                        itemID,
                                                                                                                                                    jenkinsPath:
                                                                                                                                                        rjdata
                                                                                                                                                            .headers
                                                                                                                                                            .location,
                                                                                                                                                    releaseID:
                                                                                                                                                        req
                                                                                                                                                            .params
                                                                                                                                                            .releaseID,
                                                                                                                                                    testRun:
                                                                                                                                                        currentJobModule,
                                                                                                                                                    tpId: testData?.tpId,
                                                                                                                                                    createdBy:
                                                                                                                                                        req.userId,
                                                                                                                                                    version,
                                                                                                                                                    runningStatus:
                                                                                                                                                        'In Queue',
                                                                                                                                                },
                                                                                                                                                async (
                                                                                                                                                    err,
                                                                                                                                                    job
                                                                                                                                                ) => {
                                                                                                                                                    const trigeredJob =
                                                                                                                                                        {
                                                                                                                                                            _id: job._id,
                                                                                                                                                            jenkinsJobID:
                                                                                                                                                                itemID,
                                                                                                                                                            jenkinsPath:
                                                                                                                                                                rjdata
                                                                                                                                                                    .headers
                                                                                                                                                                    .location,
                                                                                                                                                            tpId: job.tpId,
                                                                                                                                                            releaseID:
                                                                                                                                                                job.releaseID,
                                                                                                                                                            createdBy:
                                                                                                                                                                job.createdBy,
                                                                                                                                                            createdAt:
                                                                                                                                                                job.createdAt,
                                                                                                                                                            updatedAt:
                                                                                                                                                                job.updatedAt,
                                                                                                                                                            __v: job.__v,
                                                                                                                                                            name: `${release.releaseName}_${itemID}`,
                                                                                                                                                        }
                                                                                                                                                    updatedAutomationJobs[
                                                                                                                                                        tpId
                                                                                                                                                    ] =
                                                                                                                                                        job._id
                                                                                                                                                    // return job;
                                                                                                                                                }
                                                                                                                                            ).then(
                                                                                                                                                (
                                                                                                                                                    jobs,
                                                                                                                                                    error
                                                                                                                                                ) => {
                                                                                                                                                    const updatedModules =
                                                                                                                                                        [
                                                                                                                                                            ...releaseModules,
                                                                                                                                                        ]
                                                                                                                                                    updatedModules[
                                                                                                                                                        releaseModuleIndex
                                                                                                                                                    ].testPlaceholders[
                                                                                                                                                        testDataIndex
                                                                                                                                                    ] =
                                                                                                                                                        {
                                                                                                                                                            ...updatedModules[
                                                                                                                                                                releaseModuleIndex
                                                                                                                                                            ]
                                                                                                                                                                .testPlaceholders[
                                                                                                                                                                testDataIndex
                                                                                                                                                            ],
                                                                                                                                                            jobId: job._id,
                                                                                                                                                            jenkinsJobID:
                                                                                                                                                                itemID,
                                                                                                                                                        }
                                                                                                                                                    Release.findByIdAndUpdate(
                                                                                                                                                        req
                                                                                                                                                            .params
                                                                                                                                                            .releaseID,
                                                                                                                                                        {
                                                                                                                                                            modules:
                                                                                                                                                                updatedModules,
                                                                                                                                                        },
                                                                                                                                                        function (
                                                                                                                                                            err,
                                                                                                                                                            result
                                                                                                                                                        ) {
                                                                                                                                                            if (
                                                                                                                                                                err
                                                                                                                                                            ) {
                                                                                                                                                                warnings.push(
                                                                                                                                                                    `error while updating relese test data = 
                                                                      ${err}`
                                                                                                                                                                )
                                                                                                                                                            } else {
                                                                                                                                                                warnings.push(
                                                                                                                                                                    `test data updates successfully result = 
                                                                      ${result}`
                                                                                                                                                                )
                                                                                                                                                            }
                                                                                                                                                        }
                                                                                                                                                    )
                                                                                                                                                }
                                                                                                                                            )
                                                                                                                                        }
                                                                                                                                    )
                                                                                                                                }
                                                                                                                            )
                                                                                                                        }
                                                                                                                    )
                                                                                                                    .catch(
                                                                                                                        (
                                                                                                                            rjerr
                                                                                                                        ) => {
                                                                                                                            logger.error(
                                                                                                                                'Run job error',
                                                                                                                                {
                                                                                                                                    stack: rjerr.stack,
                                                                                                                                }
                                                                                                                            )
                                                                                                                            res.status(
                                                                                                                                400
                                                                                                                            ).json(
                                                                                                                                rjerr.data
                                                                                                                            )
                                                                                                                        }
                                                                                                                    )
                                                                                                            }
                                                                                                        )
                                                                                                }
                                                                                            )
                                                                                    }
                                                                                )
                                                                        }
                                                                    )
                                                                }
                                                            )
                                                        } catch (error) {
                                                            res.status(
                                                                400
                                                            ).json(
                                                                `error inside create job for automation case ${error}`
                                                            )
                                                        }
                                                    }
                                                )
                                                //testPlaceholders for loop
                                                const releaseId =
                                                    releaseData?._id
                                                warnings.push(
                                                    `finally updated automation josbs = 
                        ${automationJobs}`
                                                )
                                                /**update tps with job Ids starts*/
                                                const updatedModules = [
                                                    ...releaseModules,
                                                ]
                                            } catch (error) {
                                                warnings.puhs(
                                                    `error occurred in createjob ${error}`
                                                )
                                            }
                                            /**update tps with job Ids ends*/
                                        } else {
                                            //manual case
                                            try {
                                                new Job({
                                                    jenkinsJobID: Math.floor(
                                                        Math.random() * 100 +
                                                            100
                                                    ),
                                                    jenkinsPath: 'TODO',
                                                    releaseID:
                                                        req.params.releaseID,
                                                    createdBy: req.userId,
                                                }).save((err, job) => {
                                                    logger.info(
                                                        'Trying to run the job'
                                                    )
                                                    responseTransformer.passthroughError(
                                                        err,
                                                        job,
                                                        'creating job',
                                                        res,
                                                        (job) => {
                                                            Release.findById(
                                                                req.params
                                                                    .releaseID,
                                                                (
                                                                    err,
                                                                    release
                                                                ) => {
                                                                    responseTransformer.passthroughError(
                                                                        err,
                                                                        release,
                                                                        'find release',
                                                                        res,
                                                                        async (
                                                                            release
                                                                        ) => {
                                                                            const mods =
                                                                                await Promise.all(
                                                                                    removeCircular(
                                                                                        release.modules
                                                                                    ).map(
                                                                                        async (
                                                                                            m
                                                                                        ) => {
                                                                                            const dbModule =
                                                                                                moduleData.filter(
                                                                                                    (
                                                                                                        module
                                                                                                    ) =>
                                                                                                        module?._id ===
                                                                                                        m.moduleID
                                                                                                )[0]
                                                                                            return {
                                                                                                moduleID:
                                                                                                    m.moduleID,
                                                                                                status: JobStatus.UNTESTED,
                                                                                                testNodes:
                                                                                                    m.testNodes.map(
                                                                                                        (
                                                                                                            tn
                                                                                                        ) => {
                                                                                                            const dbTestNode =
                                                                                                                dbModule.testNodes
                                                                                                                    .filter(
                                                                                                                        (
                                                                                                                            _tn
                                                                                                                        ) =>
                                                                                                                            _tn._id.toString() ===
                                                                                                                            tn
                                                                                                                    )
                                                                                                                    .find(
                                                                                                                        (
                                                                                                                            _
                                                                                                                        ) =>
                                                                                                                            true
                                                                                                                    )
                                                                                                                    .testNode.find(
                                                                                                                        (
                                                                                                                            _
                                                                                                                        ) =>
                                                                                                                            true
                                                                                                                    )
                                                                                                            return {
                                                                                                                testNodeID:
                                                                                                                    tn,
                                                                                                                status: JobStatus.UNTESTED,
                                                                                                                testCaseSteps:
                                                                                                                    dbTestNode.testCaseSteps.map(
                                                                                                                        (
                                                                                                                            tcs
                                                                                                                        ) => {
                                                                                                                            return {
                                                                                                                                _id: tcs._id,
                                                                                                                                status: JobStatus.UNTESTED,
                                                                                                                            }
                                                                                                                        }
                                                                                                                    ),
                                                                                                            }
                                                                                                        }
                                                                                                    ),
                                                                                            }
                                                                                        }
                                                                                    )
                                                                                )
                                                                            const currentJobModule =
                                                                                mods.filter(
                                                                                    (
                                                                                        module
                                                                                    ) =>
                                                                                        module.moduleID ===
                                                                                        releaseModules[
                                                                                            releaseModuleIndex
                                                                                        ]
                                                                                            ?.moduleID
                                                                                )
                                                                            Job.findByIdAndUpdate(
                                                                                job._id,
                                                                                {
                                                                                    releaseID:
                                                                                        req
                                                                                            .params
                                                                                            .releaseID,
                                                                                    testRun:
                                                                                        currentJobModule,
                                                                                    createdBy:
                                                                                        req.userId,
                                                                                },
                                                                                (
                                                                                    err,
                                                                                    job
                                                                                ) => {
                                                                                    const job1 =
                                                                                        job.toObject()
                                                                                }
                                                                            )
                                                                        }
                                                                    )
                                                                }
                                                            )
                                                        }
                                                    )
                                                })
                                            } catch (error) {
                                                res.status(400).json(
                                                    `error in create job for manual case${error}`
                                                )
                                            }
                                        } //manual case-end
                                    }
                                ) //releaseModules for loop
                            } // if releaseModules.length>0
                        })
                }
            )
        })
    } catch (error) {
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

const createJenkinsJob = async (
    release,
    newTestRuns,
    userId,
    status,
    video
) => {
    logger.info('Getting crumb data')
    try {
        release = await Release.findById(release._id)
        newTestRuns?.forEach(async (newTestRun, index) => {
            let job = null
            const module = await Module.findById(newTestRun.moduleID)
            const relModule = release?.modules?.find(
                (module) =>
                    module.moduleID.toString() ===
                    newTestRun.moduleID.toString(0)
            )

            if (relModule) {
                const { testPlaceholders } = relModule

                if (
                    !module?.automationStatus &&
                    testPlaceholders.length === 0
                ) {
                    const createdJob = await new Job({
                        jenkinsJobID: JobRunningStatus.MANUAL,
                        jenkinsPath: JobRunningStatus.MANUAL,
                        releaseID: release._id,
                        createdBy: userId,
                        dependsOn: null,
                        runningStatus: JobRunningStatus.MANUAL,
                        version: release?.testRunVersion,
                        jenkinsJobName: '',
                        projectID: module.projectID,
                        company: module.company,
                        executeJob: null,
                        // tpId: tp.tpId,
                        // testRun: newModules,
                    }).save()
                    await Job.findByIdAndUpdate(createdJob?._id, {
                        runningStatus: JobRunningStatus.MANUAL,
                        testRun: [newTestRun],
                    })
                    // })
                    logger.info(`Created manual job`)
                } else if (
                    module?.automationStatus &&
                    testPlaceholders.length !== 0
                ) {
                    testPlaceholders?.forEach(async (tp, index) => {
                        createAutomationJenkinsJob(
                            module,
                            release,
                            userId,
                            newTestRun,
                            tp,
                            index,
                            status,
                            video
                        )
                    })
                } else if (
                    module?.automationStatus &&
                    testPlaceholders.length === 0
                ) {
                    createAutomationJenkinsJob(
                        module,
                        release,
                        userId,
                        newTestRun,
                        null,
                        0,
                        status
                    )
                }
            }
        })
    } catch (err) {
        logger.info('error in creating jenkins job', err)
    }
}

const updateTestCaseSteps = async (projectId, version, releaseId, jobId) => {
    try {
        const testCaseSteps = await TestCaseSteps.findOne({
            projectId,
            version,
        })
        let { releaseIds, jobIds } = testCaseSteps
        releaseIds.push(releaseId)
        releaseIds = Array.from(new Set(releaseIds))
        jobIds.push(jobId)
        jobIds = Array.from(new Set(jobIds))
        await TestCaseSteps.findOneAndUpdate(
            { projectId, version },
            { releaseIds, jobIds }
        )
    } catch (err) {}
}

const createAutomationJenkinsJob = async (
    module,
    release,
    userId,
    newTestRun,
    tp,
    index,
    status,
    video
) => {
    logger.info(`Creating automation job with TODO status`)
    const createdJob = await new Job({
        jenkinsJobID: JobRunningStatus.TODO,
        jenkinsPath: JobRunningStatus.TODO,
        releaseID: release._id,
        createdBy: userId,
        dependsOn: null,
        video,
        runningStatus: JobRunningStatus.TODO,
        executeJob: null,
        version: release?.testRunVersion,
        jenkinsJobName: '',
        tpId: tp?.tpId,
        projectID: module.projectID,
        company: module.company,
    }).save()

    logger.info(`Created automation job ${createdJob} with TODO status`)

    if (createdJob) {
        const createdJobId = createdJob._id.toString()
        try {
            // await Job.findByIdAndUpdate(createdJobId, {
            //     runningStatus: JobRunningStatus.TODO,
            //     testRun: [newTestRun],
            // })
            await Job.findByIdAndUpdate(
                createdJobId,
                {
                    $push: {
                        testRun: {
                            $each: [newTestRun], // ensures it's always pushed as one object
                        },
                    },
                    $set: {
                        runningStatus: JobRunningStatus.TODO,
                    },
                },
                {
                    new: true,
                    runValidators: true,
                }
            )

            const project = await Project.findById(module.projectID, {
                testCaseSteps: 1,
            })

            await updateTestCaseSteps(
                project?._id,
                project?.testCaseSteps?.version,
                release._id,
                createdJobId
            )

            await Release.findOneAndUpdate(
                { _id: release?._id },
                {
                    $set: {
                        'modules.$[module].testPlaceholders.$[tp].jobId':
                            createdJobId,
                    },
                },
                {
                    arrayFilters: [
                        { 'module.moduleID': newTestRun?.moduleID },
                        { 'tp.tpId': tp?.tpId },
                    ],
                    upsert: true,
                    new: true,
                }
            )
        } catch (error) {
            console.log('automation error', error)
        }
        if (module.automationStatus) {
            const templateID = release?.templateID
            if (templateID) {
                const template = await Template.findById(templateID)
                if (template) {
                    jenkinsConfig.parentProject = getJobName(template.name)
                    jenkinsConfig.endpoint = template.endpoint
                    jenkinsConfig.headers.Authorization = `Basic ${Buffer.from(
                        `${template.username}:${template.password}`
                    ).toString('base64')}`
                }
            }

            const crumbResponse = await axios.get(jenkinsConfig.getCrumb(), {
                headers: {
                    Authorization: jenkinsConfig.headers.Authorization,
                },
            })

            jenkinsConfig.headers['Jenkins-Crumb'] = crumbResponse.data.crumb
            const jobName = `${release?.releaseName}_${module?.suiteName}_${index + 1}`
            try {
                await axios.post(
                    jenkinsConfig.createItem(jobName),
                    {},
                    { headers: jenkinsConfig.headers }
                )
            } catch (err) {
                logger.info(err)
            }

            try {
                await axios.post(
                    jenkinsConfig.disableJob(jobName),
                    {},
                    { headers: jenkinsConfig.headers }
                )
            } catch (err) {
                logger.info(err)
            }

            try {
                await axios.post(
                    jenkinsConfig.enableJob(jobName),
                    {},
                    { headers: jenkinsConfig.headers }
                )
            } catch (err) {
                logger.info(err)
            }

            if (!newTestRun?.dependsOn) {
                try {
                    const rjdata = await axios.post(
                        jenkinsConfig.runJob(jobName, createdJobId),
                        {},
                        { headers: jenkinsConfig.headers }
                    )
                    const locationItemRegex = /.*?\/queue\/item\/(\d+)\//g
                    const itemID = locationItemRegex.exec(
                        rjdata.headers.location
                    )[1]
                    await Job.findByIdAndUpdate(createdJobId, {
                        jenkinsJobID: itemID,
                        jenkinsPath: rjdata.headers.location,
                        runningStatus: status,
                    })
                } catch (err) {
                    logger.info(err)
                }
            } else {
                const dJob = await Job.findOneAndUpdate(
                    {
                        releaseID: release?._id,
                        'testRun.moduleID': newTestRun?.dependsOn,
                        version: release?.testRunVersion,
                    },
                    {
                        executeJob: createdJobId,
                    }
                )

                await Job.findByIdAndUpdate(createdJobId, {
                    jenkinsJobID: JobRunningStatus.WAITING,
                    jenkinsPath: JobRunningStatus.WAITING,
                    runningStatus: JobRunningStatus.WAITING,
                    dependsOn: {
                        moduleId: newTestRun?.dependsOn,
                        jobId: dJob._id.toString(),
                    },
                })
            }
        }
    }
}

// TestResult creation
router.post('/v1/createJob/:releaseID', async (req, res) => {
    const warnings = []
    try {
        Release.findById(req.params.releaseID, (err, release) => {
            responseTransformer.passthroughError(
                err,
                release,
                'finding release',
                res,
                async (release) => {
                    const releaseModules = release.toObject()?.modules
                    const mids = releaseModules?.map(
                        (module) => module.moduleID
                    )
                    const moduleModal = await Module.find({
                        _id: { $in: mids },
                    })

                    const newReleaseModules = []
                    let updateRelease = false

                    const newTestRuns = await Promise.all(
                        moduleModal?.map(async (m) => {
                            const newModule = {}
                            const newReleaseModule = {}
                            const module = await Module.findOne(
                                {
                                    suiteName: m.suiteName,
                                    projectID: m.projectID,
                                },
                                {
                                    _id: 1,
                                    automationStatus: 1,
                                    testNodes: 1,
                                    testPlaceholders: 1,
                                    version: 1,
                                    createdAt: 1,
                                },
                                { sort: { createdAt: -1 } }
                            )

                            const { testNodes } = module
                            const rTestNodes = release
                            const releaseModule = releaseModules?.find(
                                (module) =>
                                    module.moduleID.toString() ===
                                    m._id.toString()
                            )
                            const rids = releaseModule?.testNodes
                            let mids = testNodes?.map((tNode) => tNode._id)
                            mids = rids?.filter((id) => mids.includes(id))
                            if (mids?.length === 0)
                                mids = testNodes?.map((tNode) => tNode._id)
                            newModule.moduleID = module?._id
                            newModule.testNodes = mids
                            newModule.testPlaceholders =
                                module?.testPlaceholders

                            let testRunModule

                            if (m._id.toString() !== module._id.toString()) {
                                testRunModule =
                                    responseTransformer.getTestRunModuleWithSteps(
                                        module,
                                        mids,
                                        null
                                    )

                                const tps = releaseModule.testPlaceholders

                                tps.forEach((tp, index) => {
                                    newReleaseModule.moduleID =
                                        module._id.toString()
                                    const newTp = {
                                        ...module.testPlaceholders[index],
                                        jobId: tp.jobId,
                                        tpId: tp.tpId,
                                        testRunProcessed: tp.testRunProcessed,
                                    }
                                    newReleaseModule.testPlaceholders = [newTp]
                                    newReleaseModule.testNodes = mids
                                    newReleaseModules.push(newReleaseModule)
                                })

                                updateRelease = true
                            } else {
                                testRunModule =
                                    responseTransformer.getTestRunModuleWithSteps(
                                        m,
                                        rids,
                                        null
                                    )

                                const tps = releaseModule.testPlaceholders
                                const newTps = []
                                tps.forEach((tp, index) => {
                                    newReleaseModule.moduleID = m._id.toString()
                                    const newTp = {
                                        ...m.testPlaceholders[index],
                                        jobId: tp.jobId,
                                        tpId: tp.tpId,
                                        testRunProcessed: tp.testRunProcessed,
                                    }
                                    newReleaseModule.testPlaceholders = [newTp]
                                    newReleaseModule.testNodes = rids
                                    newReleaseModules.push(newReleaseModule)
                                })
                            }

                            return testRunModule
                        })
                    )

                    if (updateRelease) {
                        Release.findByIdAndUpdate(
                            release?._id,
                            {
                                modules: newReleaseModules,
                                createdAt: release?.createdAt,
                                updatedAt: release?.updatedAt,
                            },
                            (err, updatedRelease) => {
                                if (err) {
                                    logger.info('Updated Release failed', err)
                                } else {
                                    logger.info(
                                        'release updated',
                                        updatedRelease
                                    )
                                    release = updatedRelease
                                }
                            }
                        )
                    }
                    createJenkinsJob(
                        release,
                        newTestRuns,
                        req.userId || req.body.userId,
                        JobRunningStatus.IN_QUEUE
                    )
                    res.send({
                        status: 200,
                        message: 'Create Job Success',
                        data: {},
                    })
                }
            )
        })
    } catch (error) {
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

const hasCommonElements = (arr1, arr2) => {
    for (let element of arr1) {
        if (arr2.includes(element)) {
            return true
        }
    }
    return false
}

router.post('/v2/createJob/:releaseID', async (req, res) => {
    const warnings = []
    try {
        const release = await Release.findById(req.params.releaseID)
        responseTransformer.passthroughError(
            null,
            release,
            'finding release',
            res,
            async (release) => {
                const releaseModules = release.toObject()?.modules
                const mids = releaseModules?.map((module) => module.moduleID)
                const moduleModal = await Module.find({
                    _id: { $in: mids },
                })

                const newReleaseModules = []
                let updateRelease = false

                const releaseModulesQuery = moduleModal?.map((module) => {
                    return {
                        suiteName: module.suiteName,
                        projectID: module.projectID,
                    }
                })

                let modulesData = await Module.find({
                    $or: releaseModulesQuery,
                }).sort({ createdAt: -1 })

                modulesData = await responseTransformer.getModulesDataWithSteps(
                    modulesData,
                    modulesData[0].projectID,
                    null,
                    null
                )

                const newTestRuns = await Promise.all(
                    moduleModal?.map(async (m) => {
                        const newModule = {}
                        const newReleaseModule = {}

                        let module = modulesData?.filter(
                            (module) =>
                                module.suiteName === m.suiteName &&
                                module.projectID === m.projectID
                        )
                        module = module[0]

                        const relModule = releaseModules.filter(
                            (rModule) =>
                                rModule.moduleID.toString() === m._id.toString()
                        )

                        const { testNodes } = module
                        let tags = relModule[0]?.tags
                        let dependsOn = relModule[0]?.dependsOn

                        const filteredtestNodes = []

                        if (tags) {
                            testNodes?.map((tNode) => {
                                const node = tNode.testNode[0]
                                const nodeTags = node.tags

                                if (tags.length === 0) {
                                    const moduleTags = [
                                        ...new Set(
                                            module?.testNodes
                                                ?.map((m) => m.testNode[0].tags)
                                                .flat()
                                        ),
                                    ]
                                    tags = moduleTags
                                }

                                if (hasCommonElements(tags, nodeTags)) {
                                    filteredtestNodes.push(tNode)
                                }
                            })
                        }

                        const rTestNodes = release
                        const releaseModule = releaseModules?.find(
                            (module) =>
                                module.moduleID.toString() === m._id.toString()
                        )
                        const rids = releaseModule?.testNodes
                        let mids = filteredtestNodes?.map((tNode) => tNode._id)
                        mids = rids?.filter((id) => mids.includes(id))
                        if (mids?.length === 0)
                            mids = filteredtestNodes?.map((tNode) => tNode._id)

                        newModule.moduleID = module?._id
                        newModule.tags = tags
                        newModule.dependsOn = releaseModule?.dependsOn
                        newModule.testNodes = mids
                        newModule.testPlaceholders = module?.testPlaceholders

                        let testRunModule

                        if (m._id.toString() !== module._id.toString()) {
                            testRunModule =
                                responseTransformer.getTestRunModuleWithSteps(
                                    module,
                                    mids,
                                    tags,
                                    dependsOn
                                )

                            const tps = releaseModule.testPlaceholders

                            newReleaseModule.moduleID = module._id.toString()

                            const newTps = tps.map((tp, index) => {
                                const newTp = {
                                    ...module.testPlaceholders[index],
                                    jobId: tp.jobId,
                                    tpId: tp.tpId,
                                    testRunProcessed: tp.testRunProcessed,
                                }
                                return newTp
                            })
                            newReleaseModule.testPlaceholders = newTps
                            newReleaseModule.testNodes = mids
                            newReleaseModule.tags = tags
                            newReleaseModule.dependsOn =
                                releaseModule?.dependsOn
                            newReleaseModules.push(newReleaseModule)

                            updateRelease = true
                        } else {
                            testRunModule =
                                responseTransformer.getTestRunModuleWithSteps(
                                    module,
                                    rids,
                                    tags,
                                    dependsOn
                                )

                            const tps = releaseModule.testPlaceholders
                            newReleaseModule.moduleID = m._id.toString()
                            const newTps = tps.map((tp, index) => {
                                const newTp = {
                                    ...m.testPlaceholders[index],
                                    jobId: tp.jobId,
                                    tpId: tp.tpId,
                                    testRunProcessed: tp.testRunProcessed,
                                }
                                return newTp
                            })

                            newReleaseModule.testPlaceholders = newTps
                            newReleaseModule.testNodes = rids
                            newReleaseModule.tags = tags
                            newReleaseModule.dependsOn =
                                releaseModule?.dependsOn
                            newReleaseModules.push(newReleaseModule)
                        }

                        return testRunModule
                    })
                )

                if (updateRelease) {
                    Release.findByIdAndUpdate(
                        release?._id,
                        {
                            modules: newReleaseModules,
                            createdAt: release?.createdAt,
                            updatedAt: release?.updatedAt,
                        },
                        (err, updatedRelease) => {
                            if (err) {
                                logger.info('Updated Release failed', err)
                            } else {
                                logger.info('release updated', updatedRelease)
                                release = updatedRelease
                            }
                        }
                    )
                }

                createJenkinsJob(
                    release,
                    newTestRuns,
                    req.userId || req.body.userId,
                    JobRunningStatus.IN_QUEUE,
                    req.body.video
                )
                res.send({
                    status: 200,
                    message: 'Create Job Success',
                    data: {},
                })
            }
        )
    } catch (error) {
        logger.info(`Error while creating job ${error}`)
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

router.post('/v1/runJob/:jobId', async (req, res) => {
    const warnings = []
    try {
        Job.findById(req.params.jobId, (err, job) => {
            responseTransformer.passthroughError(
                err,
                job,
                'finding release',
                res,
                async (job) => {
                    const release = await Release.findById(job.releaseID)
                    const templateID = release?.templateID
                    if (templateID) {
                        const template = await Template.findById(templateID)
                        if (template) {
                            jenkinsConfig.parentProject = getJobName(
                                template.name
                            )
                            jenkinsConfig.endpoint = template.endpoint
                            jenkinsConfig.headers.Authorization = `Basic ${Buffer.from(
                                `${template.username}:${template.password}`
                            ).toString('base64')}`
                        }
                    }

                    const crumbResponse = await axios.get(
                        jenkinsConfig.getCrumb(),
                        {
                            headers: {
                                Authorization:
                                    jenkinsConfig.headers.Authorization,
                            },
                        }
                    )

                    const module = await Module.findById(
                        job?.testRun[0]?.moduleID
                    )

                    jenkinsConfig.headers['Jenkins-Crumb'] =
                        crumbResponse.data.crumb
                    const jobName = `${release?.releaseName}_${module?.suiteName}_1`

                    try {
                        const rjdata = await axios.post(
                            jenkinsConfig.runJob(jobName, job._id),
                            {},
                            { headers: jenkinsConfig.headers }
                        )
                        const locationItemRegex = /.*?\/queue\/item\/(\d+)\//g
                        const itemID = locationItemRegex.exec(
                            rjdata.headers.location
                        )[1]
                        await Job.findByIdAndUpdate(job._id, {
                            jenkinsJobID: itemID,
                            jenkinsPath: rjdata.headers.location,
                            runningStatus: JobRunningStatus.IN_QUEUE,
                        })
                    } catch (err) {
                        logger.info(err)
                    }

                    res.send({
                        status: 200,
                        message: 'Create Job Success',
                        data: {},
                    })
                }
            )
        })
    } catch (error) {
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

const getReleaseModuleData = () => {}

router.get('/v2/getReleaseStatus/:releaseId', async (req, res) => {
    const releaseId = req.params.releaseId // Assume releaseId is passed as a query parameter
    try {
        const release = await Release.findOne(
            { _id: releaseId },
            { releaseName: 1, modules: 1, testRunVersion: 1 }
        )
        if (!release) {
            return res.status(404).send({ message: 'Release not found' })
        } else {
            let response = []
            let modulesdata = []
            let counts = []
            let relCounts = []
            let rTestNodes = []
            for (let i = 0; i < release.modules.length; i++) {
                let releasetestnodes = release.modules[i].testNodes

                const modules = await Module.find(
                    { _id: release.modules[i].moduleID },
                    { _id: 1, suiteName: 1, testNodes: 1, testPlaceholders: 1 }
                )
                let query = {
                    releaseID: releaseId,
                    'testRun.moduleID': release.modules[i].moduleID,
                    version: release.testRunVersion,
                }
                const jobs = await Job.find(query, {
                    _id: 1,
                    testRun: 1,
                    version: 1,
                    runningStatus: 1,
                }).sort({ createdAt: -1 })

                let testNodes = []
                counts = []

                for (let mt = 0; mt < modules[0].testNodes.length; mt++) {
                    for (let rtn = 0; rtn < releasetestnodes.length; rtn++) {
                        if (
                            releasetestnodes[rtn] ==
                            modules[0].testNodes[mt]._id
                        ) {
                            // testNodes = []
                            let formattedDuration = ''
                            if (
                                jobs[0]?.testRun[0]?.testNodes[rtn]
                                    ?.executionDuration
                            ) {
                                const exeduration = new Date(
                                    jobs[0].testRun[0].testNodes[
                                        rtn
                                    ].executionDuration
                                )
                                formattedDuration =
                                    parseInt(exeduration.getMinutes(), 10) !== 0
                                        ? moment(exeduration).format(
                                              'm[m] s[s]'
                                          )
                                        : moment(exeduration).format('s[s]')
                            }

                            let testStepStatuses = []
                            if (jobs.length !== 0) {
                                testStepStatuses =
                                    jobs[0].testRun[0].testNodes[rtn]
                                        ?.testCaseSteps
                            } else {
                                testStepStatuses =
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseSteps
                            }
                            testNodes.push({
                                _id: modules[0].testNodes[mt].testNode[0]._id,
                                id: `${modules[0].testNodes[mt].testNode[0]._id}`,
                                suiteName: modules[0].suiteName,
                                testCaseTitle:
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseTitle,
                                testCaseDescription:
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseDescription,
                                testCaseID:
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseID,
                                tags: modules[0].testNodes[mt].testNode[0].tags,
                                automationStatus:
                                    modules[0].testNodes[mt].testNode[0]
                                        .automationStatus,
                                testCaseSteps:
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseSteps,
                                testStepStatuses,
                                status:
                                    jobs.length > 0
                                        ? jobs[0].testRun[0].testNodes[rtn]
                                              ?.status
                                        : JobStatus.UNTESTED,
                                executionStart:
                                    jobs.length > 0
                                        ? jobs[0].testRun[0].testNodes[rtn]
                                              ?.executionStart
                                        : '',
                                executionEnd:
                                    jobs.length > 0
                                        ? jobs[0].testRun[0].testNodes[rtn]
                                              ?.executionEnd
                                        : '',
                                executionDuration: formattedDuration,
                            })
                        }
                    }
                }
                let statusCounts
                let formattedDuration = ''

                jobs?.forEach((job) => {
                    if (job?.testRun[0]?.executionStart) {
                        statusCounts = responseTransformer.getStatusCounts(
                            job?.testRun
                        )
                        counts.push(statusCounts)

                        if (job?.testRun[0]?.executionDuration) {
                            const exeduration = new Date(
                                jobs[0].testRun[0].executionDuration
                            )
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
                })

                const mCounts =
                    responseTransformer.getReleaseStatusCounts(counts)
                relCounts.push(mCounts)

                let mTestNodes = []

                await Promise.all(
                    release.modules[i].testPlaceholders?.map(
                        async (tp, index) => {
                            const job = await Job.findById(tp.jobId)

                            if (job?.testRun[0]?.executionDuration) {
                                const exeduration = new Date(
                                    job.testRun[0].executionDuration
                                )
                                const duration =
                                    parseInt(exeduration.getMinutes(), 10) !== 0
                                        ? moment(exeduration).format(
                                              'm[m] s[s]'
                                          )
                                        : moment(exeduration).format('s[s]')
                            }

                            const newTp = { ...tp }
                            delete newTp.jobId
                            delete newTp.tpId
                            delete newTp.testRunProcessed

                            let data =
                                responseTransformer.getModuleStatusCounts(
                                    modules,
                                    releasetestnodes,
                                    job
                                )
                            if (index === 0) {
                                mTestNodes = data.testNodes
                            }

                            modulesdata.push({
                                _id: `${modules[0]._id}_${tp.tpId}`,
                                moduleName: modules[0].suiteName,
                                testNodes: data.testNodes,
                                testPlaceholders: [tp],
                                executionStart:
                                    jobs.length > 0
                                        ? jobs[0]?.testRun[0]?.executionStart
                                        : '',
                                executionEnd:
                                    modules.length > 0
                                        ? jobs[0]?.testRun[0]?.executionEnd
                                        : '',
                                executionDuration: data.formattedDuration,
                                graphTestCases: {
                                    total:
                                        data?.counts?.length !== 0
                                            ? data?.counts?.total
                                            : data?.testNodes?.length,
                                    untested:
                                        data?.counts.length !== 0
                                            ? data?.counts?.untested
                                            : data?.countstestNodes?.length,
                                    passed:
                                        data?.counts.length !== 0
                                            ? data?.counts?.passed
                                            : 0,
                                    skipped:
                                        data?.counts.length !== 0
                                            ? data?.counts?.skipped
                                            : 0,
                                    failed:
                                        data?.counts.length !== 0
                                            ? data?.counts?.failed
                                            : 0,
                                    blocked: 0,
                                    percentage:
                                        data?.counts.length !== 0
                                            ? data?.counts?.percentage
                                            : 0,
                                },
                            })
                        }
                    )
                )

                const moduleDuration = await getReleaseModuleExecutionDuration(
                    release,
                    release?.testRunVersion,
                    modules[0]._id
                )

                if (mTestNodes.length === 0) mTestNodes = testNodes

                modulesdata.push({
                    _id: modules[0]._id,
                    suiteName: modules[0].suiteName,
                    testNodes: mTestNodes,
                    testPlaceholders: release.modules[i].testPlaceholders,
                    executionStart:
                        jobs.length > 0
                            ? jobs[0]?.testRun[0]?.executionStart
                            : '',
                    executionEnd:
                        modules.length > 0
                            ? jobs[0]?.testRun[0]?.executionEnd
                            : '',
                    executionDuration: moduleDuration,
                    graphTestCases: {
                        total:
                            mCounts.length !== 0
                                ? mCounts?.total
                                : mTestNodes?.length,
                        untested:
                            mCounts.length !== 0
                                ? mCounts?.untested
                                : mTestNodes?.length,
                        passed: mCounts.length !== 0 ? mCounts?.passed : 0,
                        skipped: mCounts.length !== 0 ? mCounts?.skipped : 0,
                        failed: mCounts.length !== 0 ? mCounts?.failed : 0,
                        blocked: 0,
                        percentage:
                            mCounts.length !== 0 ? mCounts?.percentage : 0,
                    },
                })

                rTestNodes = [...rTestNodes, ...mTestNodes]
            }
            const rCounts =
                responseTransformer.getReleaseStatusCounts(relCounts)
            const executionDuration = await getReleaseExecutionDuration(
                release,
                release?.testRunVersion
            )
            const releaseModuleData = {
                _id: releaseId,
                testNodes: rTestNodes,
                graphTestCases: {
                    total:
                        counts?.length !== 0
                            ? rCounts?.total
                            : rTestNodes.length,
                    untested:
                        counts?.length !== 0
                            ? rCounts?.untested
                            : rTestNodes.length,
                    passed: counts?.length !== 0 ? rCounts?.passed : 0,
                    skipped: counts?.length !== 0 ? rCounts?.skipped : 0,
                    failed: counts?.length !== 0 ? rCounts?.failed : 0,
                    blocked: 0,
                    percentage: counts?.length !== 0 ? rCounts?.percentage : 0,
                },
                executionDuration,
            }
            modulesdata.push(releaseModuleData)
            response = {
                _id: releaseId,
                releaseName: release?.releaseName,
                suiteName: 'All Modules',
                modules: modulesdata,
            }
            res.status(200).send({ message: 'Data Avaiable', data: response })
        }
    } catch (error) {
        console.error(error)
        res.status(500).send({
            message: 'An error occurred while fetching data',
        })
    }
})

router.get('/v3/getReleaseStatus/:releaseId', async (req, res) => {
    const releaseId = req.params.releaseId // Assume releaseId is passed as a query parameter
    try {
        const release = await Release.findOne(
            { _id: releaseId },
            { releaseName: 1, modules: 1, testRunVersion: 1 }
        )
        if (!release) {
            return res.status(404).send({ message: 'Release not found' })
        } else {
            let response = []
            let modulesdata = []
            let counts = []
            let relCounts = []
            let rTestNodes = []
            let skipExecutionDuration = false

            const moduleIDs = release.modules.map((module) => module.moduleID)

            let modulesData = await Module.find(
                { _id: { $in: moduleIDs } }, // Find multiple moduleIDs
                {
                    _id: 1,
                    suiteName: 1,
                    testNodes: 1,
                    testPlaceholders: 1,
                    projectID: 1,
                }
            )

            modulesData = await responseTransformer.getModulesDataWithSteps(
                modulesData,
                modulesData[0].projectID,
                releaseId,
                null
            )

            let query = {
                releaseID: releaseId,
                version: release.testRunVersion,
            }
            const jobsData = await Job.find(query, {
                _id: 1,
                testRun: 1,
                version: 1,
                runningStatus: 1,
            }).sort({ createdAt: -1 })

            let latestJob
            for (let i = 0; i < release.modules.length; i++) {
                let releasetestnodes = release.modules[i].testNodes
                let releaseTags = release.modules[i].tags
                const jobs = jobsData.filter(
                    (job) =>
                        job.testRun[0].moduleID === release.modules[i].moduleID
                )

                if (jobs) latestJob = jobs[0]

                let testNodes = []
                let fetchStatusCounts = false
                counts = []
                const modules = modulesData.filter(
                    (module) =>
                        module._id.toString() ===
                        release.modules[i].moduleID.toString()
                )

                for (let mt = 0; mt < modules[0].testNodes.length; mt++) {
                    for (let rtn = 0; rtn < releasetestnodes.length; rtn++) {
                        if (
                            releasetestnodes[rtn] ==
                            modules[0].testNodes[mt]._id
                        ) {
                            // testNodes = []
                            let formattedDuration = ''
                            if (
                                jobs[0]?.testRun[0]?.testNodes[rtn]
                                    ?.executionDuration
                            ) {
                                const exeduration = new Date(
                                    jobs[0].testRun[0].testNodes[
                                        rtn
                                    ].executionDuration
                                )
                                formattedDuration =
                                    parseInt(exeduration.getMinutes(), 10) !== 0
                                        ? moment(exeduration).format(
                                              'm[m] s[s]'
                                          )
                                        : moment(exeduration).format('s[s]')
                            }

                            let testStepStatuses = []
                            if (jobs.length !== 0) {
                                testStepStatuses =
                                    jobs[0].testRun[0].testNodes[rtn]
                                        ?.testCaseSteps
                            } else {
                                testStepStatuses =
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseSteps
                            }
                            testNodes.push({
                                _id: modules[0].testNodes[mt].testNode[0]._id,
                                id: `${modules[0].testNodes[mt].testNode[0]._id}`,
                                suiteName: modules[0].suiteName,
                                testCaseTitle:
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseTitle,
                                testCaseDescription:
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseDescription,
                                testCaseID:
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseID,
                                tags: modules[0].testNodes[mt].testNode[0].tags,
                                automationStatus:
                                    modules[0].testNodes[mt].testNode[0]
                                        .automationStatus,
                                testCaseSteps:
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseSteps,
                                testStepStatuses,
                                status:
                                    jobs.length > 0
                                        ? jobs[0].testRun[0].testNodes[rtn]
                                              ?.status
                                        : JobStatus.UNTESTED,
                                executionStart:
                                    jobs.length > 0
                                        ? jobs[0].testRun[0].testNodes[rtn]
                                              ?.executionStart
                                        : '',
                                executionEnd:
                                    jobs.length > 0
                                        ? jobs[0].testRun[0].testNodes[rtn]
                                              ?.executionEnd
                                        : '',
                                executionDuration: formattedDuration,
                            })

                            if (jobs.length > 0) {
                                const status =
                                    jobs[0].testRun[0].testNodes[rtn]?.status
                                if (status !== JobStatus.UNTESTED)
                                    fetchStatusCounts = true
                            }
                        }
                    }
                }
                let statusCounts
                let formattedDuration = ''

                const jobTags = jobs[0]?.testRun[0]?.tags
                jobs?.forEach((job) => {
                    skipExecutionDuration =
                        releaseTags?.sort().toString() ==
                        jobTags?.sort().toString()

                    if (
                        (job?.testRun[0]?.executionStart &&
                            skipExecutionDuration) ||
                        !jobTags ||
                        fetchStatusCounts
                    ) {
                        statusCounts = responseTransformer.getStatusCounts(
                            job?.testRun
                        )
                        counts.push(statusCounts)

                        if (job?.testRun[0]?.executionDuration) {
                            const exeduration = new Date(
                                jobs[0].testRun[0].executionDuration
                            )
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
                })
                const mCounts =
                    responseTransformer.getReleaseStatusCounts(counts)
                relCounts.push(mCounts)
                let mTestNodes = []

                await Promise.all(
                    release.modules[i].testPlaceholders?.map(
                        async (tp, index) => {
                            const job = await Job.findById(tp.jobId)

                            if (job?.testRun[0]?.executionDuration) {
                                const exeduration = new Date(
                                    job.testRun[0].executionDuration
                                )
                                const duration =
                                    parseInt(exeduration.getMinutes(), 10) !== 0
                                        ? moment(exeduration).format(
                                              'm[m] s[s]'
                                          )
                                        : moment(exeduration).format('s[s]')
                            }

                            const newTp = { ...tp }
                            delete newTp.jobId
                            delete newTp.tpId
                            delete newTp.testRunProcessed

                            let data =
                                responseTransformer.getModuleStatusCounts(
                                    modules,
                                    releasetestnodes,
                                    job
                                )
                            if (index === 0) {
                                mTestNodes = data.testNodes
                            }

                            modulesdata.push({
                                _id: `${modules[0]._id}_${tp.tpId}`,
                                moduleName: modules[0].suiteName,
                                testNodes: data.testNodes,
                                testPlaceholders: [tp],
                                executionStart:
                                    jobs.length > 0
                                        ? jobs[0]?.testRun[0]?.executionStart
                                        : '',
                                executionEnd:
                                    modules.length > 0
                                        ? jobs[0]?.testRun[0]?.executionEnd
                                        : '',
                                executionDuration: skipExecutionDuration
                                    ? data.formattedDuration
                                    : null,
                                graphTestCases: {
                                    total:
                                        data?.counts?.length !== 0
                                            ? data?.counts?.total
                                            : data?.testNodes?.length,
                                    untested:
                                        data?.counts.length !== 0
                                            ? data?.counts?.untested
                                            : data?.countstestNodes?.length,
                                    passed:
                                        data?.counts.length !== 0
                                            ? data?.counts?.passed
                                            : 0,
                                    skipped:
                                        data?.counts.length !== 0
                                            ? data?.counts?.skipped
                                            : 0,
                                    failed:
                                        data?.counts.length !== 0
                                            ? data?.counts?.failed
                                            : 0,
                                    blocked: 0,
                                    percentage:
                                        data?.counts.length !== 0
                                            ? data?.counts?.percentage
                                            : 0,
                                },
                            })
                        }
                    )
                )

                const moduleDuration = await getReleaseModuleExecutionDuration(
                    release,
                    release?.testRunVersion,
                    modules[0]._id
                )

                if (mTestNodes.length === 0) mTestNodes = testNodes
                const mCountsExists = parseInt(mCounts?.total, 10) !== 0
                modulesdata.push({
                    _id: modules[0]._id,
                    suiteName: modules[0].suiteName,
                    testNodes: mTestNodes,
                    testPlaceholders: release.modules[i].testPlaceholders,
                    executionStart:
                        jobs.length > 0
                            ? jobs[0]?.testRun[0]?.executionStart
                            : '',
                    executionEnd:
                        modules.length > 0
                            ? jobs[0]?.testRun[0]?.executionEnd
                            : '',
                    executionDuration: skipExecutionDuration
                        ? moduleDuration
                        : null,
                    graphTestCases: {
                        total: mCountsExists
                            ? mCounts?.total
                            : mTestNodes?.length,
                        untested: mCountsExists
                            ? mCounts?.untested
                            : mTestNodes?.length,
                        passed: mCountsExists ? mCounts?.passed : 0,
                        skipped: mCountsExists ? mCounts?.skipped : 0,
                        failed: mCountsExists ? mCounts?.failed : 0,
                        blocked: 0,
                        percentage: mCountsExists ? mCounts?.percentage : 0,
                    },
                })

                rTestNodes = [...rTestNodes, ...mTestNodes]
            }

            const rCounts =
                responseTransformer.getReleaseStatusCounts(relCounts)
            const executionDuration = await getReleaseExecutionDuration(
                release,
                release?.testRunVersion
            )
            const releaseModuleData = {
                _id: releaseId,
                testNodes: rTestNodes,
                graphTestCases: {
                    total:
                        counts?.length !== 0
                            ? rCounts?.total
                            : rTestNodes.length,
                    untested:
                        counts?.length !== 0
                            ? rCounts?.untested
                            : rTestNodes.length,
                    passed: counts?.length !== 0 ? rCounts?.passed : 0,
                    skipped: counts?.length !== 0 ? rCounts?.skipped : 0,
                    failed: counts?.length !== 0 ? rCounts?.failed : 0,
                    blocked: 0,
                    percentage: counts?.length !== 0 ? rCounts?.percentage : 0,
                },
                executionDuration: skipExecutionDuration
                    ? executionDuration
                    : null,
            }
            modulesdata.push(releaseModuleData)
            response = {
                _id: releaseId,
                releaseName: release?.releaseName,
                suiteName: 'All Modules',
                modules: modulesdata,
                runningStatus: latestJob?.runningStatus,
            }
            // Remove keys where value is null, undefined, empty string, or spaces only
            Object.keys(response).forEach((key) => {
                if (
                    response[key] == null ||
                    response[key].toString().trim() === ''
                ) {
                    delete response[key]
                }
            })
            res.status(200).send({ message: 'Data Avaiable', data: response })
        }
    } catch (error) {
        console.error(error)
        res.status(500).send({
            message: 'An error occurred while fetching data',
        })
    }
})

router.get('/v2/getTestRunStatus/:jobId', async (req, res) => {
    const jobId = req.params.jobId // Assume releaseId is passed as a query parameter
    try {
        const job = await Job.findOne(
            { _id: jobId },
            { _id: 1, testRun: 1, version: 1, runningStatus: 1, releaseID: 1 }
        )
        const release = await Release.findOne(
            { _id: job?.releaseID },
            {
                releaseName: 1,
                modules: 1,
            }
        )
        let jobs
        if (!job) {
            return res.status(404).send({ message: 'Job not found' })
        } else {
            let response = []
            let modulesdata = []
            let counts = []
            let rTestNodes = []
            for (let i = 0; i < job?.testRun?.length; i++) {
                let releasetestnodes = release?.modules?.find(
                    (module) => module.moduleID === job?.testRun[0]?.moduleID
                )?.testNodes

                const modules = await Module.find(
                    { _id: job?.testRun[0]?.moduleID },
                    { _id: 1, suiteName: 1, testNodes: 1, testPlaceholders: 1 }
                )

                jobs = [job]

                if (!releasetestnodes) {
                    const module = modules[0]
                    const testNodes = module.testNodes
                    releasetestnodes = testNodes?.map((tNode) => tNode._id)
                }

                let testNodes = []

                for (let mt = 0; mt < modules[0].testNodes.length; mt++) {
                    for (let rtn = 0; rtn < releasetestnodes?.length; rtn++) {
                        if (
                            releasetestnodes[rtn]?.toString() ===
                            modules[0].testNodes[mt]?._id.toString()
                        ) {
                            let formattedDuration = ''
                            if (
                                jobs[0]?.testRun[0]?.testNodes[rtn]
                                    ?.executionDuration
                            ) {
                                const exeduration = new Date(
                                    jobs[0].testRun[0].testNodes[
                                        rtn
                                    ].executionDuration
                                )
                                formattedDuration =
                                    parseInt(exeduration.getMinutes(), 10) !== 0
                                        ? moment(exeduration).format(
                                              'm[m] s[s]'
                                          )
                                        : moment(exeduration).format('s[s]')
                            }
                            let testStepStatuses = []
                            if (jobs.length !== 0) {
                                testStepStatuses =
                                    jobs[0].testRun[0].testNodes[rtn]
                                        ?.testCaseSteps
                            } else {
                                testStepStatuses =
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseSteps
                            }
                            testNodes.push({
                                _id: modules[0].testNodes[mt]._id,
                                id: `${modules[0].testNodes[mt]._id}`,
                                moduleId: modules[0]._id,
                                suiteName: modules[0].suiteName,
                                testCaseTitle:
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseTitle,
                                testCaseDescription:
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseDescription,
                                testCaseID:
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseID,
                                tags: modules[0].testNodes[mt].testNode[0].tags,
                                automationStatus:
                                    modules[0].testNodes[mt].testNode[0]
                                        .automationStatus,
                                testCaseSteps:
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseSteps,
                                testStepStatuses,
                                status:
                                    jobs.length > 0
                                        ? jobs[0].testRun[0].testNodes[rtn]
                                              ?.status
                                        : JobStatus.UNTESTED,
                                executionStart:
                                    jobs.length > 0
                                        ? jobs[0].testRun[0].testNodes[rtn]
                                              ?.executionStart
                                        : '',
                                executionEnd:
                                    jobs.length > 0
                                        ? jobs[0].testRun[0].testNodes[rtn]
                                              ?.executionEnd
                                        : '',
                                executionDuration: formattedDuration,
                            })
                        }
                    }
                }
                let statusCounts
                let formattedDuration = ''
                jobs?.forEach((job) => {
                    statusCounts = responseTransformer.getStatusCounts(
                        job?.testRun
                    )
                    // counts.push(statusCounts)
                })
                if (jobs[0].testRun[0].executionDuration) {
                    // jobs?.forEach((job) => {
                    //     statusCounts = responseTransformer.getStatusCounts(
                    //         job?.testRun
                    //     )
                    //     // counts.push(statusCounts)
                    // })
                    const exeduration = new Date(
                        jobs[0].testRun[0].executionDuration
                    )
                    formattedDuration =
                        parseInt(exeduration.getMinutes(), 10) !== 0
                            ? moment(exeduration).format('m[m] s[s]')
                            : moment(exeduration).format('s[s]')
                }
                // else {
                //     statusCounts = {
                //         total: testNodes?.length,
                //         untested: testNodes?.length,
                //         passed: 0,
                //         skipped: 0,
                //         failed: 0,
                //         percentage: 0,
                //     }
                // }

                counts.push(statusCounts)

                modulesdata.push({
                    _id: modules[0]._id,
                    suiteName: modules[0].suiteName,
                    testNodes: testNodes,
                    testPlaceholders: modules[0].testPlaceholders,
                    executionStart:
                        jobs.length > 0
                            ? jobs[0].testRun[0].executionStart
                            : '',
                    executionEnd:
                        modules.length > 0
                            ? jobs[0].testRun[0].executionEnd
                            : '',
                    executionDuration: formattedDuration,
                    graphTestCases: {
                        total: statusCounts
                            ? statusCounts?.total
                            : testNodes?.length,
                        untested: statusCounts
                            ? statusCounts?.untested
                            : testNodes?.length,
                        passed: statusCounts ? statusCounts?.passed : 0,
                        skipped: statusCounts ? statusCounts?.skipped : 0,
                        failed: statusCounts ? statusCounts?.failed : 0,
                        blocked: 0,
                        percentage: statusCounts ? statusCounts?.percentage : 0,
                    },
                })
                rTestNodes = [...rTestNodes, ...testNodes]
            }
            const rCounts = responseTransformer.getReleaseStatusCounts(counts)
            let executionDuration = ''
            if (jobs[0]?.testRun[0]?.executionDuration) {
                const exeduration = new Date(
                    jobs[0].testRun[0].executionDuration
                )
                executionDuration =
                    parseInt(exeduration.getMinutes(), 10) !== 0
                        ? moment(exeduration).format('m[m] s[s]')
                        : moment(exeduration).format('s[s]')
            }
            const releaseModuleData = {
                _id: jobId,
                testNodes: rTestNodes,
                graphTestCases: {
                    total: rCounts?.total,
                    untested: rCounts?.untested,
                    passed: rCounts?.passed,
                    skipped: rCounts?.skipped,
                    failed: rCounts?.failed,
                    blocked: 0,
                    percentage: rCounts?.percentage,
                },
                executionDuration,
            }
            modulesdata.push(releaseModuleData)

            response = {
                _id: jobId,
                releaseName: release?.releaseName,
                suiteName: 'All Modules',
                modules: modulesdata,
            }
            res.status(200).send({ message: 'Data Avaiable', data: response })
        }
    } catch (error) {
        console.error(error)
        res.status(500).send({
            message: 'An error occurred while fetching data',
        })
    }
})

router.get('/v3/getTestRunStatus/:jobId', async (req, res) => {
    const jobId = req.params.jobId
    try {
        const result = await getTestRunStatus(jobId)
        res.send(result)
    } catch (error) {
        console.error(error)
        res.status(500).send({
            message: 'An error occurred while fetching data',
        })
    }
})

const getTestRunStatus = async (jobId) => {
    try {
        const job = await Job.findOne(
            { _id: jobId },
            { _id: 1, testRun: 1, version: 1, runningStatus: 1, releaseID: 1 }
        )
        const release = await Release.findOne(
            { _id: job?.releaseID },
            {
                releaseName: 1,
                modules: 1,
                _id: 1,
            }
        )
        let jobs
        if (!job) {
            return res.status(404).send({ message: 'Job not found' })
        } else {
            let response = []
            let modulesdata = []
            let counts = []
            let rTestNodes = []
            for (let i = 0; i < job?.testRun?.length; i++) {
                let releasetestnodes = release?.modules?.find(
                    (module) => module.moduleID === job?.testRun[0]?.moduleID
                )?.testNodes

                let modules = await Module.find(
                    { _id: job?.testRun[0]?.moduleID },
                    {
                        _id: 1,
                        suiteName: 1,
                        testNodes: 1,
                        testPlaceholders: 1,
                        projectID: 1,
                    }
                )

                const moduleTags = [
                    ...new Set(
                        modules[0]?.testNodes
                            ?.map((m) => m.testNode[0].tags)
                            .flat()
                    ),
                ]

                modules = await responseTransformer.getModulesDataWithSteps(
                    modules,
                    modules[0]?.projectID,
                    null,
                    jobId
                )

                jobs = [job]

                let jobTags = jobs[0]?.testRun[0]?.tags

                if (jobTags?.length === 0) jobTags = moduleTags

                if (!releasetestnodes || (jobTags && jobTags.length !== 0)) {
                    const module = modules[0]
                    const testNodes = module.testNodes

                    if (jobTags) {
                        releasetestnodes = testNodes?.map((tNode) => {
                            if (
                                tNode._id &&
                                hasCommonElements(
                                    tNode.testNode[0].tags,
                                    jobTags
                                )
                            )
                                return tNode._id
                        })
                        releasetestnodes = releasetestnodes.filter((n) => n)
                    } else {
                        releasetestnodes = testNodes?.map((tNode) => tNode._id)
                    }
                }

                let testNodes = []

                for (let mt = 0; mt < modules[0].testNodes.length; mt++) {
                    for (let rtn = 0; rtn < releasetestnodes?.length; rtn++) {
                        if (
                            releasetestnodes[rtn]?.toString() ===
                            modules[0].testNodes[mt]?._id.toString()
                        ) {
                            let formattedDuration = ''
                            if (
                                jobs[0]?.testRun[0]?.testNodes[rtn]
                                    ?.executionDuration
                            ) {
                                const exeduration = new Date(
                                    jobs[0].testRun[0].testNodes[
                                        rtn
                                    ].executionDuration
                                )
                                formattedDuration =
                                    parseInt(exeduration.getMinutes(), 10) !== 0
                                        ? moment(exeduration).format(
                                              'm[m] s[s]'
                                          )
                                        : moment(exeduration).format('s[s]')
                            }
                            let testStepStatuses = []
                            if (jobs.length !== 0) {
                                testStepStatuses =
                                    jobs[0].testRun[0].testNodes[rtn]
                                        ?.testCaseSteps
                            } else {
                                testStepStatuses =
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseSteps
                            }
                            const id = modules[0].testNodes[mt]._id
                            testNodes.push({
                                _id: modules[0].testNodes[mt]._id,
                                id: `${modules[0].testNodes[mt]._id}`,
                                moduleId: modules[0]._id,
                                suiteName: modules[0].suiteName,
                                testCaseTitle:
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseTitle,
                                testCaseDescription:
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseDescription,
                                testCaseID:
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseID,
                                tags: modules[0].testNodes[mt].testNode[0].tags,
                                automationStatus:
                                    modules[0].testNodes[mt].testNode[0]
                                        .automationStatus,
                                testCaseSteps:
                                    modules[0].testNodes[mt].testNode[0]
                                        .testCaseSteps,
                                testStepStatuses,
                                status:
                                    jobs.length > 0
                                        ? jobs[0].testRun[0].testNodes[rtn]
                                              ?.status
                                        : JobStatus.UNTESTED,
                                executionStart:
                                    jobs.length > 0
                                        ? jobs[0].testRun[0].testNodes[rtn]
                                              ?.executionStart
                                        : '',
                                executionEnd:
                                    jobs.length > 0
                                        ? jobs[0].testRun[0].testNodes[rtn]
                                              ?.executionEnd
                                        : '',
                                executionDuration: formattedDuration,
                            })
                        }
                    }
                }
                let statusCounts
                let formattedDuration = ''
                jobs?.forEach((job) => {
                    statusCounts = responseTransformer.getStatusCounts(
                        job?.testRun
                    )
                    // counts.push(statusCounts)
                })
                if (jobs[0].testRun[0].executionDuration) {
                    // jobs?.forEach((job) => {
                    //     statusCounts = responseTransformer.getStatusCounts(
                    //         job?.testRun
                    //     )
                    //     // counts.push(statusCounts)
                    // })
                    const exeduration = new Date(
                        jobs[0].testRun[0].executionDuration
                    )
                    formattedDuration =
                        parseInt(exeduration.getMinutes(), 10) !== 0
                            ? moment(exeduration).format('m[m] s[s]')
                            : moment(exeduration).format('s[s]')
                }
                // else {
                //     statusCounts = {
                //         total: testNodes?.length,
                //         untested: testNodes?.length,
                //         passed: 0,
                //         skipped: 0,
                //         failed: 0,
                //         percentage: 0,
                //     }
                // }

                counts.push(statusCounts)

                modulesdata.push({
                    _id: modules[0]._id,
                    suiteName: modules[0].suiteName,
                    testNodes: testNodes,
                    testPlaceholders: modules[0].testPlaceholders,
                    executionStart:
                        jobs.length > 0
                            ? jobs[0].testRun[0].executionStart
                            : '',
                    executionEnd:
                        modules.length > 0
                            ? jobs[0].testRun[0].executionEnd
                            : '',
                    executionDuration: formattedDuration,
                    graphTestCases: {
                        total: statusCounts
                            ? statusCounts?.total
                            : testNodes?.length,
                        untested: statusCounts
                            ? statusCounts?.untested
                            : testNodes?.length,
                        passed: statusCounts ? statusCounts?.passed : 0,
                        skipped: statusCounts ? statusCounts?.skipped : 0,
                        failed: statusCounts ? statusCounts?.failed : 0,
                        blocked: 0,
                        percentage: statusCounts ? statusCounts?.percentage : 0,
                    },
                })
                rTestNodes = [...rTestNodes, ...testNodes]
            }
            const rCounts = responseTransformer.getReleaseStatusCounts(counts)
            let executionDuration = ''
            if (jobs[0]?.testRun[0]?.executionDuration) {
                const exeduration = new Date(
                    jobs[0].testRun[0].executionDuration
                )
                executionDuration =
                    parseInt(exeduration.getMinutes(), 10) !== 0
                        ? moment(exeduration).format('m[m] s[s]')
                        : moment(exeduration).format('s[s]')
            }
            const releaseModuleData = {
                _id: jobId,
                testNodes: rTestNodes,
                graphTestCases: {
                    total: rCounts?.total,
                    untested: rCounts?.untested,
                    passed: rCounts?.passed,
                    skipped: rCounts?.skipped,
                    failed: rCounts?.failed,
                    blocked: 0,
                    percentage: rCounts?.percentage,
                },
                executionDuration,
            }
            modulesdata.push(releaseModuleData)

            response = {
                _id: jobId,
                releaseName: release?.releaseName,
                releaseId: release?._id,
                suiteName: 'All Modules',
                modules: modulesdata,
                runningStatus: job.runningStatus,
            }
            return { status: 200, message: 'Data Avaiable', data: response }
        }
    } catch (error) {
        console.error(error)
        return {
            status: 500,
            message: 'An error occurred while fetching data',
        }
    }
}

router.get('/getMultipleTestRunStatus/:ids', async (req, res) => {
    let jobIds = req.params.ids.split(',')
    const promises = jobIds.map((id) => getTestRunStatus(id))
    try {
        const results = await Promise.all(promises)
        res.send(results)
    } catch (error) {
        console.error(error)
        res.status(500).send({
            message: 'An error occurred while fetching data',
        })
    }
})

router.post('/v1/exportModule', async (req, res) => {
    let body = req.body
    let projectid = body.ProjectId
    const modules = await Module.find(
        {
            projectID: projectid,
        },
        {
            _id: 1,
            version: 1,
            suiteName: 1,
        },
        {
            sort: { createdAt: -1 },
        }
    )
    const uniqueSuites = new Set()
    const result = []

    for (const item of modules) {
        if (!uniqueSuites.has(item.suiteName)) {
            uniqueSuites.add(item.suiteName)
            result.push(item)
        }
    }
    let ModuleIds = []
    for (let i = 0; i < result.length; i++) {
        ModuleIds.push(result[i]._id)
    }
    if (ModuleIds.length < 1) {
        res.send({ status: 204, Message: 'Module ID Required', data: [] })
    } else {
        let respdata = []
        for (let m = 0; m < ModuleIds.length; m++) {
            let modulesdata = await Module.find(
                { _id: ModuleIds[m] },
                { _id: 1, suiteName: 1, testNodes: 1 }
            )

            modulesdata = await responseTransformer.getModulesDataWithSteps(
                modulesdata,
                projectid,
                null,
                null
            )
            let exceldata = []
            for (let x = 0; x < modulesdata.length; x++) {
                for (let y = 0; y < modulesdata[x].testNodes.length; y++) {
                    let steps =
                        modulesdata[x].testNodes[y].testNode[0].testCaseSteps
                    steps = steps.filter(
                        (step) =>
                            !Object.keys(step).some((key) =>
                                ExcludeKeys.includes(key)
                            )
                    )
                    let stepno = 1
                    for (let z = 0; z < steps.length; z++) {
                        let tstr = JSON.stringify(steps[z])

                        const subArr = ExcludeKeys.filter((str) =>
                            tstr.includes(str)
                        )
                        if (subArr.length == 0) {
                            const newMsg = {}
                            let tsd = responseTransformer.findVal(
                                JSON.parse(tstr),
                                KEYS.TESTSTEPDESCRIPTION
                            )
                            if (z == 0) {
                                if (tsd === 'undefined' || tsd == undefined) {
                                } else {
                                    newMsg.testCaseID =
                                        modulesdata[x].testNodes[
                                            y
                                        ].testNode[0].testCaseID
                                    newMsg.testCaseTitle =
                                        modulesdata[x].testNodes[
                                            y
                                        ].testNode[0].testCaseTitle
                                    newMsg.testCaseDescription =
                                        modulesdata[x].testNodes[
                                            y
                                        ].testNode[0].testCaseDescription
                                    newMsg.StepNo = stepno
                                    newMsg.Expected = tsd
                                    newMsg.testStepDescription = tsd
                                }
                            } else {
                                if (tsd === 'undefined' || tsd == undefined) {
                                } else {
                                    newMsg.testCaseID = ''
                                    newMsg.testCaseTitle = ''
                                    newMsg.testCaseDescription = ''
                                    newMsg.StepNo = stepno
                                    newMsg.Expected = tsd
                                    newMsg.testStepDescription = tsd
                                }
                            }
                            exceldata.push(newMsg)
                            stepno++
                        }
                    }
                }
            }

            respdata.push({ sname: modulesdata[0].suiteName, edata: exceldata })
        }

        response = {
            exceldata: respdata,
        }
        res.status(200).send({ message: 'Data Avaiable', data: response })
    }
})

router.post('/v1/tagTestCases', async (req, res) => {
    let body = req.body
    let respdata = []

    const modulesdata = await Module.find(
        { projectID: body.ProjectId },
        { _id: 1, suiteName: 1, testNodes: 1, version: 1 },
        { sort: { createdAt: -1 } }
    )
    let tagMap = new Map()
    let x = 0
    // for (let x = 0; x < modulesdata.length; x++) {
    for (let y = 0; y < modulesdata[x].testNodes.length; y++) {
        let tagsdt = modulesdata[x].testNodes[y].testNode[0].tags
        let testCaseID = modulesdata[x].testNodes[y].testNode[0].testCaseID
        let testCaseTitle =
            modulesdata[x].testNodes[y].testNode[0].testCaseTitle
        let testCaseDescription =
            modulesdata[x].testNodes[y].testNode[0].testCaseDescription
        let testCaseSteps =
            modulesdata[x].testNodes[y].testNode[0].testCaseSteps

        for (let t = 0; t < tagsdt.length; t++) {
            if (!tagMap.has(tagsdt[t])) {
                tagMap.set(tagsdt[t], new Map())
            }
            if (!tagMap.get(tagsdt[t]).has(testCaseID)) {
                tagMap.get(tagsdt[t]).set(testCaseID, {
                    testCaseID,
                    testCaseTitle,
                    testCaseDescription,
                    testCaseSteps,
                })
            }
        }
    }
    // }
    let tags = Array.from(tagMap, ([tagname, testCaseMap]) => ({
        tagname,
        testCase: Array.from(testCaseMap.values()),
    }))

    let excdt = []
    for (let i = 0; i < tags.length; i++) {
        for (let j = 0; j < tags[i].testCase.length; j++) {
            if (j == 0) {
                excdt.push({
                    tagname: tags[i].tagname,
                    testCaseID: tags[i].testCase[j].testCaseID,
                    testCaseTitle: tags[i].testCase[j].testCaseTitle,
                    testCaseDescription:
                        tags[i].testCase[j].testCaseDescription,
                })
            } else {
                excdt.push({
                    tagname: '',
                    testCaseID: tags[i].testCase[j].testCaseID,
                    testCaseTitle: tags[i].testCase[j].testCaseTitle,
                    testCaseDescription:
                        tags[i].testCase[j].testCaseDescription,
                })
            }
            exceldata.push(newMsg)
        }
    }

    respdata.push({ tags: tags })

    response = {
        exceldata: respdata,
    }
    res.status(200).send({ message: 'Data Avaiable', data: response })
})
router.post('/v1/deleteFiles', async (req, res) => {
    let jobArray = []
    let jobsDeleted = []
    const jobsdata = await Job.find({}, { _id: 1 })
    if (jobsdata.length > 0) {
        console.log(jobsdata)
        jobArray = jobsdata.map((job) => job.id)
    }

    const bucketName = process.env.AWS_S3_BUCKET
    const folderNames = ['jobs', 'videos']

    folderNames.forEach((folderName) => {
        console.log(`Deleting objects from folder: ${folderName}`)
        async function deleteFolder(bucketName, folderName) {
            try {
                let continuationToken
                let objectsToDelete = []

                do {
                    objectsToDelete = []
                    const listParams = {
                        Bucket: bucketName,
                        Prefix: folderName,
                        ContinuationToken: continuationToken,
                    }

                    const listResponse = await s3.send(
                        new ListObjectsV2Command(listParams)
                    )
                    continuationToken = listResponse.NextContinuationToken

                    if (listResponse.Contents) {
                        for (const obj of listResponse.Contents) {
                            const subArr = !jobArray.includes(
                                obj.Key.split('/')[1]
                            )
                            if (subArr) {
                                jobsDeleted.push(obj.Key.split('/')[1])
                                objectsToDelete.push({ Key: obj.Key })
                            }
                        }
                        console.log('jobs Deleted', jobsDeleted.length)
                        console.log('objectsToDelete ', objectsToDelete.length)
                        const deleteParams = {
                            Bucket: bucketName,
                            Delete: {
                                Objects: objectsToDelete,
                            },
                        }

                        if (objectsToDelete.length > 0) {
                            await s3.send(
                                new DeleteObjectsCommand(deleteParams)
                            )
                            console.log(
                                `Deleted all objects in folder ${folderName}`
                            )
                        }
                    }
                } while (continuationToken)

                jobsDeleted = [...new Set(jobsDeleted)]

                if (objectsToDelete.length > 0) {
                    const deleteParams = {
                        Bucket: bucketName,
                        Delete: {
                            Objects: objectsToDelete,
                        },
                    }

                    // await s3.send(new DeleteObjectsCommand(deleteParams))
                    console.log(`Deleted all objects in folder ${folderName}`)
                } else {
                    console.log(`No objects found in folder ${folderName}`)
                }
            } catch (err) {
                console.error('Error deleting objects:', err)
            }
        }

        deleteFolder(bucketName, folderName)
    })

    res.status(200).send({ message: 'Data Avaiable', data: jobsDeleted })
})

router.get('/v1/getmodulestatus/:releaseId', async (req, res) => {
    const releaseId = req.params.releaseId // Assume releaseId is passed as a query parameter
    try {
        // Step 1: Find releases by ID
        const release = await Release.findOne(
            { _id: releaseId },
            { releaseName: 1, modules: 1 }
        )
        if (!release) {
            return res.status(404).send({ message: 'Release not found' })
        } else {
            let respobj = []
            for (let i = 0; i < release.modules.length; i++) {
                let modulesdata = []
                respobj.push({ releaseName: release.releaseName })

                const modules = await Module.find(
                    { _id: release.modules[i].moduleID },
                    { _id: 1, suiteName: 1, testNodes: 1 }
                )
                modulesdata.push({
                    mid: release.modules[i].moduleID,
                })

                let query = {
                    releaseID: releaseId,
                    'testRun.moduleID': release.modules[i].moduleID,
                }
                const jobs = await Job.find(query, {
                    _id: 1,
                    testRun: 1,
                    version: 1,
                    runningStatus: 1,
                }).sort({ createdAt: -1 })
                let testnodes = []
                for (let k = 0; k < jobs[0].testRun[0].testNodes.length; k++) {
                    testnodes.push({
                        status: jobs[0].testRun[0].testNodes[k].status,
                        executionStart:
                            jobs[0].testRun[0].testNodes[k].executionStart,
                        executionEnd:
                            jobs[0].testRun[0].testNodes[k].executionEnd,
                        executionDuration:
                            jobs[0].testRun[0].testNodes[k].executionDuration,
                        testCaseSteps:
                            jobs[0].testRun[0].testNodes[k].testCaseSteps,
                    })
                }
                respobj.push({
                    moduleId: modules[0]._id,
                    suiteName: modules[0].suiteName,
                    runningStatus: jobs[0].runningStatus,
                    jobversion: jobs[0].version,
                    testRunStatus: jobs[0].testRun[0].status,
                    executionStart: jobs[0].testRun[0].executionStart,
                    executionEnd: jobs[0].testRun[0].executionEnd,
                    executionDuration: jobs[0].testRun[0].executionDuration,
                    testNode: testnodes,
                })
            }
            res.status(200).send({ message: 'Data Avaiable', data: respobj })
        }
    } catch (error) {
        console.error(error)
        res.status(500).send({
            message: 'An error occurred while fetching data',
        })
    }
})
// TestResult creation
router.post('/reRunJob/:jobID', async (req, res) => {
    const warnings = []
    try {
        Job.findById(req.params.jobID, async (err, job) => {
            const { testRun } = job
            const newTestRuns = []
            const release = await Release.findById(job?.releaseID)
            testRun?.forEach((module) => {
                const newTestRun = {}

                const { testNodes } = module
                const newTestNodes = testNodes?.map((testNode) => {
                    const newTestNode = {}
                    newTestNode.testNodeID = testNode?.testNodeID
                    newTestNode.status = JobStatus.UNTESTED
                    const newTestSteps = testNode?.testCaseSteps?.map(
                        (testStep) => {
                            const newTestStep = {}
                            newTestStep._id = testStep?._id
                            newTestStep.status = JobStatus.UNTESTED
                            return newTestStep
                        }
                    )
                    newTestNode.testCaseSteps = newTestSteps
                    return newTestNode
                })
                newTestRun.moduleID = module?.moduleID
                newTestRun.testNodes = newTestNodes
                newTestRun.status = JobStatus.UNTESTED
                newTestRuns.push(newTestRun)
            })

            await Job.findByIdAndUpdate(job?._id, {
                runningStatus: 'Re Run',
                testRun: newTestRuns,
            })
            await Job.updateOne(
                { _id: job?._id },
                {
                    $unset: {
                        executionStart: 1,
                        executionDuration: 1,
                        executionEnd: 1,
                    },
                }
            )
            responseTransformer.passthroughError(
                err,
                job,
                'finding release',
                res,
                async (job) => {
                    const release = await Release.findById(job.releaseID)

                    const templateID = release.templateID

                    logger.info('Getting crumb data')
                    if (templateID) {
                        const template = await Template.findById(templateID)
                        if (template) {
                            jenkinsConfig.parentProject = getJobName(
                                template.name
                            )
                            jenkinsConfig.endpoint = template.endpoint
                            jenkinsConfig.headers.Authorization = `Basic ${Buffer.from(
                                `${template.username}:${template.password}`
                            ).toString('base64')}`
                        }
                    }
                    axios
                        .get(jenkinsConfig.getCrumb(), {
                            headers: {
                                Authorization:
                                    jenkinsConfig.headers.Authorization,
                            },
                        })
                        .then((data) => {
                            jenkinsConfig.headers['Jenkins-Crumb'] =
                                data.data.crumb
                            /** automation case **/
                            try {
                                logger.info('Trying to run the job')
                                /** updating jobId in release test Data Ends **/
                                const jobName = job?.jenkinsJobName
                                responseTransformer.passthroughError(
                                    err,
                                    job,
                                    'creating job',
                                    res,
                                    (job) => {
                                        logger.info('Trying to create a job')
                                        axios
                                            .post(
                                                jenkinsConfig.createItem(
                                                    jobName
                                                ),
                                                {},
                                                {
                                                    headers:
                                                        jenkinsConfig.headers,
                                                }
                                            )
                                            .catch((cjerr) =>
                                                logger.error(
                                                    'Issue while posting to jenkins',
                                                    {
                                                        stack: cjerr.stack,
                                                    }
                                                )
                                            )
                                            .finally(() => {
                                                logger.info(
                                                    'Trying to disable the job'
                                                )
                                                axios
                                                    .post(
                                                        jenkinsConfig.disableJob(
                                                            jobName
                                                        ),
                                                        {},
                                                        {
                                                            headers:
                                                                jenkinsConfig.headers,
                                                        }
                                                    )
                                                    .catch((djerr) =>
                                                        logger.error(
                                                            'Issue while disabling the job',
                                                            {
                                                                stack: djerr.stack,
                                                            }
                                                        )
                                                    )
                                                    .finally(() => {
                                                        logger.info(
                                                            'Trying to enable the job'
                                                        )
                                                        axios
                                                            .post(
                                                                jenkinsConfig.enableJob(
                                                                    jobName
                                                                ),
                                                                {},
                                                                {
                                                                    headers:
                                                                        jenkinsConfig.headers,
                                                                }
                                                            )
                                                            .catch((ejerr) =>
                                                                logger.error(
                                                                    'Issue while enabling the job',
                                                                    {
                                                                        stack: ejerr.stack,
                                                                    }
                                                                )
                                                            )
                                                            .finally(() => {
                                                                axios
                                                                    .post(
                                                                        jenkinsConfig.runJob(
                                                                            jobName,
                                                                            job._id
                                                                        ),
                                                                        {},
                                                                        {
                                                                            headers:
                                                                                jenkinsConfig.headers,
                                                                        }
                                                                    )
                                                                    .then(
                                                                        async (
                                                                            rjdata
                                                                        ) => {
                                                                            logger.info(
                                                                                `Run job success, ${JSON.stringify(
                                                                                    rjdata,
                                                                                    responseTransformer.getCircularReplacer()
                                                                                )}`
                                                                            )
                                                                        }
                                                                    )
                                                                    .catch(
                                                                        (
                                                                            rjerr
                                                                        ) => {
                                                                            logger.error(
                                                                                'Run job error',
                                                                                {
                                                                                    stack: rjerr.stack,
                                                                                }
                                                                            )
                                                                            res.status(
                                                                                400
                                                                            ).json(
                                                                                rjerr.data
                                                                            )
                                                                        }
                                                                    )
                                                            })
                                                    })
                                            })
                                    }
                                )
                                //testPlaceholders for loop
                                /**update tps with job Ids starts*/
                            } catch (error) {
                                warnings.push(
                                    `error occurred in createjob ${error}`
                                )
                            }
                            /**update tps with job Ids ends*/
                        }) //releaseModules for loop
                }
            )
            // })
        })
    } catch (error) {
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

// TestResult creation
router.post('/stopJob/:jobID', async (req, res) => {
    const warnings = []
    try {
        Job.findById(req.params.jobID, async (err, job) => {
            const release = await Release.findById(job?.releaseID)

            responseTransformer.passthroughError(
                err,
                job,
                'finding release',
                res,
                async (job) => {
                    const release = await Release.findById(job.releaseID)
                    const templateID = release?.templateID
                    logger.info('Getting crumb data')
                    if (templateID) {
                        const template = await Template.findById(templateID)
                        if (template) {
                            jenkinsConfig.parentProject = getJobName(
                                template.name
                            )
                            jenkinsConfig.endpoint = template.endpoint
                            jenkinsConfig.headers.Authorization = `Basic ${Buffer.from(
                                `${template.username}:${template.password}`
                            ).toString('base64')}`
                        }
                    }
                    axios
                        .get(jenkinsConfig.getCrumb(), {
                            headers: {
                                Authorization:
                                    jenkinsConfig.headers.Authorization,
                            },
                        })
                        .then((data) => {
                            jenkinsConfig.headers['Jenkins-Crumb'] =
                                data.data.crumb
                            /** automation case **/
                            try {
                                logger.info('Trying to stop the job')
                                /** updating jobId in release test Data Ends **/
                                const jobName = job?.jenkinsJobName
                                const jenkinsJobID = job?.jenkinsJobID
                                const jenkinsBuildNumber =
                                    job?.jenkinsBuildNumber
                                responseTransformer.passthroughError(
                                    err,
                                    job,
                                    'Stopping job',
                                    res,
                                    (job) => {
                                        logger.info('Trying to stop job')
                                        if (
                                            (jenkinsJobID &&
                                                jenkinsJobID != 'TODO') ||
                                            jenkinsBuildNumber
                                        ) {
                                            axios
                                                .post(
                                                    jenkinsBuildNumber
                                                        ? jenkinsConfig.stopJobWithBuildNumber(
                                                              jobName,
                                                              jenkinsBuildNumber
                                                          )
                                                        : jenkinsConfig.stopJobWithBuildId(
                                                              jenkinsJobID
                                                          ),
                                                    {},
                                                    {
                                                        headers:
                                                            jenkinsConfig.headers,
                                                    }
                                                )
                                                .then(async (response) => {
                                                    if (
                                                        job?.lambdatest?.status
                                                    ) {
                                                        await Job.findByIdAndUpdate(
                                                            job?._id,
                                                            {
                                                                runningStatus:
                                                                    'Aborted',
                                                                'lambdatest.status':
                                                                    'View',
                                                            }
                                                        )
                                                    } else {
                                                        await Job.findByIdAndUpdate(
                                                            job?._id,
                                                            {
                                                                runningStatus:
                                                                    'Aborted',
                                                            }
                                                        )
                                                    }
                                                })
                                                .catch((cjerr) =>
                                                    logger.error(
                                                        'Issue while posting to jenkins',
                                                        {
                                                            stack: cjerr.stack,
                                                        }
                                                    )
                                                )
                                                .finally(() => {
                                                    logger.info(
                                                        'Trying to disable the job'
                                                    )
                                                })
                                        }
                                    }
                                )
                                //testPlaceholders for loop
                                /**update tps with job Ids starts*/
                            } catch (error) {
                                warnings.push(
                                    `error occurred in createjob ${error}`
                                )
                            }
                            /**update tps with job Ids ends*/
                        }) //releaseModules for loop
                }
            )
            // })
        })
    } catch (error) {
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

// ALL jobs
router.get('/AllJobs', async (req, res) => {
    try {
        if (req.userID) {
            Project.find({ team: { $in: req.userID } }, (err, projects) => {
                responseTransformer.passthroughError(
                    err,
                    projects,
                    'list projects',
                    res,
                    (projects) => {
                        const projectIds = projects.map((p) => p._id)
                        Module.find(
                            { projectID: { $in: projectIds } },
                            (err, modules) => {
                                responseTransformer.passthroughError(
                                    err,
                                    modules,
                                    'list modules',
                                    res,
                                    (modules) => {
                                        const moduleIds = modules.map(
                                            (m) => m._id
                                        )
                                        Release.find(
                                            {
                                                'modules.moduleID': {
                                                    $in: moduleIds,
                                                },
                                            },
                                            (err, releases) => {
                                                responseTransformer.passthroughError(
                                                    err,
                                                    releases,
                                                    'list releases',
                                                    res,
                                                    (releases) => {
                                                        const releaseIds =
                                                            releases.map(
                                                                (r) => r._id
                                                            )
                                                        Job.find(
                                                            {
                                                                releaseID: {
                                                                    $in: releaseIds,
                                                                },
                                                            },
                                                            (err, jobs) => {
                                                                responseTransformer.dbResponseTransformer(
                                                                    err,
                                                                    jobs,
                                                                    'list jobs',
                                                                    res
                                                                )
                                                            }
                                                        )
                                                    }
                                                )
                                            }
                                        )
                                    }
                                )
                            }
                        )
                    }
                )
            })
        } else {
            Job.aggregate([{ $sort: { createdAt: -1 } }], (err, jobs) =>
                responseTransformer.dbResponseTransformer(
                    err,
                    jobs,
                    'list all jobs',
                    res
                )
            )
        }
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

// ALL jobs for a release
router.get('/AllJobs/:releaseID', async (req, res) => {
    const warnings = []
    try {
        Job.aggregate(
            [
                { $match: { releaseID: req.params.releaseID } },
                { $sort: { createdAt: -1 } },
            ],
            (err, jobs) => {
                const newJobs = jobs?.map((job) => {
                    const { testRun } = job
                    const modules = testRun?.map((module) => {
                        const { testNodes } = module
                        const newTestNodes = testNodes?.map((testNode) => {
                            let formattedDuration = ''
                            try {
                                if (testNode.executionDuration) {
                                    const date = new Date(
                                        testNode.executionDuration
                                    )
                                    formattedDuration =
                                        parseInt(date.getMinutes(), 10) !== 0
                                            ? moment(date).format('m[m] s[s]')
                                            : moment(date).format('s[s]')
                                }
                            } catch (error) {
                                warnings.push(error)
                            }
                            return {
                                ...testNode,
                                executionDuration: testNode.executionDuration
                                    ? formattedDuration
                                    : testNode.status === JobStatus
                                      ? '0s'
                                      : null,
                            }
                        })
                        let formattedDuration = ''
                        try {
                            if (module.executionDuration) {
                                const date = new Date(module.executionDuration)
                                formattedDuration =
                                    parseInt(date.getMinutes(), 10) !== 0
                                        ? moment(date).format('m[m] s[s]')
                                        : moment(date).format('s[s]')
                            }
                        } catch (error) {
                            warnings.push(error)
                        }

                        return {
                            ...module,
                            testNodes: newTestNodes,
                            executionDuration: module.executionDuration
                                ? formattedDuration
                                : null,
                        }
                    })

                    let formattedDuration = ''
                    try {
                        if (job.executionDuration) {
                            const date = new Date(
                                parseInt(job.executionDuration, 10)
                            )
                            formattedDuration =
                                parseInt(date.getMinutes(), 10) !== 0
                                    ? moment(date).format('m[m] s[s]')
                                    : moment(date).format('s[s]')
                        }
                    } catch (error) {
                        warnings.push(error)
                    }

                    const newJob = {
                        _id: job._id,
                        jenkinsJobID: job.jenkinsJobID,
                        jenkinsPath: job.jenkinsPath,
                        tpId: job.tpId,
                        releaseID: job.releaseID,
                        createdBy: job.createdBy,
                        createdAt: job.createdAt,
                        reportPortal: job.reportPortal,
                        updatedAt: job.updatedAt,
                        __v: job.__v,
                        executionStart: job.executionStart,
                        testRun: modules,
                        executionDuration: job.executionDuration
                            ? formattedDuration
                            : null,
                        executionEnd: job.executionEnd,
                    }
                    return newJob
                })
                responseTransformer.dbResponseTransformer(
                    err,
                    newJobs,
                    'list all jobs',
                    res
                )
            }
        )
    } catch (error) {
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

//Job Details
router.get('/jobDetails/:id', async (req, res) => {
    const warnings = []
    try {
        const job = await Job.findById(req.params.id)
        // (err, job) => {
        if (job) {
            const { testRun } = job
            const modules = testRun?.map((module) => {
                const { testNodes } = module
                const newTestNodes = testNodes?.map((testNode) => {
                    let formattedDuration = ''
                    try {
                        if (testNode.executionDuration) {
                            const date = new Date(testNode.executionDuration)
                            formattedDuration =
                                parseInt(date.getMinutes(), 10) !== 0
                                    ? moment(date).format('m[m] s[s]')
                                    : moment(date).format('s[s]')
                        } else if (testNode?.status !== JobStatus.UNTESTED) {
                            formattedDuration = '0s'
                        }
                    } catch (error) {
                        warnings.push(error)
                    }
                    return {
                        ...testNode,
                        executionDuration: formattedDuration
                            ? formattedDuration
                            : testNode.status === JobStatus.SKIPPED
                              ? '0s'
                              : null,
                    }
                })
                let formattedDuration = ''
                try {
                    if (module.executionDuration) {
                        const date = new Date(module.executionDuration)
                        formattedDuration =
                            parseInt(date.getMinutes(), 10) !== 0
                                ? moment(date).format('m[m] s[s]')
                                : moment(date).format('s[s]')
                    }
                } catch (error) {
                    warnings.push(error)
                }

                return {
                    ...module,
                    testNodes: newTestNodes,
                    executionDuration: module.executionDuration
                        ? formattedDuration
                        : null,
                }
            })

            let formattedDuration = ''
            try {
                if (job.executionDuration) {
                    const date = new Date(parseInt(job.executionDuration, 10))
                    formattedDuration =
                        parseInt(date.getMinutes(), 10) !== 0
                            ? moment(date).format('m[m] s[s]')
                            : moment(date).format('s[s]')
                }
            } catch (error) {
                warnings.push(error)
            }

            const newJob = {
                _id: job._id,
                jenkinsJobID: job.jenkinsJobID,
                jenkinsPath: job.jenkinsPath,
                tpId: job.tpId,
                releaseID: job.releaseID,
                createdBy: job.createdBy,
                createdAt: job.createdAt,
                reportPortal: job.reportPortal,
                updatedAt: job.updatedAt,
                __v: job.__v,
                executionStart: job.executionStart,
                testRun: modules,
                executionDuration: job.executionDuration
                    ? formattedDuration
                    : null,
                executionEnd: job.executionEnd,
            }
            responseTransformer.dbResponseTransformer(
                null,
                newJob,
                'get job',
                res
            )
        } else {
            res.send({ status: 400, message: 'No Job Found !!' })
        }

        // })
    } catch (error) {
        logger.info(`Encountered issue while serving request : ${error}`)
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.send({ status: 400, message: 'Bad Request', data: error, warnings })
    }
})

// Get Updated Release details where its test runs are executing
router.get('/ReleaseDetail/:ids', async (req, res) => {
    let releaseIds = req.params.ids.split(',')
    let releases, jobs, mergedObj
    let singleModuleReleaseIds = [],
        multiModuleReleaseIds = [],
        singleModuleReleases = [],
        multiModuleReleases = [],
        updatedReleases = []
    let startTime, endTime
    try {
        releases = await Release.find({
            _id: { $in: releaseIds },
        })

        // If a release have multiple modules, it will have multiple jobs or
        // If a release has a single module, it can have multiple testplaceholders (dataproviders)
        // In the above cases, need to fetch the summation of test cases of all the jobs
        for (let release of releases) {
            if (
                release.modules.length === 1 &&
                release.modules[0].testPlaceholders.length <= 1
            ) {
                singleModuleReleaseIds.push(release._id)
                singleModuleReleases.push(release)
            } else {
                multiModuleReleaseIds.push(release._id)
                multiModuleReleases.push(release)
            }
        }

        if (singleModuleReleaseIds.length > 0) {
            jobs = await Job.aggregate([
                {
                    $match: {
                        $or: singleModuleReleases.map((release) => ({
                            releaseID: String(release._id),
                            version: release.testRunVersion,
                        })),
                    },
                },
            ])

            jobs.forEach((job) => {
                let total = 0
                let untested = 0
                let passed = 0
                let skipped = 0
                let failed = 0
                let percentage = 0
                let formattedDuration
                let release = singleModuleReleases.filter(
                    (release) => job.releaseID == release._id
                )
                if (release) {
                    const testRun = job?.testRun
                    const statusCounts =
                        responseTransformer.getStatusCounts(testRun)
                    total += statusCounts?.total
                    untested += statusCounts?.untested
                    passed += statusCounts?.passed
                    skipped += statusCounts?.skipped
                    failed += statusCounts?.failed
                    percentage = parseInt((passed / total) * 100, 10)
                    startTime = moment(job?.executionStart)
                    endTime = moment(job?.executionEnd)
                    duration = moment.duration(endTime.diff(startTime))
                    minutes = duration.minutes()
                    seconds = Math.floor(duration.seconds())
                    formattedDuration = `${minutes}m ${seconds}s`
                    mergedObj = {
                        _id: release[0]._id,
                        releaseName: release[0].releaseName,
                        description: release[0].description,
                        version: release[0].version,
                        releaseDate: release[0].releaseDate,
                        schedule: release[0].schedule,
                        createdBy: release[0].createdBy,
                        createdAt: release[0].createdAt,
                        updatedAt: release[0].updatedAt,
                        __v: release[0].__v,
                        testRunVersion: release[0].testRunVersion,
                        executionStart: job.executionStart,
                        executionDuration: formattedDuration,
                        executionEnd: job.executionEnd,
                        maxDuration: formattedDuration,
                        runningStatus: job.runningStatus,
                        total: total,
                        untested: untested,
                        passed: passed,
                        skipped: skipped,
                        failed: failed,
                        percentage: percentage,
                        latestJobIds: job._id,
                    }
                    updatedReleases.push(mergedObj)
                }
            })
        }

        if (multiModuleReleaseIds.length > 0) {
            jobs = await Job.aggregate([
                {
                    $match: {
                        $or: multiModuleReleases.map((release) => ({
                            releaseID: String(release._id),
                            version: release.testRunVersion,
                        })),
                    },
                },
            ])
            multiModuleReleases.forEach((release) => {
                let total = 0
                let untested = 0
                let passed = 0
                let skipped = 0
                let failed = 0
                let percentage = 0
                let status
                let formattedDuration
                let jobIdsList = []
                let allJobs = jobs.filter((job) => job.releaseID == release._id)
                for (let job of allJobs) {
                    if (job) {
                        const testRun = job?.testRun
                        const statusCounts =
                            responseTransformer.getStatusCounts(testRun)
                        total += statusCounts?.total
                        untested += statusCounts?.untested
                        passed += statusCounts?.passed
                        skipped += statusCounts?.skipped
                        failed += statusCounts?.failed
                        percentage = parseInt((passed / total) * 100, 10)
                        jobIdsList.push(job._id)
                    }
                }

                let obj = getMultiJobsExecDuration(allJobs)
                formattedDuration = obj.formattedTimeDifference
                if (!formattedDuration) formattedDuration = '0m 0s'
                const jobRunning = allJobs.some((job) => {
                    return !['completed', 'aborted', 'manual'].includes(
                        job.runningStatus.toLowerCase()
                    )
                })
                if (jobRunning) status = 'In Progress'
                else status = 'Completed'

                mergedObj = {
                    _id: release._id,
                    releaseName: release.releaseName,
                    description: release.description,
                    version: release.version,
                    releaseDate: release.releaseDate,
                    schedule: release.schedule,
                    createdBy: release.createdBy,
                    createdAt: release.createdAt,
                    updatedAt: release.updatedAt,
                    __v: release.__v,
                    testRunVersion: release.testRunVersion,
                    executionStart: obj.executionStart,
                    executionDuration: formattedDuration,
                    executionEnd: obj.executionEnd,
                    maxDuration: formattedDuration,
                    runningStatus: status,
                    total: total,
                    untested: untested,
                    passed: passed,
                    skipped: skipped,
                    failed: failed,
                    percentage: percentage,
                    latestJobIds: jobIdsList,
                }
                updatedReleases.push(mergedObj)
            })
        }
        // Sorting releases on the basis of executionEnd timestamp attribute
        updatedReleases = updatedReleases.sort(
            // Decreasing order
            (a, b) => new Date(b.executionEnd) - new Date(a.executionEnd)
        )
        res.send({ status: 200, message: 'Sucesss', data: updatedReleases })
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

const getMultiJobsExecDuration = (jobs) => {
    let formattedTimeDifference = null
    let executionStart = null
    let executionEnd = null
    const jobStarts = Array.from(
        new Set(jobs.map((u) => new Date(u.executionStart)))
    )

    const jobEnds = Array.from(
        new Set(jobs.map((u) => new Date(u.executionEnd)))
    )
    const validStartDates = []

    for (const date of jobStarts) {
        const newDate = new Date(date)

        if (newDate.toString() !== 'Invalid Date') {
            validStartDates.push(newDate)
        }
    }

    const validEndDates = []

    for (const date of jobEnds) {
        const newDate = new Date(date)

        if (newDate.toString() !== 'Invalid Date') {
            validEndDates.push(newDate)
        }
    }

    const starttime = Math.max(...validEndDates)
    const endtime = Math.min(...validStartDates)

    if (validEndDates?.length && validStartDates?.length) {
        let timeDiffInMilliseconds = starttime - endtime

        let timeDiffInSeconds = Math.abs(timeDiffInMilliseconds) / 1000

        let minutes = Math.floor(timeDiffInSeconds / 60)
        let seconds = Math.floor(timeDiffInSeconds % 60)

        formattedTimeDifference = `${minutes !== 0 ? `${minutes}m` : ''} ${seconds}s`
        executionStart = moment(endtime)
        executionEnd = moment(starttime)
    }
    return { formattedTimeDifference, executionStart, executionEnd }
}

// Get Updated Executing Jira Jobs
router.get('/jobStatusDetail/:ids', async (req, res) => {
    let jobIds = req.params.ids.split(',')
    let modules = []
    let newJob = []
    let releaseIds = []
    let releases = []
    let jobs, percentage, total, untested, passed, failed, skipped
    try {
        jobs = await Job.find({
            _id: { $in: jobIds },
        })
        jobs.forEach((job) => {
            releaseIds.push(job.releaseID)
        })
        releases = await Release.find({
            _id: { $in: releaseIds },
        })
        for (let i = 0; i < jobs.length; i++) {
            const releaseID = jobs[i].releaseID
            const release = releases.find((rel) => rel._id + '' === releaseID)
            const releaseName = release.releaseName
            const {
                _id,
                jenkinsJobID,
                jenkinsJobName,
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
            } = jobs[i]
            modules = []
            const statusCounts = responseTransformer.getStatusCounts(testRun)
            total = statusCounts?.total || 0
            untested = statusCounts?.untested || 0
            passed = statusCounts?.passed || 0
            skipped = statusCounts?.skipped || 0
            failed = statusCounts?.failed || 0
            percentage = statusCounts?.percentage || 0
            testRun?.forEach((run) => {
                const { testNodes, moduleID } = run || []
                modules.push({
                    moduleID,
                    testNodes,
                })
            })
            const formattedDuration = moment(
                new Date(parseInt(executionDuration, 10))
            ).format('m[m] s[s]')
            const moduleId = modules[0]?.moduleID
            // select is used to fetch only needed fields
            // lean method
            // 1. Converts Mongoose documents into plain JavaScript objects
            // 2. Speeds up read queries by skipping Mongoose processing.
            // 3. No Mongoose methods (.save(), .populate(), .validate()) available.
            const module = await Module.findById(moduleId)
                .select('suiteName')
                .lean()
            const moduleName = module.suiteName
            newJob.push({
                _id,
                testRun: `${moduleName}_${jenkinsJobID}`,
                createdBy,
                createdAt,
                updatedAt,
                __v,
                releaseName,
                jenkinsJobName,
                total,
                untested,
                passed,
                skipped,
                failed,
                percentage,
                executionStart,
                executionEnd,
                executionDuration: executionDuration ? formattedDuration : '',
                lambdatest,
                linuxScreenRecord,
                runningStatus,
            })
        }
        res.send({ status: 200, message: 'Sucesss', data: newJob })
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

// Get latest test run user name for a release
router.get('/latestTestRunUser/:id/:type', async (req, res) => {
    try {
        let release
        let job
        if (req.params.type == 'release') {
            release = await Release.findById(req.params.id)
                .select('testRunVersion')
                .lean()

            job = await Job.findOne({
                releaseID: String(release._id),
                version: release.testRunVersion,
            })
                .select('createdBy')
                .lean()
        } else {
            job = await Job.findById(req.params.id).select('createdBy').lean()
        }

        let userName = await User.findById(job.createdBy)
            .select('firstName lastName')
            .lean()
        userName = userName.firstName + ' ' + userName.lastName
        res.send({ status: 200, message: 'Sucesss', data: userName })
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

const updateStatus = (check, update) => {
    if (check.every((tcs) => tcs.status === 'PASSED')) {
        update.status = 'PASSED'
    } else if (check.some((tcs) => tcs.status === 'FAILED')) {
        update.status = 'FAILED'
    } else if (check.some((tcs) => tcs.status === 'RUNNING')) {
        update.status = 'RUNNING'
    }
}

router.patch('/jobUpdate/:jobID', async (req, res) => {
    try {
        const job = await Job.findById(req.params.jobID)
        // , (err, job) => {
        // responseTransformer.passthroughError(
        //     null,
        //     job,
        //     'find job',
        //     res,
        //     (job) => {

        if (req.body.reportPortalUrl)
            job['reportPortal']['url'] = req.body.reportPortalUrl
        job['jenkinsJobName'] = req.body?.jenkinsJobName
        job['jenkinsBuildNumber'] = req.body?.jenkinsBuildNumber
        if (req.body?.runningStatus)
            job['runningStatus'] = req.body?.runningStatus
        if (req?.body?.ltVideoUrl) {
            job['lambdatest']['video'] = req.body.ltVideoUrl
        }
        if (req?.body?.ltVideoStatus) {
            job['lambdatest']['status'] = req.body.ltVideoStatus
        }

        const updatedJob = await Job.findByIdAndUpdate(req.params.jobID, job, {
            new: true,
        })
        // , job, (err, job) =>

        responseTransformer.passthroughError(
            null,
            updatedJob,
            'update job',
            res,
            (job) =>
                res.json({
                    id: req.params.jobID,
                    url: req.body.reportPortalUrl,
                })
        )
        // )
        // }
        // )
        // })
        // let auditsave = common.UserAudit("64a7b2ea81b8b505b1ddddc9","RELEASE","/updated/"+req.params.id,"UPDATE","SUCCESS","Updated Successfully",req.params.id,chdataObj);
    } catch (error) {
        logger.info(`Encountered issue while updating job ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

const s3 = new S3Client({
    endpoint: process.env.AWS_S3_ENDPOINT,
    region: process.env.AWS_DEFAULT_REGION,
    forcePathStyle: true,
})

const sharedStorage = process.env.SMB_SHARE
const mountStorage = process.env.MOUNT_SHARE

if (sharedStorage) {
    IMAGES_ROOT_FOLDER = sharedStorage
    LOGS_ROOT_FOLDER = sharedStorage
}

if (mountStorage) {
    IMAGES_ROOT_FOLDER = mountStorage
    LOGS_ROOT_FOLDER = mountStorage
}

// console.log('sharedStorage', sharedStorage)
// console.log('IMAGES_ROOT_FOLDER', IMAGES_ROOT_FOLDER)
// console.log('LOGS_ROOT_FOLDER', LOGS_ROOT_FOLDER)

// if (sharedStorage) {
//     responseTransformer.getSMBClient()
// }

const uploadFileToS3 = async (req, jobId, testStepId, file, content) => {
    logger.info('File upload request for jobId ' + jobId)
    return new Promise((resolve, reject) => {
        const uploadParams = {
            Bucket: process.env.AWS_S3_BUCKET,
            Key: file,
            Body: content.toString(),
        }
        s3.send(new PutObjectCommand(uploadParams))
            .then(() => {
                logger.info('File uploaded successfully for jobId ' + jobId)
                resolve(true)
            })
            .catch((err) => {
                logger.error(
                    `Error uploading the file to S3 for jobId ${jobId}`,
                    {
                        stack: err.stack,
                    }
                )
                reject(err)
            })
    })
}

const uploadVideoFileToS3 = async (fileStream, key, jobId) => {
    logger.info('File upload request for jobId ', jobId)
    return new Promise((resolve, reject) => {
        // const fileStream = fs.createReadStream(filePath)
        const uploadParams = {
            Bucket: process.env.AWS_S3_BUCKET,
            Key: key,
            Body: fileStream,
            ContentType: 'video/mp4',
        }
        s3.send(new PutObjectCommand(uploadParams))
            .then(() => {
                logger.info('File uploaded successfully for jobId ' + jobId)
                resolve(true)
            })
            .catch((err) => {
                console.log('err', err)
                logger.error(
                    `Error uploading the file to S3 for jobId ${jobId}`,
                    {
                        stack: err.stack,
                    }
                )
                reject(err)
            })
    })
}

const uploadVideoFileToSharedFolder = async (
    fileStream,
    filePath,
    fileName,
    jobId
) => {
    logger.info('File upload request for jobId ', jobId)
    return new Promise((resolve, reject) => {
        // const fileStream = fs.createReadStream(filePath)
        const smbFolderPath = path.join(sharedStorage, filePath)
        const smbFilePath = path.join(smbFolderPath, fileName)
        console.log('smbFolderPath', smbFolderPath)
        console.log('smbFilePath', smbFilePath)
    })
}

const appendScreenshot = (deleteFile, file, testStepId, screenshot) => {
    try {
        if (!fs.existsSync(IMAGES_ROOT_FOLDER)) {
            fs.mkdirSync(IMAGES_ROOT_FOLDER, { recursive: true })
        }
        if (!fs.existsSync(IMAGES_ROOT_FOLDER + file)) {
            fs.writeFileSync(
                IMAGES_ROOT_FOLDER + file,
                ' **TestResults**  ',
                function (err) {
                    logger.info('A new text file was created successfully.')
                }
            )
        }
        const text = testStepId + ' ' + screenshot + ' && '
        fs.appendFileSync(IMAGES_ROOT_FOLDER + file, text, function (err) {
            logger.info('A new text file was created successfully.')
        })
    } catch (err) {
        logger.error('err', err)
    }
}
const appendLog = (deleteFile, file, testStepId, log) => {
    try {
        if (!fs.existsSync(LOGS_ROOT_FOLDER)) {
            fs.mkdirSync(LOGS_ROOT_FOLDER, { recursive: true })
        }
        if (!fs.existsSync(LOGS_ROOT_FOLDER + file)) {
            fs.writeFileSync(
                LOGS_ROOT_FOLDER + file,
                ' **TestResults**  ',
                function (err) {
                    logger.info('A new text file was created successfully.')
                }
            )
        }
        const text = testStepId + ' ' + log + ' && '
        fs.appendFileSync(LOGS_ROOT_FOLDER + file, text, function (err) {
            logger.info('A new text file was created successfully.')
        })
    } catch (err) {
        logger.error('err', err)
    }
}

const saveScreenshotToSharedLocation = (
    deleteFile,
    filePath,
    fileName,
    testStepId,
    screenshot
) => {
    try {
        const smbFilePath = path.join(filePath, fileName)
        if (screenshot[0] !== null) {
            responseTransformer.writeFileToSMBPath(
                null,
                filePath,
                smbFilePath,
                screenshot[0]
            )
        }
    } catch (err) {
        logger.error('err', err)
    }
}

const saveLogToSharedLocation = (
    deleteFile,
    filePath,
    fileName,
    testStepId,
    log
) => {
    try {
        const smbFilePath = path.join(filePath, fileName)
        if (log !== null) {
            responseTransformer.writeFileToSMBPath(
                null,
                filePath,
                smbFilePath,
                log
            )
        }
    } catch (err) {
        logger.error('err', err)
    }
}

const saveScreenshotToMountLocation = (
    deleteFile,
    remotePath,
    file,
    testStepId,
    screenshot
) => {
    try {
        const mountFolderPath = path.join(IMAGES_ROOT_FOLDER, remotePath)
        const mountFilePath = path.join(mountFolderPath, file)
        if (!fs.existsSync(mountFolderPath)) {
            fs.mkdirSync(mountFolderPath, { recursive: true })
        }
        // if (!fs.existsSync(mountFilePath)) {
        fs.writeFileSync(mountFilePath, screenshot[0], function (err) {
            logger.info('A new text file was created successfully.')
        })
        // }
        // const text = testStepId + ' ' + screenshot + ' && '
        // fs.appendFileSync(IMAGES_ROOT_FOLDER + file, text, function (err) {
        //     logger.info('A new text file was created successfully.')
        // })
    } catch (err) {
        logger.error('err', err)
    }
}

const saveLogToMountLocation = (
    deleteFile,
    remotePath,
    file,
    testStepId,
    log
) => {
    try {
        const mountFolderPath = path.join(LOGS_ROOT_FOLDER, remotePath)
        const mountFilePath = path.join(mountFolderPath, file)
        if (!fs.existsSync(mountFolderPath)) {
            fs.mkdirSync(mountFolderPath, { recursive: true })
        }
        if (!fs.existsSync(mountFilePath)) {
            fs.writeFileSync(mountFilePath, log, function (err) {
                logger.info('A new text file was created successfully.')
            })
        }
        // const text = testStepId + ' ' + log + ' && '
        // fs.appendFileSync(LOGS_ROOT_FOLDER + file, text, function (err) {
        //     logger.info('A new text file was created successfully.')
        // })
    } catch (err) {
        logger.error('err', err)
    }
}

const getScreenshotFromMountLocation = (remotePath) => {
    let screenshot = null
    try {
        screenshot = fs.readFileSync(remotePath, {
            flag: 'r',
            encoding: 'utf8',
        })
    } catch (err) {
        logger.error('err', err)
    }
    return screenshot
}

const getLogFromMountLocation = (remotePath) => {
    let log = null
    try {
        log = fs.readFileSync(remotePath, {
            flag: 'r',
            encoding: 'utf8',
        })
    } catch (err) {
        logger.error('err', err)
    }
    return log
}

router.patch('/jobUpdate/:jobID/:id/:status', async (req, res) => {
    try {
        const deleteFile = req.body.deleteFile
        const moduleId = req.body.moduleId
        const testCaseId = req.body.testCaseId
        const screenshot = req.body.images
        const log = req.body.log
        const jobExecutionStart = req.body.jobExecutionStart
        const executionStart = req.body.executionStart
        const executionEnd = req.body.executionEnd
        const executionDuration = req.body.executionDuration
        const moduleDuration = req.body.moduleDuration
        const jobDuration = req.body.jobDuration
        const testNodeId = req.body.testNodeId

        let moduleExecutionStart = null

        const file =
            'TestResults_' +
            req.params.jobID +
            '_' +
            moduleId +
            '_' +
            testCaseId +
            '.txt'

        const job = await Job.findById(req.params.jobID)
        //  (err, job) => {
        // let auditsave = common.UserAudit("","JOBS","/jobUpdate/"+req.params.jobID,"UPDATE","SUCCESS","Updated Successfully",req.params.jobID,job);
        if (job) {
            responseTransformer.passthroughError(
                null,
                job,
                'find job',
                res,
                async (job) => {
                    let updated = false

                    job.testRun.forEach((testNode, index) => {
                        let failed = false

                        testNode.testNodes.forEach((testStep, index) => {
                            if (failed) {
                                testStep.status = JobStatus.SKIPPED
                            }

                            let idFound = false

                            logger.info(
                                `Going to iterate over test step with testNodeId ${testNode.testNodeID}`
                            )
                            testStep.testCaseSteps.forEach((ts) => {
                                if (failed) {
                                    ts.status = JobStatus.SKIPPED
                                }
                                if (ts._id.toString() === req.params.id) {
                                    idFound = true
                                    if (
                                        (testStep.status !==
                                            JobStatus.SKIPPED ||
                                            req.params.status !==
                                                JobStatus.SKIPPED) &&
                                        req.params.jobID &&
                                        moduleId &&
                                        testNodeId &&
                                        req.params.id
                                    ) {
                                        logger.info(`before append screenshot`)

                                        if (process.env.AWS_S3_BUCKET) {
                                            if (screenshot) {
                                                const screenshotPath = `jobs/${req.params.jobID}/${moduleId}/${testNodeId}/images/${req.params.id}.txt`
                                                uploadFileToS3(
                                                    req,
                                                    req.params.jobID,
                                                    req.params.id,
                                                    screenshotPath,
                                                    screenshot
                                                )
                                                ts.testStepResultsFile = `${screenshotPath}`
                                            }

                                            if (log) {
                                                const logFilePath = `jobs/${req.params.jobID}/${moduleId}/${testNodeId}/logs/${req.params.id}.txt`
                                                uploadFileToS3(
                                                    req,
                                                    req.params.jobID,
                                                    req.params.id,
                                                    logFilePath,
                                                    log
                                                )
                                                ts.testStepLogsFile = `${logFilePath}`
                                            }
                                        } else if (sharedStorage) {
                                            const screenshotPath = path.join(
                                                'jobs',
                                                req.params.jobID,
                                                moduleId,
                                                testNodeId,
                                                'images'
                                            )

                                            const logFilePath = path.join(
                                                'jobs',
                                                req.params.jobID,
                                                moduleId,
                                                testNodeId,
                                                'logs'
                                            )

                                            saveScreenshotToSharedLocation(
                                                deleteFile,
                                                screenshotPath,
                                                `${req.params.id}.txt`,
                                                req.params.id,
                                                screenshot
                                            )
                                            saveLogToSharedLocation(
                                                deleteFile,
                                                logFilePath,
                                                `${req.params.id}.txt`,
                                                req.params.id,
                                                log
                                            )
                                            ts.testStepResultsFile = path.join(
                                                screenshotPath,
                                                `${req.params.id}.txt`
                                            )
                                            ts.testStepLogsFile = path.join(
                                                logFilePath,
                                                `${req.params.id}.txt`
                                            )
                                        } else if (mountStorage) {
                                            const screenshotPath = path.join(
                                                'jobs',
                                                req.params.jobID,
                                                moduleId,
                                                testNodeId,
                                                'images'
                                            )

                                            const logFilePath = path.join(
                                                'jobs',
                                                req.params.jobID,
                                                moduleId,
                                                testNodeId,
                                                'logs'
                                            )

                                            saveScreenshotToMountLocation(
                                                deleteFile,
                                                screenshotPath,
                                                `${req.params.id}.txt`,
                                                req.params.id,
                                                screenshot
                                            )
                                            saveLogToMountLocation(
                                                deleteFile,
                                                logFilePath,
                                                `${req.params.id}.txt`,
                                                req.params.id,
                                                log
                                            )
                                            ts.testStepResultsFile = path.join(
                                                screenshotPath,
                                                `${req.params.id}.txt`
                                            )
                                            ts.testStepLogsFile = path.join(
                                                logFilePath,
                                                `${req.params.id}.txt`
                                            )
                                        }
                                    }
                                    ts.status = req.params.status

                                    updated = true
                                    if (
                                        req.params.status === JobStatus.FAILED
                                    ) {
                                        failed = true
                                    }
                                }
                            })

                            if (executionStart && idFound) {
                                testStep.executionStart = executionStart
                                if (parseInt(index, 10) === 0)
                                    moduleExecutionStart = executionStart
                            }
                            if (executionEnd && idFound)
                                testStep.executionEnd = executionEnd
                            if (executionDuration && idFound)
                                testStep.executionDuration = executionDuration

                            if (
                                testStep.status !== JobStatus.SKIPPED &&
                                testStep.testNodeID === req.params.id &&
                                !process.env.AWS_S3_BUCKET
                            ) {
                                testStep.testCaseResultsFile = file
                                testStep.testCaseLogsFile = file
                            }

                            updateStatus(testStep.testCaseSteps, testStep)
                            if (testStep.testNodeID === req.params.id) {
                                if (
                                    testStep.status !== JobStatus.SKIPPED &&
                                    screenshot &&
                                    !process.env.AWS_S3_BUCKET
                                ) {
                                    appendScreenshot(
                                        deleteFile,
                                        file,
                                        req.params.id,
                                        screenshot
                                    )
                                    appendLog(
                                        deleteFile,
                                        file,
                                        req.params.id,
                                        log
                                    )
                                }
                                testStep.status = req.params.status
                                updated = true
                            }
                        })

                        if (testNode.moduleID === moduleId) {
                            if (moduleExecutionStart)
                                testNode.executionStart = moduleExecutionStart
                            if (executionEnd)
                                testNode.executionEnd = executionEnd
                            if (moduleDuration)
                                testNode.executionDuration = moduleDuration
                        }

                        updateStatus(testNode.testNodes, testNode)
                        if (testNode.moduleID === req.params.id) {
                            testNode.status = req.params.status
                            updated = true
                        }
                    })

                    if (jobExecutionStart)
                        job.executionStart = jobExecutionStart
                    if (executionEnd) job.executionEnd = executionEnd
                    if (jobDuration) job.executionDuration = jobDuration
                    if (updated) {
                        const updatedJob = await Job.findByIdAndUpdate(
                            req.params.jobID,
                            job
                        )
                        // (err, job) => {
                        // if (err) {
                        //     res.send({
                        //         status: '400',
                        //         Message: 'Error While job update',
                        //         data: err,
                        //     })
                        // } else {
                        responseTransformer.passthroughError(
                            null,
                            job,
                            'update job',
                            res,
                            (updatedJob) =>
                                res.json({
                                    _id: req.params.jobID,
                                    status: req.params.status,
                                })
                        )
                        // }
                        // }
                        // )
                    } else
                        res.status(400).json({
                            message: 'Not found',
                        })
                }
            )
        } else {
            res.send({ status: 400, message: 'Job Not Found !!', data: error })
        }

        // })
    } catch (error) {
        logger.info(`Encountered issue while updating job status ${error}`)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.get('/jobJson/:id', async (req, res) => {
    try {
        Job.findById(req.params.id, (err, job) =>
            responseTransformer.passthroughError(
                err,
                job,
                'get job',
                res,
                async (job) => {
                    job = removeCircular(job)

                    const release = await Release.findById(job.releaseID)
                    const releaseModules = release?.toObject().modules

                    const testNodes = job.testRun
                    delete job.testRun
                    job.modules = await Promise.all(
                        testNodes.map(async (tc) => {
                            const moduleObj = releaseModules?.find(
                                (releaseModule) =>
                                    releaseModule.moduleID == tc.moduleID
                            )
                            const currentJobTestPlaceholders =
                                moduleObj?.testPlaceholders?.filter(
                                    (tp) => tp?.jobId?.toString() === job?._id
                                )[0]
                            if (currentJobTestPlaceholders) {
                                currentJobTestPlaceholders.jobId =
                                    currentJobTestPlaceholders?.jobId?.toString()
                            }
                            const module = await Module.findById(tc.moduleID)
                            const testNodes = new Map(
                                module
                                    .toObject()
                                    .testNodes.map((c) => [c._id.toString(), c])
                            )

                            const updatedTestNodes = []
                            testNodes.forEach((testNode, index) => {
                                const tnindex = index
                                const tempTestNode = { ...testNode }
                                tempTestNode._id = tempTestNode._id.toString()
                                tempTestNode?.testNode[0]?.testCaseSteps.forEach(
                                    (ts, index) => {
                                        const tpindex = index
                                        tempTestNode.testNode[0].testCaseSteps[
                                            tpindex
                                        ]._id =
                                            tempTestNode.testNode[0].testCaseSteps[
                                                tpindex
                                            ]._id.toString()
                                    }
                                )
                                updatedTestNodes.push(tempTestNode)
                            })
                            return {
                                _id: module._id,
                                projectID: module.projectID,
                                suiteName: module.suiteName,
                                suiteDescription: module.suiteDescription,
                                testPlaceholders: currentJobTestPlaceholders,
                                testNodes: updatedTestNodes,
                            }
                        })
                    )
                    res.json(job)
                }
            )
        )
    } catch (error) {
        res.json({ error })
    }
})

router.get('/v1/jobJson/:id', async (req, res) => {
    try {
        Job.findById(req.params.id, (err, job) =>
            responseTransformer.passthroughError(
                err,
                job,
                'get job',
                res,
                async (job) => {
                    let ReRunStatus
                    if (job.testRun.length) {
                        if (
                            job.testRun[job.testRun.length - 1].ReRunStatus ==
                            undefined
                        ) {
                            ReRunStatus = 0
                        } else {
                            ReRunStatus =
                                job.testRun[job.testRun.length - 1].ReRunStatus
                        }
                    }
                    job = removeCircular(job)

                    const release = await Release.findById(job.releaseID)
                    const releaseModules = release?.toObject().modules
                    // latest module should go not all check line 1981
                    const testNodes = job.testRun
                    delete job.testRun
                    job.modules = await Promise.all(
                        testNodes.map(async (tc) => {
                            const moduleObj = releaseModules?.find(
                                (releaseModule) =>
                                    releaseModule.moduleID == tc.moduleID
                            )
                            const currentJobTestPlaceholders =
                                moduleObj?.testPlaceholders?.filter(
                                    (tp) => tp?.jobId?.toString() === job?._id
                                )[0]
                            if (currentJobTestPlaceholders) {
                                currentJobTestPlaceholders.jobId =
                                    currentJobTestPlaceholders?.jobId?.toString()
                            }
                            const module = await Module.findById(tc.moduleID)
                            const testNodes = new Map(
                                module
                                    .toObject()
                                    .testNodes.map((c) => [c._id.toString(), c])
                            )

                            const updatedTestNodes = []
                            testNodes.forEach((testNode, index) => {
                                const tnindex = index
                                const tempTestNode = { ...testNode }
                                tempTestNode._id = tempTestNode._id.toString()
                                tempTestNode?.testNode[0]?.testCaseSteps.forEach(
                                    (ts, index) => {
                                        const tpindex = index
                                        tempTestNode.testNode[0].testCaseSteps[
                                            tpindex
                                        ]._id =
                                            tempTestNode.testNode[0].testCaseSteps[
                                                tpindex
                                            ]._id.toString()
                                    }
                                )
                                updatedTestNodes.push(tempTestNode)
                            })
                            // find ReRunStatus from job with moduleID == module._id as
                            return {
                                _id: module._id,
                                projectID: module.projectID,
                                suiteName: module.suiteName,
                                suiteDescription: module.suiteDescription,
                                testPlaceholders: currentJobTestPlaceholders,
                                testNodes: updatedTestNodes,
                            }
                        })
                    )
                    job.modules[0].ReRunStatus = ReRunStatus
                    // job.ReRunStatus = "1"  //last rerun status from Jobs.testRun[0].ReRunStatus Schema
                    res.json(job)
                }
            )
        )
    } catch (error) {
        res.json({ error })
    }
})

router.get('/v2/jobJson/:id', async (req, res) => {
    try {
        let job = await Job.findById(req.params.id)
        //  (err, job) =>
        //     responseTransformer.passthroughError(
        //         err,
        //         job,
        //         'get job',
        //         res,
        //         async (job) => {
        if (job) {
            job = removeCircular(job)

            const release = await Release.findById(job.releaseID)
            const releaseModules = release?.toObject().modules

            const testNodes = job.testRun
            delete job.testRun
            job.modules = await Promise.all(
                testNodes.map(async (tc) => {
                    const moduleObj = releaseModules?.find(
                        (releaseModule) => releaseModule.moduleID == tc.moduleID
                    )

                    const currentJobTestPlaceholders =
                        moduleObj?.testPlaceholders?.filter(
                            (tp) => tp?.jobId?.toString() === job?._id
                        )[0]
                    if (currentJobTestPlaceholders) {
                        currentJobTestPlaceholders.jobId =
                            currentJobTestPlaceholders?.jobId?.toString()
                    }
                    let module = await Module.findById(tc.moduleID)
                    module = await responseTransformer.getModulesDataWithSteps(
                        [module],
                        module?.projectID,
                        null,
                        null
                    )
                    module = module[0]
                    let jobTestNodes = tc.testNodes.map((c) =>
                        c.testNodeID.toString()
                    )

                    let tempJobNodes = []

                    jobTestNodes?.forEach((tNode) => {
                        let testNode = module.testNodes.find(
                            (node) => tNode.toString() === node._id.toString()
                        )
                        let dependsOn = testNode.testNode[0]?.dependsOn
                        let id = testNode._id
                        tempJobNodes.push(id)

                        while (dependsOn !== null && dependsOn !== '') {
                            const n = module.testNodes.find(
                                (node) =>
                                    dependsOn ===
                                    node.testNode[0]?.testCaseID.toString()
                            )

                            if (n) {
                                dependsOn = n.testNode[0]?.dependsOn
                                id = n._id
                                tempJobNodes.push(id)
                            }
                        }
                    })

                    jobTestNodes = [...new Set(tempJobNodes)]

                    const moduleTestNodes = module.testNodes?.filter(
                        (testNode) =>
                            jobTestNodes.includes(testNode._id.toString())
                    )

                    const testNodes = new Map(
                        moduleTestNodes.map((c) => [c._id.toString(), c])
                    )

                    const updatedTestNodes = []
                    testNodes.forEach((testNode, index) => {
                        const tnindex = index
                        const tempTestNode = { ...testNode }
                        tempTestNode._id = tempTestNode._id.toString()
                        const testCaseSteps =
                            tempTestNode?.testNode[0]?.testCaseSteps.forEach(
                                (ts, index) => {
                                    const tpindex = index
                                    tempTestNode.testNode[0].testCaseSteps[
                                        tpindex
                                    ]._id =
                                        tempTestNode.testNode[0].testCaseSteps[
                                            tpindex
                                        ]._id.toString()
                                }
                            )
                        updatedTestNodes.push(tempTestNode)
                    })
                    return {
                        _id: module._id,
                        projectID: module.projectID,
                        suiteName: module.suiteName,
                        suiteDescription: module.suiteDescription,
                        testPlaceholders: currentJobTestPlaceholders,
                        locatorProperties: module?.locatorProperties,
                        testNodes: updatedTestNodes,
                    }
                })
            )
            res.json(job)
        } else {
            res.json({ message: 'Job Not found !!' })
        }

        // }
        // )
        // )
    } catch (error) {
        logger.info(`Error fetching job json ${error}`)
        res.json({ error })
    }
})

// router.patch(
//     '/testCaseUpdate/:testRunId/:moduleID/:id/:testCaseId',
//     async (req, res, next) => {
//         try {
//             app.use(imageUpload())

//             let testCaseResultsFile

//             const testCase = { ...req.body }
//             const testStepsToDelete = {}
//             if (req.body.testStepsToDelete) {
//                 if (req.body.testStepsToDelete.constructor === Array) {
//                     req.body.testStepsToDelete.forEach((step) => {
//                         const stepId = step.split('_')[0]
//                         const indices = step.split('_')[1]
//                         testStepsToDelete[stepId] = indices
//                     })
//                 } else {
//                     const stepId = req.body.testStepsToDelete.split('_')[0]
//                     let indices = req.body.testStepsToDelete.split('_')[1]

//                     testStepsToDelete[stepId] = indices
//                 }
//             }

//             // const path = __dirname + "../../../public/images/";
//             const path = 'public/images/'

//             /** test case file Data consolidation starts**/
//             const jsonFile =
//                 path +
//                 'TestResults' +
//                 '_' +
//                 req.params.testRunId +
//                 '_' +
//                 req.params.moduleID +
//                 '_' +
//                 req.params.testCaseId +
//                 '.txt'

//             testCaseResultsFile =
//                 'TestResults' +
//                 '_' +
//                 req.params.testRunId +
//                 '_' +
//                 req.params.moduleID +
//                 '_' +
//                 req.params.testCaseId +
//                 '.txt'

//             const json_temp_File =
//                 path +
//                 'Temp_TestResults' +
//                 '_' +
//                 req.params.testRunId +
//                 '_' +
//                 req.params.moduleID +
//                 '_' +
//                 req.params.testCaseId +
//                 '.txt'

//             testCaseResultsFile =
//                 'TestResults' +
//                 '_' +
//                 req.params.testRunId +
//                 '_' +
//                 req.params.moduleID +
//                 '_' +
//                 req.params.testCaseId +
//                 '.txt'

//             let existingTestData
//             if (fs.existsSync(jsonFile)) {
//                 let resultTestCaseData = []
//                 let resultTestStepData = {}
//                 let fileContent = ' '
//                 let totalData
//                 let testStepStatuses = {}

//                 const existingTestData = fs.readFileSync(jsonFile, {
//                     flag: 'r',
//                     encoding: 'utf8',
//                 })
//                 if (existingTestData && existingTestData?.length > 0) {
//                     totalData = existingTestData.split('**TestResults**')
//                 }

//                 if (totalData && totalData?.length > 0) {
//                     /*Existing Test Case Data processing  */
//                     let existingTestCaseImages = totalData[0].split(' ')
//                     if (existingTestCaseImages) {
//                         existingTestCaseImages = existingTestCaseImages.filter(
//                             (entry) => entry.trim() !== ''
//                         )

//                         if (testCase?.testResultsToDelete) {
//                             existingTestCaseImages =
//                                 existingTestCaseImages.filter(
//                                     (image) =>
//                                         !testCase?.testResultsToDelete.includes(
//                                             existingTestCaseImages.indexOf(
//                                                 image
//                                             )
//                                         )
//                                 )
//                         }

//                         if (existingTestCaseImages.constructor === Array) {
//                             resultTestCaseData = [
//                                 ...resultTestCaseData,
//                                 ...existingTestCaseImages,
//                             ]
//                         } else {
//                             resultTestCaseData.push(existingTestCaseImages)
//                         }
//                     }

//                     /*********New Test Cases Data processing****/

//                     if (req.files) {
//                         if (req.files.testCaseScreenshots) {
//                             if (
//                                 req.files.testCaseScreenshots.constructor ===
//                                 Array
//                             ) {
//                                 req.files.testCaseScreenshots.forEach(
//                                     (screenshot, index) =>
//                                         (resultTestCaseData = [
//                                             ...resultTestCaseData,
//                                             `data:image/png;base64,${fileUtils.arrayBufferToBase64(
//                                                 screenshot?.data
//                                             )}` + ' ',
//                                         ])
//                                 )
//                             } else {
//                                 resultTestCaseData = [
//                                     ...resultTestCaseData,
//                                     `data:image/png;base64,${fileUtils.arrayBufferToBase64(
//                                         req.files.testCaseScreenshots?.data
//                                     )}`,
//                                 ]
//                             }
//                         }
//                     }

//                     /**Existing Test Steps Data Processing  */
//                     if (totalData[1] && totalData[1]?.length > 0) {
//                         let existingTestStepImages = totalData[1].split('&&')
//                         if (
//                             existingTestStepImages &&
//                             existingTestStepImages?.length > 0
//                         ) {
//                             existingTestStepImages =
//                                 existingTestStepImages.filter(
//                                     (entry) => entry.trim() !== ''
//                                 )

//                             let existingStepImages = {}

//                             existingTestStepImages.forEach((step, index) => {
//                                 step = step
//                                     .split(' ')
//                                     .filter((entry) => entry.trim() !== '')
//                                 const stepId = step[0]
//                                 const stepIdImages = step.slice(1)

//                                 if (testStepsToDelete[stepId]) {
//                                     if (stepIdImages.constructor === Array) {
//                                         const filetredImages =
//                                             stepIdImages.filter(
//                                                 (image, index) =>
//                                                     !testStepsToDelete[
//                                                         stepId
//                                                     ].includes(index)
//                                             )
//                                         if (filetredImages?.length > 0) {
//                                             existingStepImages[stepId] =
//                                                 filetredImages
//                                         }
//                                     } else {
//                                         if (
//                                             !Object.keys(
//                                                 testStepsToDelete
//                                             ).includes(stepId)
//                                         ) {
//                                             existingStepImages[stepId] =
//                                                 stepIdImages
//                                         }
//                                     }
//                                 } else {
//                                     if (stepIdImages.constructor === Array) {
//                                         existingStepImages[stepId] = [
//                                             ...stepIdImages,
//                                         ]
//                                     } else {
//                                         existingStepImages[stepId] =
//                                             stepIdImages
//                                     }
//                                 }
//                             })
//                             if (existingStepImages) {
//                                 resultTestStepData = {
//                                     ...existingStepImages,
//                                     ...resultTestStepData,
//                                 }
//                             }
//                         }

//                         /***New Steps data processing */
//                         if (req.files) {
//                             const stepIds = Object.keys(req.files).filter(
//                                 (key) => key !== 'testCaseScreenshots'
//                             )
//                             if (stepIds) {
//                                 let tempStepObj = {}
//                                 stepIds.forEach((stepId) => {
//                                     let tempStepData = []
//                                     if (
//                                         req.files[stepId].constructor === Array
//                                     ) {
//                                         tempStepData = [...req.files[stepId]]
//                                     } else {
//                                         tempStepData.push(req.files[stepId])
//                                     }

//                                     tempStepData.forEach((step, index) => {
//                                         tempStepData[index] =
//                                             `data:image/png;base64,${fileUtils.arrayBufferToBase64(
//                                                 tempStepData[index]?.data
//                                             )}`
//                                     })

//                                     tempStepObj[stepId] = tempStepData
//                                 })

//                                 Object.keys(tempStepObj).forEach((stepId) => {
//                                     if (resultTestStepData[stepId]) {
//                                         if (
//                                             resultTestStepData[stepId]
//                                                 .constructor === Array
//                                         ) {
//                                             resultTestStepData[stepId] = [
//                                                 ...resultTestStepData[stepId],
//                                                 ...tempStepObj[stepId],
//                                             ]
//                                         } else {
//                                             resultTestStepData[stepId] = [
//                                                 resultTestStepData[stepId],
//                                                 ...tempStepObj[stepId],
//                                             ]
//                                         }
//                                     } else {
//                                         resultTestStepData[stepId] = [
//                                             ...tempStepObj[stepId],
//                                         ]
//                                     }
//                                 })
//                             }
//                         }
//                     } //if (totalData[1] && totalData[1]?.length > 0)
//                 } //if (totalData && totalData?.length > 0)

//                 /*******************File Writing proces**************************************** */

//                 fs.writeFileSync(json_temp_File, '', (err) => {
//                     if (err) {
//                         console.error(err)
//                     }
//                 })

//                 /**-------Writing Test Cases ------------**/
//                 fileContent = ' '
//                 if (resultTestCaseData && resultTestCaseData?.length > 0) {
//                     resultTestCaseData.forEach((item) => {
//                         fileContent = fileContent + item + ' '
//                     })
//                 }
//                 fileContent = fileContent + ' **TestResults** '
//                 fs.appendFileSync(json_temp_File, fileContent)
//                 fileContent = ' '

//                 /**-------Writing Test Steps ------------- */
//                 if (
//                     resultTestStepData &&
//                     Object.keys(resultTestStepData)?.length > 0
//                 ) {
//                     const stepIds = Object.keys(resultTestStepData)
//                     if (stepIds?.length > 0) {
//                         stepIds.forEach((stepId) => {
//                             fileContent = fileContent + ` ${stepId} `
//                             if (
//                                 resultTestStepData[stepId].constructor === Array
//                             ) {
//                                 resultTestStepData[stepId].forEach(
//                                     (image) =>
//                                         (fileContent =
//                                             fileContent + image + ' ')
//                                 )
//                             } else {
//                                 fileContent =
//                                     fileContent +
//                                     resultTestStepData[stepId] +
//                                     ' '
//                             }

//                             fileContent = fileContent + ' && '
//                         })
//                     }
//                 }

//                 fs.appendFileSync(json_temp_File, fileContent)
//                 fileContent = ' '

//                 /**overwriting the original file */

//                 const updatedReadStream = fs.readFileSync(json_temp_File, {
//                     encoding: 'utf8',
//                 })
//                 fs.writeFileSync(jsonFile, '')
//                 fs.writeFileSync(jsonFile, updatedReadStream)
//                 fs.unlinkSync(json_temp_File)
//             } //if (fs.existsSync(jsonFile))

//             /**********if the file does not already exists**************/
//             else {
//                 if (req?.files) {
//                     let writeStream = fs.writeFile(jsonFile, '', (err) => {
//                         if (err) {
//                             console.error(err)
//                         }
//                         // file written successfully
//                     })
//                     writeStream = fs.createWriteStream(jsonFile, { flags: 'a' })

//                     const testCaseScreenshots = req?.files?.testCaseScreenshots

//                     if (testCaseScreenshots) {
//                         if (testCaseScreenshots) {
//                             if (testCaseScreenshots.constructor === Array) {
//                                 testCaseScreenshots.forEach(
//                                     (screenshot, index) =>
//                                         writeStream.write(
//                                             `data:image/png;base64,${fileUtils.arrayBufferToBase64(
//                                                 screenshot?.data
//                                             )}` + ' '
//                                         )
//                                 )
//                             } else {
//                                 writeStream.write(
//                                     `data:image/png;base64,${fileUtils.arrayBufferToBase64(
//                                         testCaseScreenshots?.data
//                                     )}` + ' '
//                                 )
//                             }
//                         }
//                         writeStream.write(' **TestResults** ')
//                     }

//                     /** step Files Logic **/

//                     const stepIds = Object.keys(req.files).filter(
//                         (key) => key !== 'testCaseScreenshots'
//                     )
//                     if (stepIds) {
//                         if (!testCaseScreenshots) {
//                             writeStream.write(' **TestResults** ')
//                         }
//                     }

//                     stepIds.forEach((stepId) => {
//                         writeStream.write(` ${stepId} `)
//                         if (req.files[stepId].constructor === Array) {
//                             req.files[stepId].forEach((screenshot) =>
//                                 writeStream.write(
//                                     `data:image/png;base64,${fileUtils.arrayBufferToBase64(
//                                         screenshot?.data
//                                     )}` + ' '
//                                 )
//                             )
//                         } else {
//                             writeStream.write(
//                                 `data:image/png;base64,${fileUtils.arrayBufferToBase64(
//                                     req.files[stepId]?.data
//                                 )}` + ' '
//                             )
//                         }

//                         writeStream.write(' && ')
//                     })

//                     writeStream.on('finish', () => {
//                         logger.info(
//                             `wrote all the array data to file ${jsonFile}`
//                         )
//                     })

//                     writeStream.on('error', (err) => {
//                         logger.info(
//                             `There is an error writing the file ${jsonFile} => ${err}`
//                         )
//                     })

//                     writeStream.end()
//                 }
//             } //if its a new FIle

//             Job.findById(req.params.testRunId, (err, job) => {
//                 responseTransformer.passthroughError(
//                     err,
//                     job,
//                     'find job',
//                     res,
//                     (job) => {
//                         let updated = false

//                         job.testRun.forEach((module) => {
//                             if (module.moduleID === req.params.moduleID) {
//                                 module.testNodes.forEach((testNode) => {
//                                     if (
//                                         testNode.testNodeID.toString() ===
//                                         req.params.id
//                                     ) {
//                                         updated = true

//                                         if (testCase.testCaseStatus) {
//                                             if (
//                                                 testCase.testCaseStatus !==
//                                                 testNode?.status
//                                             ) {
//                                                 testNode.dateStatusLastUpdated =
//                                                     new Date()
//                                                 //.toISOString()
//                                                 // .replace(/[-:.]/g, "");
//                                             }
//                                             testNode.status =
//                                                 testCase.testCaseStatus
//                                         }
//                                         if (testCase?.screenShotComments) {
//                                             testNode.screenShotComments =
//                                                 testCase?.screenShotComments
//                                         }

//                                         if (
//                                             testCaseResultsFile &&
//                                             !process.env.AWS_S3_BUCKET
//                                         ) {
//                                             testNode.testCaseResultsFile =
//                                                 testCaseResultsFile
//                                         }

//                                         /**updating step status starts */
//                                         if (testCase?.stepStatus) {
//                                             let testStepStatus = {}
//                                             if (
//                                                 testCase?.stepStatus
//                                                     .constructor === Array
//                                             ) {
//                                                 testCase?.stepStatus.forEach(
//                                                     (step) => {
//                                                         const stepId =
//                                                             step.split('_')[0]
//                                                         const stepStatus =
//                                                             step.split('_')[1]
//                                                         testStepStatus[stepId] =
//                                                             stepStatus
//                                                     }
//                                                 )
//                                             } else {
//                                                 const stepId =
//                                                     testCase?.stepStatus.split(
//                                                         '_'
//                                                     )[0]
//                                                 const stepStatus =
//                                                     testCase?.stepStatus.split(
//                                                         '_'
//                                                     )[1]
//                                                 testStepStatus[stepId] =
//                                                     stepStatus
//                                             }

//                                             if (testStepStatus) {
//                                                 let testStepStatuses = {}
//                                                 testNode.testCaseSteps.forEach(
//                                                     (step) => {
//                                                         const modified_stepkeys =
//                                                             Object.keys(
//                                                                 testStepStatus
//                                                             )

//                                                         modified_stepkeys.forEach(
//                                                             (
//                                                                 stepKey,
//                                                                 index
//                                                             ) => {
//                                                                 modified_stepkeys[
//                                                                     index
//                                                                 ] =
//                                                                     modified_stepkeys[
//                                                                         index
//                                                                     ].trim()
//                                                             }
//                                                         )

//                                                         if (
//                                                             modified_stepkeys.includes(
//                                                                 step?._id.toString()
//                                                             )
//                                                         ) {
//                                                             updated = true
//                                                             step.status =
//                                                                 testStepStatus[
//                                                                     step?._id
//                                                                 ]
//                                                             testStepStatuses[
//                                                                 step?._id
//                                                             ] =
//                                                                 testStepStatus[
//                                                                     step?._id
//                                                                 ]
//                                                         } else {
//                                                             testStepStatuses[
//                                                                 step?._id
//                                                             ] = step.status
//                                                         }
//                                                     }
//                                                 )

//                                                 if (
//                                                     Object.values(
//                                                         testStepStatuses
//                                                     ).includes(JobStatus.FAILED)
//                                                 ) {
//                                                     testNode.status =
//                                                         JobStatus.FAILED
//                                                 }
//                                             }
//                                         }
//                                         /** Updating step status ends*/
//                                     }
//                                 })
//                             }
//                         })

//                         if (updated) {
//                             Job.findByIdAndUpdate(
//                                 req.params.testRunId,
//                                 job,
//                                 (err, job) => {
//                                     AuditCreation.upsertAuditLog(
//                                         job.collection.collectionName,
//                                         'update',
//                                         req.body?.email,
//                                         req.body?.company,
//                                         null,
//                                         job
//                                     )
//                                     responseTransformer.passthroughError(
//                                         err,
//                                         job,
//                                         'update job',
//                                         res,
//                                         (job) =>
//                                             res.json({
//                                                 job: job,
//                                             })
//                                     )
//                                 }
//                             )
//                         }
//                     }
//                 )
//             })
//         } catch (error) {
//             res.status(400).json({
//                 message:
//                     'Error updating the test case  testRunId = ' ||
//                     req.params.testRunId ||
//                     'moduleID =' ||
//                     req.params.moduleID ||
//                     'testCseId = ' ||
//                     req.params.id ||
//                     '_' ||
//                     error,
//             })
//         }
//     }
// )

router.patch(
    '/testCaseUpdate/:testRunId/:moduleID/:id/:testCaseId',
    async (req, res, next) => {
        try {
            const testCase = { ...req.body }
            // If any image attachments are present, then we will save them to the mount or s3 location
            if (req?.files) {
                const screenshotKeys = Object.keys(req.files)
                const screenshotValues = Object.values(req.files)
                let screenshotPath
                let base64Image
                let image
                let imageFileName
                screenshotKeys.forEach((key, index) => {
                    // Test Case level
                    if (key === 'testCaseScreenshots') {
                        imageFileName = req.params.testCaseId
                        screenshotPath = path.join(
                            'jobs',
                            req.params.testRunId,
                            req.params.moduleID,
                            req.params.testCaseId
                            // 'images'
                        )
                    }
                    // Test Case Step level
                    else {
                        imageFileName = screenshotKeys[index]
                        screenshotPath = path.join(
                            'jobs',
                            req.params.testRunId,
                            req.params.moduleID,
                            req.params.testCaseId,
                            'images'
                        )
                    }
                    base64Image = `data:${screenshotValues[index].mimetype};base64,${screenshotValues[index].data.toString('base64')}`
                    image = [base64Image]
                    saveScreenshotToMountLocation(
                        '',
                        screenshotPath,
                        `${imageFileName}.txt`,
                        imageFileName,
                        image
                    )
                })
            }

            let job = await Job.findById(req.params.testRunId)

            if (!job) {
                return res.status(404).json({ message: 'Job not found' })
            }

            let updated = false

            job.testRun.forEach((module) => {
                if (module.moduleID === req.params.moduleID) {
                    module.testNodes.forEach((testNode) => {
                        if (testNode.testNodeID.toString() === req.params.id) {
                            updated = true

                            if (testCase.testCaseStatus) {
                                if (
                                    testCase.testCaseStatus !== testNode?.status
                                ) {
                                    testNode.dateStatusLastUpdated = new Date()
                                }
                                testNode.status = testCase.testCaseStatus
                            }

                            if (testCase?.screenShotComments) {
                                testNode.screenShotComments =
                                    testCase?.screenShotComments
                            }

                            // if (
                            //     testCaseResultsFile &&
                            //     !process.env.AWS_S3_BUCKET
                            // ) {
                            //     testNode.testCaseResultsFile =
                            //         testCaseResultsFile
                            // }

                            /** updating step status starts */
                            if (testCase?.stepStatus) {
                                let testStepStatus = {}

                                if (Array.isArray(testCase?.stepStatus)) {
                                    testCase?.stepStatus.forEach((step) => {
                                        const [stepId, stepStatus] =
                                            step.split('_')
                                        testStepStatus[stepId] = stepStatus
                                    })
                                } else {
                                    const [stepId, stepStatus] =
                                        testCase?.stepStatus.split('_')
                                    testStepStatus[stepId] = stepStatus
                                }

                                if (testStepStatus) {
                                    let testStepStatuses = {}
                                    testNode.testCaseSteps.forEach((step) => {
                                        const modified_stepkeys = Object.keys(
                                            testStepStatus
                                        ).map((key) => key.trim())

                                        if (
                                            modified_stepkeys.includes(
                                                step?._id.toString()
                                            )
                                        ) {
                                            updated = true
                                            step.status =
                                                testStepStatus[step?._id]
                                            testStepStatuses[step?._id] =
                                                testStepStatus[step?._id]
                                        } else {
                                            testStepStatuses[step?._id] =
                                                step.status
                                        }
                                    })

                                    if (
                                        Object.values(
                                            testStepStatuses
                                        ).includes(JobStatus.FAILED)
                                    ) {
                                        testNode.status = JobStatus.FAILED
                                    }
                                }
                            }
                            /** Updating step status ends */
                        }
                    })
                }
            })

            if (updated) {
                const updatedJob = await Job.findByIdAndUpdate(
                    req.params.testRunId,
                    job,
                    { new: true }
                )

                await AuditCreation.upsertAuditLog(
                    updatedJob.collection.collectionName,
                    'update',
                    req.body?.email,
                    req.body?.company,
                    null,
                    updatedJob
                )

                return res.json({ job: updatedJob })
            } else {
                return res.status(400).json({ message: 'No changes made' })
            }
        } catch (error) {
            res.status(400).json({
                message:
                    'Error updating the test case  testRunId = ' ||
                    req.params.testRunId ||
                    'moduleID =' ||
                    req.params.moduleID ||
                    'testCseId = ' ||
                    req.params.id ||
                    '_' ||
                    error,
            })
        }
    }
)

router.get('/getTestCaseResults/:fileName', async (req, res) => {
    try {
        // const path = __dirname + "../../../public/images/";
        const path = 'public/images/'
        if (req.params.fileName) {
            if (fs.existsSync(path + req.params.fileName)) {
                const stream = fs.createReadStream(path + req.params.fileName)

                stream.on('open', () => {
                    res.set('Content-type', 'plain/text')
                    stream.pipe(res)
                })

                stream.on('error', (error) => {
                    res.set('Content-type', 'text/plain')
                    // res.status(404).end("Not found");
                })
            } else {
                res.json([])
            }
        } else {
            res.json([])
        }
    } catch (error) {
        res.json({ warnings: `${req.params.fileName} not valid file` })
    }
})

router.get('/getTestCaseLogs/:fileName', async (req, res) => {
    const warnings = []
    try {
        // const path = __dirname + "../../../public/images/";
        const path = LOGS_ROOT_FOLDER
        if (req.params.fileName) {
            if (fs.existsSync(path + req.params.fileName)) {
                const stream = fs.createReadStream(path + req.params.fileName)

                stream.on('open', () => {
                    res.set('Content-type', 'plain/text')
                    stream.pipe(res)
                })

                stream.on('error', (error) => {
                    res.set('Content-type', 'text/plain')
                    // res.status(404).end("Not found");
                })
            } else {
                res.json([])
            }
        } else {
            res.json([])
        }
    } catch (error) {
        logger.warn(`Encountered warnings while serving request: ${warnings}`)
        res.json({
            status: 400,
            warnings: `${req.params.fileName} not valid file`,
        })
    }
})

router.get('/delete/:object/:id', async (req, res) => {
    const obj = req.params.object
    const id = req.params.id

    if (obj === 'releaseTestRuns') {
        await Job.deleteMany({ releaseID: id })
    } else if (obj === 'projectTestRuns') {
        const modules = await Module.find({ projectID: id })
        const modulesList = modules?.map((m) => m._id)
        const releases = await Release.find({
            'modules.moduleID': { $in: modulesList },
        })
        const releasesList = releases?.map((r) => r._id)
        const testRuns = await Job.find({ releaseID: { $in: releasesList } })

        await Job.deleteMany({ releaseID: { $in: releasesList } })
        await Release.deleteMany({
            'modules.moduleID': { $in: modulesList },
        })
        await Module.deleteMany({ projectID: id })
        await Project.deleteMany({
            _id: new ObjectId(id.toString()),
        })
    }
    res.json([])
})

router.get('/updated/:status/:id', async (req, res) => {
    const status = req.params.status
    const job = await Job.findById(req.params.id)
    let chdataObj = []
    const { testRun } = job

    const modules = testRun?.map((module) => {
        module.status = status
        const { testNodes } = module

        const newTestNodes = testNodes?.map((testNode) => {
            testNode.status = status
            const { testCaseSteps } = testNode
            const newTestCaseSteps = testCaseSteps?.map((testCaseStep) => {
                testCaseStep.status = status
                return testCaseStep
            })
            testNode.testCaseSteps = newTestCaseSteps
            return testNode
        })

        module.testNodes = newTestNodes

        return module
        // let auditsave = common.UserAudit("64a7b2ea81b8b505b1ddddc9","RELEASE","/updated/"+req.params.id,"UPDATE","SUCCESS","Updated Successfully",req.params.id,chdataObj);
    })

    const newjob = await Job.findByIdAndUpdate(
        req.params.id,
        {
            testRun: modules,
        },
        (err, updatejob) => {
            logger.info('error', err)
        }
    )

    res.json(newjob)
})

router.get('/deleteFiles', async (req, res) => {
    const jobs = await Job.find()
    const jobIds = jobs?.map((job) => job._id)

    let removed = []
    fs.readdir(IMAGES_ROOT_FOLDER, (err, files) => {
        files.forEach((file) => {
            const values = file.split('_')
            if (!jobIds.toString().includes(values[1]?.toString())) {
                removed.push(values[1])
                fs.unlinkSync(IMAGES_ROOT_FOLDER + file)
            }
        })
        fs.readdir(LOGS_ROOT_FOLDER, (err, files) => {
            files.forEach((file) => {
                const values = file.split('_')
                if (!jobIds.toString().includes(values[1]?.toString())) {
                    removed.push(values[1])
                    fs.unlinkSync(LOGS_ROOT_FOLDER + file)
                }
            })
            removed = new Set(removed)
            removed = [...removed]
            res.json({ removed, jobIds })
        })
    })
})

router.post('/v1/SaveRefData', async (req, res) => {
    try {
        let body = req.body
        if (!body.Key) {
            res.send({ status: 204, message: 'Key Required', data: [] })
        } else if (!body.Value) {
            res.send({ status: 204, message: 'Value Required', data: [] })
        } else if (!body.RId) {
            res.send({ status: 204, message: 'Release ID Required', data: [] })
        } else if (!body.JobId) {
            res.send({ status: 204, message: 'Job ID Required', data: [] })
        } else if (!body.MId) {
            res.send({ status: 204, message: 'Module ID Required', data: [] })
        } else {
            TempVars.find(
                {
                    rId: body.RId,
                    jobId: body.JobId,
                    mId: body.MId,
                    key: body.Key,
                },
                async (err, tempkey) => {
                    if (tempkey.length > 0) {
                        //update record with new value
                        TempVars.updateOne(
                            {
                                key: body.Key,
                                rId: body.RId,
                                jobId: body.JobId,
                                mId: body.MId,
                            },
                            {
                                $set: {
                                    value: body.Value,
                                },
                            }
                        ).then((doc) => {
                            if (doc) {
                                res.send({
                                    status: 200,
                                    message: 'Key Updated',
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
                        let _savekey = new TempVars({
                            key: body.Key,
                            value: body.Value,
                            rId: body.RId,
                            jobId: body.JobId,
                            mId: body.MId,
                            // createdBy:body.UserId
                        })
                        await _savekey.save().then(async (doc) => {
                            if (doc) {
                                res.send({
                                    status: 200,
                                    message: 'Key Saved',
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
                }
            )
        }
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})
router.post('/v1/GetRefData', async (req, res) => {
    try {
        let body = req.body
        if (!body.Key) {
            res.send({ status: 204, message: 'Key Required', data: [] })
        } else if (!body.RId) {
            res.send({ status: 204, message: 'Release ID Required', data: [] })
        } else if (!body.JobId) {
            res.send({ status: 204, message: 'Job ID Required', data: [] })
        } else if (!body.MId) {
            res.send({ status: 204, message: 'Module ID Required', data: [] })
        } else {
            TempVars.find(
                {
                    rId: body.RId,
                    jobId: body.JobId,
                    mId: body.MId,
                    key: body.Key,
                },
                { _id: 1, key: 1, value: 1 },
                async (err, tempkey) => {
                    if (tempkey.length > 0) {
                        res.send({
                            status: 200,
                            message: 'Data Available',
                            data: tempkey,
                        })
                    } else {
                        res.send({
                            status: 204,
                            message: 'Data Not Available',
                            data: [],
                        })
                    }
                }
            )
        }
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.post('/v1/gettestresultfiles', async (req, res) => {
    // let daa = "";
    let body = req.body
    try {
        if (!body.jobId) {
            res.send({ status: 204, message: 'Job Id Required', data: [] })
        } else if (!body.moduleId) {
            res.send({ status: 204, message: 'Module Id Required', data: [] })
        } else if (!body.testNodeId) {
            res.send({ status: 204, message: 'TestNode Id Required', data: [] })
        } else {
            const { jobId, moduleId, testNodeId, testStepId } = body
            logger.info(
                `Fetching test results files for jobId : ${jobId}, moduleId : ${moduleId} & testNodeId : ${testNodeId}`
            )
            let screenshots
            let logFiles
            const job = await Job.findById(jobId)
            if (job) {
                if (job.testRun.length > 0) {
                    job.testRun.map((module) => {
                        if (module.moduleID === moduleId) {
                            module?.testNodes?.map(async (testNode) => {
                                if (
                                    testNode.testNodeID.toString() ===
                                    testNodeId.toString()
                                ) {
                                    logger.info(
                                        `Looping through test steps to get screenshots and logs`
                                    )
                                    screenshots = await Promise.all(
                                        testNode?.testCaseSteps?.map(
                                            async (testStep) => {
                                                let image = ''
                                                let log = ''
                                                try {
                                                    const screenshotParams = {
                                                        Bucket: process.env
                                                            .AWS_S3_BUCKET,
                                                        Key: testStep?.testStepResultsFile,
                                                    }
                                                    const logFileParams = {
                                                        Bucket: process.env
                                                            .AWS_S3_BUCKET,
                                                        Key: testStep?.testStepLogsFile,
                                                    }
                                                    if (
                                                        testStep?.testStepResultsFile
                                                    ) {
                                                        logger.info(
                                                            `screenshotParams : ${JSON.stringify(screenshotParams)}`
                                                        )
                                                        const stream =
                                                            await s3.send(
                                                                new GetObjectCommand(
                                                                    screenshotParams
                                                                )
                                                            )
                                                        logger.info(
                                                            `Successfully retreived screenshot`
                                                        )
                                                        stream.Body.on(
                                                            'data',
                                                            (data) => {
                                                                image +=
                                                                    Buffer.from(
                                                                        data,
                                                                        'base64'
                                                                    ).toString(
                                                                        'ascii'
                                                                    )
                                                            }
                                                        )
                                                    }
                                                    if (
                                                        testStep?.testStepLogsFile
                                                    ) {
                                                        const stream =
                                                            await s3.send(
                                                                new GetObjectCommand(
                                                                    logFileParams
                                                                )
                                                            )
                                                        stream.Body.on(
                                                            'data',
                                                            (data) => {
                                                                log =
                                                                    Buffer.from(
                                                                        data
                                                                    ).toString()
                                                            }
                                                        )
                                                        // log = Buffer.from(await stream.read()).toString();
                                                    }
                                                } catch (error) {
                                                    logger.info(
                                                        `Error fetching screenshot ${error}`
                                                    )
                                                }
                                                if (image?.length === 0) {
                                                    logger.info(
                                                        `image is empty adding null`
                                                    )
                                                    return null
                                                }
                                                return {
                                                    testStepId: testStep._id,
                                                    testscreenshotfile: [image],
                                                }
                                            }
                                        )
                                    )

                                    logger.info(
                                        `Successfully retreived screenshots..!!`
                                    )

                                    logger.info(
                                        `Looping through test steps to get screenshots and logs`
                                    )

                                    logFiles = await Promise.all(
                                        testNode?.testCaseSteps?.map(
                                            async (testStep) => {
                                                let image = ''
                                                let log = ''
                                                try {
                                                    const screenshotParams = {
                                                        Bucket: process.env
                                                            .AWS_S3_BUCKET,
                                                        Key: testStep?.testStepResultsFile,
                                                    }
                                                    const logFileParams = {
                                                        Bucket: process.env
                                                            .AWS_S3_BUCKET,
                                                        Key: testStep?.testStepLogsFile,
                                                    }

                                                    if (
                                                        testStep?.testStepLogsFile
                                                    ) {
                                                        logger.info(
                                                            `logFileParams : ${JSON.stringify(logFileParams)}`
                                                        )
                                                        const stream =
                                                            await s3.send(
                                                                new GetObjectCommand(
                                                                    logFileParams
                                                                )
                                                            )
                                                        logger.info(
                                                            `Successfully retreived log`
                                                        )
                                                        stream.Body.on(
                                                            'data',
                                                            (data) => {
                                                                log +=
                                                                    Buffer.from(
                                                                        data
                                                                    ).toString()
                                                            }
                                                        )

                                                        if (
                                                            testStep?.testStepResultsFile
                                                        ) {
                                                            const stream =
                                                                await s3.send(
                                                                    new GetObjectCommand(
                                                                        screenshotParams
                                                                    )
                                                                )
                                                            stream.Body.on(
                                                                'data',
                                                                (data) => {
                                                                    image +=
                                                                        Buffer.from(
                                                                            data,
                                                                            'base64'
                                                                        ).toString(
                                                                            'ascii'
                                                                        )
                                                                }
                                                            )
                                                        }
                                                        log = Buffer.from(
                                                            await stream.read()
                                                        ).toString()
                                                    }
                                                } catch (error) {
                                                    logger.info(
                                                        `Error fetching log ${error}`
                                                    )
                                                }

                                                if (log?.length === 0) {
                                                    logger.info(
                                                        `log is empty adding null`
                                                    )
                                                    return null
                                                }

                                                return {
                                                    testStepId: testStep._id,
                                                    testlogfile: [log],
                                                }
                                            }
                                        )
                                    )

                                    logger.info(`Successfully fecthed logs..!!`)

                                    if (screenshots) {
                                        logger.info(
                                            `Sending response with screenshots and logs..!!`
                                        )
                                        res.send({
                                            status: 200,
                                            message: 'Files Available',
                                            data: {
                                                logs: logFiles,
                                                screens: screenshots,
                                            },
                                        })
                                    } else {
                                        logger.info(
                                            `Sending response without screenshots and logs..!!`
                                        )
                                        res.send({
                                            status: 204,
                                            message: 'No Files Available',
                                            data: [],
                                        })
                                    }
                                }
                            })
                        }
                    })
                } else {
                    logger.info(`No Test Runs Available..!!`)
                    res.send({
                        status: 204,
                        message: 'No Test Runs Availabe',
                        data: [],
                    })
                }
            } else {
                logger.info(`No Job Available..!!`)
                res.send({ status: 204, message: 'No Job Available', data: [] })
            }
        }
    } catch (err) {
        logger.info('error in get test result files', err)
    }
})

router.post('/v2/gettestresultfiles', async (req, res) => {
    let body = req.body
    try {
        const { jobId, moduleId, testNodeId, testStepId } = body
        const job = await Job.findById(jobId)
        if (job) {
            if (job.testRun.length > 0) {
                let testruns = job.testRun
                let filesdata = []
                let screenshots = []
                let isloopcompleted = false
                for (let i = 0; i < testruns.length; i++) {
                    if (testruns[i].moduleID === moduleId) {
                        let testcases = []
                        let testnodes = testruns[i].testNodes
                        for (let j = 0; j < testnodes.length; j++) {
                            let isTestNodesCompleted = false
                            if (testnodes.length == j + 1) {
                                isTestNodesCompleted = true
                            }
                            for (
                                let k = 0;
                                k < testnodes[j].testCaseSteps.length;
                                k++
                            ) {
                                const logFileParams = {
                                    Bucket: process.env.AWS_S3_BUCKET,
                                    Key: testnodes[j].testCaseSteps[k]
                                        .testStepLogsFile,
                                }
                                const stream = await s3.send(
                                    new GetObjectCommand(logFileParams)
                                )

                                stream.Body.on('data', (data) => {
                                    filesdata.push({
                                        testStepId:
                                            testnodes[j].testCaseSteps[k]._id,
                                        testlogfile: [
                                            Buffer.from(data).toString(),
                                        ],
                                    })
                                })

                                const screenshotParams = {
                                    Bucket: process.env.AWS_S3_BUCKET,
                                    Key: testnodes[j].testCaseSteps[k]
                                        .testStepResultsFile,
                                }
                                const stream1 = await s3.send(
                                    new GetObjectCommand(screenshotParams)
                                )

                                let screenshot = ''

                                stream1.Body.on('data', (data1) => {
                                    screenshot += Buffer.from(
                                        data1,
                                        'base64'
                                    ).toString('ascii')
                                })

                                if (isTestNodesCompleted) {
                                    if (
                                        testnodes[j].testCaseSteps.length ==
                                        k + 1
                                    ) {
                                        isloopcompleted = true
                                    }
                                }
                            }
                        }
                    }
                }
                if (isloopcompleted) {
                    res.send({
                        status: 200,
                        message: 'Files',
                        data: { logs: filesdata, screens: screenshots },
                    })
                }
            } else {
                res.send({ status: 204, message: 'No Test Runs', data: [] })
            }
        } else {
            res.send({ status: 204, message: 'No Job Available', data: [] })
        }
    } catch (err) {
        logger.info('error in test results file ', err)
    }
})

router.post('/v3/gettestresultfiles', async (req, res) => {
    let body = req.body
    const { jobId, moduleId, testNodeId, testStepId } = body
    const job = await Job.findById(jobId)
    if (job) {
        if (job.testRun.length > 0) {
            let testruns = job.testRun
            let filesdata = []
            let screenshots = []
            let isloopcompleted = false
            let totalsteps = 0
            let finalended = false
            let totaltestcasesteps = 0
            for (let a = 0; a < testruns.length; a++) {
                let testnode = testruns[a].testNodes

                for (let b = 0; b < testnode.length; b++) {
                    if (testnode[b].testNodeID == body.testNodeId) {
                        for (
                            let c = 0;
                            c < testnode[b].testCaseSteps.length;
                            c++
                        ) {
                            totaltestcasesteps += 1
                        }
                    }
                }
            }
            for (let i = 0; i < testruns.length; i++) {
                if (testruns[i].moduleID === moduleId) {
                    let testcases = []
                    let testnodes = testruns[i].testNodes
                    for (let j = 0; j < testnodes.length; j++) {
                        let isTestNodesCompleted = false
                        if (testnodes.length == j + 1) {
                            isTestNodesCompleted = true
                        }
                        if (testnodes[j].testNodeID == body.testNodeId) {
                            for (
                                let k = 0;
                                k < testnodes[j].testCaseSteps.length;
                                k++
                            ) {
                                const logFileParams = {
                                    Bucket: process.env.AWS_S3_BUCKET,
                                    Key: testnodes[j].testCaseSteps[k]
                                        .testStepLogsFile,
                                }
                                const stream = await s3.send(
                                    new GetObjectCommand(logFileParams)
                                )
                                stream.Body.on('data', (data) => {
                                    filesdata.push({
                                        testStepId:
                                            testnodes[j].testCaseSteps[k]._id,
                                        testlogfile: [
                                            Buffer.from(data).toString(),
                                        ],
                                    })
                                })
                                const screenshotParams = {
                                    Bucket: process.env.AWS_S3_BUCKET,
                                    Key: testnodes[j].testCaseSteps[k]
                                        .testStepResultsFile,
                                }
                                const stream1 = await s3.send(
                                    new GetObjectCommand(screenshotParams)
                                )
                                stream1.Body.on('data', (data1) => {
                                    screenshots.push({
                                        testStepId:
                                            testnodes[j].testCaseSteps[k]._id,
                                        testscreenshotfile: Buffer.from(
                                            data1,
                                            'base64'
                                        ).toString('ascii'),
                                    })
                                })
                                stream1.Body.on('end', (data1) => {
                                    totalsteps += 1
                                    if (totalsteps == totaltestcasesteps) {
                                        finalended = true
                                        let concdata = []
                                        let testDataMap = {}
                                        screenshots.forEach((screen) => {
                                            if (
                                                testDataMap.hasOwnProperty(
                                                    screen.testStepId
                                                )
                                            ) {
                                                testDataMap[
                                                    screen.testStepId
                                                ].push(
                                                    screen.testscreenshotfile
                                                )
                                            } else {
                                                testDataMap[screen.testStepId] =
                                                    [screen.testscreenshotfile]
                                            }
                                        })
                                        for (let testStepId in testDataMap) {
                                            if (
                                                testDataMap.hasOwnProperty(
                                                    testStepId
                                                )
                                            ) {
                                                concdata.push({
                                                    testStepId: testStepId,
                                                    testscreenshotfile: [
                                                        testDataMap[
                                                            testStepId
                                                        ].join(''),
                                                    ],
                                                })
                                            }
                                        }
                                        res.send({
                                            status: 200,
                                            message: 'Files',
                                            data: {
                                                logs: filesdata,
                                                screens: concdata,
                                            },
                                        })
                                    }
                                })
                            }
                        }
                    }
                }
            }
        } else {
            res.send({ status: 204, message: 'No Test Runs', data: [] })
        }
    } else {
        res.send({ status: 204, message: 'No Job Available', data: [] })
    }
})

const getObjectFromS3 = async (params) => {
    const response = await s3.send(new GetObjectCommand(params))
    logger.info(`Successfully retreived object : ${JSON.stringify(params)}`)
    const streamToString = async (stream) => {
        return new Promise((resolve, reject) => {
            const chunks = []
            stream.on('data', (chunk) => chunks.push(chunk))
            stream.on('end', () =>
                resolve(Buffer.concat(chunks).toString('utf-8'))
            )
            stream.on('error', reject)
        })
    }
    return await streamToString(response.Body)
}

router.post('/v4/gettestresultfiles', async (req, res) => {
    // let daa = "";
    let body = req.body
    console.log('body', body)
    try {
        if (!body.jobId) {
            res.send({ status: 204, message: 'Job Id Required', data: [] })
        } else if (!body.moduleId) {
            res.send({ status: 204, message: 'Module Id Required', data: [] })
        } else if (!body.testNodeId) {
            res.send({ status: 204, message: 'TestNode Id Required', data: [] })
        } else {
            const { jobId, moduleId, testNodeId, testStepId } = body
            logger.info(
                `Fetching test results files for jobId : ${jobId}, moduleId : ${moduleId} & testNodeId : ${testNodeId}`
            )
            let screenshots
            let logFiles
            const job = await Job.findById(jobId)
            if (job) {
                if (job.testRun.length > 0) {
                    job.testRun.map((module) => {
                        if (module.moduleID === moduleId) {
                            module?.testNodes?.map(async (testNode) => {
                                if (
                                    testNode.testNodeID.toString() ===
                                    testNodeId.toString()
                                ) {
                                    logger.info(
                                        `Looping through test steps to get screenshots and logs`
                                    )
                                    const screenshots = await Promise.all(
                                        testNode?.testCaseSteps?.map(
                                            async (testStep) => {
                                                let image = ''
                                                try {
                                                    if (
                                                        process.env
                                                            .AWS_S3_BUCKET
                                                    ) {
                                                        const screenshotParams =
                                                            {
                                                                Bucket: process
                                                                    .env
                                                                    .AWS_S3_BUCKET,
                                                                Key: testStep?.testStepResultsFile,
                                                            }

                                                        if (
                                                            testStep?.testStepResultsFile
                                                        ) {
                                                            logger.info(
                                                                `screenshotParams : ${JSON.stringify(screenshotParams)}`
                                                            )

                                                            image =
                                                                await getObjectFromS3(
                                                                    screenshotParams
                                                                ) // Assuming this returns string
                                                        }
                                                    } else if (sharedStorage) {
                                                        if (
                                                            testStep?.testStepResultsFile
                                                        ) {
                                                            logger.info(
                                                                `screenshotParams : ${testStep?.testStepResultsFile}`
                                                            )

                                                            const remoteFilePath =
                                                                path.join(
                                                                    testStep.testStepResultsFile
                                                                )

                                                            image =
                                                                await responseTransformer.readFileFromSMBPath(
                                                                    null,
                                                                    remoteFilePath
                                                                )
                                                        }
                                                    } else if (mountStorage) {
                                                        if (
                                                            testStep?.testStepResultsFile
                                                        ) {
                                                            logger.info(
                                                                `screenshotParams : ${testStep?.testStepResultsFile}`
                                                            )

                                                            const remoteFilePath =
                                                                path.join(
                                                                    mountStorage,
                                                                    testStep.testStepResultsFile
                                                                )

                                                            image =
                                                                getScreenshotFromMountLocation(
                                                                    remoteFilePath
                                                                )
                                                        }
                                                    }
                                                } catch (error) {
                                                    logger.info(
                                                        `Error fetching screenshot: ${error}`
                                                    )
                                                }

                                                if (
                                                    !image ||
                                                    image.length === 0
                                                ) {
                                                    logger.info(
                                                        `image is empty, adding null`
                                                    )
                                                    return null
                                                }

                                                return {
                                                    testStepId: testStep._id,
                                                    testscreenshotfile: [image],
                                                }
                                            }
                                        )
                                    )

                                    logger.info(
                                        `Successfully retreived screenshots..!!`
                                    )

                                    logger.info(
                                        `Looping through test steps to get screenshots and logs`
                                    )

                                    logFiles = await Promise.all(
                                        testNode?.testCaseSteps?.map(
                                            async (testStep) => {
                                                let log = ''
                                                try {
                                                    if (
                                                        process.env
                                                            .AWS_S3_BUCKET
                                                    ) {
                                                        const logFileParams = {
                                                            Bucket: process.env
                                                                .AWS_S3_BUCKET,
                                                            Key: testStep?.testStepLogsFile,
                                                        }

                                                        if (
                                                            testStep?.testStepLogsFile
                                                        ) {
                                                            logger.info(
                                                                `logFileParams : ${JSON.stringify(logFileParams)}`
                                                            )

                                                            log =
                                                                await getObjectFromS3(
                                                                    logFileParams
                                                                )
                                                        }
                                                    } else if (sharedStorage) {
                                                        if (
                                                            testStep?.testStepLogsFile
                                                        ) {
                                                            logger.info(
                                                                `screenshotParams : ${testStep?.testStepLogsFile}`
                                                            )

                                                            const remoteFilePath =
                                                                path.join(
                                                                    testStep?.testStepLogsFile
                                                                )

                                                            log =
                                                                await responseTransformer.readFileFromSMBPath(
                                                                    null,
                                                                    remoteFilePath
                                                                )
                                                        }
                                                    } else if (mountStorage) {
                                                        if (
                                                            testStep?.testStepLogsFile
                                                        ) {
                                                            logger.info(
                                                                `screenshotParams : ${testStep?.testStepLogsFile}`
                                                            )

                                                            const remoteFilePath =
                                                                path.join(
                                                                    mountStorage,
                                                                    testStep.testStepLogsFile
                                                                )

                                                            log =
                                                                fs.readFileSync(
                                                                    remoteFilePath,
                                                                    {
                                                                        flag: 'r',
                                                                        encoding:
                                                                            'utf8',
                                                                    }
                                                                )
                                                        }
                                                    }
                                                } catch (error) {
                                                    logger.info(
                                                        `Error fetching log ${error}`
                                                    )
                                                }

                                                if (log?.length === 0) {
                                                    logger.info(
                                                        `log is empty adding null`
                                                    )
                                                    return null
                                                }

                                                return {
                                                    testStepId: testStep._id,
                                                    testlogfile: [log],
                                                }
                                            }
                                        )
                                    )

                                    logger.info(`Successfully fecthed logs..!!`)

                                    if (screenshots) {
                                        logger.info(
                                            `Sending response with screenshots and logs..!!`
                                        )
                                        try {
                                            res.send({
                                                status: 200,
                                                message: 'Files Available',
                                                data: {
                                                    logs: logFiles,
                                                    screens: screenshots,
                                                },
                                            })
                                        } catch (error) {
                                            logger.info(
                                                `Encountered issue while fetching details ${error}`
                                            )
                                        }
                                    } else {
                                        logger.info(
                                            `Sending response without screenshots and logs..!!`
                                        )
                                        res.send({
                                            status: 204,
                                            message: 'No Files Available',
                                            data: [],
                                        })
                                    }
                                }
                            })
                        }
                    })
                } else {
                    logger.info(`No Test Runs Available..!!`)
                    res.send({
                        status: 204,
                        message: 'No Test Runs Availabe',
                        data: [],
                    })
                }
            } else {
                logger.info(`No Job Available..!!`)
                res.send({ status: 204, message: 'No Job Available', data: [] })
            }
        }
    } catch (err) {
        logger.info('error in get test result files', err)
    }
})

async function readSmbFile(remoteFilePath) {
    try {
        // If the file contains text (e.g., base64 string)
        const content = await smb.readFile(remoteFilePath, 'utf8')
        console.log('SMB file content:', content)
        return content
    } catch (err) {
        console.error('Failed to read SMB file:', err)
        throw err
    }
}

router.post('/v1/emailsummary', async (req, res) => {
    let body = req.body
    if (!body.jobId) {
        res.send({ status: 204, message: 'JobId Required', data: [] })
    } else {
        const job = await Job.findById(body.jobId)
        const user = await User.findById(job?.createdBy)
        const release = await Release.findById(job?.releaseID)
        const relJobs = await Job.find({
            releaseID: job?.releaseID,
            version: release?.testRunVersion,
        })
        let untested = 0
        let passed = 0
        let skipped = 0
        let failed = 0
        let blocked = 0
        let total = 0
        let relUntested = 0
        let relPassed = 0
        let relSkipped = 0
        let relFailed = 0
        let relBlocked = 0
        let percentage = 0

        const jobs = []
        if (relJobs) {
            relJobs?.forEach((job) => {
                const { testRun } = job
                testRun?.forEach((module) => {
                    const { testNodes } = module
                    untested = testNodes?.filter(
                        (testNode) => testNode?.status === JobStatus.UNTESTED
                    )?.length
                    passed = testNodes?.filter(
                        (testNode) => testNode?.status === JobStatus.PASSED
                    )?.length
                    skipped = testNodes?.filter(
                        (testNode) => testNode?.status === JobStatus.SKIPPED
                    )?.length
                    failed = testNodes?.filter(
                        (testNode) => testNode?.status === JobStatus.FAILED
                    )?.length
                    blocked = testNodes?.filter(
                        (testNode) => testNode?.status === JobStatus.BLOCKED
                    )?.length
                    relUntested += untested
                    relPassed += passed
                    relSkipped += skipped
                    relFailed += failed
                    relBlocked += blocked
                    total = untested + passed + skipped + failed + blocked
                    const date = new Date(parseInt(job?.executionDuration, 10))
                    const formattedDuration =
                        parseInt(date.getMinutes(), 10) !== 0
                            ? moment(date).format('m[m] s[s]')
                            : moment(date).format('s[s]')
                    const newJob = {}
                    newJob._id = job._id
                    newJob.runNo = `${release?.releaseName}_${job.jenkinsJobID}`
                    newJob.release = `${release?.releaseName}`
                    newJob.total = total
                    newJob.untested = untested
                    newJob.passed = passed
                    newJob.skipped = skipped
                    newJob.failed = failed
                    newJob.blocked = blocked
                    newJob.executionDuration = formattedDuration
                    jobs.push(newJob)
                })
            })
        }
        total = relUntested + relPassed + relSkipped + relFailed + relBlocked
        percentage = automatedPercentage = parseFloat((relPassed / total) * 100)
            .toFixed(2)
            .replace('.00', '')

        const relDuration = await getReleaseExecutionDuration(
            release,
            release?.testRunVersion
        )

        const relSummary = {
            ReleaseId: release?._id,
            ReleaseName: release?.releaseName,
            completed_perc: percentage,
            completed_time: relDuration,
            total,
            Passed: relPassed,
            Failed: relFailed,
            Untested: relUntested,
            Blocked: relBlocked,
            Skipped: relSkipped,
        }
        const summary = {
            relSummary,
            testRuns: jobs,
        }
        if (release) {
            let email = await common
                .sendPieChartEmail(
                    user.email,
                    release?.releaseName + ' - Summary Report',
                    summary,
                    `${user?.firstName} ${user?.lastName}`,
                    'SUMMARY_REPORT',
                    job._id,
                    body?.attachments
                )
                .catch(console.error)
            res.send({
                status: 200,
                message: `Sent email to ${user.email}`,
                data: summary,
            })
        } else {
            res.send({ status: 200, message: 'Release not found', data: '' })
        }
    }
})

router.post('/v1/sendAttachmentInEmail', async (req, res) => {
    try {
        const response = await common.sendAttachmentEmail(req.body)
        res.send({
            status: 200,
            message: `Sent email to ${req.body.to}`,
            data: response,
        })
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

//User Details
router.post('/v1/getReleaseTestRunVersion', async (req, res) => {
    try {
        const body = req.body
        const release = await Release.findById(body.releaseId)
        let version = 0.01
        if (release?.testRunVersion) version = release?.testRunVersion + 0.01
        version = version.toFixed(2)

        // Release.findByIdAndUpdate(
        //     body.releaseId,
        //     {
        //         testRunVersion: version,
        //     },
        //     (err, release) => {
        //         if (err) console.error('err', err)
        //     }
        // )
        const updatedRelease = await Release.findByIdAndUpdate(
            body.releaseId,
            { testRunVersion: version },
            { new: true } // to return the updated document
        )
        res.send({
            status: 200,
            message: { data: { version } },
        })
    } catch (error) {
        logger.info(
            `Encountered issue while fetching release test run version ${error}`
        )
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.post('/v1/getReleaseExecutionDuration', async (req, res) => {
    try {
        const body = req.body
        const release = await Release.findById(body.releaseId)
        let formattedTimeDifference = null
        let queryParams = {
            releaseID: release?._id,
            version: release?.testRunVersion,
        }
        if (body.moduleId) {
            queryParams = {
                releaseID: release?._id,
                version: release?.testRunVersion,
                'testRun.moduleID': body?.moduleId,
            }
        }
        if (release?.testRunVersion) {
            const jobs = await Job.find({
                releaseID: release?._id,
                version: release?.testRunVersion,
            })
            const jobStarts = Array.from(
                new Set(jobs.map((u) => new Date(u.executionStart)))
            )

            const jobEnds = Array.from(
                new Set(jobs.map((u) => new Date(u.executionEnd)))
            )

            const validStartDates = []

            for (const date of jobStarts) {
                const newDate = new Date(date)

                if (newDate.toString() !== 'Invalid Date') {
                    validStartDates.push(newDate)
                }
            }

            const validEndDates = []

            for (const date of jobEnds) {
                const newDate = new Date(date)

                if (newDate.toString() !== 'Invalid Date') {
                    validEndDates.push(newDate)
                }
            }

            const starttime = Math.max(...validEndDates)
            const endtime = Math.min(...validStartDates)

            if (validEndDates?.length && validStartDates?.length) {
                let timeDiffInMilliseconds = starttime - endtime

                let timeDiffInSeconds = Math.abs(timeDiffInMilliseconds) / 1000

                let minutes = Math.floor(timeDiffInSeconds / 60)
                let seconds = Math.floor(timeDiffInSeconds % 60)

                formattedTimeDifference = `${minutes !== 0 ? `${minutes}m` : ''} ${seconds}s`
            }
        }

        res.send({
            status: 200,
            message: { data: { executionDuration: formattedTimeDifference } },
        })
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.post('/v1/getGenAITestCases', async (req, res) => {
    try {
        const url = process.env.GEN_AI_TESTCASES_HOST
        const body = req.body

        let formData = { inputText: body.inputText, inputImage: null }

        if (body?.input === GEN_AI_INPUT.IMAGE)
            formData = { inputText: null, inputImage: body.inputText }

        await axios
            .post(url, formData, {})
            .then((resp) => {
                res.send({
                    status: 200,
                    data: resp.data,
                })
            })
            .catch((err) => {
                res.status(400).json({ message: err?.message })
            })
    } catch (error) {
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

router.post('/v1/uploadVideo', async (req, res) => {
    try {
        const { jobId, moduleId, moduleName, status } = req.body
        const videoPath = path.join(
            'videos',
            jobId,
            moduleId,
            `${moduleName}.mp4`
        )
        if (req.files?.video_file && sharedStorage) {
            const videoPath = path.join('videos', jobId, moduleId)
            await uploadVideoFileToSharedFolder(
                req.files.video_file.data,
                videoPath,
                `${moduleName}.mp4`
            )
        } else if (req.files?.video_file)
            await uploadVideoFileToS3(req.files.video_file.data, videoPath)

        Job.findById(jobId, (err, job) => {
            responseTransformer.passthroughError(
                err,
                job,
                'find job',
                res,
                (job) => {
                    job['linuxScreenRecord']['video'] = videoPath
                    job['linuxScreenRecord']['status'] = status
                    Job.findByIdAndUpdate(jobId, job, (err, resJob) => {})
                }
            )
        })
        res.send({ status: 200, data: 'Video upload success' })
    } catch (error) {
        console.log('error', error)
        res.send({ status: 400, message: 'Bad Request', data: error })
    }
})

const streamToString = async (stream) => {
    const chunks = []
    for await (const chunk of stream) {
        chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf-8')
}

router.get('/v1/stream/:userId/:testRunId', async (req, res) => {
    try {
        const { userId, testRunId } = req.params
        if (!userId) {
            res.send({ status: 204, message: 'User Id Required', data: '' })
        } else {
            User.findById(userId).then(async (user, err) => {
                if (user) {
                    Job.findById(testRunId).then(async (job, err) => {
                        if (job) {
                            const project = await Project.findById(
                                job.projectID,
                                { team: 1 }
                            )
                            const userHasAccess = project.team.includes(userId)

                            if (!userHasAccess) {
                                res.send({
                                    status: 400,
                                    message:
                                        'User has no access to this Video!!',
                                    data: '',
                                })
                            } else if (
                                user._id &&
                                userHasAccess &&
                                job?.linuxScreenRecord?.video
                            ) {
                                try {
                                    const params = {
                                        Bucket: process.env.AWS_S3_BUCKET,
                                        Key: job?.linuxScreenRecord?.video,
                                        // Expires: 300, // 5 minutes
                                    }

                                    const metadata = await s3.send(
                                        new GetObjectCommand(params)
                                    )
                                    const fileSize = metadata.ContentLength

                                    const range = req.headers.range

                                    if (!range) {
                                        res.status(400).send(
                                            'Requires Range header'
                                        )
                                        return
                                    }

                                    // 2️⃣ Parse Range Header
                                    const CHUNK_SIZE = 10 ** 6 // 1MB chunks
                                    const start = Number(
                                        range.replace(/\D/g, '')
                                    )
                                    const end = Math.min(
                                        start + CHUNK_SIZE,
                                        fileSize - 1
                                    )
                                    const contentLength = end - start + 1

                                    // 3️⃣ Get Video Stream from S3/MinIO
                                    const getObjectParams = {
                                        Bucket: process.env.AWS_S3_BUCKET,
                                        Key: job?.linuxScreenRecord?.video,
                                        Range: `bytes=${start}-${end}`,
                                    }

                                    const { Body } = await s3.send(
                                        new GetObjectCommand(getObjectParams)
                                    )

                                    // 4️⃣ Set Headers and Stream Data
                                    res.writeHead(206, {
                                        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                                        'Accept-Ranges': 'bytes',
                                        'Content-Length': contentLength,
                                        'Content-Type': 'video/mp4',
                                    })

                                    Body.pipe(res)
                                } catch (error) {
                                    res.send({
                                        status: 400,
                                        message: 'No Video found!!',
                                        data: '',
                                    })
                                }
                            } else {
                                res.send({
                                    status: 400,
                                    message: 'No Video found!!',
                                    data: '',
                                })
                            }
                        } else {
                            res.send({
                                status: 400,
                                message: 'No Job found!!',
                                data: '',
                            })
                        }
                    })
                } else {
                    res.send({
                        status: 400,
                        message: 'Bad Request',
                        data: 'User not found!!',
                    })
                }
            })
            // res.send({ status: 200, data: { presignedUrl } })
        }
    } catch (error) {
        console.error('Error streaming video', error)
        res.status(500).json({ error: 'Failed to stream video' })
    }
})

router.get('/v1/download/:userId/:filename', async (req, res) => {
    try {
        const { userId, filename } = req.params
        const key = `downloads/${filename}`
        console.log('userId', userId, filename, key)
        if (!userId) {
            res.send({ status: 204, message: 'User Id Required', data: '' })
        } else {
            const params = {
                Bucket: process.env.AWS_S3_BUCKET,
                Key: key,
                // Expires: 300, // 5 minutes
            }

            try {
                const stream = await s3.send(new GetObjectCommand(params))
                res.setHeader('Content-Type', 'application/octet-stream')
                res.setHeader(
                    'Content-Disposition',
                    `attachment; filename="${filename}"`
                )
                stream.Body.pipe(res)
            } catch (error) {
                console.error('Download error:', error)
                res.status(500).send('Error downloading file')
            }
        }
    } catch (error) {
        console.error('Error streaming video', error)
        res.status(500).json({ error: 'Failed to stream video' })
    }
})

// Proxy for .m3u8 and .ts segments
router.get('/v1/getJob/:userId/:jobId', async (req, res) => {
    const { userId, jobId } = req.params

    if (!userId) {
        res.send({ status: 204, message: 'User Id Required', data: '' })
    } else {
        const job = await Job.findById(jobId, {
            jenkinsJobName: 1,
            linuxScreenRecord: 1,
        })
        res.send({ status: 200, message: 'Job found', data: job })
    }
})

// Proxy for .m3u8 and .ts segments
router.get('/v1/livestream/:jenkinsJobName/:streamPath', (req, res) => {
    try {
        const { jenkinsJobName } = req.params
        const { streamPath } = req.params // captures the rest of the path

        const jenkinsUrl = jenkinsConfig.streamUrl(jenkinsJobName, streamPath)

        // Optional: if Jenkins needs auth
        const options = {
            url: jenkinsUrl,
            headers: {
                // Example for Basic Auth (replace if needed)
                Authorization: 'Basic ' + Buffer.from(auth).toString('base64'),
            },
        }

        req.pipe(request(options)).pipe(res)
    } catch (error) {
        res.send({ status: 500, message: 'Error getting info', error })
    }
})

router.post('/v1/deleteJenkinsJobs', async (req, res) => {
    try {
        const templates = (await Template.find()).map((t) => t.name)
        console.log('templates', templates)

        const crumbResponse = await axios.get(jenkinsConfig.getCrumb(), {
            headers: {
                Authorization: jenkinsConfig.headers.Authorization,
            },
        })

        jenkinsConfig.headers['Jenkins-Crumb'] = crumbResponse.data.crumb
        jenkinsConfig.xmlHeaders['Jenkins-Crumb'] = crumbResponse.data.crumb

        let response = await axios.post(
            jenkinsConfig.getAllJobs(),
            {},
            { headers: jenkinsConfig.headers }
        )
        const jobs = response.data.jobs.map((job) => job.name)
        console.log('jobs', jobs)
        const jobsToDelete = jobs
            .filter((job) => !templates.includes(job))
            .filter((job) => job !== 'TestEnsure')
        console.log('jobsToDelete', jobsToDelete)
        jobsToDelete.forEach(async (jobToDelete) => {
            try {
                await axios.post(
                    jenkinsConfig.deleteJob(jobToDelete),
                    {},
                    { headers: jenkinsConfig.headers }
                )
                console.log('Delete Job is success', jobToDelete)
            } catch (err) {
                logger.info(err)
            }
        })
        res.send({ status: 200, data: 'Delete success' })
    } catch (error) {
        console.log('error', error)
        res.send({ status: 500, message: 'Error getting info', error })
    }
})

// Proxy endpoint for streaming
// router.get('/v1/stream/:streamId', async (req, res) => {
//     const { streamId } = req.params

//     // Fetch the stream from Jenkins
//     try {
//         const crumbResponse = await axios.get(jenkinsConfig.getCrumb(), {
//             headers: {
//                 Authorization: jenkinsConfig.headers.Authorization,
//             },
//         })

//         jenkinsConfig.headers['Jenkins-Crumb'] = crumbResponse.data.crumb
//         jenkinsConfig.xmlHeaders['Jenkins-Crumb'] = crumbResponse.data.crumb

//         try {
//             console.log(
//                 jenkinsConfig.streamUrl(
//                     'Test_Live_video_SalesOrder_1',
//                     streamId
//                 )
//             )
//             response = await axios.post(
//                 jenkinsConfig.streamUrl(
//                     'Test_Live_video_SalesOrder_1',
//                     streamId
//                 ),
//                 {},
//                 { headers: jenkinsConfig.headers, responseType: 'stream' }
//             )
//             console.log('Delete Job is success')
//         } catch (err) {
//             logger.info(err)
//         }

//         // Forward the Jenkins stream to the React app
//         res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
//         response.data.pipe(res) // Pipe the Jenkins stream response to the client
//     } catch (error) {
//         console.error('Error fetching stream:', error)
//         res.status(500).send('Error fetching stream')
//     }
// })

module.exports = router
