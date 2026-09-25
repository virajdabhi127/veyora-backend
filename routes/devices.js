const express = require("express");
const router = express.Router();
const database = require("../database");
const mqtt = require("../mqtt");
const authenticate = require("../middleware/auth");
const requireDeviceOwner = require("../middleware/deviceOwner");

router.get("/", authenticate, (req, res) => {
    const userId = req.user.user_id;
    database.getDevicesByUser(userId, (err, devices) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            username: req.user.username,
            devices
        });
    });
});

// All remaining routes operate on one device. Authentication alone is not
// sufficient: the authenticated user must own that device.
router.use("/:deviceId", authenticate, requireDeviceOwner);

router.get("/:deviceId/daily-energy", (req, res) => {
    const deviceId = req.params.deviceId;
    database.getDailyEnergy(deviceId, (err, energy) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            deviceId: deviceId,
            today: energy.today,
            yesterday: energy.yesterday
        });
    });
});

router.get("/:deviceId/monthly-energy", (req, res) => {
    const deviceId = req.params.deviceId;
    database.getMonthlyEnergy(deviceId, (err, energy) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            deviceId: deviceId,
            // Energy
            currentMonth: energy.currentMonth,
            previousMonth: energy.previousMonth,
            // Today's usage
            todayEnergy: energy.todayEnergy,
            // PGVCL estimated energy charges
            monthlyCost: energy.monthlyCost,
            todayCost: energy.todayCost
        });
    });
});

router.get("/:deviceId/channels", (req, res) => {
    const deviceId = req.params.deviceId;
    database.getDeviceChannels(deviceId, (err, channels) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            deviceId: deviceId,
            channels
        });
    });
});

router.put("/:deviceId/channels/:channelId", (req, res) => {
    const deviceId = req.params.deviceId;
    const channelId = Number(req.params.channelId);
    const channelName = req.body.channelName;
    if (!Number.isInteger(channelId) || channelId < 1) {
        return res.status(400).json({
            success: false,
            message: "Invalid channel ID."
        });
    }
    if (
        typeof channelName !== "string" ||
        channelName.trim().length === 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Channel name cannot be empty."
        });
    }
    if (channelName.trim().length > 30) {
        return res.status(400).json({
            success: false,
            message: "Channel name must be 30 characters or less."
        });
    }
    database.renameDeviceChannel(
        deviceId,
        channelId,
        channelName.trim(),
        (err) => {
            if (err) {
                if (err.message === "Channel not found.") {
                    return res.status(404).json({
                        success: false,
                        message: "Channel not found."
                    });
                }
                return res.status(500).json({
                    success: false,
                    message: "Database error."
                });
            }
            mqtt.publishChannelNames(deviceId);
            res.json({
                success: true,
                message: "Channel name updated successfully."
            });
        }
    );
});

router.post("/:deviceId/reset-channel-energy", async (req, res) => {
    const deviceId = req.params.deviceId;
    const channelId = Number(req.body.channelId);
    if (!Number.isInteger(channelId) || channelId < 1) {
        return res.status(400).json({
            success: false,
            message: "Invalid channel ID."
        });
    }
    database.getDevice(deviceId, async (err, device) => {
        if (err) {
            console.error(
                `Failed to fetch device ${deviceId}:`,
                err.message
            );
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        if (!device) {
            return res.status(404).json({
                success: false,
                message: "Device not found."
            });
        }
        if (!device.status) {
            return res.status(409).json({
                success: false,
                message: "Device is offline. Reset commands cannot be sent right now."
            });
        }
        try {
            await mqtt.resetChannelEnergy(deviceId, channelId);
        } catch (err) {
            console.error(
                `Failed to send reset command to ${deviceId}:`,
                err.message
            );
            return res.status(504).json({
                success: false,
                message: "Device did not respond."
            });
        }
        database.resetChannelEnergy(deviceId, channelId, (err) => {
            if (err) {
                console.error(
                    `Failed to reset channel energy for ${deviceId}:`,
                    err.message
                );
                return res.status(500).json({
                    success: false,
                    message: "Database error."
                });
            }
            res.json({
                success: true,
                message: "Channel energy reset successfully."
            });
        });
    });
});

router.get("/:deviceId/wifi", async (req, res) => {
    const deviceId = req.params.deviceId;
    try {
        const device = await new Promise((resolve, reject) => {
            database.getDevice(
                deviceId,
                (err, device) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(device);
                }
            );
        });
        if (!device) {
            return res.status(404).json({
                success: false,
                message: "Device not found."
            });
        }
        const wifi = await mqtt.requestWiFi(deviceId, 5000);
        res.json({
            success: true,
            deviceId,
            ...wifi
        });
    } catch (err) {
        console.error(
            `Failed to get Wi-Fi for ${deviceId}:`,
            err.message
        );
        return res.status(504).json({
            success: false,
            message: "Device did not respond."
        });
    }
});

router.delete("/:deviceId/wifi/:wifiId", async (req, res) => {
    const deviceId = req.params.deviceId;
    const wifiId = Number(req.params.wifiId);
    if (!Number.isInteger(wifiId) || wifiId < 0 || wifiId >= 5) {
        return res.status(400).json({
            success: false,
            message: "Invalid Wi-Fi ID."
        });
    }
    try {
        const device = await new Promise((resolve, reject) => {
            database.getDevice(
                deviceId,
                (err, device) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(device);
                }
            );
        });
        if (!device) {
            return res.status(404).json({
                success: false,
                message: "Device not found."
            });
        }
        const result = await mqtt.deleteWiFi(
            deviceId,
            wifiId,
            5000
        );
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.message || "Failed to delete Wi-Fi network."
            });
        }
        return res.json({
            success: true,
            message: result.message ||
                "Wi-Fi network deleted successfully."
        });
    } catch (err) {
        console.error(
            `Failed to delete Wi-Fi ${wifiId} from ${deviceId}:`,
            err.message
        );
        return res.status(504).json({
            success: false,
            message: "Device did not respond."
        });
    }
});

router.post("/:deviceId/wifi", async (req, res) => {
    const deviceId = req.params.deviceId;
    const ssid = req.body.ssid;
    const password = req.body.password;
    if (
        typeof ssid !== "string" ||
        ssid.trim().length === 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Wi-Fi name cannot be empty."
        });
    }
    if (
        typeof password !== "string" ||
        password.length === 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Wi-Fi password cannot be empty."
        });
    }
    if (ssid.trim().length > 32) {
        return res.status(400).json({
            success: false,
            message: "Wi-Fi name must be 32 characters or less."
        });
    }
    try {
        const device = await new Promise((resolve, reject) => {
            database.getDevice(
                deviceId,
                (err, device) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(device);
                }
            );
        });
        if (!device) {
            return res.status(404).json({
                success: false,
                message: "Device not found."
            });
        }
        const result = await mqtt.addWiFi(
            deviceId,
            ssid.trim(),
            password,
            5000
        );
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message:
                    result.message ||
                    "Failed to add Wi-Fi network."
            });
        }
        return res.json({
            success: true,
            message: result.message || "Wi-Fi network added successfully."
        });
    } catch (err) {
        console.error(
            `Failed to add Wi-Fi to ${deviceId}:`,
            err.message
        );
        return res.status(504).json({
            success: false,
            message: "Device did not respond."
        });
    }
});

router.get("/:deviceId/load-history", (req, res) => {
    const deviceId = req.params.deviceId;
    database.getLoadHistory(deviceId, (err, history) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            deviceId: deviceId,
            history
        });
    });
});

router.get("/:deviceId/daily-load", (req, res) => {
    const deviceId = req.params.deviceId;
    database.getDailyLoad(deviceId, (err, load) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            deviceId: deviceId,
            load
        });
    });
});

router.get("/:deviceId/monthly-load", (req, res) => {
    const deviceId = req.params.deviceId;
    database.getMonthlyLoad(deviceId, (err, load) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: "Database error."
            });
        }
        res.json({
            success: true,
            deviceId: deviceId,
            load
        });
    });
});

module.exports = router;
