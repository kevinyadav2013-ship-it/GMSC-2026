import "dotenv/config"; 
import nodemailer from "nodemailer";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Database from "better-sqlite3";

const app = express(); 
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMSC_EMAIL,
    pass: process.env.GMSC_EMAIL_PASSWORD
  }
});
app.set("trust proxy", 1);
const db = new Database("gmsc.sqlite");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.static("public"));

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
db.exec(`
CREATE TABLE IF NOT EXISTS test_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_code TEXT NOT NULL,
  answers TEXT NOT NULL,
  reason TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);
`);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10
});

function clean(value) {
  return String(value || "").trim().slice(0, 120);
}

function makeCode() {
  return "GMSC-2026-" + Math.floor(10000 + Math.random() * 90000);
}

app.post("/api/register", limiter, async (req, res) => {
  const student_name = clean(req.body.student_name);
  const email = clean(req.body.email);
  const mobile = clean(req.body.mobile);
  const className = clean(req.body.class);
  const father_name = clean(req.body.father_name);

  if (
    !student_name ||
    !email ||
    !mobile ||
    !father_name ||
    !["7", "8", "9", "10", "11", "12"].includes(className)
  ) {
    return res.status(400).json({
      error: "Please enter all required information."
    });
  }

  const deadline = new Date("2026-10-31T23:59:59+05:30");

  if (new Date() > deadline) {
    return res.status(403).json({
      error: "GMSC registration is closed."
    });
  }

  let code;

  while (true) {
    code = makeCode();

    try {
      db.prepare(`
        INSERT INTO registrations
        (code, student_name, email, mobile, class, father_name, created_at)
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
      if (!String(error.message).includes("UNIQUE")) {
        return res.status(500).json({
          error: "Registration could not be completed."
        });
      }
    }
  }
await transporter.sendMail({
  from: process.env.GMSC_EMAIL,
  to: process.env.GMSC_EMAIL,
  subject: `New GMSC Registration - ${code}`,
  text: `
New GMSC registration received.

Registration Code: ${code}
Student Name: ${student_name}
Student Email: ${email}
Mobile: ${mobile}
Class: ${className}
Father's Name: ${father_name}
`
});
  res.status(201).json({
    code: code
  });
  app.post("/api/test/submit", async (req, res) => {
  const registration_code = String(req.body.registration_code || "").trim();
  const answers = req.body.answers || {};
  const reason = String(req.body.reason || "Student submitted test");

  if (!registration_code) {
    return res.status(400).json({
      error: "Registration code is required."
    });
  }

  const registration = db.prepare(`
    SELECT code
    FROM registrations
    WHERE code = ?
  `).get(registration_code);

  if (!registration) {
    return res.status(403).json({
      error: "Invalid registration code."
    });
  }

  db.prepare(`
    INSERT INTO test_submissions
    (registration_code, answers, reason, submitted_at)
    VALUES (?, ?, ?, ?)
  `).run(
    registration_code,
    JSON.stringify(answers),
    reason,
    new Date().toISOString()
  );

  res.status(201).json({
    success: true,
    message: "Test submitted successfully."
  });
});
});

app.get("/api/status", (req, res) => {
  const now = new Date();

  res.json({
    registrationOpen:
      now <= new Date("2026-10-31T23:59:59+05:30"),

    questionPapersAvailable:
      now >= new Date("2026-11-21T00:00:00+05:30"),

    resultsAvailable:
      now >= new Date("2027-01-15T00:00:00+05:30")
  });
});

const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});
app.listen(PORT, () => {
  console.log(`GMSC server running on port ${PORT}`);
});
