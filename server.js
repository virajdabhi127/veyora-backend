require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const authRoutes = require("./routes/auth");
const deviceRoutes = require("./routes/devices");
const database = require("./database");
const config = require("./config");
const mqtt = require("./mqtt");
const aiRoutes = require("./routes/ai");
const adminRoutes = require("./routes/admin");
const cookieParser = require("cookie-parser");
const initializeSocket = require("./socket");

config.validate();

const app = express();
const server = http.createServer(app);

app.use(cors({
    origin: [
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "https://veyora.in"
    ],
    credentials: true
}));

const io = initializeSocket(server, mqtt);

app.use(helmet());
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/devices", deviceRoutes);
app.use("/ai", aiRoutes);

database.init(() => {
    mqtt.start();
    server.listen(config.server.port, () => {
        console.log("SERVER_STARTED");
    });
});
