const JobStatus = {
    UNTESTED: 'UNTESTED',
    PASSED: 'PASSED',
    SKIPPED: 'SKIPPED',
    FAILED: 'FAILED',
    BLOCKED: 'BLOCKED',
}

const JobRunningStatus = {
    TODO: 'TODO',
    IN_QUEUE: 'In Queue',
    IN_PROGRESS: 'In Progress',
    MANUAL: 'Manual',
    WAITING: 'Waiting',
    COMPLETED: 'Completed',
}

const ReleaseSchedule = {
    NO_REPEAT: 'No Repeat',
    DAILY: 'Daily',
    WEEKLY: 'Weekly',
    MONTHLY: 'Monthly',
}

const GEN_AI_INPUT = {
    TEXT: 'text',
    IMAGE: 'image',
}

const ExcludeKeys = ['frameSwitch', 'sleep', 'keyBoardEvent']

const KEYS = {
    GETTEXT: 'getText',
    TESTSTEPDESCRIPTION: 'testStepDescription',
    VARIABLENAME: 'varName',
}

module.exports = {
    JobStatus,
    JobRunningStatus,
    ReleaseSchedule,
    GEN_AI_INPUT,
    ExcludeKeys,
    KEYS,
}
