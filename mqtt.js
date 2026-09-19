const lastDatabaseSave = new Map();
const mqtt = require("mqtt");
const config = require("./config");
const database = require("./database");
const EventEmitter = require("events");
const mqttEvents = new EventEmitter();
const latestDevices = new Map();
const lastLoadHistorySave = new Map();
const dailyLoadFinalized = new Map();
const pendingWiFiRequests = new Map();
let dailyRowsEnsuredDate = null;
let client = null;
let started = false;

function start() {
    if (started) {
        return;
    }
    started = true;

    client = mqtt.connect({
        host: config.mqtt.host,
        port: config.mqtt.port,
        protocol: "mqtts",
        username: config.mqtt.username,
        password: config.mqtt.password,
        reconnectPeriod: 20000
    });

    client.on("connect", () => {
        console.log("MQTT Connected");
        client.subscribe(
            [
                config.mqtt.topic,
                "energymeter/+/wifi",
                "energymeter/+/load/buffer"
            ],
            (err) => {
                if (err) {
                    console.error("Subscribe Failed:",err.message);
                    return;
                }
            }
        );
    });

    database.getAllEnergyHistory((err, rows) => {
        if (err) {
            console.error("Failed to hydrate latestDevices:", err.message);
            return;
        }
        rows.forEach(row => {
            const channelEnergy = row.channelEnergy || {};
            latestDevices.set(row.deviceId, {
                deviceId: row.deviceId,
                product: null,
                payloadVersion: 0,
                channelCount: Object.keys(channelEnergy).length,
                activeWifiId: -1,
                voltage: 0,
                totalCurrent: 0,
                totalPowerFactor: 0,
                totalRealPower: 0,
                totalApparentPower: 0,
                energyKWh: Number(row.energyKWh) || 0,
                channels: Object.entries(channelEnergy).map(([channelId, kwh]) => ({
                    channelId: Number(channelId),
                    current: 0,
                    pf: 0,
                    realPower: 0,
                    apparentPower: 0,
                    energyKWh: Number(kwh) || 0
                })),
                connected: false,
                lastUpdate: row.recordedAt,
                lastSeen: 0
            });
        });
        ensureDailyRowsForAllDevices();
    });

    client.on("error", (err) => {
        console.error("MQTT Error:", err);
    });

    client.on("message", (topic, message) => {
        const parts = topic.split("/");
        const product = parts[0];
        const deviceId = parts[1];
        const messageType = parts[2];
        if (messageType === "load" && parts[3] === "buffer") {
            try {
                const data = JSON.parse(message.toString());
                if (
                    typeof data !== "object" ||
                    data === null ||
                    data.type !== "loadHistory" ||
                    !data.batchId ||
                    !Array.isArray(data.samples) ||
                    data.samples.length === 0
                ) {
                    console.error(`Invalid load buffer from ${deviceId}`);
                    return;
                }
                if (data.samples.length > 20) {
                    console.error(`Load batch too large from ${deviceId}`);
                    return;
                }
                const validSamples = data.samples.filter(sample =>
                    typeof sample.ts === "number" &&
                    typeof sample.kw === "number" &&
                    Number.isFinite(sample.ts) &&
                    Number.isFinite(sample.kw)
                );
                if (validSamples.length === 0) {
                    console.error(`All samples invalid in batch ${data.batchId} from ${deviceId}`);
                    return;
                }
                if (validSamples.length < data.samples.length) {
                    console.warn(`Dropped ${data.samples.length - validSamples.length} invalid sample(s) in batch ${data.batchId} from ${deviceId}`);
                }
                database.saveLoadHistoryBatch(
                    deviceId,
                    data.batchId,
                    validSamples,
                    (err) => {
                        if (err) {
                            console.error(
                                `Failed to save load batch ${data.batchId} from ${deviceId}:`,
                                err.message
                            );
                            return;
                        }
                        const ackTopic = `energymeter/${deviceId}/load/ack`;
                        const ackPayload = JSON.stringify({
                            batchId: data.batchId,
                            success: true
                        });
                        client.publish(ackTopic, ackPayload, (err) => {
                            if (err) {
                                console.error(
                                    `Failed to send load ACK for ${deviceId}:`,
                                    err.message
                                );
                                return;
                            }
                        });
                    }
                );
            } catch (err) {
                console.error(`Invalid load buffer JSON from ${deviceId}:`, err.message);
            }
            return;
        }
        if (messageType === "wifi") {
            try {
                const data = JSON.parse(
                    message.toString()
                );
                if (typeof data !== "object" || data === null) {
                    console.error(
                        `Invalid Wi-Fi response from ${deviceId}`
                    );
                    return;
                }
                const pending = pendingWiFiRequests.get(deviceId);
                if (pending) {
                    clearTimeout(pending.timeout);
                    pending.resolve(data);
                    pendingWiFiRequests.delete(deviceId);
                }
            } catch (err) {
                console.error(
                    `Invalid Wi-Fi JSON from ${deviceId}:`,
                    err.message
                );
            }
            return;
        }
        database.getDevice(deviceId, (err, device) => {
            if (err) {
                console.error("Database Error:", err.message);
                return;
            }
            if (!device) {
                return;
            }
            if (device.product_code !== config.productCodes[product]) {
                console.log(
                    `Product mismatch for ${deviceId}. Expected ${device.product_code}, received ${product}`
                );
                return;
            }
            try {
                const data = JSON.parse(message.toString());
                if (typeof data !== "object" || data === null) {
                    console.error("Invalid MQTT payload");
                    return;
                }
                let deviceData = latestDevices.get(deviceId);
                if (!deviceData) {
                    deviceData = {
                        deviceId,
                        product,
                        payloadVersion: 0,
                        channelCount: 0,
                        activeWifiId: -1,
                        voltage: 0,
                        totalCurrent: 0,
                        totalPowerFactor: 0,
                        totalRealPower: 0,
                        totalApparentPower: 0,
                        energyKWh: 0,
                        channels: [],
                        connected: true,
                        lastUpdate: "--:--:--",
                        lastSeen: 0
                    };
                    latestDevices.set(deviceId, deviceData);
                }
                if (!deviceData.connected) {
                    database.updateDevice(deviceId, 1);
                }
                deviceData.connected = true;
                const payloadVersion = Number(data.payloadVersion) || 1;
                const channelCount = Number(data.channelCount);
                if (
                    !Number.isInteger(channelCount) ||
                    channelCount < 0 ||
                    channelCount > config.maxChannelCount
                ) {
                    console.error(`Invalid channelCount from ${deviceId}`);
                    return;
                }
                if (deviceData.payloadVersion !== payloadVersion || deviceData.channelCount !== channelCount) {
                    deviceData.payloadVersion = payloadVersion;
                    deviceData.channelCount = channelCount;
                    database.updateDeviceInfo(
                        deviceId,
                        payloadVersion,
                        channelCount
                    );
                }
                deviceData.activeWifiId =
                data.wifi &&
                data.wifi.activeWifiId !== undefined
                    ? Number(data.wifi.activeWifiId)
                    : -1;
                deviceData.voltage = Number(data.voltage) || 0;
                deviceData.totalCurrent = Number(data.totalCurrent) || 0;
                deviceData.totalPowerFactor = Number(data.totalPowerFactor) || 0;
                deviceData.channels = Array.isArray(data.channels)
                    ? data.channels
                    : [];
                deviceData.energyKWh = Number(data.energyKWh) || 0;
                deviceData.totalApparentPower = deviceData.voltage * deviceData.totalCurrent;
                deviceData.totalRealPower = deviceData.totalApparentPower * deviceData.totalPowerFactor;
                if (deviceData.channelCount > 0) {
                    deviceData.channels.forEach(channel => {
                        channel.current = Number(channel.current) || 0;
                        channel.pf = Number(channel.pf) || 0;
                        channel.energyKWh = Number(channel.energyKWh) || 0;
                        channel.apparentPower = deviceData.voltage * channel.current;
                        channel.realPower = channel.apparentPower * channel.pf;
                    });
                }
                const now = Date.now();
                deviceData.lastSeen = now;
                deviceData.lastUpdate = new Date(now).toISOString();
                finalizePreviousDayLoad(deviceId);
                const lastSave = lastDatabaseSave.get(deviceId) || 0;
                if (now - lastSave >= config.saveInterval) {
                    database.saveEnergyHistory(
                        deviceId,
                        deviceData.energyKWh,
                        deviceData.channels
                    );
                    lastDatabaseSave.set(deviceId, now);
                }
                database.saveDailyHistory(
                    deviceId,
                    deviceData.energyKWh
                );
                const lastLoadSave = lastLoadHistorySave.get(deviceId) || 0;
                if (now - lastLoadSave >= 10000) {
                    database.saveLoadHistory(
                        deviceId,
                        deviceData.totalRealPower,
                        new Date()
                    );
                    lastLoadHistorySave.set(deviceId, now);
                    database.calculateDailyLoad(
                        deviceId,
                        getISTDateString(),
                        (err) => {
                            if (err) {
                                console.error(
                                    `Live daily load calculation failed for ${deviceId}:`,
                                    err.message
                                );
                            }
                        }
                    );
                }
                checkDailyLoadRollover(deviceId);
                mqttEvents.emit("data", deviceData);
            }
            catch (err) {
                console.log("Invalid MQTT JSON", err.message);
            }
        });
    });
}

function getISTDateString(date = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(date);
}

function checkDailyLoadRollover(deviceId) {
    const now = new Date();
    const istTime = new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    }).format(now);
    if (istTime !== "23:59:59") {
        return;
    }
    const historyDate = getISTDateString();
    database.calculateDailyLoad(
        deviceId,
        historyDate,
        (err) => {
            if (err) {
                console.error(
                    `Daily load calculation failed for ${deviceId}:`,
                    err.message
                );
                return;
            }
            database.verifyDailyLoad(
                deviceId,
                historyDate,
                (err, result) => {
                    if (err) {
                        console.error(
                            `Daily load verification failed for ${deviceId}:`,
                            err.message
                        );
                        return;
                    }
                    if (result.rows.length === 0) {
                        console.error(
                            `Daily load summary missing for ${deviceId} on ${historyDate}. Load history will NOT be deleted.`
                        );
                        return;
                    }
                    database.verifyFinalLoadReading(
                        deviceId,
                        historyDate,
                        (err, result) => {
                            if (err) {
                                console.error(
                                    `Final load reading verification failed for ${deviceId}:`,
                                    err.message
                                );
                                return;
                            }
                            if (result.rows.length === 0) {
                                console.error(
                                    `Final load reading missing for ${deviceId} on ${historyDate}. Load history will NOT be deleted.`
                                );
                                return;
                            }
                            database.deleteDailyLoadHistory(
                                deviceId,
                                historyDate,
                                (err, result) => {
                                    if (err) {
                                        console.error(
                                            `Load history deletion failed for ${deviceId}:`,
                                            err.message
                                        );
                                        return;
                                    }
                                }
                            );
                        }
                    );
                }
            );
        }
    );
}

function finalizePreviousDayLoad(deviceId) {
    const todayDate = getISTDateString();
    if (dailyLoadFinalized.get(deviceId) === todayDate) {
        return;
    }
    const today = new Date();
    const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000));
    const yesterdayDate = getISTDateString(yesterday);
    database.calculateDailyLoad(
        deviceId,
        yesterdayDate,
        (err) => {
            if (err) {
                console.error(
                    `Failed to finalize daily load for ${deviceId}:`,
                    err.message
                );
                return;
            }
            dailyLoadFinalized.set(deviceId, todayDate);
        }
    );
}

setInterval(() => {
    const now = Date.now();
    for (const deviceData of latestDevices.values()) {
        if (deviceData.connected &&
            (now - deviceData.lastSeen > config.offlineTimeout)) {
            deviceData.connected = false;
            deviceData.voltage = 0;
            deviceData.totalCurrent = 0;
            deviceData.totalRealPower = 0;
            deviceData.totalApparentPower = 0;
            deviceData.totalPowerFactor = 0;
            deviceData.channels.forEach(channel => {
                channel.current = 0;
                channel.pf = 0;
                channel.realPower = 0;
                channel.apparentPower = 0;
            });
            database.updateDevice(deviceData.deviceId, 0);
            mqttEvents.emit("data", deviceData);
        }
    }
}, 10000);

function requestWiFi(deviceId, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            pendingWiFiRequests.delete(deviceId);
            reject(
                new Error(
                    "ESP did not respond in time."
                )
            );
        }, timeout);
        pendingWiFiRequests.set(
            deviceId,
            {
                resolve,
                reject,
                timeout: timeoutId
            }
        );
        const topic =`energymeter/${deviceId}/command`;
        const payload = JSON.stringify({action: "get_wifi"});
        client.publish(
            topic,
            payload,
            (err) => {
                if (err) {
                    clearTimeout(timeoutId);
                    pendingWiFiRequests.delete(
                        deviceId
                    );
                    reject(err);
                    return;
                }
            }
        );
    });
}

function deleteWiFi(deviceId, wifiId, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            pendingWiFiRequests.delete(deviceId);
            reject(
                new Error(
                    "ESP did not respond in time."
                )
            );
        }, timeout);
        pendingWiFiRequests.set(
            deviceId,
            {
                resolve,
                reject,
                timeout: timeoutId
            }
        );
        const topic = `energymeter/${deviceId}/command`;
        const payload = JSON.stringify({
            action: "delete_wifi",
            id: wifiId
        });
        client.publish(
            topic,
            payload,
            (err) => {
                if (err) {
                    clearTimeout(timeoutId);
                    pendingWiFiRequests.delete(
                        deviceId
                    );
                    reject(err);
                    return;
                }
            }
        );
    });
}

function addWiFi(deviceId, ssid, password, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            pendingWiFiRequests.delete(deviceId);
            reject(
                new Error(
                    "ESP did not respond in time."
                )
            );

        }, timeout);
        pendingWiFiRequests.set(
            deviceId,
            {
                resolve,
                reject,
                timeout: timeoutId
            }
        );
        const topic =  `energymeter/${deviceId}/command`;
        const payload = JSON.stringify({
            action: "add_wifi",
            ssid,
            password
        });
        client.publish(
            topic,
            payload,
            (err) => {
                if (err) {
                    clearTimeout(timeoutId);
                    pendingWiFiRequests.delete(
                        deviceId
                    );
                    reject(err);
                    return;
                }
            }
        );
    });
}

function setEnergy(deviceId, energyKWh) {
    return new Promise((resolve, reject) => {
        const topic = `energymeter/${deviceId}/command`;
        const payload = JSON.stringify({
            action: "set_energy",
            energyKWh: Number(energyKWh)
        });
        client.publish(topic, payload, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

function resetChannelEnergy(deviceId, channelId) {
    return new Promise((resolve, reject) => {
        const topic = `energymeter/${deviceId}/command`;
        const payload = JSON.stringify({
            action: "reset_channel_energy",
            channelId: Number(channelId)
        });
        client.publish(topic, payload, (err) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function ensureDailyRowsForAllDevices() {
    const today = getISTDateString();
    if (dailyRowsEnsuredDate === today) return;
    for (const deviceData of latestDevices.values()) {
        database.saveDailyHistory(
            deviceData.deviceId,
            deviceData.energyKWh,
            (err) => {
                if (err) {
                    console.error(
                        `Failed to ensure daily row for ${deviceData.deviceId}:`,
                        err.message
                    );
                }
            }
        );
    }
    dailyRowsEnsuredDate = today;
}
setInterval(ensureDailyRowsForAllDevices, 60 * 1000);

module.exports = {
    start,
    latestDevices,
    mqttEvents,
    deleteWiFi,
    requestWiFi,
    addWiFi,
    setEnergy,
    resetChannelEnergy,
    pendingWiFiRequests,
    lastDatabaseSave,
    lastLoadHistorySave,
    dailyLoadFinalized
};
