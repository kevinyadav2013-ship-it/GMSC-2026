import "dotenv/config";
import nodemailer from "nodemailer";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Database from "better-sqlite3";

const app = express();

/* =========================================================
   EMAIL CONFIGURATION
========================================================= */

const EMAIL_TO = "kevinyadav2013@gmail.com";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,

  auth: {
    user: process.env.GMSC_EMAIL,
    pass: process.env.GMSC_EMAIL_PASSWORD
  },

  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000
});

/* =========================================================
   SERVER
========================================================= */

app.set("trust proxy", 1);

const db = new Database("gmsc.sqlite");

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(express.json({ limit: "100kb" }));

app.use(express.static("public"));

/* =========================================================
   DATABASE
========================================================= */

db.exec(`
CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  student_name TEXT NOT NULL,
  email TEXT NOT NULL,
  mobile TEXT NOT NULL,
  class TEXT NOT NULL,
  father_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_code TEXT NOT NULL,
  answers TEXT NOT NULL,
  reason TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);
`);

/* =========================================================
   RATE LIMIT
========================================================= */

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

/* =========================================================
   HELPERS
========================================================= */

function clean(value) {
  return String(value || "")
    .trim()
    .slice(0, 120);
}

function makeCode() {
  return (
    "GMSC-2026-" +
    Math.floor(10000 + Math.random() * 90000)
  );
}

/* =========================================================
   REGISTRATION OPEN CHECK
========================================================= */

function isRegistrationOpen() {
  const now = new Date();

  const deadline = new Date(
    "2026-10-31T23:59:59+05:30"
  );

  return now <= deadline;
}

/* =========================================================
   TEST OPEN CHECK
   ONLY 21 NOVEMBER 2026
   INDIA TIME
========================================================= */

function isTestOpen() {
  const now = new Date();

  const testStart = new Date(
    "2026-11-21T00:00:00+05:30"
  );

  const testEnd = new Date(
    "2026-11-22T00:00:00+05:30"
  );

  return now >= testStart && now < testEnd;
}

/* =========================================================
   SEND REGISTRATION EMAIL
========================================================= */

async function sendRegistrationEmail(data) {
  const {
    code,
    student_name,
    email,
    mobile,
    className,
    father_name
  } = data;

  await transporter.sendMail({
    from: process.env.GMSC_EMAIL,
    to: EMAIL_TO,

    subject:
      `New GMSC Registration - ${code}`,

    text: `
NEW GMSC REGISTRATION

Registration Code:
${code}

Student Name:
${student_name}

Student Email:
${email}

Mobile:
${mobile}

Class:
${className}

Father's Name:
${father_name}

Registration Time:
${new Date().toISOString()}
`
  });
}

/* =========================================================
   SEND TEST SUBMISSION EMAIL
========================================================= */

async function sendTestSubmissionEmail(data) {
  const {
    registration_code,
    student_name,
    email,
    className,
    reason,
    answers
  } = data;

  await transporter.sendMail({
    from: process.env.GMSC_EMAIL,
    to: EMAIL_TO,

    subject:
      `GMSC Test Submission - ${registration_code}`,

    text: `
NEW GMSC TEST SUBMISSION

Registration Code:
${registration_code}

Student Name:
${student_name}

Student Email:
${email}

Class:
${className}

Submission Reason:
${reason}

ANSWERS
=======

${JSON.stringify(answers, null, 2)}

Submitted:
${new Date().toISOString()}
`
  });
}

/* =========================================================
   REGISTRATION
========================================================= */

app.post(
  "/api/register",
  limiter,
  async (req, res) => {

    const student_name =
      clean(req.body.student_name);

    const email =
      clean(req.body.email);

    const mobile =
      clean(req.body.mobile);

    const className =
      clean(req.body.class);

    const father_name =
      clean(req.body.father_name);

    /* -------------------------
       VALIDATION
    ------------------------- */

    if (
      !student_name ||
      !email ||
      !mobile ||
      !father_name ||
      !["7", "8", "9", "10", "11", "12"]
        .includes(className)
    ) {
      return res.status(400).json({
        error:
          "Please enter all required information."
      });
    }

    /* -------------------------
       REGISTRATION DEADLINE
    ------------------------- */

    if (!isRegistrationOpen()) {

      return res.status(403).json({
        error:
          "GMSC registration is closed."
      });

    }

    /* -------------------------
       CREATE UNIQUE CODE
    ------------------------- */

    let code;

    while (true) {

      code = makeCode();

      try {

        db.prepare(`
          INSERT INTO registrations
          (
            code,
            student_name,
            email,
            mobile,
            class,
            father_name,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          code,
          student_name,
          email,
          mobile,
          className,
          father_name,
          new Date().toISOString()
        );

        break;

      } catch (error) {

        if (
          !String(error.message)
            .includes("UNIQUE")
        ) {

          console.error(
            "REGISTRATION DATABASE ERROR:",
            error
          );

          return res.status(500).json({
            error:
              "Registration could not be completed."
          });

        }

      }
    }

    /* -------------------------
       SEND EMAIL
    ------------------------- */

    let emailSent = false;

    try {

      await sendRegistrationEmail({
        code,
        student_name,
        email,
        mobile,
        className,
        father_name
      });

      emailSent = true;

      console.log(
        `REGISTRATION EMAIL SENT: ${code}`
      );

    } catch (error) {

      console.error(
        `REGISTRATION EMAIL FAILED: ${code}`
      );

      console.error(error);

    }

    /* -------------------------
       RETURN RESULT
    ------------------------- */

    return res.status(201).json({

      success: true,

      code,

      emailSent,

      message: emailSent
        ? "Registration completed successfully."
        : "Registration completed, but the notification email could not be sent."
    });
  }
);

/* =========================================================
   TEST VERIFICATION
========================================================= */

app.post(
  "/api/test/verify",
  limiter,
  (req, res) => {

    /* -------------------------
       DATE CHECK
    ------------------------- */

    if (!isTestOpen()) {

      return res.status(403).json({
        error:
          "The GMSC test is available only on 21 November 2026."
      });

    }

    /* -------------------------
       CODE
    ------------------------- */

    const registration_code =
      clean(
        req.body.registration_code
      );

    if (!registration_code) {

      return res.status(400).json({
        error:
          "Registration code is required."
      });

    }

    /* -------------------------
       FIND REGISTRATION
    ------------------------- */

    const registration =
      db.prepare(`
        SELECT
          code,
          student_name,
          email,
          class
        FROM registrations
        WHERE code = ?
      `).get(
        registration_code
      );

    if (!registration) {

      return res.status(403).json({
        error:
          "Invalid registration code."
      });

    }

    /* -------------------------
       VERIFIED
    ------------------------- */

    return res.json({

      verified: true,

      registrationCode:
        registration.code,

      studentName:
        registration.student_name,

      class:
        registration.class

    });
  }
);

/* =========================================================
   TEST SUBMISSION
========================================================= */

app.post(
  "/api/test/submit",
  limiter,
  async (req, res) => {

    /* -------------------------
       DATE CHECK
    ------------------------- */

    if (!isTestOpen()) {

      return res.status(403).json({
        error:
          "The GMSC test is available only on 21 November 2026."
      });

    }

    /* -------------------------
       DATA
    ------------------------- */

    const registration_code =
      clean(
        req.body.registration_code
      );

    const answers =
      req.body.answers || {};

    const reason =
      clean(
        req.body.reason ||
        "Student submitted test"
      );

    if (!registration_code) {

      return res.status(400).json({
        error:
          "Registration code is required."
      });

    }

    /* -------------------------
       FIND STUDENT
    ------------------------- */

    const registration =
      db.prepare(`
        SELECT
          code,
          student_name,
          email,
          class
        FROM registrations
        WHERE code = ?
      `).get(
        registration_code
      );

    if (!registration) {

      return res.status(403).json({
        error:
          "Invalid registration code."
      });

    }

    /* -------------------------
       SAVE TEST
    ------------------------- */

    try {

      db.prepare(`
        INSERT INTO test_submissions
        (
          registration_code,
          answers,
          reason,
          submitted_at
        )
        VALUES (?, ?, ?, ?)
      `).run(
        registration_code,
        JSON.stringify(answers),
        reason,
        new Date().toISOString()
      );

    } catch (error) {

      console.error(
        "TEST DATABASE ERROR:",
        error
      );

      return res.status(500).json({
        error:
          "Test submission could not be saved."
      });

    }

    /* -------------------------
       SEND EMAIL
    ------------------------- */

    let emailSent = false;

    try {

      await sendTestSubmissionEmail({

        registration_code,

        student_name:
          registration.student_name,

        email:
          registration.email,

        className:
          registration.class,

        reason,

        answers

      });

      emailSent = true;

      console.log(
        `TEST EMAIL SENT: ${registration_code}`
      );

    } catch (error) {

      console.error(
        `TEST EMAIL FAILED: ${registration_code}`
      );

      console.error(error);

    }

    /* -------------------------
       RESULT
    ------------------------- */

    return res.status(201).json({

      success: true,

      emailSent,

      message:
        "Test submitted successfully."
    });
  }
);

/* =========================================================
   STATUS
========================================================= */

app.get(
  "/api/status",
  (req, res) => {

    const now =
      new Date();

    const registrationOpen =
      isRegistrationOpen();

    const testOpen =
      isTestOpen();

    const resultsAvailable =
      now >=
      new Date(
        "2027-01-15T00:00:00+05:30"
      );

    return res.json({

      registrationOpen,

      testOpen,

      questionPapersAvailable:
        testOpen,

      resultsAvailable

    });
  }
);

/* =========================================================
   HOME PAGE
========================================================= */

app.get(
  "/",
  (req, res) => {

    res.sendFile(
      "index.html",
      {
        root: "public"
      }
    );

  }
);

/* =========================================================
   START SERVER
========================================================= */

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  async () => {

    console.log(
      `GMSC server running on port ${PORT}`
    );

    /* -------------------------
       CHECK EMAIL CONNECTION
    ------------------------- */

    if (
      !process.env.GMSC_EMAIL ||
      !process.env.GMSC_EMAIL_PASSWORD
    ) {

      console.error(
        "EMAIL ERROR: GMSC_EMAIL or GMSC_EMAIL_PASSWORD is missing."
      );

      return;
    }

    try {

      await transporter.verify();

      console.log(
        "EMAIL SMTP CONNECTION VERIFIED SUCCESSFULLY."
      );

      console.log(
        `Registration emails will be sent to ${EMAIL_TO}`
      );

    } catch (error) {

      console.error(
        "EMAIL SMTP CONNECTION FAILED:"
      );

      console.error(error);

    }

  }
);
