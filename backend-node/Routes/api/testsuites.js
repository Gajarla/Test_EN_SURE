const express = require("express");
const router = express.Router();
const axios = require("axios");
const TestSuiteCreation = require("../../Models/TestSuite");
const AllJobs = require("../../Models/AllJobs");

//Get Projects By User ID
router.get("/TestSuite/:id/testSuites", async (req, res) => {
  try {
    const testSuites = await TestSuiteCreation.find({
      moduleID: req.params.id,
    });
    res.status(200).send(testSuites);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

//Get Testcases by ModuleIds
router.post("/getTestSuitesByModules", async (req, res) => {
  const moduleIds = req.body.moduleIds;
  try {
    const testSuites = await TestSuiteCreation.find({
      moduleID: { $in: moduleIds },
    });
    res.status(200).send(testSuites);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/updateTestItemById", async (req, res) => {
  try {
    const releaseName = req.body.releaseName;
    const itemId = req.body.itemId;
    let status = req.body.status;
    const rpid = req.body.rpid;
    const reportPortalURL = `http://73.135.240.210:9080`;

    const REPORT_PORTAL_HEADERS = {
      Authorization: `Bearer f19c7add-9d21-48c5-bbb4-a199fbcb1580`,
    };

    if (status === "UNTESTED") status = "INFO";
    const response = await axios.put(
      `${reportPortalURL}/api/v1/${releaseName}/item/${itemId}/update`,
      {
        status: status,
      },
      {
        headers: REPORT_PORTAL_HEADERS,
      }
    );

    let updateAllJobs = null;

    if (response.data.message.includes("success")) {
      const res = await axios.get(
        `${reportPortalURL}/api/v1/${releaseName}/launch/${rpid}`,
        {
          headers: REPORT_PORTAL_HEADERS,
        }
      );
      const data = res.data;
      const statistics = data?.statistics.executions;

      let finalStatus = data?.status ? data.status : "UNTESTED";
      const total = statistics?.total ? statistics.total : 0;
      const passed = statistics?.passed ? statistics.passed : 0;
      const skipped = statistics?.skipped ? statistics.skipped : 0;
      const failed = statistics?.failed ? statistics.failed : 0;

      if (status === "INFO") finalStatus = "UNTESTED";

      if (total === passed) finalStatus = "PASSED";
      else if (failed !== 0) finalStatus = "FAILED";
      else finalStatus = "UNTESTED";

      var query = { rpid: rpid };
      var values = {
        $set: { status: finalStatus, total, passed, skipped, failed },
      };
      updateAllJobs = await AllJobs.findOneAndUpdate(query, values);
      updateAllJobs = await AllJobs.find({ rpid: rpid });
    }
    res.status(200).json(updateAllJobs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
