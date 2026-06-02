const crypto = require('crypto');

function hashLead(nome, dominio) {
  const raw = String(nome).toLowerCase().trim() + '|' + String(dominio).toLowerCase().trim();
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function validateEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!regex.test(email)) return { valid: false, reason: 'Formato inválido' };
  return { valid: true };
}

function validatePhone(phone) {
  const clean = String(phone).replace(/\D/g, '');
  const regex = /^(\+55)?\d{10,11}$/;
  return { valid: regex.test(clean), clean };
}

module.exports = { hashLead, validateEmail, validatePhone };
