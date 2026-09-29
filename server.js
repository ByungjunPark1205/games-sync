const http = require("node:http");
const { createApplication } = require("./application.cjs");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const { handleRequest } = createApplication();

http.createServer(handleRequest).listen(PORT, HOST, () => {
  console.log(`Games Sync is running at http://localhost:${PORT}`);
});
