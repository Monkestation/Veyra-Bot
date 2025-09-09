/**
 * Returns a human friendly UTC date which is not actually accurate but good enough for a human to read.
 * @param {Date} [date=new Date()] 
 * @returns {string}
 */
function getFilenameFriendlyUTCDate(date = new Date()) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}_UTC`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve,ms))
}

function BooleanLike(val) {
  if (typeof val === "string") {
    if (!Number.isNaN(parseInt(val))) {
      return Boolean(parseInt(val))
    } else {
      // what the fuck am i doing
      return (/^true|false|y(?:es)?|no?|1|0/i).test(val)
    }
  } else {
    return Boolean(val);
  }
}


module.exports = {
  getFilenameFriendlyUTCDate,
  sleep,
  BooleanLike
};
