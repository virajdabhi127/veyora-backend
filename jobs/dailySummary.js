const cron = require('node-cron');
const database = require('../database');
const { sendDailySummary } = require('../services/whatsappService');
const { generateTip } = require('../services/tips');

/**
 * Gets all users who have a WhatsApp number set, along with their devices.
 */
function getUsersWithDevices(callback) {
  database.getAllUsers((err, users) => {
    if (err) return callback(err);

    const usersWithNumber = users.filter(
      (u) => u.whatsappNumber && u.whatsappNumber.trim() !== ''
    );

    if (usersWithNumber.length === 0) {
      return callback(null, []);
    }

    let remaining = usersWithNumber.length;
    let hadError = null;
    const result = [];

    usersWithNumber.forEach((user) => {
      database.getUserByUserId(user.userid, (err, userRow) => {
        if (err || !userRow) {
          remaining--;
          if (remaining === 0) callback(hadError, result);
          return;
        }
        database.getDevicesByUser(userRow.user_id, (err, devices) => {
          if (!err && devices) {
            devices.forEach((d) =>
              result.push({ ...user, deviceId: d.deviceId })
            );
          } else if (err) {
            hadError = err;
          }
          remaining--;
          if (remaining === 0) callback(hadError, result);
        });
      });
    });
  });
}

function runDailySummaryJob() {
  getUsersWithDevices((err, userDevices) => {
    if (err) {
      console.error('[dailySummary] Failed to load users/devices:', err.message);
      return;
    }

    console.log(`[dailySummary] Sending to ${userDevices.length} user-device pairs`);

    const displayDate = new Date().toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Kolkata',
    });

    userDevices.forEach(({ userid, username, whatsappNumber, deviceId }) => {
      database.getDailyEnergy(deviceId, (err, energy) => {
        if (err) {
          console.error(`[dailySummary] getDailyEnergy failed for ${deviceId}:`, err.message);
          return;
        }

        database.getDailyLoad(deviceId, (err, load) => {
          if (err) {
            console.error(`[dailySummary] getDailyLoad failed for ${deviceId}:`, err.message);
            return;
          }

          const kwh = energy.today;
          const prevDayKwh = energy.yesterday;
          const peakW = load ? Number(load.peak_load) : 0;
          const cost = database.calculatePGVCLCost(kwh);

          const tip = generateTip({
            kwh,
            prevDayKwh,
            peakW,
          });

          sendDailySummary(whatsappNumber, {
            name: username || userid,
            date: displayDate,
            kwh: kwh.toFixed(2),
            cost: cost.toFixed(2),
            peakW: Math.round(peakW).toString(),
            tip,
          }).then((result) => {
            if (!result.success) {
              console.error(`[dailySummary] Send failed for ${userid} (${deviceId}):`, result.error);
            }
          });
        });
      });
    });
  });
}

// Runs every day at 00:00 IST
cron.schedule('0 0 * * *', runDailySummaryJob, {
  timezone: 'Asia/Kolkata',
});

module.exports = { runDailySummaryJob };