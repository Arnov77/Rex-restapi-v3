const express = require("express");
const router = express.Router();
const { blackWaifuGemini } = require("../controllers/blackWaifuGemini");

router.get("/", blackWaifuGemini);

module.exports = router;
