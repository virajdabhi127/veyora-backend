const config = {
    mqtt: {
        host: process.env.MQTT_HOST,
        port: Number(process.env.MQTT_PORT) || 8883,
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
        topic: process.env.MQTT_TOPIC || "energymeter/+/status"
    },
    server: {
        port: process.env.PORT || 3000
    },
    jwt: {
        secret: process.env.JWT_SECRET,
        expiresIn: "7d"
    },
    productCodes: {
        energymeter: "EM",
        homeautomation: "HA",
        combined: "EM_HA"
    },
    isProduction: process.env.NODE_ENV === "production",
    offlineTimeout: 15000,
    saveInterval: 60000,
    maxChannelCount: Number(process.env.MAX_CHANNEL_COUNT) || 32
};

config.validate = function validate() {
    const missing = [];
    if (typeof config.jwt.secret !== "string" || config.jwt.secret.length < 32) {
        missing.push("JWT_SECRET (at least 32 characters)");
    }
    if (!process.env.DATABASE_URL) {
        for (const name of ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD"]) {
            if (!process.env[name]) {
                missing.push(name);
            }
        }
    }
    for (const name of ["MQTT_HOST", "MQTT_USERNAME", "MQTT_PASSWORD"]) {
        if (!process.env[name]) {
            missing.push(name);
        }
    }
    if (missing.length > 0) {
        throw new Error(`Missing or invalid required configuration: ${missing.join(", ")}`);
    }
};

module.exports = config;
