function text(input) {
  if (typeof input !== 'string') return '';
  let str = input.trim().substring(0, 4000);
  str = str.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
  str = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return str;
}

function phone(input) {
  if (input == null) return '';
  const digits = String(input).replace(/\D/g, '').substring(0, 15);
  return digits;
}

function email(input) {
  if (typeof input !== 'string') return null;
  let str = input.trim().toLowerCase().substring(0, 254);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(str) ? str : null;
}

function command(input) {
  if (typeof input !== 'string') return null;
  let cmd = input.trim().split(/\s+/)[0].toLowerCase();
  const cmdRegex = /^\/[a-z0-9_]+$/;
  return cmdRegex.test(cmd) ? cmd : null;
}

function json(input) {
  if (typeof input !== 'string') {
    return (input !== null && typeof input === 'object') ? input : null;
  }
  try {
    return JSON.parse(input);
  } catch (e) {
    return null;
  }
}

function sql(input) {
  if (typeof input !== 'string') return null;
  if (/;|\-\-|\b(DROP|UNION|SELECT|INSERT|DELETE)\b/i.test(input)) {
    return null;
  }
  return input;
}

module.exports = {
  text,
  phone,
  email,
  command,
  json,
  sql
};
