// Tiny static file server for local testing - no dependencies required.
// Run with:  node serve.js [port]
// Then open http://localhost:<port>/index.html in a browser.
// Press Ctrl+C in this terminal window to stop it.
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = parseInt(process.argv[2] || "8080", 10);

const types = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".xml": "application/xml", ".csv": "text/csv", ".json": "application/json",
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.join(root, urlPath === "/" ? "/index.html" : urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found: " + urlPath); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}).listen(port, () => console.log(`Pazuju site running at http://localhost:${port}/index.html  (Ctrl+C to stop)`));
