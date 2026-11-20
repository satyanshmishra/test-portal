/* ===== Site settings ===== */
window.APP_CONFIG = {
  /* Google Apps Script Web App URL (ends with /exec) */
  API_URL: "https://script.google.com/macros/s/AKfycby0H8pi7yDw8Fh3oYvcVPMYsBB1jXDnybLQ2653OH8BwGw-GXE7IQ6X63uyn5edTZI/exec",

  /* Heading shown across the site */
  HEADING: "Satyansh's Test Papers",

  /* Student login: the same Supabase project as the Doubt Portal (publishable key is public) */
  SUPABASE_URL: "https://axznixboebvixkigojvj.supabase.co",
  SUPABASE_KEY: "sb_publishable_g3vreHGOHm7lu4b91Qtahw_4uH-loXh",

  /* "Continue with Google" button on the login / sign-up pages and the Live Quiz.
     Switch to true only AFTER Google is turned on in Supabase → Authentication → Sign In / Providers → Google. */
  GOOGLE_LOGIN: false,

  /* Folders students see after login. "id" must match the paper's category.
     practice: true = sheet folder: no timer, no single attempt, every question checked instantly. */
  FOLDERS: [
    { id: "topic",  title: "Topic-wise Papers",      desc: "Chapter and topic tests",                    icon: "📘", bySubject: true },
    { id: "full",   title: "Full Syllabus Papers",   desc: "Tests on the complete syllabus",             icon: "📚" },
    { id: "main3h", title: "JEE Main 3-Hour Papers", desc: "Full-length papers in the JEE Main pattern", icon: "⏱️", allSubjects: true },
    { id: "sheet",  title: "Practice Sheets",        desc: "Tap an option, check instantly, see solutions", icon: "📝", practice: true },
    { id: "pyq",    title: "IIT JEE PYQs Practice",  desc: "Year-wise, topic-wise and sub-topic-wise previous year questions", icon: "🎯", pyq: true }
  ],

  /* Subjects. Set show: true to switch Physics / Chemistry on later.
     With only one subject on, Topic-wise opens straight to the paper list.
     Papers whose Subject mentions a switched-off subject are not shown to students. */
  /* PYQ Practice: show the exam/date tag (e.g. "JEE Main 2025 · 22 Jan Shift 1") on every question card.
     false = the tag is shown only inside the solution. */
  PYQ_SHOW_SOURCE: true,

  SUBJECTS: [
    { name: "Mathematics", show: true,  icon: "📐" },
    { name: "Physics",     show: false, icon: "🧲" },
    { name: "Chemistry",   show: false, icon: "⚗️" }
  ]
};
