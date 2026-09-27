/**
 * Rule-based savings/health tips from one day's summary.
 * Pass whatever fields you have available per device/user; each rule
 * checks for its own fields and falls through if not present.
 */
function generateTip({ kwh, peakW, avgPF, prevDayKwh, prevWeekAvgKwh, minutesOffline }) {
  const tips = [];

  if (typeof prevDayKwh === 'number' && prevDayKwh > 0 && kwh > prevDayKwh * 1.25) {
    const pct = Math.round(((kwh - prevDayKwh) / prevDayKwh) * 100);
    tips.push(`Usage jumped ${pct}% vs yesterday — check if a heavy appliance was left running longer than usual.`);
  }

  if (typeof prevWeekAvgKwh === 'number' && prevWeekAvgKwh > 0 && kwh > prevWeekAvgKwh * 1.3) {
    tips.push(`You're running well above your weekly average today — worth a quick look at what's drawing extra load.`);
  }

  if (typeof avgPF === 'number' && avgPF < 0.85) {
    tips.push(`Average power factor was ${avgPF.toFixed(2)} — low PF can mean inefficient appliances or motor loads; consider a PF correction check.`);
  }

  if (typeof peakW === 'number' && peakW > 4000) {
    tips.push(`Peak load hit ${peakW}W — if this coincides with your sanctioned load limit, staggering high-power appliances could avoid tripping.`);
  }

  if (typeof minutesOffline === 'number' && minutesOffline > 60) {
    tips.push(`Your device was offline for ${Math.round(minutesOffline)} min today — check WiFi/power stability at the install site.`);
  }

  if (tips.length === 0) {
    tips.push(`Consumption looked steady today — no anomalies detected. Keep it up!`);
  }

  // Keep to one tip per message to fit the template variable cleanly.
  return tips[0];
}

module.exports = { generateTip };