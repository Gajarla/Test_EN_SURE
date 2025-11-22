const User = require('../Models/User')
const moment = require('moment')
const logger = require('../utils/logger')
const { Module } = require('../Models/Module')
const mongoose = require('mongoose')
const Project = require('../Models/Project')
const Company = require('../Models/Company')
const Role = require('../Models/Role')
const LoginActivity = require('../Models/UserLoginActivity')
const userAudit = require('../Models/UserAudit')
const puppeteer = require('puppeteer')

const nodemailer = require('nodemailer')
// const Chart = require('chart.js');
// const { createCanvas, loadImage } = require('canvas')
const fetch = require('node-fetch')
const fs = require('fs')

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: true, // Use `true` for port 465, `false` for all other ports, 587
    auth: {
        user: process.env.SMTP_USERNAME,
        pass: process.env.SMTP_PASSWORD,
    },
})

const SendEmail = async (toAddress, Sub, body, U_Details, template) => {
    let bdy
    if (template == 'FORGOT_PASSWORD') {
        bdy =
            `<html lang="en">
    <body>
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" class="body">
        <tr>
          <td>&nbsp;</td>
          <td class="container">
            <div class="content">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" class="main">
                <tr>
                  <td class="wrapper">
                    <p>Dear ` +
            U_Details.firstName +
            `</p>
                    <p>Trouble signing in? Resetting your password is easy.</p>
                    <p>Just click on the link below and follow the instructions.</p>
                    <p>
                    <a href="`
        bdy += body
        bdy += `" target="_blank">click here to update password</a> 
                    </p><br><br>
                    <p>If you did not make this request, please ignore this email
                    </p><br><br><br>
                    <p>Thank you,</p>
                    <p>TestEnsure Platform Support</p>
                  </td>
                </tr>
                </table>
              </div>
          </td>
          <td>&nbsp;</td>
        </tr>
      </table>
    </body>
  </html>`
    } else if (template == 'SUMMARY_REPORT') {
        bdy =
            `<html lang="en">
    <body>
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" class="body">
        <tr>
          <td>&nbsp;</td>
          <td class="container">
            <div class="content">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" class="main">
                <tr>
                  <td class="wrapper">
                    <p>Dear ` +
            U_Details +
            `</p>
                    <p>Your Last Test Result Summary ..</p><br><br>
                    <p>
                      <table>
                        <tr>
                          <td><b>Percentage</b></td><td>` +
            body.completed_perc +
            `</td>
                        </tr>
                        <tr>
                          <td><b>Completed Time</b></td><td>` +
            body.completed_time +
            `</td>
                        </tr>
                        <tr>
                          <td><b>Passed</b></td><td>` +
            body.Passed +
            `</td>
                        </tr>
                        <tr>
                          <td><b>Failed</b></td><td>` +
            body.Failed +
            `</td>
                        </tr>
                        <tr>
                          <td><b>Untested</b></td><td>` +
            body.Untested +
            `</td>
                        </tr>
                        <tr>
                          <td><b>Blocked</b></td><td>` +
            body.Blocked +
            `</td>
                        </tr>
                        <tr>
                        <td><b>Skipped</b></td><td>` +
            body.Skipped +
            `</td>
                        </tr>
                      </table>
                    </p>
                    <p>Thank you,</p>
                    <p>TestEnsure Platform Support</p>
                  </td>
                </tr>
                </table>
              </div>
          </td>
          <td>&nbsp;</td>
        </tr>
      </table>
    </body>
  </html>`
    }

    const info = await transporter.sendMail({
        from: process.env.SMTP_USERNAME, // sender address
        to: toAddress, // list of receivers
        subject: Sub, // Subject line Hello ✔
        text: '', // plain text body
        html: bdy, // html body "<b>Hello world?</b>"
    })
    if (info.messageId) {
        return info.messageId
    } else {
        return 'FAIL'
    }
}

const SendEmailChart = async (toAddress, Sub, body, U_Details, template) => {
    let rdet = body.relSummary
    let responce
    const QuickChart = require('quickchart-js')
    const chart = new QuickChart()
    chart.setWidth(400)
    chart.setHeight(300)
    chart.setVersion('2.9.4')
    chart.setConfig({
        type: 'pie',
        data: {
            labels: ['Untested', 'Skipped', 'Failed', 'Blocked', 'Passed'],
            datasets: [
                {
                    data: [
                        rdet.Untested,
                        rdet.Skipped,
                        rdet.Failed,
                        rdet.Blocked,
                        rdet.Passed,
                    ],
                },
            ],
        },
        options: {
            plugins: {
                datalabels: {
                    display: false,
                },
            },
        },
    })
    let imgurl = chart.getUrl()
    const image = await chart.toBinary()
    let testrun = body.testRuns
    let testrundtd
    for (let i = 0; i < testrun.length; i++) {
        testrundtd =
            `<tr>
        <td style="border: 1px solid #ddd;text-align: center;">` +
            testrun[i].runNo +
            `</td>
        <td style="border: 1px solid #ddd;text-align: center;">` +
            testrun[i].release +
            `</td>
        <td style="border: 1px solid #ddd;text-align: center;">` +
            testrun[i].total +
            `/` +
            testrun[i].passed +
            `/` +
            testrun[i].skipped +
            `/` +
            testrun[i].failed +
            `/` +
            testrun[i].untested +
            `</td>
        <td style="border: 1px solid #ddd;text-align: center;">` +
            testrun[i].executionDuration +
            `</td>
        </tr>`
    }

    fetch(imgurl)
        .then((res) => res.buffer())
        .then(async (imageBuffer) => {
            const imageData = imageBuffer.toString('base64')
            const bstable =
                `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Email Table Example</title>
                <!-- Include Bootstrap CSS -->
                <link href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css" rel="stylesheet">
                <style>
                    /* Custom styling */
                    .table-custom th {
                        background-color:  rgb(238, 255, 245); /* Light gray background */
                        border: 1px solid #ddd; /* Gray border */
                    }
                    .table-custom th, .table-custom td {
                        border: 1px solid #ddd; /* Gray border for table cells */
                    }
                </style>
            </head>
            <body>
                <div class="container">
                <p>Hello ` +
                U_Details +
                `,</p>
                <p>We are pleased to provide you with the summary of your recent test results:</p>
                <h3>Release Details</h3>
                    <table cellspacing="0" cellpadding="5" style="border: 1px solid #ddd; border-collapse: collapse; width: 100%;">
                        <thead style="background-color:rgb(238, 255, 245);">
                            <tr>
                                <th style="border: 1px solid #ddd;">Release Name</th>
                                <th style="border: 1px solid #ddd;">Status <br> (Total/Passed/Skipped/Failed/Untested)</th>
                                <th style="border: 1px solid #ddd;">Pass %</th>
                                <th style="border: 1px solid #ddd;">Execution Time %</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="border: 1px solid #ddd;">
                                <td style="border: 1px solid #ddd;text-align: center;">` +
                rdet.ReleaseName +
                `</td>
                                <td style="border: 1px solid #ddd;text-align: center;">` +
                rdet.total +
                `/` +
                rdet.Passed +
                `/` +
                rdet.Skipped +
                `/` +
                rdet.Failed +
                `/` +
                rdet.Untested +
                `</td>
                                <td style="border: 1px solid #ddd;text-align: center;">` +
                rdet.completed_perc +
                `%</td>
                                <td style="border: 1px solid #ddd;text-align: center;">` +
                rdet.completed_time +
                `</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="container">
                <h3>Test Run Details</h3>
                    <table cellspacing="0" cellpadding="5" style="border: 1px solid #ddd; border-collapse: collapse; width: 100%;">
                        <thead style="background-color:rgb(238, 255, 245);">
                            <tr>
                                <th style="border: 1px solid #ddd;">Run #</th>
                                <th style="border: 1px solid #ddd;">Release</th>
                                <th style="border: 1px solid #ddd;">Status <br> (Total/Passed/Skipped/Failed/Untested)</th>
                                <th style="border: 1px solid #ddd;">Execution Time %</th>
                            </tr>
                        </thead>
                        <tbody>
                            ` +
                testrundtd +
                `
                        </tbody>
                    </table>
                </div>
                <h3>Summary</h3>
                <div style="width:600px;">
                    <img src="data:image/png;base64,${imageData}" alt="Embedded Image" />
                </div><br><br><br>
                <p>
                    <a href="${process.env.APP_URL}/#/dashboard/release/` +
                rdet.ReleaseId +
                `/releaseDashboard">Click here to view more details in Dashboard</a>
                </p>
                <p>If you have any questions or need further information, feel free to contact us.</p>
                <div>
                    <p>Best Regards,</p>
                    <p>TestEnsure Platform Support</p>
                </div>
            </body>
            </html>`
            const htmlBody =
                `<html lang="en">
    <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <meta name="viewport" content="width=device-width">
        <title></title>
        <style></style>
    </head>
    <body>
           
        <div id="email" style="width:300px;">
            
            <p>Dear ` +
                U_Details +
                `, Release <b>` +
                body.ReleaseName +
                `</b> Result Summary is </p>
            <table role="presentation" border="1" cellspacing="0" width="70%">
            <tr>
                          <td><b>Percentage</b></td><td>` +
                body.completed_perc +
                `</td>
                        </tr>
                        <tr>
                          <td><b>Completed Time</b></td><td>` +
                body.completed_time +
                `</td>
                        </tr>
                        <tr>
                          <td><b>Passed</b></td><td>` +
                body.Passed +
                `</td>
                        </tr>
                        <tr>
                          <td><b>Failed</b></td><td>` +
                body.Failed +
                `</td>
                        </tr>
                        <tr>
                          <td><b>Untested</b></td><td>` +
                body.Untested +
                `</td>
                        </tr>
                        <tr>
                          <td><b>Blocked</b></td><td>` +
                body.Blocked +
                `</td>
                        </tr>
                        <tr>
                        <td><b>Skipped</b></td><td>` +
                body.Skipped +
                `</td>
                        </tr>
            </table><br><br><br>
        </div>
        
        <div style="width:600px;">
            <img src="data:image/png;base64,${imageData}" alt="Embedded Image" />
        </div><br><br><br>
        <div>
            <p>Thank you,</p>
            <p>TestEnsure Platform Support</p>
        </div>
    `
            const info = await transporter.sendMail({
                from: process.env.SMTP_USERNAME, // sender address
                // to: toAddress + ',raj@sailotech.com', // list of receivers
                to: toAddress,
                subject: Sub, // Subject line Hello ✔
                text: '', // plain text body
                html: bstable, // html body "<b>Hello world?</b>"
                attachments: [
                    {
                        filename: 'text3.txt',
                        content: Buffer.from('hello world!', 'utf-8'),
                    },
                    {
                        filename: 'text4.txt',
                        content: 'hello world!',
                    },
                ],
            })
            const response = info.messageId ? info.messageId : info
            return response
        })
        .catch((error) => {
            console.error('Error sending email:', error)
            return error
        })
}

async function createChart(
    chartLabels,
    chartData,
    chartBackgroundColor,
    chartBorderColor
) {
    const browser = await puppeteer.launch({
        headless: true, // Set to false to see the browser
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    const page = await browser.newPage()

    // Log console messages for debugging
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()))
    page.on('error', (error) => console.error('PAGE ERROR:', error))
    page.on('pageerror', (pageError) => console.error('PAGE ERROR:', pageError))

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          margin: 0;
          padding: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          background-color: #f4f4f4;
        }
        .pie-chart-container {
          width: 400px;
          height: 400px;
          margin: 0 auto;
        }
      </style>
    </head>
    <body>
      <div class="pie-chart-container">
        <canvas id="pieChart" width="30%" height="30%"></canvas>
      </div>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2"></script>
      <script>
        const ctx = document.getElementById('pieChart').getContext('2d');
        const data = {
          labels: ${JSON.stringify(chartLabels)},
            datasets: [{
                data:  ${JSON.stringify(chartData)},
                backgroundColor: ${JSON.stringify(chartBackgroundColor)},
                borderColor: ${JSON.stringify(chartBorderColor)},
                borderWidth: 2
            }]
        };
  
        const config = {
          type: 'pie',
          data: data,
          options: {
            responsive: true,
            plugins: {
              datalabels: {
                color: '#fff',
                anchor: 'center',
                align: 'center',
                font: {
                  weight: 'bold',
                  size: 16
                },
                formatter: (value, context) => {
                  let sum = 0;
                  let dataArr = context.chart.data.datasets[0].data;
                  dataArr.map(data => {
                    sum += data;
                  });
                  let percentage = value===0 ? '': (value * 100 / sum).toFixed(1) + "%";
                  return percentage;
                }
              }
            }
          },
          plugins: [ChartDataLabels],
        };
  
        const chartInstance = new Chart(ctx, config);
        window.chartRendered = true;
      </script>
    </body>
    </html>
    `

    await page.setContent(htmlContent)

    // Wait until the chart is fully rendered
    await page.waitForFunction(() => window.chartRendered === true, {
        timeout: 120000,
    })

    // Optional: Add a delay to ensure full rendering
    await page.evaluate(
        () => new Promise((resolve) => setTimeout(resolve, 5000))
    ) // 5-second delay

    // Capture the screenshot and get it as a base64 string
    const chartBase64 = await page.screenshot({ encoding: 'base64' })
    // await chart.screenshot({ path: 'chart.png' })

    await browser.close()
    return chartBase64
}

async function sendPieChartEmail(
    toAddress,
    Sub,
    body,
    U_Details,
    template,
    jobId,
    attachments
) {
    let testrun = body.testRuns

    let testrundtd

    for (let i = 0; i < testrun.length; i++) {
        testrundtd =
            `<tr>
        <td style="border: 1px solid #ddd;text-align: center;">` +
            testrun[i].runNo +
            `</td>
        <td style="border: 1px solid #ddd;text-align: center;">` +
            testrun[i].release +
            `</td>
        <td style="border: 1px solid #ddd;text-align: center;">` +
            testrun[i].total +
            `/` +
            testrun[i].passed +
            `/` +
            testrun[i].skipped +
            `/` +
            testrun[i].failed +
            `/` +
            testrun[i].untested +
            `</td>
        <td style="border: 1px solid #ddd;text-align: center;">` +
            testrun[i].executionDuration +
            `</td>
        </tr>`
    }

    let job = testrun.find((run) => run._id.toString() === jobId.toString())

    const chartLabels = ['Untested', 'Passed', 'Skipped', 'Failed']
    const chartData = [job?.untested, job?.passed, job?.skipped, job?.failed]
    const chartBackgroundColor = ['#e5e6e6', '#8bda9d', '#ffdd99', '#fbc3b6']
    const chartBorderColor = ['#9A9B9C', '#36AB51', '#FFAA00', '#F44B25']

    const chartBase64 = await createChart(
        chartLabels,
        chartData,
        chartBackgroundColor,
        chartBorderColor
    )
    // const chartImage = fs.readFileSync('chart.png').toString('base64')

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: true, // Use `true` for port 465, `false` for all other ports
        auth: {
            user: process.env.SMTP_USERNAME,
            pass: process.env.SMTP_PASSWORD,
        },
    })

    let rdet = body.relSummary

    const htmlContent =
        `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Email Table Example</title>
                <!-- Include Bootstrap CSS -->
                <link href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css" rel="stylesheet">
                <style>
                    /* Custom styling */
                    .table-custom th {
                        background-color:  rgb(238, 255, 245); /* Light gray background */
                        border: 1px solid #ddd; /* Gray border */
                    }
                    .table-custom th, .table-custom td {
                        border: 1px solid #ddd; /* Gray border for table cells */
                    }
                    .chartImage{
                        margin: 0px auto;
                        float: none;
                        display: table;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                <p>Hello ` +
        U_Details +
        `,</p>
                <p>We are pleased to provide you with the summary of your recent test results:</p>
                <h3>Release Details</h3>
                    <table cellspacing="0" cellpadding="5" style="border: 1px solid #ddd; border-collapse: collapse; width: 100%;">
                        <thead style="background-color:rgb(238, 255, 245);">
                            <tr>
                                <th style="border: 1px solid #ddd;">Release Name</th>
                                <th style="border: 1px solid #ddd;">Status <br> (Total/Passed/Skipped/Failed/Untested)</th>
                                <th style="border: 1px solid #ddd;">Pass %</th>
                                <th style="border: 1px solid #ddd;">Execution Time %</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="border: 1px solid #ddd;">
                                <td style="border: 1px solid #ddd;text-align: center;">` +
        rdet.ReleaseName +
        `</td>
                                <td style="border: 1px solid #ddd;text-align: center;">` +
        rdet.total +
        `/` +
        rdet.Passed +
        `/` +
        rdet.Skipped +
        `/` +
        rdet.Failed +
        `/` +
        rdet.Untested +
        `</td>
                                <td style="border: 1px solid #ddd;text-align: center;">` +
        rdet.completed_perc +
        `%</td>
                                <td style="border: 1px solid #ddd;text-align: center;">` +
        rdet.completed_time +
        `</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="container">
                <h3>Test Run Details</h3>
                    <table cellspacing="0" cellpadding="5" style="border: 1px solid #ddd; border-collapse: collapse; width: 100%;">
                        <thead style="background-color:rgb(238, 255, 245);">
                            <tr>
                                <th style="border: 1px solid #ddd;">Run #</th>
                                <th style="border: 1px solid #ddd;">Release</th>
                                <th style="border: 1px solid #ddd;">Status <br> (Total/Passed/Skipped/Failed/Untested)</th>
                                <th style="border: 1px solid #ddd;">Execution Time %</th>
                            </tr>
                        </thead>
                        <tbody>
                            ` +
        testrundtd +
        `
                        </tbody>
                    </table>
                </div>
                <h3>Summary</h3>
                <div class="chartImage"><img src="data:image/png;base64,${chartBase64}" alt="Pie Chart" /></div>
                <br><br><br>
                <p>
                    <a href="${process.env.APP_URL}/#/dashboard/release/` +
        rdet.ReleaseId +
        `/releaseDashboard">Click here to view more details in Dashboard</a>
                </p>
                <p>If you have any questions or need further information, feel free to contact us.</p>
                <div>
                    <p>Best Regards,</p>
                    <p>TestEnsure Platform Support</p>
                </div>
            </body>
            </html>`

    const mailOptions = {
        from: process.env.FROM_EMAIL,
        to: toAddress,
        subject: Sub,
        text: 'Here is the responsive pie chart you requested.',
        html: htmlContent,
        attachments: attachments || [],
        // attachments: [
        //     {
        //         filename: 'chart.png',
        //         path: './chart.png',
        //         cid: 'chartImage',
        //     },
        // ],
    }

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return console.log(error)
        }
        console.log('Message sent: %s', info.messageId)
        console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info))
    })
}

async function sendAttachmentEmail(body) {
    let contentType
    if (body.doc === 'pdf') {
        contentType = 'application/pdf'
    } else {
        contentType =
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }
    const htmlContent =
        `<!DOCTYPE html>
            <html lang="en">
            <body>
                <div class="container">
                <p>Hello ` +
        body.userName +
        `,</p>
                <p>Please find the report you generated in the Report screen attached.</p>
                <div>
                    <p>Best Regards,</p>
                    <p>TestEnsure Platform Support</p>
                </div>
            </body>
            </html>`

    const mailOptions = {
        from: process.env.SMTP_USERNAME, // Sender address (should match your Nodemailer auth user)
        to: body.to,
        subject: body.subject,
        text: body.text,
        html: htmlContent,
        attachments: [
            {
                filename: body.fileName,
                content: body.base64,
                encoding: 'base64', // Specify that the content is Base64 encoded
                contentType: contentType,
            },
        ],
    }

    let emailDetails = await transporter
        .sendMail(mailOptions)
        .catch((error) => {
            console.error('Error sending email:', error)
            return error
        })
    return emailDetails
}

const SendDefectReportEmail = async (
    toAddress,
    Sub,
    rawText,
    U_Details,
    testRunUrl,
    url,
    defectId,
    attachments
) => {
    // 1️⃣ Convert literal "\n" to real line breaks
    const normalizedText = rawText.replace(/\\n/g, '\n')

    // 2️⃣ Split into lines
    const lines = normalizedText
        .split(/\n/)
        .filter((line) => line.trim() !== '')

    // 3️⃣ Parse each line into { key, value }
    const pairs = lines
        .map((line) => {
            const colonIndex = line.indexOf(':')
            if (colonIndex === -1) return null // skip lines without colon
            const key = line.slice(0, colonIndex).trim()
            const value = line.slice(colonIndex + 1).trim()
            return { key, value }
        })
        .filter(Boolean) // remove any nulls

    const index = pairs.findIndex((pair) => pair.key === 'Release')

    pairs.splice(index + 1, 0, {
        key: 'Test Run',
        value: `${testRunUrl}`,
    })

    // 3️⃣ Build HTML table dynamically
    let tableRows = ''
    pairs.forEach((pair) => {
        tableRows += `
    <tr>
      <th align="left" style="padding:10px; border:1px solid #ccc; color: #0b5394">${pair.key}</th>
      <td style="padding:10px; border:1px solid #ccc;">${pair.value}</td>
    </tr>`
    })

    tableRows += `
    <tr>
      <th align="left" style="padding:10px; border:1px solid #ccc; color: #0b5394">Jira ticket link</th>
      <td style="padding:10px; border:1px solid #ccc;"><a href="${url}" target="_blank">${defectId}</a></td>
    </tr>`

    const htmlTable = `
    <table cellpadding="5px" cellspacing="5px" border="0" style=" width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 14px;">
      ${tableRows}
    </table>
    `
    const htmlBody = `
        <p>Dear ${U_Details},</p>
        <p>Please find the issue details below:</p>
        ${htmlTable}<br>
        <p>Thank you,</p>
        <p>TestEnsure Platform Support</p>`

    const info = await transporter.sendMail({
        from: process.env.SMTP_USERNAME, // sender address
        to: toAddress, // list of receivers
        subject: Sub, // Subject line Hello ✔
        text: '', // plain text body
        html: htmlBody, // html body "<b>Hello world?</b>"
        attachments: attachments || [],
    })
    if (info.messageId) {
        return info.messageId
    } else {
        return 'FAIL'
    }
}

const CheckUserRole = async (UserId) => {
    let user = await User.findOne({ _id: UserId, status: 'active' })
    if (user) {
        let userrole = await Role.findOne({ _id: user.role })
        if (userrole) {
            return userrole.roleID
        } else {
            return null
        }
    } else {
        return user
    }
}
const UserLoginActivity = async (Id, UserName, time, action, company) => {
    if (action == 'LOG_IN') {
        let _loginat = new LoginActivity({
            userId: Id,
            userName: UserName,
            loginAt: time,
            logoutAt: '',
            company: company,
        })
        await _loginat.save().then(async (doc) => {
            if (doc) {
                console.log('doc', doc)
                //  return doc._id;
            } else {
                return 'LOGGED_In_FAIL'
            }
        })
        return 'OK'
    } else {
        LoginActivity.updateOne(
            {
                userId: Id,
                status: 1,
                loginAt: time,
            },
            {
                $set: {
                    status: 0,
                    logoutAt: moment().format('MM/DD/YYYY hh:mm:ss'),
                },
            }
        ).then((doc) => {
            if (doc) {
                resp = doc
            } else {
                resp = 'FAIl'
            }
        })
        return 'OK'
    }
}

const UserAudit = async (
    uid,
    action,
    apiurl,
    act_type,
    sts,
    msg,
    rid,
    bd,
    company
) => {
    if (rid) {
        userAudit.findOne({ ref_id: rid }, (err, data) => {
            if (data) {
                userAudit.updateOne(
                    { ref_id: rid },
                    {
                        $push: {
                            backUp: {
                                Data: bd,
                                updatedAt: moment().format(
                                    'MM/DD/YYYY hh:mm:ss'
                                ),
                                ActivityStatus: sts,
                                Message: msg,
                                APIUrl: apiurl,
                                UserId: uid,
                            },
                        },
                    },
                    (err, dt) => {
                        if (dt) {
                            console.log('dt', dt)
                        } else {
                            console.log('err', err)
                        }
                    }
                )
            } else {
                let _audit = new userAudit({
                    // userId: uid,
                    action: action,
                    // apiUrl:apiurl,
                    activityType: act_type,
                    activityStatus: sts,
                    // Message:msg,
                    ref_id: rid,
                    company: company,
                    backUp: {
                        Data: bd,
                        updatedAt: moment().format('MM/DD/YYYY hh:mm:ss'),
                        ActivityStatus: sts,
                        Message: msg,
                        APIUrl: apiurl,
                        UserId: uid,
                    },
                })
                _audit.save().then(async (doc) => {
                    if (doc) {
                        console.log('doc', doc)
                        //  return doc._id;
                    } else {
                        return 'LOGGED_In_FAIL'
                    }
                })
            }
        })

        return 'OK'
    }
}
module.exports = {
    CheckUserRole,
    UserLoginActivity,
    UserAudit,
    SendEmail,
    SendEmailChart,
    sendPieChartEmail,
    sendAttachmentEmail,
    SendDefectReportEmail,
}
