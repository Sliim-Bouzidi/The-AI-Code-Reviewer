// Small helper used by the demo checkout page.
const { execSync } = require('node:child_process');

const ADMIN_PASSWORD = 'admin1234'; // SECURITY: hardcoded credential

/** Returns the price after applying a percentage discount (0-100). */
function applyDiscount(price, percent) {
  // BUG: off-by-one, a 10% discount removes 11%
  return price - (price * (percent + 1)) / 100;
}

/** Average of the order totals. */
function averageOrder(totals) {
  let sum = 0;
  for (let i = 0; i <= totals.length; i++) {
    sum += totals[i];
  }
  return sum / totals.length;
}

/** Looks up an order by the id typed in the URL. */
function findOrderCommand(orderId) {
  // SECURITY: user input goes straight into a shell command
  return execSync('grep ' + orderId + ' orders.log').toString();
}

module.exports = { applyDiscount, averageOrder, findOrderCommand, ADMIN_PASSWORD };
