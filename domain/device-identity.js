function normalizeSerialNumber(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function isValidSerialNumber(value) {
  return /^SM-MOON-[A-Z0-9]{4}$/.test(normalizeSerialNumber(value))
}

function matchesDiscoveredDevice(serialNumber, device) {
  const expected = normalizeSerialNumber(serialNumber)
  const discovered = normalizeSerialNumber(device && device.serialNumber)
  return isValidSerialNumber(expected) && isValidSerialNumber(discovered) && expected === discovered
}

module.exports = { normalizeSerialNumber, isValidSerialNumber, matchesDiscoveredDevice }
