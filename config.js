/* ===== Site settings ===== */
window.APP_CONFIG = {
  /* Google Apps Script Web App URL (ends with /exec) */
  API_URL: "https://script.google.com/macros/s/AKfycby0H8pi7yDw8Fh3oYvcVPMYsBB1jXDnybLQ2653OH8BwGw-GXE7IQ6X63uyn5edTZI/exec",

  /* Heading shown across the site */
  HEADING: "Satyansh's Test Papers",

  /* Student login: the same Supabase project as the Doubt Portal (publishable key is public) */
  SUPABASE_URL: "https://axznixboebvixkigojvj.supabase.co",
  SUPABASE_KEY: "sb_publishable_g3vreHGOHm7lu4b91Qtahw_4uH-loXh",

  /* Folders students see after login. "id" must match the paper's category. */
  FOLDERS: [
    { id: "topic",  title: "Topic-wise Papers",      desc: "Chapter and topic tests",                    icon: "📘", bySubject: true },
    { id: "full",   title: "Full Syllabus Papers",   desc: "Tests on the complete syllabus",             icon: "📚" },
    { id: "main3h", title: "JEE Main 3-Hour Papers", desc: "Full-length papers in the JEE Main pattern", icon: "⏱️" }
  ],

  /* Subjects. Set show: true to switch Physics / Chemistry on later.
     With only one subject on, Topic-wise opens straight to the paper list.
     Papers whose Subject mentions a switched-off subject are not shown to students. */
  SUBJECTS: [
    { name: "Mathematics", show: true,  icon: "📐" },
    { name: "Physics",     show: false, icon: "🧲" },
    { name: "Chemistry",   show: false, icon: "⚗️" }
  ]
};
